import type { LeaderboardResponse, LeaderboardRow } from "@/lib/api-client";

/**
 * The landing's Season top 3 (SeasonTop, in the closing section since the 9 Oct 2026 pass).
 * Client-safe, no JSX.
 *
 * The Season board only ever holds real players (bots are excluded in the query and a row needs
 * positive Season points; starter points never count), so three rows means three real people who
 * have played: show them. Until then the landing shows no ranking at all, never an empty board.
 */
export const SEASON_TOP_MIN_ROWS = 3;

/** The Season top 3 when the board has at least three real rows, else null (show nothing). */
export function seasonTopRows(board: LeaderboardResponse | null | undefined): LeaderboardRow[] | null {
  const rows = board?.rows ?? [];
  return rows.length >= SEASON_TOP_MIN_ROWS ? rows.slice(0, 3) : null;
}
