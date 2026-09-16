import { handler, ok } from "@/lib/server/api";
import { getSession } from "@/lib/auth/session";
import { getLeagueOverview } from "@/lib/games/league-views";
import type { LeagueResponse } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/league
 * The current League week (window, open/closed, countdown), the caller's account with
 * live quotes and last 20 trades (null when signed out or before the first trade), the
 * top-50 leaderboard with rank deltas, quotes for the tradable list and the most recently
 * settled week. Recomputes equity/rank when the last recompute is older than 60s.
 */
export const GET = handler(async () => {
  // A broken or expired cookie must never break the public board: treat it as signed out.
  const session = await getSession().catch(() => null);
  const data: LeagueResponse = await getLeagueOverview(session?.userId ?? null);
  return ok(data, { headers: { "cache-control": "no-store" } });
});
