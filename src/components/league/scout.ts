/**
 * Scout on /competition (C5 / REVIEW M-F): the n/3 chip and the "Quest complete: ... +50 pts" toast.
 * Client-safe, no React. The Scout Play is found by its rule (internal_event league_trade),
 * never by key, so any Play counting League trades works the same way.
 */
import type { LeagueTradeResponse, PlayView, PlaysResponse } from "@/lib/api-client";

/** A Play a League trade just completed (POST /api/v1/league/trade `completedPlays`). */
export interface CompletedPlayNotice {
  key: string;
  title: string;
  points: number;
}

/**
 * POST /api/v1/league/trade response. The route adds `completedPlays`; it is optional here
 * until src/lib/api-client.ts LeagueTradeResponse carries it.
 */
export type LeagueTradeResult = LeagueTradeResponse & { completedPlays?: CompletedPlayNotice[] };

/** internal_event rule counting League trades. */
export function isLeagueTradePlay(play: Pick<PlayView, "rule">): boolean {
  const rule = play.rule as { type?: unknown; event?: unknown } | null | undefined;
  return rule?.type === "internal_event" && rule.event === "league_trade";
}

/** The first live League-trade Play on the Plays board, or null (not seeded / signed out). */
export function findScoutPlay(data: PlaysResponse | null | undefined): PlayView | null {
  for (const group of data?.groups ?? []) {
    for (const campaign of group.campaigns) {
      const play = campaign.plays.find((p) => !p.comingSoon && isLeagueTradePlay(p));
      if (play) return play;
    }
  }
  return null;
}

export interface ScoutProgress {
  title: string;
  points: number;
  current: number;
  target: number;
  complete: boolean;
}

function proofCurrent(proof: unknown): number | null {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return null;
  const progress = (proof as { progress?: unknown }).progress;
  if (!progress || typeof progress !== "object") return null;
  const current = (progress as { current?: unknown }).current;
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

/**
 * Chip state: the stored progress (proof.progress.current), never below this week's trade
 * count (those trades are part of what the engine counts, and the proof can lag a tick).
 */
export function scoutProgress(play: PlayView | null, weekTrades: number): ScoutProgress | null {
  if (!play) return null;
  const rule = play.rule as { type?: unknown; count?: unknown };
  if (rule.type !== "internal_event") return null;
  const target = Math.max(1, Math.floor(typeof rule.count === "number" && Number.isFinite(rule.count) ? rule.count : 1));
  const complete = play.status === "complete";
  const trades = Number.isFinite(weekTrades) ? Math.max(0, Math.floor(weekTrades)) : 0;
  const current = complete ? target : Math.min(target, Math.max(proofCurrent(play.proof) ?? 0, trades));
  return { title: play.title, points: play.points, current, target, complete };
}

/** "Quest complete: First Paper Trades · +50 pts" — the same shape the predictions toast uses. */
export function completedPlayTitle(n: CompletedPlayNotice): string {
  return `Quest complete: ${n.title} · +${n.points.toLocaleString("en-US")} pts`;
}
