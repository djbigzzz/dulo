import { z } from "zod";
import { handler, ok, parseQuery } from "@/lib/server/api";
import { getLeaderboard } from "@/lib/server/queries";
import type { LeaderboardResponse } from "@/lib/api-client";

export const dynamic = "force-dynamic";

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  /** Season id; defaults to the current Season. */
  season: z.string().min(1).max(64).optional(),
});

/**
 * GET /api/v1/leaderboard?limit=100&season=<id>
 * Season points per user (sum of the PointsEvent ledger), ranked.
 */
export const GET = handler(async (req) => {
  const q = parseQuery(req, Query);
  const { rows, season } = await getLeaderboard(q.season, q.limit);
  const data: LeaderboardResponse = { season, rows, limit: q.limit };
  return ok(data);
});
