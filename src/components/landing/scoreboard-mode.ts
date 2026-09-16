import type { LeaderboardResponse, LeaderboardRow } from "@/lib/api-client";

/**
 * Which ranking the landing hero shows in its RankCard, the card after the live prediction cards
 * (15 Sep review M-B / C9, hero rebuilt 16 Sep). Client-safe, no JSX.
 *
 * The Season board only ever holds real players (bots are excluded in the query and a row needs
 * positive Season points; starter points never count), so three rows means three real people who
 * have played: show them. Until then the hero shows the weekly competition (virtual cash), titled
 * honestly as practice against house bots, which are labelled and never earn points.
 */
export const SEASON_TOP_MIN_ROWS = 3;

/** "Short title: rest". Phones show the part before ": " as the title and the rest as a sub-line. */
export const PRACTICE_LEAGUE_TITLE = "Virtual competition: house bots until players join";

/** The Season top 3 when the board has at least three real rows, else null (show the virtual competition). */
export function seasonTopRows(board: LeaderboardResponse | null | undefined): LeaderboardRow[] | null {
  const rows = board?.rows ?? [];
  return rows.length >= SEASON_TOP_MIN_ROWS ? rows.slice(0, 3) : null;
}
