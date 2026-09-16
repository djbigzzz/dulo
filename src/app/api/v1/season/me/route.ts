import { handler, ok } from "@/lib/server/api";
import { getSession } from "@/lib/auth/session";
import { getUserProfile } from "@/lib/server/queries";
import type { MeResponse } from "@/lib/api-client";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/season/me
 * The caller's standing in the current Season: points, rank, wallets, completed Plays, Badges.
 * Never 401s — an anonymous caller simply gets { signedIn: false, profile: null } so the
 * leaderboard's "my rank" row and the profile page can share one call.
 */
export const GET = handler(async () => {
  const session = await getSession().catch(() => null);
  if (!session) {
    const data: MeResponse = { signedIn: false, profile: null };
    return ok(data);
  }
  const profile = await getUserProfile(session.userId);
  const data: MeResponse = { signedIn: profile !== null, profile };
  return ok(data);
});
