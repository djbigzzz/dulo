import { handler, ok } from "@/lib/server/api";
import { getCurrentSeason } from "@/lib/server/queries";
import type { SeasonResponse } from "@/lib/api-client";

export const dynamic = "force-dynamic";

/** GET /api/v1/season — the current Season (or the latest one) and the server clock. */
export const GET = handler(async () => {
  const now = new Date();
  const season = await getCurrentSeason(now);
  const data: SeasonResponse = { season, now: now.toISOString() };
  return ok(data);
});
