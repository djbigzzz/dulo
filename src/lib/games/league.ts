/**
 * League — the weekly paper-trading GameModule (docs/HANDOFF.md §3.2).
 *
 * Week window   Monday 00:00 UTC -> Friday 20:00 UTC. currentWeek(now) is the League week
 *               that is current for trading and display: this calendar week while it is
 *               still open, otherwise next week (the same roll-forward as prisma/seed.ts
 *               leagueWeekFor, so the seed and the cron always agree on one League row).
 *               The League never pauses (decided 15 Sep, C6 / REVIEW M-H): between Friday
 *               20:00 and Monday 00:00 the upcoming League already exists and accepts
 *               trades, so weekend trades count toward next week's League. isTradingOpen
 *               has no lower bound; only a settled League (or one whose week has ended)
 *               refuses with 409 CLOSED_MESSAGE.
 * Minimum       a trade's notional (qty * fill) must be at least MIN_TRADE_USD ($10), so
 *               dust trades cannot farm Scout. A sell that closes the whole position is
 *               exempt, otherwise a sub-$10 remainder could never be sold.
 * Accounts      one LeagueAccount per (league, user), created on the first trade with
 *               STARTING_CASH_USD and positions {} keyed by CAIP-19 asset id.
 * Trades        placeTrade quotes through lib/price (getPriceBySymbol), fills at the quote
 *               +/- SPREAD (0.1%) and applies cash / position / LeagueTrade writes in ONE
 *               interactive transaction that locks and re-reads the account row
 *               (SELECT ... FOR UPDATE), so two concurrent trades can never both spend the
 *               same cash. Stale quotes are allowed (paper money; the demo runs on weekends)
 *               but the fill's source and publish time are recorded on the LeagueTrade and
 *               echoed back so the UI can show the price chip. No quote at all -> 400.
 * Equity        recomputeEquity(leagueId): ONE batched getPrices for every held asset,
 *               equity = cash + sum(qty * price), falling back to the position's avgPrice
 *               when a price is null (those symbols are reported in `unpriced`), rank =
 *               1-based by equity desc then userId asc. Idempotent. The rank each account
 *               had before the write is kept in an in-memory map (rankDelta) so the API
 *               can show movement since the previous recompute; it is per process and
 *               returns null when unknown (fresh account, or a new server instance).
 * Rollover      rollover(now): every League with status "open" and weekEnd < now gets a
 *               final recompute, then ONE transaction that first claims the week
 *               (updateMany where status "open" -> "settled"; only a claim with count 1 goes
 *               on) and then writes PointsEvents for ranks 1..10 (RANK_POINTS, source
 *               "league", ref league:<id>:rank:<n>, guarded by @@unique(userId, seasonId, ref)
 *               via createMany skipDuplicates). A tick that loses the claim to an overlapping
 *               tick writes nothing and does not ensure the next week. The winner ensures the
 *               next week's League. Places are overall ranks and include house bots, but only
 *               real accounts with at least MIN_TRADES_FOR_WEEKLY_POINTS (3) trades that week
 *               are paid; a place held by a bot or by an account with fewer trades pays nobody.
 * Tick          ensureLeague for the current Season -> seedBots when that League has fewer
 *               bot accounts than BOT_HANDLES (seedBots skips the ones already in, so a
 *               half-finished seed heals; own try/catch: a pricing hiccup is logged and the
 *               next tick retries) -> recomputeEquity for every open League -> rollover. So the
 *               League the Friday rollover opens is never an empty board, and a fresh deploy
 *               whose cron runs before the seed gets its bots too. The cron runs every 5
 *               minutes (§3.2 says 60s): GET /api/v1/league also recomputes when the last
 *               recompute is older than RECOMPUTE_MIN_INTERVAL_MS (recomputeIfStale), which
 *               is cheap because lib/price caches quotes for 30s.
 * Bots          15 seeded accounts (BOT_HANDLES) so the board is never empty. Deterministic
 *               user ids (bot-league-<n>) and wallets (Keypair.fromSeed(sha256(handle))),
 *               3-8 trades each from a seeded PRNG, priced from lib/price at seed time with
 *               a fixed fallback table so seeding works offline. Idempotent per League.
 *               Every seedBots run first converges existing bot Users on BOT_HANDLES
 *               (syncBotIdentities: handle + wallet address, only where they differ, never
 *               touching accounts or trades), so renaming a handle reaches a seeded database.
 *               Seeded mid-week, fills sit within +/-3% of the quote (fills "earlier in the
 *               week"). Seeded before the week starts (at the Friday rollover or on a
 *               weekend) they fill at the quote with no jitter, so every bot starts the new
 *               week at ~$10,000 (spread only) and trade timestamps are the seed instant
 *               (never displayed). Bots never score points and never sit on the Season
 *               leaderboard.
 *
 * Server-only: imports Prisma, lib/price and node:crypto. Every DB-backed function takes an
 * optional Prisma client so prisma/seed-league.ts can pass its own.
 */
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AssetId, GameModule, PriceQuote } from "@/lib/core";
import { SOLANA_MAINNET, isAssetId, solanaTokenAssetId } from "@/lib/core";
import { XSTOCKS_FALLBACK } from "@/lib/assets/xstocks";
import { UnknownAssetError, getPriceBySymbol, getPrices, getPricesBySymbols } from "@/lib/price";
import { ApiError } from "@/lib/server/api";
import { db } from "@/lib/server/db";
import { BOT_HANDLES, botWalletAddress } from "./bot-identity";
import { BOT_USER_ID_PREFIX } from "./bots";
import { MIN_TRADES_FOR_WEEKLY_POINTS } from "./ledger-policy";

const LOG_PREFIX = "[games/league]";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Virtual cash every account starts the week with. */
export const STARTING_CASH_USD = 10_000;
/** Virtual spread: buys fill at price * (1 + SPREAD), sells at price * (1 - SPREAD). */
export const SPREAD = 0.001;
/** Friday close of the League week, UTC hour. */
export const WEEK_END_HOUR_UTC = 20;
/** Points for ranks 1..10 at rollover. */
export const RANK_POINTS: readonly number[] = Object.freeze([1000, 700, 500, 300, 200, 100, 100, 100, 100, 100]);
/** Rows on the League leaderboard. */
export const LEADERBOARD_LIMIT = 50;
/** Trades echoed back on the account view. */
export const RECENT_TRADES_LIMIT = 20;
/** Quantities are rounded to this many decimals. */
export const QTY_DECIMALS = 6;
/** GET /api/v1/league recomputes equity when the last recompute is older than this. */
export const RECOMPUTE_MIN_INTERVAL_MS = 60_000;
/** The fixed tradable list (bots trade these; users can also trade any xStock lib/price knows). */
export const TRADABLE_SYMBOLS: readonly string[] = Object.freeze([
  "TSLAx",
  "NVDAx",
  "AAPLx",
  "SPYx",
  "QQQx",
  "METAx",
  "GOOGLx",
  "AMZNx",
  "MSFTx",
  "COINx",
  "MSTRx",
  "HOODx",
]);

/** Smallest trade notional (qty * fill, USD). Closing a whole position is exempt. */
export const MIN_TRADE_USD = 10;
export const MIN_TRADE_MESSAGE = "Minimum paper trade is $10";

/**
 * 409 for a League that no longer takes trades. With weekends open this only happens in the
 * moment a week is settling: the next League already accepts trades.
 */
export const CLOSED_MESSAGE = "This competition week is settled. Weekend trades count toward next week's competition; try again in a moment";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const QTY_EPS = 1e-9;
const CASH_EPS = 1e-6;

/** Any Prisma client that can run the League's queries (the app singleton or the seed's own). */
export type LeagueDb = PrismaClient;

// ---------------------------------------------------------------------------
// Week windows (pure)
// ---------------------------------------------------------------------------

export interface LeagueWeek {
  /** Monday 00:00 UTC. */
  weekStart: Date;
  /** Friday 20:00 UTC of the same week. */
  weekEnd: Date;
}

/** The Mon-Sun calendar week (UTC) containing `at`, as a League window. */
export function weekContaining(at: Date): LeagueWeek {
  const daysSinceMonday = (at.getUTCDay() + 6) % 7; // Sunday -> 6
  const monday = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - daysSinceMonday));
  return { weekStart: monday, weekEnd: new Date(monday.getTime() + 4 * DAY_MS + WEEK_END_HOUR_UTC * HOUR_MS) };
}

/** The window one week after `week`. */
export function nextWeek(week: LeagueWeek): LeagueWeek {
  return { weekStart: new Date(week.weekStart.getTime() + 7 * DAY_MS), weekEnd: new Date(week.weekEnd.getTime() + 7 * DAY_MS) };
}

export interface CurrentWeek extends LeagueWeek {
  /** True while `now` is inside [weekStart, weekEnd); false on the weekend before it starts. */
  started: boolean;
}

/**
 * The League week that is current for trading and display. Inside Mon 00:00 - Fri 20:00 UTC
 * that is this week. From Friday 20:00 UTC until Monday it is NEXT week (not started yet, but
 * already taking the weekend's trades), which matches prisma/seed.ts leagueWeekFor so both
 * create the same League row.
 */
export function currentWeek(now: Date): CurrentWeek {
  const week = weekContaining(now);
  if (now.getTime() >= week.weekEnd.getTime()) return { ...nextWeek(week), started: false };
  return { ...week, started: true };
}

/**
 * Trades are accepted by any League that has not been settled and whose week has not ended.
 * No lower bound: weekend trades land in next week's League (C6).
 */
export function isTradingOpen(league: { weekStart: Date; weekEnd: Date; status: string }, now: Date): boolean {
  return league.status === "open" && now.getTime() < league.weekEnd.getTime();
}

// ---------------------------------------------------------------------------
// Positions JSON + trade math (pure, exported for tests)
// ---------------------------------------------------------------------------

export type TradeSide = "buy" | "sell";

export interface LeaguePosition {
  symbol: string;
  qty: number;
  /** Volume-weighted average fill price of the buys still open. */
  avgPrice: number;
}

/** LeagueAccount.positions: { [assetId (CAIP-19)]: { symbol, qty, avgPrice } }. */
export type Positions = Record<string, LeaguePosition>;

export interface AccountState {
  cashUsd: number;
  positions: Positions;
}

export interface TradeSpec {
  assetId: string;
  symbol: string;
  side: TradeSide;
  qty: number;
  /** Fill price, spread already applied. */
  fill: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

/** Prisma Decimal / number / string -> number (0 for anything unreadable). */
export function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Coerce the positions JSON column. Malformed or empty entries are dropped, never thrown. */
export function parsePositions(json: unknown): Positions {
  const out: Positions = {};
  if (!json || typeof json !== "object" || Array.isArray(json)) return out;
  for (const [assetId, v] of Object.entries(json as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const p = v as Record<string, unknown>;
    const qty = num(p.qty);
    if (qty <= QTY_EPS) continue;
    const avgPrice = num(p.avgPrice);
    out[assetId] = { symbol: typeof p.symbol === "string" && p.symbol ? p.symbol : assetId, qty, avgPrice: avgPrice > 0 ? avgPrice : 0 };
  }
  return out;
}

/** Positions as the JSON column value (plain data; the interface just lacks an index signature). */
export function positionsJson(positions: Positions): Prisma.InputJsonValue {
  return positions as unknown as Prisma.InputJsonValue;
}

/** Fill price with the virtual spread applied: buys pay up, sells receive less. */
export function fillPrice(price: number, side: TradeSide): number {
  return round6(side === "buy" ? price * (1 + SPREAD) : price * (1 - SPREAD));
}

/** Validate a requested quantity: finite, > 0, rounded to QTY_DECIMALS. Throws ApiError(400). */
export function normaliseQty(qty: unknown): number {
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) throw new ApiError("Quantity must be a positive number", 400);
  const rounded = round6(qty);
  if (rounded <= 0) throw new ApiError(`Quantity must be at least ${1 / 10 ** QTY_DECIMALS}`, 400);
  return rounded;
}

/**
 * Apply one fill to an account state. Buys need cash, sells need the position; avgPrice is
 * volume-weighted on buys and untouched on sells. Returns a new state; throws ApiError(400).
 */
export function applyTrade(state: AccountState, t: TradeSpec): AccountState {
  const positions: Positions = { ...state.positions };
  const notional = round6(t.qty * t.fill);
  if (t.side === "buy") {
    if (notional > state.cashUsd + CASH_EPS) {
      throw new ApiError(`Not enough cash: ${t.qty} ${t.symbol} costs $${notional.toFixed(2)}, you have $${state.cashUsd.toFixed(2)}`, 400);
    }
    const prev = positions[t.assetId];
    const qty = round8((prev?.qty ?? 0) + t.qty);
    const avgPrice = prev ? round6(((prev.qty * prev.avgPrice) + t.qty * t.fill) / qty) : t.fill;
    positions[t.assetId] = { symbol: t.symbol, qty, avgPrice };
    return { cashUsd: round6(state.cashUsd - notional), positions };
  }
  const prev = positions[t.assetId];
  if (!prev || prev.qty + QTY_EPS < t.qty) {
    throw new ApiError(`Not enough ${t.symbol}: you hold ${prev ? prev.qty : 0}`, 400);
  }
  const remaining = round8(prev.qty - t.qty);
  if (remaining <= QTY_EPS) delete positions[t.assetId];
  else positions[t.assetId] = { ...prev, qty: remaining };
  return { cashUsd: round6(state.cashUsd + notional), positions };
}

/**
 * Refuse a trade below MIN_TRADE_USD notional (ApiError 400 MIN_TRADE_MESSAGE). A sell of the
 * whole position is always allowed so a small remainder can still be closed. Pure.
 */
export function assertMinNotional(state: AccountState, t: TradeSpec): void {
  const notional = round6(t.qty * t.fill);
  if (notional + CASH_EPS >= MIN_TRADE_USD) return;
  if (t.side === "sell") {
    const held = state.positions[t.assetId]?.qty ?? 0;
    if (held > QTY_EPS && t.qty + QTY_EPS >= held) return;
  }
  throw new ApiError(MIN_TRADE_MESSAGE, 400);
}

export interface ValuedAccount {
  equityUsd: number;
  /** Symbols valued at their avgPrice because no price was available. */
  unpriced: string[];
}

/** equity = cash + sum(qty * price), avgPrice standing in for a missing price. */
export function valueAccount(cashUsd: number, positions: Positions, prices: ReadonlyMap<string, number | null>): ValuedAccount {
  let equity = cashUsd;
  const unpriced: string[] = [];
  for (const [assetId, p] of Object.entries(positions)) {
    const price = prices.get(assetId);
    if (typeof price === "number" && Number.isFinite(price) && price > 0) {
      equity += p.qty * price;
    } else {
      equity += p.qty * p.avgPrice;
      unpriced.push(p.symbol);
    }
  }
  return { equityUsd: round6(equity), unpriced };
}

export interface RankInput {
  accountId: string;
  userId: string;
  equityUsd: number;
  /** Rank stored before this recompute (null for a fresh account). */
  rank: number | null;
}

export interface RankRow extends RankInput {
  /** New 1-based rank. */
  rank: number;
  prevRank: number | null;
}

/** 1-based rank by equity desc, tie by userId asc. Every row gets a distinct rank. */
export function rankAccounts(rows: readonly RankInput[]): RankRow[] {
  return [...rows]
    .sort((a, b) => {
      if (b.equityUsd !== a.equityUsd) return b.equityUsd - a.equityUsd;
      if (a.userId === b.userId) return 0;
      return a.userId < b.userId ? -1 : 1;
    })
    .map((r, i) => ({ ...r, rank: i + 1, prevRank: r.rank }));
}

/** PointsEvent ref for a League placing. */
export function awardRef(leagueId: string, rank: number): string {
  return `league:${leagueId}:rank:${rank}`;
}

// ---------------------------------------------------------------------------
// In-memory bookkeeping (per process; documented in the header)
// ---------------------------------------------------------------------------

const rankMemory = new Map<string, { prevRank: number | null; rank: number }>();
const lastRecomputeAt = new Map<string, number>();

/**
 * Rank change since the previous recompute for an account: positive = moved up. Null when
 * this process has not recomputed the account yet or it had no rank before (new account).
 */
export function rankDelta(accountId: string, currentRank: number | null): number | null {
  const m = rankMemory.get(accountId);
  if (!m || m.prevRank === null || currentRank === null) return null;
  return m.prevRank - currentRank;
}

/** When recomputeEquity last ran for a League in this process (ms epoch), or null. */
export function lastRecomputedAt(leagueId: string): number | null {
  return lastRecomputeAt.get(leagueId) ?? null;
}

/** Test hook. */
export function resetLeagueMemory(): void {
  rankMemory.clear();
  lastRecomputeAt.clear();
}

// ---------------------------------------------------------------------------
// Season + League rows
// ---------------------------------------------------------------------------

/** The Season whose window contains `now`, else the latest by endsAt (same rule as the UI and cron). */
export async function findCurrentSeasonId(now: Date, client: LeagueDb = db): Promise<string | null> {
  const active = await client.season.findFirst({
    where: { startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { startsAt: "desc" },
    select: { id: true },
  });
  if (active) return active.id;
  const latest = await client.season.findFirst({ orderBy: { endsAt: "desc" }, select: { id: true } });
  return latest?.id ?? null;
}

export interface LeagueRow {
  id: string;
  seasonId: string;
  weekStart: Date;
  weekEnd: Date;
  status: string;
}

/**
 * Upsert the League for currentWeek(now) in a Season. Creates it "open"; on re-run only
 * weekEnd is refreshed, never the status (a settled League stays settled).
 */
export async function ensureLeague(seasonId: string, now: Date, client: LeagueDb = db): Promise<LeagueRow> {
  const { weekStart, weekEnd } = currentWeek(now);
  return client.league.upsert({
    where: { seasonId_weekStart: { seasonId, weekStart } },
    create: { seasonId, weekStart, weekEnd, status: "open" },
    update: { weekEnd },
    select: { id: true, seasonId: true, weekStart: true, weekEnd: true, status: true },
  });
}

/** Throws ApiError(409) unless the League accepts trades at `now`. */
export function assertTradingOpen(league: { weekStart: Date; weekEnd: Date; status: string }, now: Date): void {
  if (!isTradingOpen(league, now)) throw new ApiError(CLOSED_MESSAGE, 409);
}

// ---------------------------------------------------------------------------
// Accounts + trades
// ---------------------------------------------------------------------------

export interface AccountRow {
  id: string;
  leagueId: string;
  userId: string;
  cashUsd: unknown;
  positions: unknown;
  equityUsd: unknown;
  rank: number | null;
  isBot: boolean;
}

const accountSelect = {
  id: true,
  leagueId: true,
  userId: true,
  cashUsd: true,
  positions: true,
  equityUsd: true,
  rank: true,
  isBot: true,
} satisfies Prisma.LeagueAccountSelect;

/** The user's account in a League, created with STARTING_CASH_USD when missing. */
export async function getOrCreateAccount(leagueId: string, userId: string, client: Prisma.TransactionClient | LeagueDb = db): Promise<AccountRow> {
  return client.leagueAccount.upsert({
    where: { leagueId_userId: { leagueId, userId } },
    create: { leagueId, userId, cashUsd: STARTING_CASH_USD.toFixed(6), positions: {}, equityUsd: STARTING_CASH_USD.toFixed(6) },
    update: {},
    select: accountSelect,
  });
}

export interface PlaceTradeInput {
  userId: string;
  symbol: string;
  side: TradeSide;
  qty: number;
}

export interface TradeRow {
  id: string;
  leagueAccountId: string;
  symbol: string;
  side: string;
  qty: unknown;
  price: unknown;
  priceSource: string;
  ts: Date;
}

export interface PlaceTradeResult {
  league: LeagueRow;
  trade: TradeRow;
  account: AccountRow;
  /** The quote the fill was derived from (source / publishedAt / stale for the UI chip). */
  quote: PriceQuote;
  fill: number;
}

/**
 * Place a paper trade in the current League. See the module header for the rules. Throws
 * ApiError: 400 (bad qty, unknown symbol, no price, not enough cash / position), 409 (closed).
 */
export async function placeTrade(input: PlaceTradeInput, now: Date = new Date(), client: LeagueDb = db): Promise<PlaceTradeResult> {
  const side: TradeSide = input.side === "sell" ? "sell" : "buy";
  const qty = normaliseQty(input.qty);
  const symbol = String(input.symbol ?? "").trim();
  if (!symbol) throw new ApiError("Symbol is required", 400);

  const seasonId = await findCurrentSeasonId(now, client);
  if (!seasonId) throw new ApiError("No Season is open", 409);
  const league = await ensureLeague(seasonId, now, client);
  assertTradingOpen(league, now);

  let quote: PriceQuote;
  try {
    quote = await getPriceBySymbol(symbol);
  } catch (e) {
    if (e instanceof UnknownAssetError) throw new ApiError(`Unknown xStock: ${symbol}`, 400);
    throw e;
  }
  if (quote.price === null || !(quote.price > 0)) throw new ApiError(`No price for ${quote.symbol} right now`, 400);
  const fill = fillPrice(quote.price, side);

  const { trade, account } = await client.$transaction(async (tx) => {
    const created = await getOrCreateAccount(league.id, input.userId, tx);
    // Row lock so a concurrent trade on the same account waits for this one, then re-read.
    await tx.$queryRaw`SELECT "id" FROM "LeagueAccount" WHERE "id" = ${created.id} FOR UPDATE`;
    const fresh = await tx.leagueAccount.findUniqueOrThrow({ where: { id: created.id }, select: accountSelect });
    const state: AccountState = { cashUsd: toNumber(fresh.cashUsd), positions: parsePositions(fresh.positions) };
    const spec: TradeSpec = { assetId: quote.assetId, symbol: quote.symbol, side, qty, fill };
    assertMinNotional(state, spec);
    const next = applyTrade(state, spec);
    // Equity estimate for the response: this symbol at its quote, the rest at cost. The
    // recompute below (and the next tick) prices everything.
    const estimate = valueAccount(next.cashUsd, next.positions, new Map([[quote.assetId, quote.price]])).equityUsd;
    const trade = await tx.leagueTrade.create({
      data: {
        leagueAccountId: fresh.id,
        symbol: quote.symbol,
        side,
        qty: qty.toFixed(8),
        price: fill.toFixed(6),
        priceSource: quote.source,
        ts: now,
      },
    });
    const account = await tx.leagueAccount.update({
      where: { id: fresh.id },
      data: { cashUsd: next.cashUsd.toFixed(6), positions: positionsJson(next.positions), equityUsd: estimate.toFixed(6) },
      select: accountSelect,
    });
    return { trade, account };
  });

  // Fresh equity + rank for the response. A pricing/DB hiccup here must not undo a trade
  // that is already committed; the next tick repairs it.
  let settledAccount: AccountRow = account;
  try {
    const r = await recomputeEquity(league.id, client, now);
    const mine = r.rows.find((row) => row.accountId === account.id);
    if (mine) settledAccount = { ...account, equityUsd: mine.equityUsd, rank: mine.rank };
  } catch (e) {
    console.warn(`${LOG_PREFIX} recompute after trade failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { league, trade, account: settledAccount, quote, fill };
}

// ---------------------------------------------------------------------------
// Equity + rank
// ---------------------------------------------------------------------------

export interface RecomputeResult {
  leagueId: string;
  accounts: number;
  /** Symbols that had to be valued at cost because no price was available. */
  unpriced: string[];
  rows: RankRow[];
  at: Date;
}

/**
 * Re-price every account in a League with one batched getPrices, write equityUsd + rank.
 * Idempotent: the same prices always produce the same ranks.
 */
export async function recomputeEquity(leagueId: string, client: LeagueDb = db, now: Date = new Date()): Promise<RecomputeResult> {
  const accounts = await client.leagueAccount.findMany({
    where: { leagueId },
    select: { id: true, userId: true, cashUsd: true, positions: true, rank: true },
  });
  const parsed = accounts.map((a) => ({ ...a, pos: parsePositions(a.positions) }));
  const assetIds = [...new Set(parsed.flatMap((a) => Object.keys(a.pos)))].filter(isAssetId);
  const quotes = assetIds.length > 0 ? await getPrices(assetIds as AssetId[]) : new Map<AssetId, PriceQuote>();
  const prices = new Map<string, number | null>();
  for (const [id, q] of quotes) prices.set(id, q.price);

  const unpriced = new Set<string>();
  const valued: RankInput[] = parsed.map((a) => {
    const v = valueAccount(toNumber(a.cashUsd), a.pos, prices);
    for (const s of v.unpriced) unpriced.add(s);
    return { accountId: a.id, userId: a.userId, equityUsd: v.equityUsd, rank: a.rank };
  });
  const rows = rankAccounts(valued);

  if (rows.length > 0) {
    await client.$transaction(
      rows.map((r) =>
        client.leagueAccount.update({
          where: { id: r.accountId },
          data: { equityUsd: r.equityUsd.toFixed(6), rank: r.rank },
          select: { id: true },
        }),
      ),
    );
  }
  for (const r of rows) rankMemory.set(r.accountId, { prevRank: r.prevRank, rank: r.rank });
  lastRecomputeAt.set(leagueId, now.getTime());
  if (unpriced.size > 0) console.warn(`${LOG_PREFIX} ${leagueId}: no price for ${[...unpriced].join(", ")}; valued at cost`);

  return { leagueId, accounts: rows.length, unpriced: [...unpriced], rows, at: now };
}

/** recomputeEquity unless it ran within RECOMPUTE_MIN_INTERVAL_MS in this process. Returns null when skipped. */
export async function recomputeIfStale(leagueId: string, now: Date = new Date(), client: LeagueDb = db): Promise<RecomputeResult | null> {
  const last = lastRecomputeAt.get(leagueId);
  if (last !== undefined && now.getTime() - last < RECOMPUTE_MIN_INTERVAL_MS) return null;
  return recomputeEquity(leagueId, client, now);
}

// ---------------------------------------------------------------------------
// Rollover
// ---------------------------------------------------------------------------

export interface SettledLeague {
  leagueId: string;
  /** PointsEvents attempted (real accounts in the top 10 with enough trades). */
  awarded: number;
  /** Top-10 placings held by bots (ranked, no points). */
  skippedBots: number;
  /** Top-10 placings held by real accounts with fewer than MIN_TRADES_FOR_WEEKLY_POINTS trades (ranked, no points). */
  skippedFewTrades: number;
  nextLeagueId: string;
}

export interface RolloverResult {
  settled: SettledLeague[];
}

/**
 * Settle every open League whose week has ended and make sure the next one exists. Each week
 * is claimed (status open -> settled, count 1) inside the same transaction that writes its
 * awards, so two overlapping ticks can never both pay a week.
 */
export async function rollover(now: Date = new Date(), client: LeagueDb = db): Promise<RolloverResult> {
  const due = await client.league.findMany({
    where: { status: "open", weekEnd: { lt: now } },
    select: { id: true, seasonId: true, weekStart: true, weekEnd: true, status: true },
    orderBy: { weekStart: "asc" },
  });
  const settled: SettledLeague[] = [];
  for (const league of due) {
    await recomputeEquity(league.id, client, now);
    const top = await client.leagueAccount.findMany({
      where: { leagueId: league.id, rank: { lte: RANK_POINTS.length } },
      select: { userId: true, rank: true, isBot: true, _count: { select: { trades: true } } },
      orderBy: { rank: "asc" },
    });
    const placed = top.filter((a): a is typeof a & { rank: number } => a.rank !== null);
    const bots = placed.filter((a) => a.isBot);
    const real = placed.filter((a) => !a.isBot);
    // Points are for real accounts that actually played the week: an idle or one-trade account never earns a finish.
    const eligible = real.filter((a) => a._count.trades >= MIN_TRADES_FOR_WEEKLY_POINTS);
    const awards = eligible
      .map((a) => ({ userId: a.userId, seasonId: league.seasonId, source: "league", ref: awardRef(league.id, a.rank), delta: RANK_POINTS[a.rank - 1] ?? 0 }))
      .filter((a) => a.delta > 0);
    const claimed = await client.$transaction(async (tx) => {
      // The claim comes first: only the tick that flips this week from open to settled pays it.
      const claim = await tx.league.updateMany({ where: { id: league.id, status: "open" }, data: { status: "settled" } });
      if (claim.count !== 1) return false;
      // The unique (userId, seasonId, ref) constraint plus skipDuplicates keeps a replay a no-op.
      if (awards.length > 0) await tx.pointsEvent.createMany({ data: awards, skipDuplicates: true });
      return true;
    });
    if (!claimed) {
      console.log(`${LOG_PREFIX} ${league.id} was already settled by another tick; nothing written`);
      continue;
    }
    const next = await ensureLeague(league.seasonId, now, client);
    const skippedFewTrades = real.length - eligible.length;
    settled.push({ leagueId: league.id, awarded: awards.length, skippedBots: bots.length, skippedFewTrades, nextLeagueId: next.id });
    console.log(
      `${LOG_PREFIX} settled ${league.id} (${awards.length} awards, ${bots.length} bot placings, ${skippedFewTrades} under ${MIN_TRADES_FOR_WEEKLY_POINTS} trades); next ${next.id}`,
    );
  }
  return { settled };
}

// ---------------------------------------------------------------------------
// Tick + GameModule
// ---------------------------------------------------------------------------

export interface LeagueTickResult {
  seasonId: string | null;
  leagueId: string | null;
  /** Bot accounts created in the current League by this tick (0 once it has them). */
  botsSeeded: number;
  recomputed: number;
  settled: number;
}

/**
 * Seed the bots into a League that has fewer than BOT_HANDLES.length of them (seedBots skips
 * the ones already in, so a seed that died halfway is finished by the next tick). Own
 * try/catch: a failure (pricing, DB) is logged and the next tick tries again; it must never
 * stop the recompute or the rollover.
 */
async function ensureBots(leagueId: string, now: Date, client: LeagueDb): Promise<number> {
  try {
    const bots = await client.leagueAccount.count({ where: { leagueId, isBot: true } });
    if (bots >= BOT_HANDLES.length) return 0;
    const seeded = await seedBots(client, leagueId, now);
    const created = seeded.filter((b) => b.created).length;
    console.log(`${LOG_PREFIX} seeded ${created} bots into ${leagueId}`);
    return created;
  } catch (e) {
    console.error(`${LOG_PREFIX} seeding bots into ${leagueId} failed (next tick retries): ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

/** ensureLeague (+ bots when it has none) -> recomputeEquity for every open League -> rollover. Idempotent. */
export async function tickLeague(now: Date = new Date(), client: LeagueDb = db): Promise<LeagueTickResult> {
  const seasonId = await findCurrentSeasonId(now, client);
  let leagueId: string | null = null;
  let botsSeeded = 0;
  if (seasonId) {
    const league = await ensureLeague(seasonId, now, client);
    leagueId = league.id;
    if (league.status === "open") botsSeeded = await ensureBots(league.id, now, client);
  } else {
    console.warn(`${LOG_PREFIX} no Season seeded; League not ensured`);
  }

  const open = await client.league.findMany({ where: { status: "open" }, select: { id: true } });
  for (const l of open) await recomputeEquity(l.id, client, now);

  const rolled = await rollover(now, client);
  return { seasonId, leagueId, botsSeeded, recomputed: open.length, settled: rolled.settled.length };
}

export const league: GameModule = {
  key: "league",
  async tick(now: Date) {
    await tickLeague(now);
  },
};

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

/** Handles and derived wallet addresses live in ./bot-identity (the sign-in guard reads them); re-exported here. */
export { BOT_HANDLES, botWalletAddress };

/** One source of truth in lib/games/bots (REAL_USER_WHERE keys on it); re-exported for existing importers. */
export { BOT_USER_ID_PREFIX };

/** Deterministic user id for the n-th bot (0-based index -> bot-league-1 ...). */
export function botUserId(index: number): string {
  return `${BOT_USER_ID_PREFIX}${index + 1}`;
}

/** Fallback fill prices (USD) so seeding works offline. Read from lib/price on 14 Sep 2026. */
export const BOT_FALLBACK_PRICES: Readonly<Record<string, number>> = Object.freeze({
  TSLAx: 359.19,
  NVDAx: 212.89,
  AAPLx: 332.24,
  SPYx: 760.46,
  QQQx: 704.19,
  METAx: 664.35,
  GOOGLx: 342.82,
  AMZNx: 254.66,
  MSFTx: 496.48,
  COINx: 180.69,
  MSTRx: 131.66,
  HOODx: 112.38,
});

export interface BotQuote {
  symbol: string;
  assetId: string;
  price: number;
  /** lib/price source, or "fallback" when the table above was used. */
  source: string;
}

export interface BotTradePlan {
  symbol: string;
  assetId: string;
  side: TradeSide;
  qty: number;
  /** Fill price (spread applied). */
  price: number;
  priceSource: string;
  ts: Date;
}

export interface BotPlan {
  handle: string;
  trades: BotTradePlan[];
  cashUsd: number;
  positions: Positions;
}

/** Small deterministic PRNG (mulberry32) so a handle always plans the same trades. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function prngSeed(handle: string): number {
  return createHash("sha256").update(handle, "utf8").digest().readUInt32LE(0);
}

/**
 * Plan 3-8 trades for a bot: mostly buys, some partial sells, timestamps spread over
 * Monday-Wednesday of the League week (never in the future). Seeded mid-week (now >=
 * weekStart) fills sit within +/-3% of the seed-time quote, simulating fills earlier in the
 * week. Seeded before the week starts (Friday rollover, weekend) there is nothing earlier to
 * simulate: fills are at the quote with no jitter, so the bot starts the week at ~$10,000
 * (only the spread). The PRNG sequence is the same either way. Pure.
 */
export function planBotTrades(handle: string, quotes: readonly BotQuote[], weekStart: Date, now: Date): BotPlan {
  const rng = mulberry32(prngSeed(handle));
  const count = 3 + Math.floor(rng() * 6); // 3..8
  const withJitter = now.getTime() >= weekStart.getTime();
  let state: AccountState = { cashUsd: STARTING_CASH_USD, positions: {} };
  const trades: BotTradePlan[] = [];
  let t = weekStart.getTime() + 14 * HOUR_MS; // Monday 14:00 UTC, US session open

  for (let i = 0; i < count && quotes.length > 0; i += 1) {
    t += (2 + rng() * 12) * HOUR_MS; // 2-14h between trades
    const ts = new Date(Math.min(t, now.getTime()));
    const held = Object.keys(state.positions);
    const side: TradeSide = i === 0 || held.length === 0 || rng() < 0.7 ? "buy" : "sell";
    const draw = rng(); // always drawn so both modes plan the same sequence
    const jitter = withJitter ? 1 + (draw * 2 - 1) * 0.03 : 1;

    if (side === "buy") {
      const q = quotes[Math.floor(rng() * quotes.length)];
      const fill = fillPrice(q.price * jitter, "buy");
      const notional = state.cashUsd * (0.12 + rng() * 0.28);
      if (notional < 50) continue;
      const qty = round6(notional / fill);
      if (qty <= 0) continue;
      state = applyTrade(state, { assetId: q.assetId, symbol: q.symbol, side, qty, fill });
      trades.push({ symbol: q.symbol, assetId: q.assetId, side, qty, price: fill, priceSource: `seed:${q.source}`, ts });
    } else {
      const assetId = held[Math.floor(rng() * held.length)];
      const pos = state.positions[assetId];
      const q = quotes.find((x) => x.assetId === assetId);
      if (!pos || !q) continue;
      const fill = fillPrice(q.price * jitter, "sell");
      const frac = 0.3 + rng() * 0.7;
      const qty = frac > 0.95 ? pos.qty : round6(pos.qty * frac);
      if (qty <= 0) continue;
      state = applyTrade(state, { assetId, symbol: pos.symbol, side, qty, fill });
      trades.push({ symbol: pos.symbol, assetId, side, qty, price: fill, priceSource: `seed:${q.source}`, ts });
    }
  }
  return { handle, trades, cashUsd: state.cashUsd, positions: state.positions };
}

function fallbackAssetId(symbol: string): string | null {
  const entry = XSTOCKS_FALLBACK.find((e) => e.symbol.toUpperCase() === symbol.toUpperCase());
  return entry ? solanaTokenAssetId(entry.mint, SOLANA_MAINNET) : null;
}

/** Seed-time quotes for the tradable list: lib/price when it answers, the fallback table otherwise. */
export async function botQuotes(): Promise<BotQuote[]> {
  let live: PriceQuote[] = [];
  try {
    live = (await getPricesBySymbols(TRADABLE_SYMBOLS)).quotes;
  } catch (e) {
    console.warn(`${LOG_PREFIX} seed pricing failed; using the fallback table: ${e instanceof Error ? e.message : String(e)}`);
  }
  const bySymbol = new Map(live.map((q) => [q.symbol.toUpperCase(), q]));
  const out: BotQuote[] = [];
  for (const symbol of TRADABLE_SYMBOLS) {
    const q = bySymbol.get(symbol.toUpperCase());
    const assetId = q?.assetId ?? fallbackAssetId(symbol);
    if (!assetId) continue;
    if (q && q.price !== null && q.price > 0) out.push({ symbol: q.symbol, assetId, price: q.price, source: q.source });
    else if (BOT_FALLBACK_PRICES[symbol]) out.push({ symbol, assetId, price: BOT_FALLBACK_PRICES[symbol], source: "fallback" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bot identity convergence (renaming BOT_HANDLES reaches an existing database)
// ---------------------------------------------------------------------------

/** Where a bot's identity should be: handle from BOT_HANDLES, wallet derived from that handle. */
export interface PlannedBotIdentity {
  userId: string;
  handle: string;
  address: string;
}

export interface BotWalletRow {
  id: string;
  address: string;
  isPrimary: boolean;
  createdAt: Date;
}

export interface BotIdentityState {
  /** Existing bot Users (planned ids only) with their Solana wallets. */
  users: ReadonlyArray<{ id: string; handle: string | null; wallets: readonly BotWalletRow[] }>;
  /** Any User that holds one of the planned handles. */
  handleOwners: ReadonlyArray<{ id: string; handle: string | null }>;
  /** Any Solana wallet at one of the planned addresses. */
  addressOwners: ReadonlyArray<{ id: string; userId: string; address: string }>;
}

export type BotIdentityWrite =
  | { kind: "handle"; userId: string; from: string | null; to: string }
  | { kind: "wallet_address"; userId: string; walletId: string; from: string; to: string }
  | { kind: "wallet_create"; userId: string; to: string }
  | { kind: "wallet_primary"; userId: string; walletId: string; address: string; isPrimary: boolean };

export interface BotIdentitySkip {
  userId: string;
  field: "handle" | "wallet";
  target: string;
  reason: string;
}

export interface BotIdentitySync {
  /** Writes in the order they must run (a vacated handle / address before the bot that takes it). */
  writes: BotIdentityWrite[];
  /** Changes that could not be made safely (the target is held by someone else). */
  skipped: BotIdentitySkip[];
}

/** The planned identity of every bot: bot-league-(n+1), BOT_HANDLES[n], botWalletAddress(handle). */
export function plannedBotIdentities(): PlannedBotIdentity[] {
  return BOT_HANDLES.map((handle, index) => ({ userId: botUserId(index), handle, address: botWalletAddress(handle) }));
}

function shortAddress(a: string): string {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

/**
 * Plan the writes that bring existing bot Users to their planned handle and wallet address.
 * Pure. Bots without a User row are left to the create path. Only differences produce writes:
 *   handle   updated unless another User holds the new handle.
 *   wallet   when the bot already has a wallet at the planned address it becomes the only
 *            primary one (stale wallets are demoted, never deleted); otherwise its display
 *            wallet (primary, else oldest) is re-pointed at the planned address and made
 *            primary, or a wallet is created when the bot has none, unless another User
 *            holds that address.
 * A target held by another bot that is itself moving away is retried after that bot moves
 * (multi-pass, in memory), so renames that chain resolve in any order. A cycle (two bots
 * swapping handles) and a target held by a non-bot are reported in `skipped`, never forced.
 */
export function planBotIdentitySync(planned: readonly PlannedBotIdentity[], state: BotIdentityState): BotIdentitySync {
  const users = new Map(state.users.map((u) => [u.id, u]));
  const handleOwner = new Map<string, string>();
  for (const u of state.handleOwners) if (u.handle) handleOwner.set(u.handle, u.id);
  for (const u of state.users) if (u.handle) handleOwner.set(u.handle, u.id);
  const addressOwner = new Map<string, string>();
  for (const w of state.addressOwners) addressOwner.set(w.address, w.userId);
  for (const u of state.users) for (const w of u.wallets) addressOwner.set(w.address, u.id);

  type Pending =
    | { kind: "handle"; bot: PlannedBotIdentity; from: string | null }
    | { kind: "wallet"; bot: PlannedBotIdentity; wallet: BotWalletRow | null };
  const writes: BotIdentityWrite[] = [];
  const pending: Pending[] = [];

  for (const bot of planned) {
    const user = users.get(bot.userId);
    if (!user) continue;
    if (user.handle !== bot.handle) pending.push({ kind: "handle", bot, from: user.handle });
    const atTarget = user.wallets.find((w) => w.address === bot.address);
    if (atTarget) {
      if (!atTarget.isPrimary) writes.push({ kind: "wallet_primary", userId: bot.userId, walletId: atTarget.id, address: atTarget.address, isPrimary: true });
      for (const w of user.wallets) {
        if (w.id !== atTarget.id && w.isPrimary) writes.push({ kind: "wallet_primary", userId: bot.userId, walletId: w.id, address: w.address, isPrimary: false });
      }
    } else {
      const display = user.wallets.find((w) => w.isPrimary) ?? [...user.wallets].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
      pending.push({ kind: "wallet", bot, wallet: display });
    }
  }

  let progress = true;
  while (progress && pending.length > 0) {
    progress = false;
    for (let i = 0; i < pending.length; ) {
      const p = pending[i];
      const { userId } = p.bot;
      if (p.kind === "handle") {
        const owner = handleOwner.get(p.bot.handle);
        if (owner === undefined || owner === userId) {
          writes.push({ kind: "handle", userId, from: p.from, to: p.bot.handle });
          if (p.from !== null && handleOwner.get(p.from) === userId) handleOwner.delete(p.from);
          handleOwner.set(p.bot.handle, userId);
          pending.splice(i, 1);
          progress = true;
          continue;
        }
      } else {
        const owner = addressOwner.get(p.bot.address);
        if (owner === undefined || owner === userId) {
          if (p.wallet) {
            writes.push({ kind: "wallet_address", userId, walletId: p.wallet.id, from: p.wallet.address, to: p.bot.address });
            if (addressOwner.get(p.wallet.address) === userId) addressOwner.delete(p.wallet.address);
          } else {
            writes.push({ kind: "wallet_create", userId, to: p.bot.address });
          }
          addressOwner.set(p.bot.address, userId);
          pending.splice(i, 1);
          progress = true;
          continue;
        }
      }
      i += 1;
    }
  }

  const botIds = new Set(planned.map((b) => b.userId));
  const skipped: BotIdentitySkip[] = pending.map((p) => {
    const target = p.kind === "handle" ? p.bot.handle : p.bot.address;
    const owner = (p.kind === "handle" ? handleOwner : addressOwner).get(target) ?? "";
    return {
      userId: p.bot.userId,
      field: p.kind,
      target,
      reason: botIds.has(owner) ? `held by ${owner}, which cannot move first (rename cycle)` : "held by another user",
    };
  });
  return { writes, skipped };
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/**
 * Converge existing bot Users on BOT_HANDLES: handle and Solana wallet address (see
 * planBotIdentitySync). Never touches LeagueAccounts, trades, cash, equity or ranks.
 * Idempotent and cheap: one read when nothing differs, two more reads plus one write per
 * difference otherwise. A write that loses a race on a unique key (P2002) is skipped with a
 * warning instead of failing the seed; any other error is thrown.
 */
export async function syncBotIdentities(prisma: LeagueDb): Promise<BotIdentitySync> {
  const planned = plannedBotIdentities();
  const users = await prisma.user.findMany({
    where: { id: { in: planned.map((b) => b.userId) } },
    select: {
      id: true,
      handle: true,
      wallets: { where: { chainId: SOLANA_MAINNET }, select: { id: true, address: true, isPrimary: true, createdAt: true } },
    },
  });
  // Without outside owners the plan can only be empty when every bot already matches.
  const draft = planBotIdentitySync(planned, { users, handleOwners: [], addressOwners: [] });
  if (draft.writes.length === 0 && draft.skipped.length === 0) return draft;

  const [handleOwners, addressOwners] = await Promise.all([
    prisma.user.findMany({ where: { handle: { in: planned.map((b) => b.handle) } }, select: { id: true, handle: true } }),
    prisma.wallet.findMany({
      where: { chainId: SOLANA_MAINNET, address: { in: planned.map((b) => b.address) } },
      select: { id: true, userId: true, address: true },
    }),
  ]);
  const plan = planBotIdentitySync(planned, { users, handleOwners, addressOwners });

  const applied: BotIdentityWrite[] = [];
  const skipped: BotIdentitySkip[] = [...plan.skipped];
  for (const w of plan.writes) {
    try {
      if (w.kind === "handle") {
        await prisma.user.update({ where: { id: w.userId }, data: { handle: w.to }, select: { id: true } });
      } else if (w.kind === "wallet_address") {
        await prisma.wallet.update({ where: { id: w.walletId }, data: { address: w.to, isPrimary: true }, select: { id: true } });
      } else if (w.kind === "wallet_create") {
        await prisma.wallet.create({ data: { userId: w.userId, chainId: SOLANA_MAINNET, address: w.to, isPrimary: true }, select: { id: true } });
      } else {
        await prisma.wallet.update({ where: { id: w.walletId }, data: { isPrimary: w.isPrimary }, select: { id: true } });
      }
      applied.push(w);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      skipped.push({ userId: w.userId, field: w.kind === "handle" ? "handle" : "wallet", target: w.kind === "wallet_primary" ? w.address : w.to, reason: "unique key taken concurrently" });
    }
  }
  for (const s of skipped) {
    console.warn(`${LOG_PREFIX} ${s.userId}: ${s.field} not moved to ${s.field === "wallet" ? shortAddress(s.target) : s.target} (${s.reason})`);
  }
  return { writes: applied, skipped };
}

/** One human-readable line per identity change or skip, grouped by bot user id. */
function identityNotes(sync: BotIdentitySync): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  const add = (userId: string, line: string) => notes.set(userId, [...(notes.get(userId) ?? []), line]);
  for (const w of sync.writes) {
    if (w.kind === "handle") add(w.userId, `handle ${w.from ?? "(none)"} → ${w.to}`);
    else if (w.kind === "wallet_address") add(w.userId, `wallet ${shortAddress(w.from)} → ${shortAddress(w.to)}`);
    else if (w.kind === "wallet_create") add(w.userId, `wallet created ${shortAddress(w.to)}`);
    else add(w.userId, `wallet ${shortAddress(w.address)} ${w.isPrimary ? "made primary" : "no longer primary"}`);
  }
  for (const s of sync.skipped) add(s.userId, `${s.field} kept (${s.reason})`);
  return notes;
}

export interface SeedBotOutcome {
  handle: string;
  userId: string;
  address: string;
  /** False when the bot already had an account in this League (not re-traded). */
  created: boolean;
  trades: number;
  equityUsd: number;
  /** Identity changes (or skips) syncBotIdentities made for this bot; empty when it already matched. */
  identity: string[];
}

/**
 * Converge every existing bot's handle and wallet on BOT_HANDLES (syncBotIdentities), then
 * create the missing bot Users (+ one Solana wallet each), LeagueAccounts (isBot) and trades
 * in one League. Bots that already have an account in that League keep it untouched: no new
 * trades, cash, equity or rank writes.
 */
export async function seedBots(prisma: LeagueDb, leagueId: string, now: Date = new Date()): Promise<SeedBotOutcome[]> {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { id: true, weekStart: true } });
  const notes = identityNotes(await syncBotIdentities(prisma));
  const quotes = await botQuotes();
  const priceMap = new Map<string, number | null>(quotes.map((q) => [q.assetId, q.price]));
  const out: SeedBotOutcome[] = [];

  for (const [index, handle] of BOT_HANDLES.entries()) {
    const userId = botUserId(index);
    const address = botWalletAddress(handle);
    const existing = await prisma.leagueAccount.findUnique({
      where: { leagueId_userId: { leagueId, userId } },
      select: { id: true, equityUsd: true },
    });
    if (existing) {
      const trades = await prisma.leagueTrade.count({ where: { leagueAccountId: existing.id } });
      out.push({ handle, userId, address, created: false, trades, equityUsd: toNumber(existing.equityUsd), identity: notes.get(userId) ?? [] });
      continue;
    }

    const plan = planBotTrades(handle, quotes, league.weekStart, now);
    const equityUsd = valueAccount(plan.cashUsd, plan.positions, priceMap).equityUsd;
    await prisma.$transaction(async (tx) => {
      // An existing bot User was already converged above; a handle that could not move safely
      // is left as it is rather than failing the seed on the unique key.
      await tx.user.upsert({ where: { id: userId }, create: { id: userId, handle }, update: {} });
      await tx.wallet.upsert({
        where: { chainId_address: { chainId: SOLANA_MAINNET, address } },
        create: { userId, chainId: SOLANA_MAINNET, address, isPrimary: true },
        update: {},
      });
      const account = await tx.leagueAccount.create({
        data: {
          leagueId,
          userId,
          cashUsd: plan.cashUsd.toFixed(6),
          positions: positionsJson(plan.positions),
          equityUsd: equityUsd.toFixed(6),
          isBot: true,
        },
        select: { id: true },
      });
      if (plan.trades.length > 0) {
        await tx.leagueTrade.createMany({
          data: plan.trades.map((t) => ({
            leagueAccountId: account.id,
            symbol: t.symbol,
            side: t.side,
            qty: t.qty.toFixed(8),
            price: t.price.toFixed(6),
            priceSource: t.priceSource,
            ts: t.ts,
          })),
        });
      }
    });
    out.push({ handle, userId, address, created: true, trades: plan.trades.length, equityUsd, identity: notes.get(userId) ?? [] });
  }
  return out;
}
