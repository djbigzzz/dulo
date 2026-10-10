import type { LeaderboardResponse, LeaderboardRow } from "@/lib/api-client";

/**
 * The landing's Season seats (SeasonTop, in the closing Season band; Broadcast, 9 Oct 2026).
 * Client-safe, no JSX.
 *
 * The Season board only ever holds real players (bots are excluded in the query and a row needs
 * positive Season points; starter points never count). The band always draws three seats: each
 * real player on the board takes one, in rank order, and every seat left over is an open "Your
 * slot". Nothing is made up: with one real player the band shows that player and two open seats.
 */
export const SEASON_SEATS = 3;

export interface SeasonSeat {
  rank: number;
  /** The real player in this seat, or null for an open seat. */
  row: LeaderboardRow | null;
}

/** Three seats from the board (null while it loads or after a failed read: show nothing). */
export function seasonSeats(board: LeaderboardResponse | null | undefined): SeasonSeat[] | null {
  if (!board) return null;
  const rows = board.rows ?? [];
  return Array.from({ length: SEASON_SEATS }, (_, i) => ({ rank: i + 1, row: rows[i] ?? null }));
}

/** What an open seat says: an invitation, never a made-up player (no name, no points). */
export interface OpenSeatCopy {
  title: string;
  hint: string;
}

/**
 * The visitor's own slot ("Your slot · Open") until they hold a seat themselves; then the seats
 * left wait for someone else ("Open seat"), as on /leaderboard.
 */
export function openSeatCopy(seats: ReadonlyArray<SeasonSeat>, userId: string | null | undefined): OpenSeatCopy {
  const seated = Boolean(userId && seats.some(({ row }) => row?.userId === userId));
  return seated ? { title: "Open seat", hint: "Waiting for the next player" } : { title: "Your slot", hint: "Open" };
}
