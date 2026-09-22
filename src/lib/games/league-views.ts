/**
 * Wire shaping for the League API (src/app/api/v1/league/**). Server-only.
 *
 * Everything returned here is in the shapes exported from src/lib/api-client.ts
 * (ISO dates, plain numbers) so the route handlers hand it straight to ok().
 * The pure helpers (toQuoteView, toLeagueView, buildAccountView) take plain rows.
 */
import type { AssetInfo, PriceQuote } from "@/lib/core";
import { mintFromAssetId } from "@/lib/core";
import { getPreStocksMarks, prestocks, type PreStocksMark } from "@/lib/assets/prestocks";
import { evaluateUser } from "@/lib/cron/evaluate";
import { safeParsePlayRule } from "@/lib/plays/rules";
import { getPricesBySymbols } from "@/lib/price";
import { fetchJupiterPrices } from "@/lib/prices/jupiter";
import { db } from "@/lib/server/db";
import { pickDisplayWallet } from "@/lib/server/queries";
import type {
  LeagueAccountView,
  LeagueLeaderboardRow,
  LeaguePositionView,
  LeagueResponse,
  LeagueSettledView,
  LeagueSymbolView,
  LeagueSymbolsResponse,
  LeagueTradeResponse,
  LeagueTradeView,
  LeagueView,
  PriceQuoteView,
} from "@/lib/api-client";
import {
  LEADERBOARD_LIMIT,
  RANK_POINTS,
  RECENT_TRADES_LIMIT,
  SPREAD,
  STARTING_CASH_USD,
  TRADABLE_SYMBOLS,
  ensureLeague,
  findCurrentSeasonId,
  isTradingOpen,
  parsePositions,
  placeTrade,
  rankDelta,
  recomputeIfStale,
  round6,
  toNumber,
  type AccountRow,
  type LeagueRow,
  type PlaceTradeInput,
  type TradeRow,
} from "./league";

const LOG_PREFIX = "[games/league-views]";

// ---------------------------------------------------------------------------
// Pure shaping
// ---------------------------------------------------------------------------

export function toQuoteView(q: PriceQuote): PriceQuoteView {
  return {
    assetId: q.assetId,
    symbol: q.symbol,
    price: q.price,
    source: q.source,
    publishedAt: q.publishedAt ? q.publishedAt.toISOString() : null,
    ageSeconds: q.ageSeconds,
    stale: q.stale,
    marketOpen: q.marketOpen,
  };
}

function noneQuote(assetId: string, symbol: string): PriceQuoteView {
  return { assetId, symbol, price: null, source: "none", publishedAt: null, ageSeconds: null, stale: true, marketOpen: false };
}

export function toLeagueView(league: LeagueRow, now: Date): LeagueView {
  const open = isTradingOpen(league, now);
  const status: LeagueView["status"] = league.status === "settled" ? "settled" : "open";
  return {
    id: league.id,
    seasonId: league.seasonId,
    weekStart: league.weekStart.toISOString(),
    weekEnd: league.weekEnd.toISOString(),
    status,
    open,
    closesIn: open ? Math.max(0, league.weekEnd.getTime() - now.getTime()) : null,
    // The League never waits for Monday any more (C6): weekend trades count toward the
    // upcoming week, so there is nothing to count down to before it opens.
    opensIn: null,
  };
}

export function toTradeView(t: TradeRow): LeagueTradeView {
  return {
    id: t.id,
    symbol: t.symbol,
    side: t.side === "sell" ? "sell" : "buy",
    qty: toNumber(t.qty),
    price: toNumber(t.price),
    priceSource: t.priceSource,
    ts: t.ts.toISOString(),
  };
}

function pct(pnlUsd: number, base: number): number {
  return base > 0 ? round6((pnlUsd / base) * 100) : 0;
}

/** Positions valued with the given quotes (by assetId); equity/rank come from the row. */
export function buildAccountView(account: AccountRow, quotes: ReadonlyMap<string, PriceQuoteView>, trades: readonly TradeRow[]): LeagueAccountView {
  const positions: LeaguePositionView[] = Object.entries(parsePositions(account.positions))
    .map(([assetId, p]) => {
      const quote = quotes.get(assetId) ?? noneQuote(assetId, p.symbol);
      const last = quote.price !== null && quote.price > 0 ? quote.price : null;
      const costUsd = round6(p.qty * p.avgPrice);
      const valueUsd = round6(p.qty * (last ?? p.avgPrice));
      const pnlUsd = last === null ? null : round6(valueUsd - costUsd);
      return {
        assetId,
        symbol: p.symbol,
        qty: p.qty,
        avgPrice: p.avgPrice,
        last,
        quote,
        valueUsd,
        costUsd,
        pnlUsd,
        pnlPct: pnlUsd === null ? null : pct(pnlUsd, costUsd),
      };
    })
    .sort((a, b) => b.valueUsd - a.valueUsd || a.symbol.localeCompare(b.symbol));

  const equityUsd = toNumber(account.equityUsd);
  const pnlUsd = round6(equityUsd - STARTING_CASH_USD);
  return {
    id: account.id,
    cashUsd: toNumber(account.cashUsd),
    equityUsd,
    rank: account.rank,
    delta: rankDelta(account.id, account.rank),
    pnlUsd,
    pnlPct: pct(pnlUsd, STARTING_CASH_USD),
    positions,
    trades: trades.map(toTradeView),
    isBot: account.isBot,
  };
}

interface UserName {
  handle: string | null;
  address: string | null;
}

function toLeaderboardRow(
  a: { id: string; userId: string; equityUsd: unknown; rank: number | null; isBot: boolean },
  index: number,
  names: ReadonlyMap<string, UserName>,
  meUserId: string | null,
): LeagueLeaderboardRow {
  const equityUsd = toNumber(a.equityUsd);
  const rank = a.rank ?? index + 1;
  const name = names.get(a.userId);
  return {
    rank,
    userId: a.userId,
    handle: name?.handle ?? null,
    address: name?.address ?? null,
    equityUsd,
    pnlPct: pct(equityUsd - STARTING_CASH_USD, STARTING_CASH_USD),
    isBot: a.isBot,
    delta: rankDelta(a.id, a.rank),
    isMe: meUserId !== null && a.userId === meUserId,
  };
}

// ---------------------------------------------------------------------------
// DB reads
// ---------------------------------------------------------------------------

const boardSelect = { id: true, userId: true, equityUsd: true, rank: true, isBot: true } as const;

/** handle + display wallet for a set of users. */
async function loadNames(userIds: readonly string[]): Promise<Map<string, UserName>> {
  const out = new Map<string, UserName>();
  if (userIds.length === 0) return out;
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, handle: true, wallets: { select: { address: true, isPrimary: true, createdAt: true } } },
  });
  for (const u of users) out.set(u.id, { handle: u.handle ?? null, address: pickDisplayWallet(u.wallets)?.address ?? null });
  return out;
}

/** Quotes for the tradable list plus `extra` symbols, keyed by assetId and by upper-cased symbol. */
async function loadQuotes(extra: readonly string[]): Promise<{ list: PriceQuoteView[]; byAssetId: Map<string, PriceQuoteView>; bySymbol: Map<string, PriceQuoteView> }> {
  const { quotes } = await getPricesBySymbols([...TRADABLE_SYMBOLS, ...extra]);
  const list = quotes.map(toQuoteView);
  const byAssetId = new Map(list.map((q) => [q.assetId, q]));
  const bySymbol = new Map(list.map((q) => [q.symbol.toUpperCase(), q]));
  return { list, byAssetId, bySymbol };
}

function heldSymbols(account: { positions: unknown } | null): string[] {
  return account ? Object.values(parsePositions(account.positions)).map((p) => p.symbol) : [];
}

/** Everything /league renders, personalised for `userId` (null = anonymous). */
export async function getLeagueOverview(userId: string | null, now: Date = new Date()): Promise<LeagueResponse> {
  const base = { now: now.toISOString(), signedIn: userId !== null, startingCashUsd: STARTING_CASH_USD, spread: SPREAD };
  const seasonId = await findCurrentSeasonId(now);
  if (!seasonId) return { ...base, league: null, me: null, leaderboard: [], quotes: [], lastSettled: null };

  const league = await ensureLeague(seasonId, now);
  // Keep the board fresh between cron ticks; a pricing hiccup must never break the read.
  try {
    await recomputeIfStale(league.id, now);
  } catch (e) {
    console.warn(`${LOG_PREFIX} recompute skipped: ${e instanceof Error ? e.message : String(e)}`);
  }

  const [board, mine, settled] = await Promise.all([
    db.leagueAccount.findMany({
      where: { leagueId: league.id },
      orderBy: [{ rank: { sort: "asc", nulls: "last" } }, { equityUsd: "desc" }, { userId: "asc" }],
      take: LEADERBOARD_LIMIT,
      select: boardSelect,
    }),
    userId
      ? db.leagueAccount.findUnique({
          where: { leagueId_userId: { leagueId: league.id, userId } },
          include: { trades: { orderBy: { ts: "desc" }, take: RECENT_TRADES_LIMIT } },
        })
      : Promise.resolve(null),
    db.league.findFirst({
      where: { seasonId, status: "settled" },
      orderBy: { weekEnd: "desc" },
      select: {
        id: true,
        weekStart: true,
        weekEnd: true,
        accounts: { where: { rank: { lte: RANK_POINTS.length } }, orderBy: { rank: "asc" }, select: boardSelect },
      },
    }),
  ]);

  const [names, quotes] = await Promise.all([
    loadNames([...board.map((a) => a.userId), ...(settled?.accounts ?? []).map((a) => a.userId)]),
    loadQuotes(heldSymbols(mine)),
  ]);

  const me = mine ? buildAccountView(mine, quotes.byAssetId, mine.trades) : null;
  const leaderboard = board.map((a, i) => toLeaderboardRow(a, i, names, userId));
  const lastSettled: LeagueSettledView | null = settled
    ? {
        id: settled.id,
        weekStart: settled.weekStart.toISOString(),
        weekEnd: settled.weekEnd.toISOString(),
        top: settled.accounts.map((a, i) => toLeaderboardRow(a, i, names, userId)),
      }
    : null;

  return { ...base, league: toLeagueView(league, now), me, leaderboard, quotes: quotes.list, lastSettled };
}

// ---------------------------------------------------------------------------
// Pre-IPO symbols on the trade form (22 Sep)
// ---------------------------------------------------------------------------

/**
 * The issuer marks and the Jupiter 24h changes for the pre-IPO symbols are read at most once
 * per PRE_IPO_EXTRAS_TTL_MS per instance: the trade form refetches the symbols after every
 * trade, and keyless Jupiter allows about 0.5 requests a second.
 */
export const PRE_IPO_EXTRAS_TTL_MS = 60_000;

interface PreIpoExtras {
  at: number;
  /** Issuer marks by upper-cased symbol. */
  marks: ReadonlyMap<string, PreStocksMark>;
  /** Jupiter priceChange24h (percent) by upper-cased symbol; only finite numbers are kept. */
  change24h: ReadonlyMap<string, number>;
}

let preIpoExtras: PreIpoExtras | null = null;

/** Test hook: forget the cached marks and 24h changes. */
export function resetLeagueSymbolsCache(): void {
  preIpoExtras = null;
}

/** The pre-IPO catalogue as the issuer source serves it (static eight plus anything the live API added); empty on failure. */
async function loadPreIpoAssets(): Promise<AssetInfo[]> {
  try {
    const list = await prestocks.listAssets();
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn(`${LOG_PREFIX} pre-IPO catalogue unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/** Marks and 24h changes for the pre-IPO assets, cached; never throws (an upstream failure reads as "none"). */
async function loadPreIpoExtras(assets: readonly AssetInfo[], now: Date): Promise<PreIpoExtras> {
  if (preIpoExtras && now.getTime() - preIpoExtras.at < PRE_IPO_EXTRAS_TTL_MS) return preIpoExtras;
  const mintBySymbol = new Map<string, string>();
  for (const a of assets) {
    try {
      mintBySymbol.set(a.symbol.toUpperCase(), mintFromAssetId(a.assetId));
    } catch {
      // A malformed id has no mint to ask Jupiter about; the quote itself still comes from lib/price.
    }
  }
  const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const [rawMarks, jupiter] = await Promise.all([
    getPreStocksMarks().catch((e: unknown) => {
      console.warn(`${LOG_PREFIX} issuer marks unavailable: ${describe(e)}`);
      return new Map<string, PreStocksMark>();
    }),
    fetchJupiterPrices([...mintBySymbol.values()]).catch((e: unknown) => {
      console.warn(`${LOG_PREFIX} Jupiter 24h change unavailable: ${describe(e)}`);
      return new Map<string, { priceChange24h?: number }>();
    }),
  ]);
  const marks = new Map<string, PreStocksMark>();
  for (const [symbol, mark] of rawMarks) marks.set(symbol.toUpperCase(), mark);
  const change24h = new Map<string, number>();
  for (const [symbol, mint] of mintBySymbol) {
    const change = jupiter.get(mint)?.priceChange24h;
    if (typeof change === "number" && Number.isFinite(change)) change24h.set(symbol, change);
  }
  preIpoExtras = { at: now.getTime(), marks, change24h };
  return preIpoExtras;
}

/**
 * The trade form's symbol list: the fixed tradable xStocks, then every pre-IPO token the issuer
 * source lists, then whatever else the caller holds, each with its lib/price quote and its
 * source. A pre-IPO entry also carries the issuer's own mark (null when the issuer gave none)
 * and Jupiter's 24h change (null when unavailable); an xStock entry carries neither key. The
 * quote lookup is not fenced: a held symbol of either issuer is always quoted.
 */
export async function getLeagueSymbols(userId: string | null, now: Date = new Date()): Promise<LeagueSymbolsResponse> {
  const seasonId = await findCurrentSeasonId(now);
  const league = seasonId ? await ensureLeague(seasonId, now) : null;
  const [account, preIpoAssets] = await Promise.all([
    league && userId
      ? db.leagueAccount.findUnique({ where: { leagueId_userId: { leagueId: league.id, userId } }, select: { cashUsd: true, positions: true } })
      : Promise.resolve(null),
    loadPreIpoAssets(),
  ]);
  const positions = account ? parsePositions(account.positions) : {};
  const heldByAssetId = new Map(Object.entries(positions).map(([assetId, p]) => [assetId, p.qty]));
  const preIpoSymbols = new Set(preIpoAssets.map((a) => a.symbol.toUpperCase()));
  const [quotes, extras] = await Promise.all([
    loadQuotes([...preIpoAssets.map((a) => a.symbol), ...Object.values(positions).map((p) => p.symbol)]),
    loadPreIpoExtras(preIpoAssets, now),
  ]);
  const symbols: LeagueSymbolView[] = quotes.list.map((q) => {
    const key = q.symbol.toUpperCase();
    const base = { symbol: q.symbol, assetId: q.assetId, quote: q, held: heldByAssetId.get(q.assetId) ?? 0 };
    if (!preIpoSymbols.has(key)) return { ...base, source: "xstocks" };
    const mark = extras.marks.get(key);
    return {
      ...base,
      source: "prestocks",
      issuerMark: mark && mark.markPrice !== null && mark.markPrice > 0 ? { price: mark.markPrice, publishedAt: mark.fetchedAt.toISOString() } : null,
      change24h: extras.change24h.get(key) ?? null,
    };
  });
  return {
    symbols,
    open: league ? isTradingOpen(league, now) : false,
    cashUsd: account ? toNumber(account.cashUsd) : null,
    spread: SPREAD,
  };
}

// ---------------------------------------------------------------------------
// Inline Play evaluation after a trade (C5 / REVIEW M-F)
// ---------------------------------------------------------------------------

/** How long POST /league/trade waits for the inline evaluation before answering. */
export const INLINE_EVALUATE_TIMEOUT_MS = 2_500;

/** A quest (Play) whose points this trade just awarded (the trade form toasts "Quest complete: First Paper Trades · +50 pts"). */
export interface CompletedPlayNotice {
  key: string;
  title: string;
  points: number;
}

/** POST /league/trade response: LeagueTradeResponse plus the Plays this trade completed. */
export type LeagueTradeResult = LeagueTradeResponse & { completedPlays: CompletedPlayNotice[] };

export interface LeaguePlaysEvaluation {
  /** Plays this evaluation flipped to complete AND awarded (empty on timeout or failure). */
  completed: CompletedPlayNotice[];
  timedOut: boolean;
  /** The still-running evaluation when it timed out (hand it to after()); null otherwise. Never rejects. */
  pending: Promise<void> | null;
}

/** internal_event rules never read sectors or underlyings, so no catalogue fetch is needed. */
const NO_CATALOGUE = { sectorOf: () => null, underlyingOf: () => null };

/** The internal events a paper trade produces (lib/cron/evaluate loadInternalEvents). */
export const LEAGUE_TRADE_EVENTS: ReadonlySet<string> = new Set(["league_trade", "game_action"]);

/** True for an internal_event rule a paper trade can move (league_trade or game_action; any such DB row tomorrow). */
export function isLeagueTradeRule(rule: unknown): boolean {
  const parsed = safeParsePlayRule(rule);
  return parsed?.type === "internal_event" && LEAGUE_TRADE_EVENTS.has(parsed.event);
}

/**
 * Evaluate the paper-trade quests for one user right after a trade, so First Paper Trades
 * completes (and its PointsEvent lands) in the same response instead of on the next 5-minute
 * tick. Only quests whose points this run wrote are reported (newlyCompleted && awarded), so
 * the "Quest complete" toast never repeats an award another request or the cron already made.
 * DB-only: only internal_event league_trade / game_action Plays are evaluated, with no
 * snapshot history and no catalogue fetch. Never throws (the trade is already committed; the cron repairs
 * anything missed). Past `timeoutMs` it resolves { timedOut: true, pending } and the work
 * keeps running; the route passes `pending` to after() so a serverless instance finishes it.
 */
export async function evaluateLeaguePlays(userId: string, now: Date = new Date(), timeoutMs: number = INLINE_EVALUATE_TIMEOUT_MS): Promise<LeaguePlaysEvaluation> {
  const work = (async (): Promise<CompletedPlayNotice[]> => {
    const seasonId = await findCurrentSeasonId(now);
    if (!seasonId) return [];
    const rows = await db.play.findMany({
      where: { isActive: true, campaign: { seasonId } },
      select: { key: true, title: true, points: true, badgeKey: true, rule: true },
    });
    const plays = rows.filter((p) => isLeagueTradeRule(p.rule));
    if (plays.length === 0) return [];
    const result = await evaluateUser(userId, now, undefined, { season: { id: seasonId }, plays, catalogue: NO_CATALOGUE, historyDays: 0 });
    const byKey = new Map(plays.map((p) => [p.key, p]));
    return result.plays.flatMap((o) => {
      const play = byKey.get(o.key);
      return o.newlyCompleted && o.awarded && play ? [{ key: play.key, title: play.title, points: play.points }] : [];
    });
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    (timer as { unref?: () => void }).unref?.();
  });

  try {
    const outcome = await Promise.race([work, timeout]);
    if (outcome === "timeout") {
      const pending = work.then(
        (done) => {
          if (done.length > 0) console.log(`${LOG_PREFIX} ${userId} completed ${done.map((d) => d.key).join(", ")} after the ${timeoutMs}ms budget`);
        },
        (e: unknown) => {
          console.warn(`${LOG_PREFIX} Play evaluation for ${userId} failed after timeout (the next tick retries): ${e instanceof Error ? e.message : String(e)}`);
        },
      );
      return { completed: [], timedOut: true, pending };
    }
    return { completed: outcome, timedOut: false, pending: null };
  } catch (e) {
    console.warn(`${LOG_PREFIX} Play evaluation for ${userId} failed (the next tick retries): ${e instanceof Error ? e.message : String(e)}`);
    return { completed: [], timedOut: false, pending: null };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** placeTrade + the wire shape (account with live quotes, the fill's quote). */
export async function placeLeagueTrade(input: PlaceTradeInput, now: Date = new Date()): Promise<LeagueTradeResponse> {
  const r = await placeTrade(input, now);
  const [quotes, trades] = await Promise.all([
    loadQuotes(heldSymbols(r.account)),
    db.leagueTrade.findMany({ where: { leagueAccountId: r.account.id }, orderBy: { ts: "desc" }, take: RECENT_TRADES_LIMIT }),
  ]);
  return { trade: toTradeView(r.trade), account: buildAccountView(r.account, quotes.byAssetId, trades), quote: toQuoteView(r.quote), fill: r.fill };
}
