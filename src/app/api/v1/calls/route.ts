import { handler, ok } from "@/lib/server/api";
import { getSession } from "@/lib/auth/session";
import { getCallsBoard } from "@/lib/games/calls";
import { getCurrentSeason } from "@/lib/server/queries";
import type { CallsResponse } from "@/lib/api-client";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/calls
 * Every Market in the current Season with its current xStock quote, pools and odds.
 * With a session cookie, `me` carries the caller's spendable points and stakes; anonymous
 * callers get `me: null` and still see every market.
 */
export const GET = handler(async () => {
  const now = new Date();
  // A broken or expired cookie must never break the public board: treat it as signed out.
  const session = await getSession().catch(() => null);
  const season = await getCurrentSeason(now);
  const board = await getCallsBoard(season?.id ?? null, session?.userId ?? null, now);
  const data: CallsResponse = { season, now: now.toISOString(), markets: board.markets, me: board.me };
  return ok(data, { headers: { "cache-control": "no-store" } });
});
