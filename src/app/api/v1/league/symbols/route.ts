import { handler, ok } from "@/lib/server/api";
import { getSession } from "@/lib/auth/session";
import { getLeagueSymbols } from "@/lib/games/league-views";
import type { LeagueSymbolsResponse } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/league/symbols
 * Tradable symbols (the fixed list plus whatever the caller holds) with quotes, the
 * caller's held quantity per symbol and cash, and whether trades are accepted right now.
 */
export const GET = handler(async () => {
  const session = await getSession().catch(() => null);
  const data: LeagueSymbolsResponse = await getLeagueSymbols(session?.userId ?? null);
  return ok(data, { headers: { "cache-control": "no-store" } });
});
