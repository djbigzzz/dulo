/**
 * The landing's three game tiles (approved wireframe, 16 Sep 2026): Predictions, Competition and
 * On-chain quests, each with one live number and one button. Pure and client-safe, no React.
 *
 * Every number is read from /api/v1. While a read is loading, or after it failed, a helper
 * returns null and the tile prints an em dash: the landing never shows a made-up figure.
 *
 * Plain names only (tests/plain-names.test.ts scans this file): predictions, the competition
 * (virtual cash), quests, points.
 */
import type { CallMarketView, LeagueResponse, PlayView, PlaysResponse } from "@/lib/api-client";
import { formatPoints } from "@/components/common/format";
import { liveStatus } from "@/components/calls/calls-format";
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
    note: "Yes or No on Friday's close · house bots seed each pool",
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

/**
 * "1,650 pts in this week": every point put into this week's open or locked predictions.
 * Null while the board is loading or failed (the tile shows an em dash instead).
 */
export function predictionsTileStat(markets: readonly MarketLike[] | null | undefined, nowMs: number): string | null {
  if (!markets) return null;
  let total = 0;
  for (const m of markets) {
    if (!isLive(m, nowMs)) continue;
    const pts = m.odds?.total;
    if (typeof pts === "number" && Number.isFinite(pts) && pts > 0) total += pts;
  }
  return `${formatPoints(total)} pts in this week`;
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

export interface CompetitionTileStat {
  value: string;
  /** Always says "virtual cash", so the number is never read as real money. */
  note: string;
}

/**
 * The weekly competition's leader: "#1 +1.8% this week" with "virtual cash" (and "house bot"
 * when the leader is one). An empty board reads "$10,000 virtual cash to start".
 * Null while the overview is loading or failed.
 */
export function competitionTileStat(league: Pick<LeagueResponse, "leaderboard"> | null | undefined): CompetitionTileStat | null {
  if (!league) return null;
  const leader = league.leaderboard?.[0];
  if (!leader) return { value: formatUsdWhole(VIRTUAL_CASH_USD), note: "virtual cash to start" };
  return {
    value: `#1 ${formatSignedPct(leader.pnlPct)} this week`,
    note: `virtual cash${leader.isBot ? " · house bot" : ""}`,
  };
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

/** "Verified from your wallet · 2 coming soon" */
export function questTileNote(stat: QuestTileStat | null): string {
  const base = TILE_COPY.quests.note;
  return stat && stat.comingSoonCount > 0 ? `${base} · ${stat.comingSoonCount} coming soon` : base;
}

/**
 * One request per endpoint per page load. The hero cards and the tiles read the same four
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
