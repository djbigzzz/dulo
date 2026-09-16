/**
 * Calls — points-only parimutuel Yes/No markets on Friday closes (docs/HANDOFF.md §3.3).
 *
 *   "Will NVDA close above $210.00 on Fri 18 Sep?"  Yes pool / No pool, in points.
 *
 * Placement (placeCall)
 *   - 10..5000 integer points, market unsettled and more than LOCK_BEFORE_SETTLE_MS
 *     (5 min) before settleAt. A user may hold BOTH sides of one market (the Position
 *     key is (marketId, userId, side)); each side is a separate stake.
 *   - Stakes are escrowed through the ledger itself: placing writes a PointsEvent
 *     { source: "call", ref: "call:<market>:stake:<user>:<side>", delta: -points }, so
 *     "spendable points" is simply Σ PointsEvent.delta for the Season — the open stakes
 *     are already subtracted and nothing is counted twice. A top-up on the same side
 *     appends "…:<side>:2", ":3", … (the ledger is append-only, refs are unique).
 *   - All of it runs in one transaction behind a per-user row lock so two concurrent
 *     placements cannot both pass the balance check.
 *
 * Settlement (settleMarket / tick)
 *   - Only after settleAt. Resolution price, in order:
 *       1. Pyth `Equity.US.<TICKER>/USD` — the latest Hermes publish, accepted when its
 *          publish_time is at/after settleAt (source "pyth");
 *       2. lib/price for the xStock (`<TICKER>x`) — Jupiter Price v3 after the close —
 *          accepted when it has a price and is not stale (source recorded from the quote,
 *          "jupiter" in practice; Pyth Hermes needs PYTH_API_KEY and is unavailable
 *          locally, so this is the path that actually runs).
 *     Neither yet -> the market stays open and the next tick retries; VOID_AFTER_MS (24h)
 *     past settleAt with still no price -> outcome "void" and every stake is refunded.
 *   - outcome = price > strike ? "yes" : "no". Payouts come from lib/games/parimutuel
 *     (losing pool pro rata to winners, exact integer conservation; one-sided markets
 *     refund). The market is claimed with `updateMany where outcome IS NULL` and the
 *     payout/refund PointsEvents are written in the same transaction with
 *     skipDuplicates, so a double settle (or two cron instances) pays once.
 *
 * Weekly markets (ensureWeeklyMarkets, at the top of every tick)
 *   - The three standard markets (SEED_CALL_TICKERS: NVDA, TSLA, SPY) for the coming
 *     Friday (fridaySettleAt) are created whenever they are missing — the first tick
 *     after Friday's settle opens next week's board, so the demo never goes dark. The
 *     strike is the xStock's lib/price quote at creation ("price when the market
 *     opened"): on a Monday morning that is roughly the open; created on a weekend it is
 *     Friday's last print. No quote -> the ticker is skipped and the next tick retries;
 *     nothing is created inside the 5-minute lock window. Market is unique on
 *     (seasonId, ticker, settleAt), so two ticks racing produce one row (P2002 is read
 *     back as "existing"). prisma/seed-calls.ts delegates to the same function.
 *   - seedCallStakes then puts the League bots' tilted stakes on every open market of
 *     that Friday (lib/games/calls-seed planBotStakes): each bot is funded with ONE admin
 *     PointsEvent for exactly its stake (ref admin:seed:<market>:<user>, skipDuplicates)
 *     and then goes through placeCall, so Position rows, stake refs and the pools are
 *     exactly what a real user would have produced. Only seeded League bots stake (a User
 *     with an isBot LeagueAccount; others are reported in missingBots and never created
 *     here). Bots that already hold a Position on the market are skipped, and placeCall
 *     re-checks that under the row lock (firstStakeOnly), so a re-run or two overlapping
 *     ticks never double-stake. A bot's grant and stake net to zero, so seeding never lifts
 *     a bot's Season balance; payouts after settlement can (the Season leaderboard excludes
 *     bot users for that reason).
 *
 * The cron derives `call_placed` internal events from Position rows (lib/cron/evaluate),
 * so nothing is emitted from here.
 *
 * Server-only (Prisma, price sources). Pure helpers are exported for the seed and tests.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { GameModule, PriceQuote } from "@/lib/core";
import type {
  CallMarketResponse,
  CallMarketStatus,
  CallMarketView,
  CallOutcome,
  CallPositionView,
  CallQuote,
  CallsMeView,
  CallsResponse,
  PlaceCallResponse,
} from "@/lib/api-client";
import { getPriceBySymbol, getPricesBySymbols } from "@/lib/price";
import { easternWallClockToUtc, isoDateKey, sessionCloseMinutes } from "@/lib/prices/calendar";
import { fetchPythLatest, resolvePythFeedId } from "@/lib/prices/pyth";
import { db } from "@/lib/server/db";
import { MAX_CALL_POINTS, MIN_CALL_POINTS } from "./calls-limits";
import { SEED_CALL_TICKERS, planBotStakes, seedGrantRef, type BotStake } from "./calls-seed";
import { findCurrentSeasonId } from "./league";
import { isOutcome, isSide, odds, payout, settle, type Outcome, type Side, type Settlement } from "./parimutuel";

const LOG_PREFIX = "[games/calls]";

export { MAX_CALL_POINTS, MIN_CALL_POINTS };
/** No stakes inside this window before settleAt. */
export const LOCK_BEFORE_SETTLE_MS = 5 * 60 * 1000;
/** With no usable price this long after settleAt, the market voids and refunds. */
export const VOID_AFTER_MS = 24 * 60 * 60 * 1000;
/** Minutes after the US close at which a Friday market settles (16:00 ET + 5 min). */
export const SETTLE_AFTER_CLOSE_MINUTES = 5;

const DAY_MS = 24 * 60 * 60 * 1000;
const TICKER_RE = /^[A-Z][A-Z0-9.]{0,9}$/;

export class CallsError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "CallsError";
  }
}

/** A Play that placing a Call completed on the spot (POST /api/v1/calls/place inline evaluation). */
export interface NewlyCompletedPlay {
  key: string;
  title: string;
  points: number;
}

/**
 * POST /api/v1/calls/place wire shape: PlaceCallResponse plus the Plays this placement completed
 * (Oracle on a first Call). Empty when nothing completed or the evaluation missed its deadline.
 * Client code imports it with `import type` only.
 */
export type PlaceCallRouteResponse = PlaceCallResponse & { newlyCompleted: NewlyCompletedPlay[] };

// ---------------------------------------------------------------------------
// Row shapes (structural, so tests can feed plain objects) and small pure helpers
// ---------------------------------------------------------------------------

type DecimalLike = number | string | { toNumber(): number };

export interface MarketRow {
  id: string;
  seasonId: string;
  ticker: string;
  strike: DecimalLike;
  settleAt: Date;
  settledPrice: DecimalLike | null;
  outcome: string | null;
  yesPool: number;
  noPool: number;
  source: string | null;
  createdAt: Date;
}

export interface PositionRow {
  marketId: string;
  userId: string;
  side: string;
  points: number;
  createdAt: Date;
}

/** Prisma Decimal | string | number -> number (null stays null). */
export function toNumber(v: DecimalLike | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const n = v.toNumber();
  return Number.isFinite(n) ? n : null;
}

/** "NVDA" -> "NVDAx", the xStock symbol lib/price quotes. */
export function xstockSymbol(ticker: string): string {
  return `${ticker.toUpperCase()}x`;
}

export function locksAt(settleAt: Date): Date {
  return new Date(settleAt.getTime() - LOCK_BEFORE_SETTLE_MS);
}

export function marketStatus(market: Pick<MarketRow, "settleAt" | "outcome">, now: Date): CallMarketStatus {
  if (market.outcome === "void") return "void";
  if (market.outcome !== null) return "settled";
  return now.getTime() >= locksAt(market.settleAt).getTime() ? "locked" : "open";
}

export function stakeRef(marketId: string, userId: string, side: Side, seq = 1): string {
  const base = `call:${marketId}:stake:${userId}:${side}`;
  return seq > 1 ? `${base}:${seq}` : base;
}

export function payoutRef(marketId: string, userId: string): string {
  return `call:${marketId}:payout:${userId}`;
}

export function refundRef(marketId: string, userId: string, side: Side): string {
  return `call:${marketId}:refund:${userId}:${side}`;
}

/** Strike from a live price: 2 decimals ("clean" enough for a Yes/No line). */
export function roundStrike(price: number): number {
  return Math.round(price * 100) / 100;
}

/**
 * The Friday settle instant for the ISO week containing `now`: the US regular-session
 * close on that Friday (16:00 ET, 13:00 ET on early-close days) plus
 * SETTLE_AFTER_CLOSE_MINUTES, converted through the America/New_York calendar. That is
 * 20:05 UTC while EDT holds (September) and 21:05 UTC after clocks fall back — "Friday
 * 20:05 UTC" is what it evaluates to this month, not a constant. If that instant has
 * already passed (seeded on a weekend), the following week's Friday is used so the seeded
 * market is open rather than instantly due.
 */
export function fridaySettleAt(now: Date): Date {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  let monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday);
  for (let i = 0; i < 3; i++) {
    const friday = new Date(monday + 4 * DAY_MS);
    const y = friday.getUTCFullYear();
    const m = friday.getUTCMonth() + 1;
    const d = friday.getUTCDate();
    const minutes = sessionCloseMinutes(isoDateKey(y, m, d)) + SETTLE_AFTER_CLOSE_MINUTES;
    const settleAt = easternWallClockToUtc(y, m, d, Math.floor(minutes / 60), minutes % 60);
    if (settleAt.getTime() > now.getTime()) return settleAt;
    monday += 7 * DAY_MS;
  }
  throw new Error(`fridaySettleAt: no upcoming Friday close after ${now.toISOString()}`);
}

/** How the strike is labelled wherever it is reported: it is the quote at creation, never an official print. */
export const STRIKE_LABEL = "price when the market opened";

/**
 * Strike = the xStock's current lib/price quote, rounded to 2 decimals — "the price when
 * the market opened" (STRIKE_LABEL). Created on a Monday morning that approximates the
 * open; created by the first tick after Friday's settle (the normal case now that the
 * cron opens next week's markets) it is Friday's last print. Never the official 09:30 ET
 * open. Null when the catalogue or every source is unavailable — the caller skips the
 * ticker and the next tick retries; there is no fixed fallback strike.
 */
export async function mondayOpenStrike(ticker: string): Promise<number | null> {
  try {
    const quote = await getPriceBySymbol(xstockSymbol(ticker));
    if (quote.price === null || !Number.isFinite(quote.price) || quote.price <= 0) return null;
    return roundStrike(quote.price);
  } catch (e) {
    console.warn(`${LOG_PREFIX} no strike quote for ${ticker}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Views (wire shapes from src/lib/api-client.ts)
// ---------------------------------------------------------------------------

export function toCallQuote(q: PriceQuote): CallQuote {
  return {
    symbol: q.symbol,
    price: q.price,
    source: q.source,
    publishedAt: q.publishedAt ? q.publishedAt.toISOString() : null,
    ageSeconds: q.ageSeconds,
    stale: q.stale,
    marketOpen: q.marketOpen,
  };
}

export function toMarketView(m: MarketRow, quote: PriceQuote | null, now: Date): CallMarketView {
  return {
    id: m.id,
    ticker: m.ticker,
    symbol: xstockSymbol(m.ticker),
    strike: toNumber(m.strike) ?? 0,
    settleAt: m.settleAt.toISOString(),
    locksAt: locksAt(m.settleAt).toISOString(),
    status: marketStatus(m, now),
    yesPool: m.yesPool,
    noPool: m.noPool,
    odds: odds(m.yesPool, m.noPool),
    settledPrice: toNumber(m.settledPrice),
    outcome: isOutcome(m.outcome) ? (m.outcome as CallOutcome) : null,
    source: m.source ?? null,
    quote: quote ? toCallQuote(quote) : null,
  };
}

interface LedgerRef {
  ref: string;
  delta: number;
}

/**
 * A Position as the user sees it. Settled results are read back from the ledger (the
 * payout / refund PointsEvent), never recomputed, so the card shows what was actually paid.
 */
export function toPositionView(p: PositionRow, market: MarketRow, ledger: ReadonlyMap<string, LedgerRef>): CallPositionView {
  const side: Side = p.side === "no" ? "no" : "yes";
  const sidePool = side === "yes" ? market.yesPool : market.noPool;
  // A stake is always inside its pool; if the rows ever disagree, show the stake rather than throw.
  const potential = p.points <= sidePool ? Math.floor(payout(p.points, side, market.yesPool, market.noPool)) : p.points;
  let result: CallPositionView["result"] = "pending";
  let paid: number | null = null;
  if (market.outcome !== null) {
    const refund = ledger.get(refundRef(market.id, p.userId, side));
    if (refund) {
      result = "refunded";
      paid = refund.delta;
    } else if (market.outcome === side) {
      result = "won";
      paid = ledger.get(payoutRef(market.id, p.userId))?.delta ?? null;
    } else {
      result = "lost";
      paid = 0;
    }
  }
  return {
    marketId: p.marketId,
    side,
    points: p.points,
    potentialPayout: potential,
    result,
    payout: paid,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Unsettled markets first (soonest settle first), then settled ones newest first. */
export function sortMarkets<T extends Pick<MarketRow, "outcome" | "settleAt" | "ticker">>(markets: readonly T[]): T[] {
  return [...markets].sort((a, b) => {
    const aOpen = a.outcome === null;
    const bOpen = b.outcome === null;
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    const dt = a.settleAt.getTime() - b.settleAt.getTime();
    if (dt !== 0) return aOpen ? dt : -dt;
    return a.ticker.localeCompare(b.ticker);
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type Client = PrismaClient | Prisma.TransactionClient;

/** Σ PointsEvent.delta for the Season. Open stakes are negative events, so they are already out. */
export async function spendablePoints(client: Client, userId: string, seasonId: string): Promise<number> {
  const agg = await client.pointsEvent.aggregate({ _sum: { delta: true }, where: { userId, seasonId } });
  return agg._sum.delta ?? 0;
}

/** Current quotes for a set of tickers, keyed by ticker. Unknown symbols / outages just leave gaps. */
async function quotesByTicker(tickers: readonly string[]): Promise<Map<string, PriceQuote>> {
  const out = new Map<string, PriceQuote>();
  const unique = [...new Set(tickers)];
  if (unique.length === 0) return out;
  try {
    const { quotes } = await getPricesBySymbols(unique.map(xstockSymbol));
    const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
    for (const t of unique) {
      const q = bySymbol.get(xstockSymbol(t).toUpperCase());
      if (q) out.set(t, q);
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} quotes unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

async function callLedger(userId: string, seasonId: string): Promise<Map<string, LedgerRef>> {
  const rows = await db.pointsEvent.findMany({
    where: { userId, seasonId, source: "call" },
    select: { ref: true, delta: true },
  });
  return new Map(rows.map((r) => [r.ref, r]));
}

/**
 * Reads here run one after another on purpose: each is tiny, and the local Prisma dev
 * proxy (and Supabase's pooler) refuses connections when a request fans out several at
 * once on top of the pool.
 */
async function meView(userId: string, seasonId: string, markets: readonly MarketRow[]): Promise<CallsMeView> {
  const byId = new Map(markets.map((m) => [m.id, m]));
  const positions: PositionRow[] =
    markets.length > 0
      ? await db.position.findMany({ where: { userId, marketId: { in: markets.map((m) => m.id) } }, orderBy: { createdAt: "asc" } })
      : [];
  const ledger = await callLedger(userId, seasonId);
  const spendable = await spendablePoints(db, userId, seasonId);
  const views: CallPositionView[] = [];
  for (const p of positions) {
    const market = byId.get(p.marketId);
    if (market) views.push(toPositionView(p, market, ledger));
  }
  return { spendablePoints: spendable, positions: views };
}

/** Everything the /calls board shows. `me` is null when signed out. */
export async function getCallsBoard(
  seasonId: string | null,
  userId: string | null,
  now: Date = new Date(),
): Promise<Pick<CallsResponse, "markets" | "me">> {
  const rows: MarketRow[] = seasonId ? sortMarkets(await db.market.findMany({ where: { seasonId } })) : [];
  const me = userId && seasonId ? await meView(userId, seasonId, rows) : null;
  const quotes = await quotesByTicker(rows.map((m) => m.ticker));
  return { markets: rows.map((m) => toMarketView(m, quotes.get(m.ticker) ?? null, now)), me };
}

/** One market with its Position count. Null when the id is unknown. */
export async function getCallMarket(id: string, userId: string | null, now: Date = new Date()): Promise<CallMarketResponse | null> {
  const market = await db.market.findUnique({ where: { id } });
  if (!market) return null;
  const positionsCount = await db.position.count({ where: { marketId: id } });
  const me = userId ? await meView(userId, market.seasonId, [market]) : null;
  const quotes = await quotesByTicker([market.ticker]);
  return { market: { ...toMarketView(market, quotes.get(market.ticker) ?? null, now), positionsCount }, me };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateMarketInput {
  seasonId: string;
  ticker: string;
  strike: number;
  settleAt: Date;
}

/** Admin / seed: open a market. Validates the ticker, a positive strike and a real settle time. */
export async function createMarket(input: CreateMarketInput, client: Client = db) {
  const ticker = input.ticker.trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) throw new CallsError(`Invalid ticker: ${input.ticker}`, 400);
  if (!Number.isFinite(input.strike) || input.strike <= 0) throw new CallsError("Strike must be a positive number", 400);
  if (Number.isNaN(input.settleAt.getTime())) throw new CallsError("Invalid settleAt", 400);
  return client.market.create({
    data: { seasonId: input.seasonId, ticker, strike: input.strike, settleAt: input.settleAt },
  });
}

export interface PlaceCallInput {
  userId: string;
  marketId: string;
  side: Side;
  points: number;
}

export interface PlaceCallResult {
  position: PositionRow;
  market: MarketRow;
  odds: ReturnType<typeof odds>;
  /** Balance after this stake. */
  spendablePoints: number;
}

export interface PlaceCallOptions {
  /**
   * Refuse with AlreadyStakedError when the user already holds a Position on either side of
   * the market. Checked inside the transaction, after the user row lock, so two overlapping
   * cron ticks seeding the same bot cannot both stake (seedCallStakes' pre-read alone can be
   * stale). Real users never pass it: they may top up and hold both sides.
   */
  firstStakeOnly?: boolean;
}

/** firstStakeOnly placement on a market the user already holds. seedCallStakes counts it as skipped. */
export class AlreadyStakedError extends CallsError {
  constructor() {
    super("Already holds a Position on this market", 409);
    this.name = "AlreadyStakedError";
  }
}

/**
 * The 409 for a short balance: what the user has, what this prediction needs, and where points come
 * from, so a first-time player is never left with a bare "Not enough points".
 */
export function notEnoughPointsMessage(spendable: number, needed: number): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  return `Not enough points: you have ${fmt(spendable)}, this prediction needs ${fmt(needed)}. Earn more in the weekly competition (virtual cash) or from quests.`;
}

/**
 * Stake `points` on one side of a market. Throws CallsError:
 *   400  bad side / points outside MIN..MAX or not an integer
 *   404  unknown market
 *   409  "Prediction settled", "Prediction locked", notEnoughPointsMessage(...),
 *        AlreadyStakedError (firstStakeOnly only)
 * `client` lets the seed run it through its own PrismaClient (bot stakes).
 */
export async function placeCall(
  input: PlaceCallInput,
  now: Date = new Date(),
  client: PrismaClient = db,
  opts: PlaceCallOptions = {},
): Promise<PlaceCallResult> {
  const { userId, marketId, side, points } = input;
  if (!isSide(side)) throw new CallsError("Side must be yes or no", 400);
  if (!Number.isInteger(points) || points < MIN_CALL_POINTS || points > MAX_CALL_POINTS) {
    throw new CallsError(`Points must be a whole number between ${MIN_CALL_POINTS} and ${MAX_CALL_POINTS}`, 400);
  }

  return client.$transaction(async (tx) => {
    // Serialise this user's stakes: the balance check below is only safe if no second
    // placement can slip in between the read and the debit.
    await tx.$executeRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;

    const market = await tx.market.findUnique({ where: { id: marketId } });
    if (!market) throw new CallsError("Market not found", 404);
    if (market.outcome !== null) throw new CallsError("Prediction settled", 409);
    if (now.getTime() >= locksAt(market.settleAt).getTime()) throw new CallsError("Prediction locked", 409);

    if (opts.firstStakeOnly) {
      // Re-read under the lock: an overlapping tick may have staked this user since the caller looked.
      const held = await tx.position.findFirst({ where: { marketId, userId }, select: { side: true } });
      if (held) throw new AlreadyStakedError();
    }

    const spendable = await spendablePoints(tx, userId, market.seasonId);
    if (spendable < points) throw new CallsError(notEnoughPointsMessage(spendable, points), 409);

    const prior = await tx.pointsEvent.count({
      where: { userId, seasonId: market.seasonId, ref: { startsWith: stakeRef(marketId, userId, side) } },
    });
    await tx.pointsEvent.create({
      data: { userId, seasonId: market.seasonId, source: "call", ref: stakeRef(marketId, userId, side, prior + 1), delta: -points },
    });
    const position = await tx.position.upsert({
      where: { marketId_userId_side: { marketId, userId, side } },
      create: { marketId, userId, side, points },
      update: { points: { increment: points } },
    });
    const updated = await tx.market.update({
      where: { id: marketId },
      data: side === "yes" ? { yesPool: { increment: points } } : { noPool: { increment: points } },
    });
    return { position, market: updated, odds: odds(updated.yesPool, updated.noPool), spendablePoints: spendable - points };
  });
}

// ---------------------------------------------------------------------------
// Weekly markets + bot stakes (see the module header)
// ---------------------------------------------------------------------------

/** Prisma's unique-constraint error (a concurrent tick created the same market first). */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

export interface SeedStakesResult {
  marketId: string;
  /** Bot stakes placed by this call. */
  placed: number;
  /**
   * Planned stakes not placed: the bot already holds a Position on the market (seen up front
   * or re-checked under the row lock), it is not a seeded League bot yet (`missingBots`), or
   * the market is locked / settled.
   */
  skipped: number;
  /** Bots whose grant or placement threw (logged; the next run retries them). */
  failed: string[];
  /**
   * Planned bots with no isBot LeagueAccount: the League seed has not created them yet. They
   * are skipped, never created here, so a stake can never land on a User that REAL_USER_WHERE
   * would treat as a real player. The next tick after the League seeds them places their stake.
   */
  missingBots: string[];
  /** Pools after this call, as placeCall reported them (null when nothing was placed). */
  yesPool: number | null;
  noPool: number | null;
}

type StakeableMarket = Pick<MarketRow, "id" | "seasonId" | "ticker" | "settleAt" | "outcome">;

/**
 * Put the League bots' planned stakes on one open market. Idempotent: bots that already
 * hold a Position on the market are skipped, so a partial run (or a re-run of the seed)
 * never double-stakes, and each placement re-checks the Position inside placeCall's locked
 * transaction (firstStakeOnly), so two overlapping ticks cannot both stake one bot either.
 * Each stake is funded by ONE admin PointsEvent for exactly its size (unique ref,
 * skipDuplicates) and placed through placeCall, so the ledger, Position rows and pools stay
 * consistent and the bot's Season balance nets to zero. Only seeded League bots (a User with
 * an isBot LeagueAccount) stake; others land in `missingBots`. Locked or settled markets are
 * left alone. Never throws for a single bot; failures are reported.
 */
export async function seedCallStakes(market: StakeableMarket, now: Date = new Date(), client: PrismaClient = db): Promise<SeedStakesResult> {
  const plan = planBotStakes(market.ticker);
  const result: SeedStakesResult = { marketId: market.id, placed: 0, skipped: 0, failed: [], missingBots: [], yesPool: null, noPool: null };
  if (market.outcome !== null || now.getTime() >= locksAt(market.settleAt).getTime()) {
    result.skipped = plan.length;
    return result;
  }

  const planned = plan.map((s) => s.userId);
  const seeded = await client.leagueAccount.findMany({
    where: { isBot: true, userId: { in: planned } },
    select: { userId: true },
  });
  const bots = new Set(seeded.map((a) => a.userId));
  const held = await client.position.findMany({
    where: { marketId: market.id, userId: { in: planned } },
    select: { userId: true },
  });
  const holding = new Set(held.map((p) => p.userId));

  for (const stake of plan) {
    if (!bots.has(stake.userId)) {
      result.missingBots.push(stake.userId);
      result.skipped += 1;
      continue;
    }
    if (holding.has(stake.userId)) {
      result.skipped += 1;
      continue;
    }
    try {
      const r = await placeBotStake(market, stake, now, client);
      result.placed += 1;
      result.yesPool = r.market.yesPool;
      result.noPool = r.market.noPool;
    } catch (e) {
      if (e instanceof AlreadyStakedError) {
        result.skipped += 1;
        continue;
      }
      result.failed.push(stake.userId);
      console.error(`${LOG_PREFIX} bot stake ${stake.userId} on ${market.ticker} ${market.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (result.missingBots.length > 0) {
    console.warn(`${LOG_PREFIX} ${market.ticker} ${market.id}: ${result.missingBots.length} planned bot(s) not seeded in the League yet; stakes skipped`);
  }
  return result;
}

/**
 * Admin grant -> placeCall(firstStakeOnly). The bot User already exists (seedCallStakes only
 * gets here for a bot with an isBot LeagueAccount). The grant is idempotent on its ref, so a
 * tick that loses the race to another one leaves no second grant, and the locked re-check in
 * placeCall throws AlreadyStakedError instead of staking twice.
 */
async function placeBotStake(market: StakeableMarket, stake: BotStake, now: Date, client: PrismaClient): Promise<PlaceCallResult> {
  await client.pointsEvent.createMany({
    data: [{ userId: stake.userId, seasonId: market.seasonId, source: "admin", ref: seedGrantRef(market.id, stake.userId), delta: stake.points }],
    skipDuplicates: true,
  });
  return placeCall({ userId: stake.userId, marketId: market.id, side: stake.side, points: stake.points }, now, client, { firstStakeOnly: true });
}

export interface EnsuredMarket {
  ticker: string;
  marketId: string;
  strike: number;
  /** "created" by this call, or "existing" (also when a concurrent tick won the race). */
  action: "created" | "existing";
  stakes: SeedStakesResult;
}

export interface EnsureMarketsResult {
  seasonId: string;
  /** The Friday settle instant the markets are (or would be) for. */
  settleAt: Date;
  /** True inside the lock window before settleAt: nothing is created or staked this tick. */
  locked: boolean;
  markets: EnsuredMarket[];
  /** Tickers skipped because no quote was available for the strike; the next tick retries. */
  noQuote: string[];
}

/**
 * Make sure the standard markets exist for the coming Friday and carry the bot stakes.
 * See the module header. Idempotent; safe to run every 5 minutes and from the seed.
 */
export async function ensureWeeklyMarkets(
  seasonId: string,
  now: Date = new Date(),
  client: PrismaClient = db,
  tickers: readonly string[] = SEED_CALL_TICKERS,
): Promise<EnsureMarketsResult> {
  const settleAt = fridaySettleAt(now);
  const result: EnsureMarketsResult = { seasonId, settleAt, locked: false, markets: [], noQuote: [] };
  if (now.getTime() >= locksAt(settleAt).getTime()) {
    result.locked = true;
    return result;
  }

  for (const raw of tickers) {
    const ticker = raw.toUpperCase();
    let action: EnsuredMarket["action"] = "existing";
    let market = await client.market.findFirst({ where: { seasonId, ticker, settleAt } });
    if (!market) {
      const strike = await mondayOpenStrike(ticker);
      if (strike === null) {
        result.noQuote.push(ticker);
        console.warn(`${LOG_PREFIX} ${ticker}: no quote for a strike; market for ${settleAt.toISOString()} not created this tick`);
        continue;
      }
      try {
        market = await createMarket({ seasonId, ticker, strike, settleAt }, client);
        action = "created";
        console.log(`${LOG_PREFIX} opened ${ticker} > $${strike.toFixed(2)} (${STRIKE_LABEL}) settling ${settleAt.toISOString()}`);
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        market = await client.market.findFirst({ where: { seasonId, ticker, settleAt } });
        if (!market) throw e;
      }
    }
    const stakes = await seedCallStakes(market, now, client);
    result.markets.push({ ticker, marketId: market.id, strike: toNumber(market.strike) ?? 0, action, stakes });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export interface ResolvedPrice {
  price: number;
  source: string;
  publishedAt: Date | null;
}

/**
 * The price a market settles on: Pyth's first publish at/after settleAt, else lib/price
 * (Jupiter after the close) when fresh. Null when nothing usable exists yet.
 */
export async function resolveSettlePrice(ticker: string, settleAt: Date): Promise<ResolvedPrice | null> {
  try {
    const feedId = await resolvePythFeedId(ticker);
    if (feedId) {
      const latest = await fetchPythLatest([feedId]);
      const p = latest.get(feedId);
      if (p && p.price > 0 && p.publishedAt.getTime() >= settleAt.getTime()) {
        return { price: p.price, source: "pyth", publishedAt: p.publishedAt };
      }
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} pyth lookup failed for ${ticker}: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const q = await getPriceBySymbol(xstockSymbol(ticker));
    if (q.price !== null && q.price > 0 && !q.stale && q.source !== "none") {
      return { price: q.price, source: q.source, publishedAt: q.publishedAt };
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} price lookup failed for ${ticker}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return null;
}

export type SettleStatus = "settled" | "voided" | "already_settled" | "not_due" | "waiting_for_price" | "missing";

export interface SettleResult {
  marketId: string;
  status: SettleStatus;
  outcome?: Outcome;
  settledPrice?: number | null;
  source?: string | null;
  /** Points written back to the ledger (payouts + refunds). Equals the pool when settled. */
  paid?: number;
  positions?: number;
  refunded?: boolean;
}

/** Ledger rows for a settlement: one payout per winner, one refund per refunded stake. Losers get nothing. */
export function settlementEvents(marketId: string, seasonId: string, settlement: Settlement): Prisma.PointsEventCreateManyInput[] {
  const out: Prisma.PointsEventCreateManyInput[] = [];
  for (const p of settlement.positions) {
    if (p.payout <= 0) continue;
    if (p.result === "refunded") {
      out.push({ userId: p.userId, seasonId, source: "call", ref: refundRef(marketId, p.userId, p.side), delta: p.payout });
    } else if (p.result === "won") {
      out.push({ userId: p.userId, seasonId, source: "call", ref: payoutRef(marketId, p.userId), delta: p.payout });
    }
  }
  return out;
}

/** Claim the market and write its payouts in one transaction. Safe to call twice. */
async function finaliseMarket(marketId: string, outcome: Outcome, settledPrice: number | null, source: string | null): Promise<SettleResult> {
  return db.$transaction(async (tx) => {
    const fresh = await tx.market.findUnique({ where: { id: marketId }, include: { positions: true } });
    if (!fresh) return { marketId, status: "missing" };
    if (fresh.outcome !== null) return { marketId, status: "already_settled" };
    const claimed = await tx.market.updateMany({ where: { id: marketId, outcome: null }, data: { outcome, settledPrice, source } });
    if (claimed.count === 0) return { marketId, status: "already_settled" };

    const settlement = settle(
      fresh.positions.map((p) => ({ userId: p.userId, side: (p.side === "no" ? "no" : "yes") as Side, points: p.points })),
      outcome,
    );
    const events = settlementEvents(marketId, fresh.seasonId, settlement);
    if (events.length > 0) await tx.pointsEvent.createMany({ data: events, skipDuplicates: true });
    return {
      marketId,
      status: outcome === "void" ? "voided" : "settled",
      outcome,
      settledPrice,
      source,
      paid: settlement.paid,
      positions: settlement.positions.length,
      refunded: settlement.refunded,
    };
  });
}

/**
 * Settle one market if it is due. Leaves it open while no price is usable (retried by the
 * next tick) and voids it once VOID_AFTER_MS have passed with still nothing.
 */
export async function settleMarket(market: MarketRow, now: Date = new Date()): Promise<SettleResult> {
  if (market.outcome !== null) return { marketId: market.id, status: "already_settled" };
  if (now.getTime() <= market.settleAt.getTime()) return { marketId: market.id, status: "not_due" };

  const strike = toNumber(market.strike);
  if (strike === null) throw new CallsError(`Market ${market.id} has no numeric strike`, 500);

  const resolved = await resolveSettlePrice(market.ticker, market.settleAt);
  if (resolved) {
    const outcome: Outcome = resolved.price > strike ? "yes" : "no";
    return finaliseMarket(market.id, outcome, resolved.price, resolved.source);
  }
  if (now.getTime() - market.settleAt.getTime() >= VOID_AFTER_MS) {
    console.warn(`${LOG_PREFIX} ${market.ticker} ${market.id}: no price ${VOID_AFTER_MS / 3600000}h after settle; voiding`);
    return finaliseMarket(market.id, "void", null, null);
  }
  return { marketId: market.id, status: "waiting_for_price" };
}

export interface CallsTickResult {
  /** Null when no Season exists yet, or when ensuring threw (see `ensureError`). */
  ensured: EnsureMarketsResult | null;
  settled: SettleResult[];
}

/**
 * ensureWeeklyMarkets for the current Season, then settle every due market. One market's
 * failure never blocks the rest, and a failure to open next week's markets never blocks
 * settlement: it is rethrown only after the due markets have been handled, so the cron
 * still reports the module as failed and the next tick retries.
 */
export async function tick(now: Date = new Date()): Promise<CallsTickResult> {
  let ensured: EnsureMarketsResult | null = null;
  let ensureError: unknown = null;
  try {
    const seasonId = await findCurrentSeasonId(now, db);
    if (seasonId) ensured = await ensureWeeklyMarkets(seasonId, now, db);
    else console.warn(`${LOG_PREFIX} no Season seeded; weekly markets not ensured`);
  } catch (e) {
    ensureError = e;
    console.error(`${LOG_PREFIX} ensureWeeklyMarkets failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const due = await db.market.findMany({ where: { outcome: null, settleAt: { lt: now } }, orderBy: { settleAt: "asc" } });
  const settled: SettleResult[] = [];
  for (const market of due) {
    try {
      const r = await settleMarket(market, now);
      settled.push(r);
      if (r.status === "settled" || r.status === "voided") {
        console.log(`${LOG_PREFIX} ${market.ticker} ${market.id} -> ${r.outcome} @ ${r.settledPrice ?? "n/a"} (${r.source ?? "no source"}), paid ${r.paid} pts`);
      }
    } catch (e) {
      console.error(`${LOG_PREFIX} settle ${market.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (ensureError) throw ensureError;
  return { ensured, settled };
}

export const calls: GameModule = {
  key: "calls",
  async tick(now: Date) {
    await tick(now);
  },
};
