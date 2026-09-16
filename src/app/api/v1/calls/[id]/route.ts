import { ApiError, handler, ok } from "@/lib/server/api";
import { getSession } from "@/lib/auth/session";
import { getCallMarket } from "@/lib/games/calls";
import type { CallMarketResponse } from "@/lib/api-client";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/calls/[id]
 * One Market with its quote, odds and Position count; `me` carries the caller's stakes on it.
 */
export const GET = handler<{ params: Promise<{ id: string }> }>(async (_req, ctx) => {
  const { id } = await ctx.params;
  if (!id || id.length > 64) throw new ApiError("Invalid market id", 400);
  const session = await getSession().catch(() => null);
  const data: CallMarketResponse | null = await getCallMarket(id, session?.userId ?? null);
  if (!data) throw new ApiError("Market not found", 404);
  return ok(data, { headers: { "cache-control": "no-store" } });
});
