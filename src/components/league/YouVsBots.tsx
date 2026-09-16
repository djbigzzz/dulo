"use client";

/**
 * "You versus the house bots" — one line plus a small bar, derived entirely from the board the
 * competition page already fetched (GET /api/v1/league). No new request, no new data.
 *
 * Honesty rules this file keeps:
 * - The words "house bots" appear in the sentence itself, so a seeded account's numbers are never
 *   shown as if a person produced them.
 * - "ahead of N of M" counts only the house bots present on the board the page holds (the top 50).
 *   The 15 seeded accounts sit well inside it, but M is always what was counted, never a constant.
 * - A tie is not "ahead", and the comparison is made at the same 2 decimals the board's return
 *   pills render, so the count can never contradict the rows a judge can read on screen.
 * - Returns are paper percentages. Nothing here implies points, cash or a prize.
 */

import { cn } from "cn";
import type { LeagueAccountView, LeagueLeaderboardRow } from "@/lib/api-client";
import { formatSignedPct, pnlClass } from "@/components/league/format";

/** The two fields this comparison reads off a leaderboard row. */
export type BotRow = Pick<LeagueLeaderboardRow, "pnlPct" | "isBot">;

export interface BotComparisonInput {
  /** The signed-in player's account; null when signed out or before the first trade. */
  me: Pick<LeagueAccountView, "pnlPct"> | null | undefined;
  /** Paper trades the player has placed this week. Zero means there is nothing to compare yet. */
  trades: number;
  rows: readonly BotRow[];
}

export interface BotComparison {
  /** The player's return this week, percent. */
  youPct: number;
  /** Median return of the house bots on the board, percent. */
  medianPct: number;
  /** House bots the player is strictly ahead of (at 2 decimals). */
  ahead: number;
  /** House bots counted — the divisor in "ahead of N of M". */
  bots: number;
}

/** The precision the board's return pills render at (LeagueLeaderboard ReturnPill digits = 2). */
const DISPLAY_DIGITS = 2;

function atDisplayPrecision(n: number): number {
  const f = 10 ** DISPLAY_DIGITS;
  return Math.round(n * f) / f;
}

/** Median of a non-empty list; the mean of the middle two when the count is even. Null when empty. */
export function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The player against the house bots on the board, or null when there is nothing honest to say:
 * no account, no trade this week, an unusable return, or no house bot to compare against.
 */
export function botComparison({ me, trades, rows }: BotComparisonInput): BotComparison | null {
  if (!me || !Number.isFinite(me.pnlPct)) return null;
  if (!Number.isFinite(trades) || trades <= 0) return null;

  // A row with an unusable return is dropped from the median AND the divisor, so "of M" always
  // counts exactly the bots that were compared.
  const botPcts = rows.filter((r) => r.isBot && Number.isFinite(r.pnlPct)).map((r) => r.pnlPct);
  if (botPcts.length === 0) return null;

  const medianPct = median(botPcts);
  if (medianPct === null) return null;

  const you = atDisplayPrecision(me.pnlPct);
  const ahead = botPcts.filter((pct) => atDisplayPrecision(pct) < you).length;
  return { youPct: me.pnlPct, medianPct, ahead, bots: botPcts.length };
}

/** The spoken form, used as the block's tooltip. Says "house bots", never "the house". */
export function botComparisonLabel(c: BotComparison): string {
  return `Your paper return this week is ${formatSignedPct(c.youPct, DISPLAY_DIGITS)}. The median of the ${c.bots} house bots on this board is ${formatSignedPct(c.medianPct, DISPLAY_DIGITS)}. You are ahead of ${c.ahead} of them.`;
}

export interface YouVsBotsProps {
  me: LeagueAccountView | null;
  rows: readonly BotRow[];
  className?: string;
}

/**
 * Renders nothing unless the player has an account with at least one trade this week and there is
 * at least one house bot on the board.
 */
export function YouVsBots({ me, rows, className }: YouVsBotsProps) {
  const trades = me?.trades.length ?? 0;
  const c = botComparison({ me, trades, rows });
  if (!c) return null;

  const share = Math.max(0, Math.min(1, c.ahead / c.bots));
  const dot = (
    <span className="px-1.5 text-muted-foreground/50" aria-hidden>
      ·
    </span>
  );

  return (
    <div className={cn("flex flex-col gap-2.5 rounded-2xl border border-white/[0.07] bg-card px-4 py-3.5 sm:px-5", className)} title={botComparisonLabel(c)}>
      <p className="text-sm text-pretty text-muted-foreground">
        <span className="font-medium text-foreground">You</span>{" "}
        <span className={cn("font-semibold tabular-nums", pnlClass(c.youPct))}>{formatSignedPct(c.youPct, DISPLAY_DIGITS)}</span>
        {dot}
        house bots median{" "}
        <span className="font-medium text-foreground/90 tabular-nums">{formatSignedPct(c.medianPct, DISPLAY_DIGITS)}</span>
        {dot}
        ahead of{" "}
        <span className="font-medium text-foreground/90 tabular-nums">
          {c.ahead} of {c.bots}
        </span>{" "}
        bots
      </p>
      {/* Decorative: every number in it is already in the sentence above. */}
      <span className="block h-1.5 w-full overflow-hidden rounded-full border border-white/[0.06] bg-black/25 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]" aria-hidden>
        <span
          className="block h-full rounded-full bg-gradient-to-r from-gold/60 to-gold transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${(share * 100).toFixed(1)}%` }}
        />
      </span>
    </div>
  );
}

export default YouVsBots;
