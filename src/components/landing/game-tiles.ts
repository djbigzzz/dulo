/**
 * The landing's three game tiles (approved wireframe, 16 Sep 2026): Predictions, Competition and
 * On-chain quests, each with one large live figure, one short line and one button (calmer pass,
 * 9 Oct 2026). Pure and client-safe, no React.
 *
 * Every number is read from /api/v1. While a read is loading, or after it failed, a helper
 * returns null and the tile prints an em dash: the landing never shows a made-up figure.
 *
 * Plain names only (tests/plain-names.test.ts scans this file): predictions, the competition
 * (virtual cash), quests, points.
 */
import type { CallMarketView, LeagueResponse, PlayView, PlaysResponse } from "@/lib/api-client";
import { formatPoints, formatUsd } from "@/components/common/format";
import { NEXT_WEEK_MARKETS_COPY, liveStatus, marketQuestion, splitPct } from "@/components/calls/calls-format";
import { formatSignedPct, formatUsdWhole } from "@/components/league/format";
import { VIRTUAL_CASH_USD } from "@/lib/games/ledger-policy";

/** What a tile prints while its number is loading or unavailable. */
export const TILE_PLACEHOLDER = "—";

export type GameTileKey = "predictions" | "competition" | "quests";

export interface GameTileCopy {
  key: GameTileKey;
  title: string;
  /** The one button. */
  cta: string;
  href: string;
  /** The line under the number before (or without) a live read. */
  note: string;
}

export const TILE_COPY: Readonly<Record<GameTileKey, GameTileCopy>> = {
  predictions: {
    key: "predictions",
    title: "Predictions",
    cta: "Make a prediction",
    href: "/predictions",
    note: "Yes or No on Friday's close",
  },
  competition: {
    key: "competition",
    title: "Competition",
    cta: `Start with ${formatUsdWhole(VIRTUAL_CASH_USD)} virtual cash`,
    href: "/competition",
    note: "virtual cash",
  },
  quests: {
    key: "quests",
    title: "On-chain quests",
    cta: "See quests",
    href: "/quests",
    note: "Verified from your wallet",
  },
};

/** Display order, the same as the nav: Predictions, Competition, Quests. */
export const GAME_TILE_ORDER: readonly GameTileKey[] = ["predictions", "competition", "quests"];

type MarketLike = Pick<CallMarketView, "status" | "locksAt" | "odds">;

/** True while a market belongs to this week's board: entries open, or locked and waiting to settle. */
function isLive(m: Pick<CallMarketView, "status" | "locksAt">, nowMs: number): boolean {
  const s = liveStatus(m, nowMs);
  return s === "open" || s === "locked";
}

/** Every point put into this week's open or locked predictions (a malformed total is skipped). */
function livePointsIn(markets: readonly MarketLike[], nowMs: number): number {
  let total = 0;
  for (const m of markets) {
    if (!isLive(m, nowMs)) continue;
    const pts = m.odds?.total;
    if (typeof pts === "number" && Number.isFinite(pts) && pts > 0) total += pts;
  }
  return total;
}

/**
 * A tile's one large live figure and the one short line under it ("1,900" / "points in this
 * week, incl. bot seed"). The helpers return null while a read is loading or failed: the tile
 * prints an em dash.
 */
export interface TileFigure {
  figure: string;
  line: string;
}

/**
 * "1,650" / "points in this week, incl. bot seed": every point put into this week's open or locked
 * predictions. The house bots seed every pool, so the line says so, the same words as the hero card
 * (with one real account, most of this total is the seed). Between Friday's settle and the next
 * board: "Between weeks" and when the next one opens.
 */
export function predictionsTileFigure(markets: readonly MarketLike[] | null | undefined, nowMs: number): TileFigure | null {
  if (!markets) return null;
  if (!markets.some((m) => isLive(m, nowMs))) return { figure: "Between weeks", line: NEXT_WEEK_MARKETS_COPY };
  return { figure: formatPoints(livePointsIn(markets, nowMs)), line: "points in this week, incl. bot seed" };
}

/**
 * "+1.8%" / "#1 this week · house bot · virtual cash", or "$10,000" / "virtual cash to start" on
 * an empty board. The line always says virtual cash, so the figure is never read as money.
 */
export function competitionTileFigure(league: Pick<LeagueResponse, "leaderboard"> | null | undefined): TileFigure | null {
  if (!league) return null;
  const leader = league.leaderboard?.[0];
  if (!leader) return { figure: formatUsdWhole(VIRTUAL_CASH_USD), line: "virtual cash to start" };
  return { figure: formatSignedPct(leader.pnlPct), line: `#1 this week${leader.isBot ? " · house bot" : ""} · virtual cash` };
}

/**
 * This week's predictions for the hero cards: open ones first, then locked ones, each group by
 * points in (most first), then by ticker so the order is stable. `count` is every live market.
 */
export function pickLiveMarkets<T extends Pick<CallMarketView, "status" | "locksAt" | "odds" | "ticker">>(
  markets: readonly T[] | null | undefined,
  nowMs: number,
  limit = 3,
): { shown: T[]; count: number } {
  if (!markets) return { shown: [], count: 0 };
  const rank = (m: T) => (liveStatus(m, nowMs) === "open" ? 0 : 1);
  const live = markets
    .filter((m) => isLive(m, nowMs))
    .sort((a, b) => rank(a) - rank(b) || (b.odds?.total ?? 0) - (a.odds?.total ?? 0) || a.ticker.localeCompare(b.ticker));
  return { shown: live.slice(0, Math.max(0, limit)), count: live.length };
}

/** A compact hero row's split when nobody has put points in yet (said, not drawn as a 50/50). */
export const COMPACT_ROW_EMPTY = "No points yet";

/**
 * One of the hero card's compact rows: what it shows ("NVDA above $210.00", then "64% Yes" or
 * COMPACT_ROW_EMPTY) and its accessible name, which starts with exactly that visible text, so a
 * voice user can say what they see (WCAG 2.5.3), and then adds the full question.
 */
export function compactRowCopy(m: Pick<CallMarketView, "ticker" | "strike" | "settleAt" | "odds">): {
  label: string;
  split: string;
  name: string;
} {
  const label = `${m.ticker} above ${formatUsd(m.strike)}`;
  const split = m.odds.total === 0 ? COMPACT_ROW_EMPTY : `${splitPct(m.odds).yes} Yes`;
  return { label, split, name: `${label}, ${split}. ${marketQuestion(m)}` };
}

export interface QuestTileStat {
  /** "9 quests live" */
  value: string;
  liveCount: number;
  /** Partner quests listed as coming soon: shown, never counted as live. */
  comingSoonCount: number;
}

/** Every quest on the board once, in board order (a key listed twice counts once). */
export function flattenPlays(plays: Pick<PlaysResponse, "groups"> | null | undefined): PlayView[] {
  const seen = new Map<string, PlayView>();
  for (const group of plays?.groups ?? []) {
    for (const campaign of group.campaigns) {
      for (const play of campaign.plays) if (!seen.has(play.key)) seen.set(play.key, play);
    }
  }
  return [...seen.values()];
}

/**
 * On-chain quests that can be completed today: every quest verified from a wallet (any rule
 * except the in-platform internal_event ones) that is not marked coming soon.
 * Null while the board is loading or failed.
 */
export function onChainQuestTileStat(plays: Pick<PlaysResponse, "groups"> | null | undefined): QuestTileStat | null {
  if (!plays) return null;
  let liveCount = 0;
  let comingSoonCount = 0;
  for (const play of flattenPlays(plays)) {
    if (play.rule.type === "internal_event") continue;
    if (play.comingSoon) comingSoonCount++;
    else liveCount++;
  }
  return { value: `${liveCount} ${liveCount === 1 ? "quest" : "quests"} live`, liveCount, comingSoonCount };
}

/** "11" / "quests live, verified from your wallet". Coming-soon partner quests are never counted. */
export function questTileFigure(stat: QuestTileStat | null): TileFigure | null {
  if (!stat) return null;
  return { figure: formatPoints(stat.liveCount), line: `${stat.liveCount === 1 ? "quest" : "quests"} live, verified from your wallet` };
}

/**
 * One request per endpoint per page load. The hero card and the tiles read the same
 * endpoints; whichever mounts first starts the request and the rest share its promise.
 *
 * - A pending request is always shared.
 * - A settled one is reused for `ttlMs`, so returning to the page later reads fresh numbers.
 * - A failed one is dropped at once, so a retry starts a new request.
 */
export interface SharedReads {
  get<T>(key: string, fetcher: () => Promise<T>): Promise<T>;
  clear(): void;
}

export function createSharedReads(ttlMs: number, clock: () => number = Date.now): SharedReads {
  const entries = new Map<string, { promise: Promise<unknown>; settledAt: number | null }>();
  return {
    get<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && (hit.settledAt === null || clock() - hit.settledAt < ttlMs)) return hit.promise as Promise<T>;
      const entry: { promise: Promise<unknown>; settledAt: number | null } = { promise: Promise.resolve(), settledAt: null };
      const promise = (async () => fetcher())();
      entry.promise = promise;
      entries.set(key, entry);
      promise.then(
        () => {
          entry.settledAt = clock();
        },
        () => {
          if (entries.get(key) === entry) entries.delete(key);
        },
      );
      return promise;
    },
    clear() {
      entries.clear();
    },
  };
}
