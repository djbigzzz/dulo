import bs58 from "bs58";
import { SIWS_STATEMENT } from "@/lib/auth/siws";
import { handler, ok, requestOrigin } from "@/lib/server/api";
import { db } from "@/lib/server/db";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A nonce must be used within 10 minutes of issue. */
const NONCE_TTL_MS = 10 * 60 * 1000;

/**
 * GET /api/v1/auth/nonce
 * -> ok({ nonce, issuedAt, domain, uri, statement })
 *
 * `domain` and `uri` are the host and origin the browser actually used for this
 * request (x-forwarded-proto / x-forwarded-host / host), so a preview deployment or a
 * custom domain signs for itself; NEXT_PUBLIC_APP_URL is only the fallback when no host
 * header exists. The client feeds this into siwsInputFromNonce(data, address) and signs.
 */
export const GET = handler(async (req) => {
  const e = env();
  const now = new Date();
  const nonce = bs58.encode(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const { origin, host } = requestOrigin(req, e.NEXT_PUBLIC_APP_URL);

  // Opportunistic cleanup of expired nonces. Never fatal.
  try {
    await db.authNonce.deleteMany({ where: { expiresAt: { lt: now } } });
  } catch (err) {
    console.warn("[auth/nonce] expired-nonce cleanup failed", err instanceof Error ? err.message : err);
  }

  await db.authNonce.create({
    data: { nonce, expiresAt: new Date(now.getTime() + NONCE_TTL_MS) },
  });

  return ok(
    {
      nonce,
      issuedAt: now.toISOString(),
      domain: host,
      uri: origin,
      statement: SIWS_STATEMENT,
    },
    { headers: { "cache-control": "no-store" } },
  );
});
