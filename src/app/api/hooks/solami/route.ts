import { after } from "next/server";
import { createHookHealth, createSeenSignatures, parseSolamiDelivery, verifySolamiSignature } from "@/lib/adapters/solami";
import { SOLANA_MAINNET } from "@/lib/core";
import { runForUser } from "@/lib/cron/tick";
import { ApiError, handler, ok } from "@/lib/server/api";
import { db } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { REAL_USER_WHERE } from "@/lib/server/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** runForUser caps itself at ~8s per player; after() keeps the function alive for it. */
export const maxDuration = 30;

/**
 * Not exported: a route module may only export handlers and route config.
 * Solami retries a failed delivery three times; a repeat inside 10 minutes is acknowledged and dropped.
 */
const seen = createSeenSignatures({ windowMs: 10 * 60_000 });
const health = createHookHealth();
/** Largest body accepted; an enriched delivery for a few transfers is a few KB. */
const MAX_BODY_BYTES = 512 * 1024;
/** Players re-read per delivery; a transfer touches two wallets, a swap one. */
const MAX_USERS_PER_DELIVERY = 10;

/**
 * POST /api/hooks/solami
 * A Solami webhook delivery (lib/adapters/solami). Signed with X-Webhook-Signature (HMAC-SHA256
 * of the raw body, SOLAMI_WEBHOOK_SECRET). The payload is a trigger only: the players whose
 * linked wallets it names are re-read through the ChainAdapter and their quests evaluated
 * (runForUser) after the 200 is sent, so an on-chain quest completes seconds after the
 * transfer instead of at the next 5-minute tick. House bots are never matched.
 *   401 bad or missing signature; 503 no secret configured; 413 body too large.
 * -> ok({ matched, duplicate })
 */
export const POST = handler(async (req) => {
  const secret = env().SOLAMI_WEBHOOK_SECRET;
  if (!secret) throw new ApiError("Solami webhook is not configured", 503);

  const body = await req.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) throw new ApiError("Payload too large", 413);
  if (!verifySolamiSignature(body, req.headers.get("x-webhook-signature"), secret)) {
    health.rejected();
    throw new ApiError("Invalid signature", 401);
  }

  const now = new Date();
  health.delivery(now);

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new ApiError("Body is not JSON", 400);
  }
  const delivery = parseSolamiDelivery(payload);
  if (seen.allSeen(delivery.signatures, now.getTime())) {
    health.duplicate();
    return ok({ matched: 0, duplicate: true });
  }
  if (delivery.candidateAddresses.length === 0) return ok({ matched: 0, duplicate: false });

  const wallets = await db.wallet.findMany({
    where: { chainId: SOLANA_MAINNET, address: { in: delivery.candidateAddresses }, user: REAL_USER_WHERE },
    select: { userId: true },
  });
  const userIds = [...new Set(wallets.map((w) => w.userId))].slice(0, MAX_USERS_PER_DELIVERY);
  if (userIds.length === 0) return ok({ matched: 0, duplicate: false });
  health.matched();

  after(async () => {
    const started = Date.now();
    const runs = await Promise.all(userIds.map((id) => runForUser(id, now)));
    health.run({
      at: new Date().toISOString(),
      users: runs.length,
      tookMs: Date.now() - started,
      newlyCompleted: runs.reduce((n, r) => n + (r.evaluate?.newlyCompleted ?? 0), 0),
    });
  });
  return ok({ matched: userIds.length, duplicate: false });
});

/**
 * GET /api/hooks/solami
 * This instance's delivery health since it started: counts, last delivery and the last
 * triggered re-read (took, newly completed quests). Nothing secret, nothing per player.
 */
export const GET = handler(async () =>
  ok({ configured: Boolean(env().SOLAMI_WEBHOOK_SECRET), ...health.snapshot() }, { headers: { "cache-control": "no-store" } }),
);
