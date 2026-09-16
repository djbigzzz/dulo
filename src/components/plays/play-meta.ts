import { isListedPartnerSlug } from "@/lib/plays/partners";
import type { PlayRule } from "@/lib/plays/rules";

/**
 * Presentation helpers for the quests board: quest kinds, filter categories, where a quest
 * happens, progress extraction and board totals. Pure and client-safe (tested in plays.test.ts).
 *
 * A quest never links to a buy. In-platform quests link to the page inside Dulo where they are
 * completed (predictions, the competition, the copy tool); on-chain quests describe a wallet
 * state and carry no action at all.
 */

/**
 * The three kinds of quest on the board:
 *  - in-platform          completed inside Dulo with starter points and virtual cash (internal_event rules);
 *  - on-chain             verified from the user's own wallet snapshots (every other live rule, Portfolio Match included);
 *  - partner-coming-soon  listed by a partner but not verified yet (seeded inactive).
 */
export type QuestKind = "in-platform" | "on-chain" | "partner-coming-soon";

export function questKind(play: { rule: PlayRule; comingSoon: boolean }): QuestKind {
  if (play.comingSoon) return "partner-coming-soon";
  if (play.rule.type === "internal_event") return "in-platform";
  return "on-chain";
}

export type PlayFilter = "all" | "in_platform" | "on_chain" | "badges";

export const PLAY_FILTERS: ReadonlyArray<{ value: PlayFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "in_platform", label: "In-platform" },
  { value: "on_chain", label: "On-chain" },
  { value: "badges", label: "Badges" },
];

/** The minimum a quest needs for the helpers here (PlayView and PartnerPlayView both fit). */
export interface PlayLike {
  points: number;
  badgeKey: string | null;
  rule: PlayRule;
  comingSoon: boolean;
  status?: "locked" | "in_progress" | "complete";
  proof?: unknown;
}

/**
 * In-platform: in-platform quests only. On-chain: live on-chain quests plus the partner quests
 * coming soon (partner quests are on-chain quests that are not verified yet). Badges: any quest
 * that mints a Badge.
 */
export function matchesFilter(play: PlayLike, filter: PlayFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "badges":
      return play.badgeKey !== null;
    case "in_platform":
      return questKind(play) === "in-platform";
    case "on_chain":
      return questKind(play) !== "in-platform";
    default:
      return true;
  }
}

/** Where a quest is done: a page inside Dulo. On-chain quests have none (the wallet state is the quest). */
export type PlayAction = { kind: "internal"; href: string; label: string };

/** Where the quest is done inside Dulo, or null for a quest verified from the wallet. */
export function playHref(rule: PlayRule): PlayAction | null {
  if (rule.type === "mirror_match") return { kind: "internal", href: "/copy", label: "Copy a portfolio" };
  if (rule.type === "internal_event") {
    if (rule.event === "league_trade") return { kind: "internal", href: "/competition", label: "Open the competition" };
    if (rule.event === "call_placed" || rule.event === "game_action") {
      return { kind: "internal", href: "/predictions", label: "Make a prediction" };
    }
    if (rule.event === "mirror_executed") return { kind: "internal", href: "/copy", label: "Copy a portfolio" };
    return null;
  }
  return null;
}

/** The action a quest card actually shows: none once the quest is complete or while it is coming soon. */
export function visibleStartAction(play: PlayLike): PlayAction | null {
  if (play.comingSoon || play.status === "complete") return null;
  return playHref(play.rule);
}

export interface PlayProgressView {
  current: number;
  target: number;
  unit: string;
}

/** proof.progress written by the cron ({ current, target, unit }), or null when absent or malformed. */
export function proofProgress(proof: unknown): PlayProgressView | null {
  if (typeof proof !== "object" || proof === null || Array.isArray(proof)) return null;
  const p = (proof as Record<string, unknown>).progress;
  if (typeof p !== "object" || p === null) return null;
  const { current, target, unit } = p as Record<string, unknown>;
  if (typeof current !== "number" || typeof target !== "number" || !Number.isFinite(current) || !Number.isFinite(target) || target <= 0) {
    return null;
  }
  return { current: Math.max(0, Math.min(current, target)), target, unit: typeof unit === "string" ? unit : "" };
}

/** Engine progress units as a card prints them. Units not listed pass through ("days", "questions"). */
const PROGRESS_UNIT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  events: "done",
  legs: "holdings matched",
  days: "days",
  assets: "xStocks",
});

/** "legs" -> "holdings matched", "events" -> "done"; anything else unchanged. */
export function progressUnitLabel(unit: string): string {
  return Object.prototype.hasOwnProperty.call(PROGRESS_UNIT_LABELS, unit) ? PROGRESS_UNIT_LABELS[unit] : unit;
}

/**
 * The progress a quest card may show, unit already labelled, or null. A dollar target
 * ("300 of 1,000 usd") reads as "buy $700 more of a stock", so a card never shows one; the
 * proof drawer still lists the snapshot.
 */
export function cardProgress(progress: PlayProgressView | null | undefined): PlayProgressView | null {
  if (!progress || progress.unit.trim().toLowerCase() === "usd") return null;
  return { ...progress, unit: progressUnitLabel(progress.unit) };
}

export interface BoardTotals {
  /** Live quests (coming soon left out). */
  livePlays: number;
  livePoints: number;
  /** Distinct Badge designs a live Play mints. */
  badges: number;
  completed: number;
}

export function boardTotals(plays: PlayLike[]): BoardTotals {
  const live = plays.filter((p) => !p.comingSoon);
  return {
    livePlays: live.length,
    livePoints: live.reduce((n, p) => n + p.points, 0),
    badges: new Set(live.map((p) => p.badgeKey).filter((k): k is string => k !== null)).size,
    completed: plays.filter((p) => p.status === "complete").length,
  };
}

export type PartnerListingLabel = "Quests live" | "Coming soon";

/**
 * What a Partner chip may honestly say: "Quests live" once at least one of its quests verifies
 * today, "Coming soon" otherwise. It never implies the project itself listed or endorses Dulo.
 */
export function partnerListingLabel(livePlays: number): PartnerListingLabel {
  return livePlays > 0 ? "Quests live" : "Coming soon";
}

/** Caption under a Partner logo tile: the honest listing label, then the listed quest count ("Coming soon · 1 quest"). */
export function partnerRowCaption(partner: { playCount: number; livePlayCount: number }): string {
  return `${partnerListingLabel(partner.livePlayCount)} · ${partner.playCount} ${partner.playCount === 1 ? "quest" : "quests"}`;
}

/** Partners a listing counts: the hidden house Partner (in-platform quests) is left out, so /quests agrees with /partners. */
export function listedPartnerCount(groups: ReadonlyArray<{ partner: { slug: string } }>): number {
  return groups.filter((g) => isListedPartnerSlug(g.partner.slug)).length;
}

/** The Partner page for `slug`, or null for the hidden house Partner (in-platform quests), which has no page. */
export function partnerPageHref(slug: string): string | null {
  return isListedPartnerSlug(slug) ? `/partners/${encodeURIComponent(slug)}` : null;
}
