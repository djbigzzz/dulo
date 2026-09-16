import { clearSessionCookie, getSession } from "@/lib/auth/session";
import { handler, ok } from "@/lib/server/api";
import { db } from "@/lib/server/db";
import { getPointsSummary } from "@/lib/server/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "cache-control": "no-store" } };

/**
 * GET /api/v1/auth/me
 * -> ok({ session, user: { id, handle, wallets: [{ chainId, address, isPrimary }], points } })
 * -> ok({ session: null, user: null }) when signed out
 *
 * `points` is the caller's PointsSummary for the current Season (lib/games/ledger-policy):
 * { seasonId, balance, seasonPoints, starterPoints, inPredictions, rank }. Balance is what can
 * be put into predictions (starter points included); Season points are what the rank is built
 * from (starter points and points in open predictions excluded). Points only, no cash value.
 * It is null when no Season exists, and any failure reading it also yields null: /me never
 * fails because of the points read.
 */
export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return ok({ session: null, user: null }, NO_STORE);

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      handle: true,
      wallets: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: { chainId: true, address: true, isPrimary: true },
      },
    },
  });

  // A token for a user that no longer exists is dead: clear it.
  if (!user) return clearSessionCookie(ok({ session: null, user: null }, NO_STORE));

  const points = await getPointsSummary(user.id).catch((err: unknown) => {
    console.warn(`[auth/me] points summary unavailable for ${user.id}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  return ok({ session, user: { ...user, points } }, NO_STORE);
});
