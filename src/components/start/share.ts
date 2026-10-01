/** Share helpers for /start: the post a player can put on X after a prediction. Client-safe, no React. */

import type { CallSide } from "@/lib/api-client";
import { formatUsd } from "@/components/common/format";

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
