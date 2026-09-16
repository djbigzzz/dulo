import { handler, ok } from "@/lib/server/api";
import { requireSession } from "@/lib/auth/session";
import { listBadgesForUser } from "@/lib/badges/views";
import type { BadgesMeResponse } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/badges/me
 * The caller's Badge rows (newest first) joined with the design copy: name, description,
 * image URL, mint / txSig and state ("minted" or "pending" = "Minting soon"). 401 signed out.
 */
export const GET = handler(async () => {
  const session = await requireSession();
  const data: BadgesMeResponse = { badges: await listBadgesForUser(session.userId) };
  return ok(data, { headers: { "cache-control": "no-store" } });
});
