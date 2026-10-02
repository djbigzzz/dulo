/** Share helpers for /start: the post a player can put on X after a prediction. Client-safe, no React. */

import type { CallSide } from "@/lib/api-client";
import { formatUsd } from "@/components/common/format";
import { formatCountdown } from "@/components/calls/calls-format";

/** The public landing for shared links. */
export const START_PATH = "/start";

export interface SharePrediction {
  ticker: string;
  strike: number;
  side: CallSide;
}

/** "I said YES: NVDA closes above $224.94 this Friday. Free, points only, on Dulo. Your call? <url>" */
export function shareText(p: SharePrediction, url: string): string {
  const verdict = p.side === "yes" ? "YES" : "NO";
  const verb = p.side === "yes" ? "closes above" : "stays below";
  return `I said ${verdict}: ${p.ticker} ${verb} ${formatUsd(p.strike)} this Friday. Free, points only, on Dulo. What's your pick? ${url}`;
}

/** X compose link with the post prefilled; the player edits and posts it from their own account. */
export function shareOnXUrl(p: SharePrediction, url: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(shareText(p, url))}`;
}

/** "I'm #3 in this week's Dulo competition with virtual cash, +1.23%. Can you beat me? <url>" */
export function rankShareText(rank: number, pnlPct: number, url: string): string {
  const pct = `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`;  // pnlPct is already a percentage (LeagueAccountView)
  return `I'm #${rank} in this week's Dulo competition, trading xStocks with $10,000 of virtual cash (${pct}). Points only. Can you beat me? ${url}`;
}

export function rankShareOnXUrl(rank: number, pnlPct: number, url: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(rankShareText(rank, pnlPct, url))}`;
}

/**
 * The /start line about the weekly competition (virtual cash), from /api/v1/league's countdowns:
 * open -> how long is left; weekend -> when the next week opens; otherwise null.
 */
export function competitionLine(league: { open: boolean; closesIn: number | null; opensIn: number | null } | null): string | null {
  if (!league) return null;
  if (league.open && league.closesIn !== null) return `This week's competition (virtual cash) is live: ${formatCountdown(league.closesIn)} left.`;
  if (league.opensIn !== null) return `Next week's competition (virtual cash) opens in ${formatCountdown(league.opensIn)}. Sign in now and start with $10,000 of virtual cash.`;
  return null;
}
