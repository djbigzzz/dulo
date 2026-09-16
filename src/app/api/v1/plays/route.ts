import { handler, ok } from "@/lib/server/api";
import { getSession } from "@/lib/auth/session";
import { getCurrentSeason, listPlaysForUser } from "@/lib/server/queries";
import type { PlaysResponse } from "@/lib/api-client";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/plays
 * Active Plays grouped Partner -> Campaign, personalised by the session cookie when present.
 * Anonymous callers get every Play as "locked".
 */
export const GET = handler(async () => {
  // A broken or expired cookie must never break the public board: treat it as signed out.
  const session = await getSession().catch(() => null);
  const [season, groups] = await Promise.all([getCurrentSeason(), listPlaysForUser(session?.userId ?? null)]);
  const data: PlaysResponse = { season, signedIn: session !== null, groups };
  return ok(data);
});
