import { clearSessionCookie } from "@/lib/auth/session";
import { assertSameOrigin, handler, ok } from "@/lib/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/auth/logout -> clears the session cookie, ok({}). Refuses cross-site requests (403). */
export const POST = handler(async (req) => {
  assertSameOrigin(req);
  return clearSessionCookie(ok({}, { headers: { "cache-control": "no-store" } }));
});
