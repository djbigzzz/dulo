import { after } from "next/server";
import { z } from "zod";
import { ApiError, assertSameOrigin, handler, ok, parseBody } from "@/lib/server/api";
import { requireSession } from "@/lib/auth/session";
import { runForUser } from "@/lib/cron/tick";
import { targetSymbols, targetWeights } from "@/lib/mirror/allocation";
import { MIRROR_PLAY_KEY, MirrorPlayMissingError, recordMirrorIntent, type MirrorIntent } from "@/lib/mirror/events";
import { publicReadApiError } from "@/lib/mirror/views";
import { db } from "@/lib/server/db";
import { getMirrorTarget } from "@/lib/server/queries";
import type { MirrorRecordResponse } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  targetWallet: z.string().trim().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid wallet address"),
  budgetUsd: z.number().finite().positive().max(1_000_000),
});

/**
 * POST /api/v1/mirror/record  { targetWallet, budgetUsd }
 * "I've done my swaps — verify": stores the target allocation as the caller's Mirror
 * intent (PlayProgress `mirror`, proof.intent) so the cron turns it into a
 * mirror_executed event and the next snapshot is compared against it. No points are
 * granted here and no money moves: the swaps happened in Jupiter, in the user's wallet.
 * A fast snapshot + evaluation of the caller is scheduled right after the response.
 * The target can be a public (non-Dulo) wallet: its allocation comes from the cached live
 * read and the intent records source "public"; the public wallet itself is never scored.
 *   401 signed out · 403 cross-site · 404 nothing to mirror
 *   409 no legs / own wallet / Mirror Play not listed · 503 public read unavailable
 */
export const POST = handler(async (req) => {
  assertSameOrigin(req);
  const session = await requireSession();
  const body = await parseBody(req, Body);
  const now = new Date();

  let target: Awaited<ReturnType<typeof getMirrorTarget>>;
  try {
    target = await getMirrorTarget(body.targetWallet, now);
  } catch (e) {
    throw publicReadApiError(e) ?? e;
  }
  if (!target) throw new ApiError("Nothing to copy: this wallet has no snapshots or competition positions (virtual cash)", 404);
  if (target.legs.length === 0) throw new ApiError("Nothing to copy: this wallet holds no xStocks worth $1 or more", 409);

  const own = await db.wallet.findFirst({ where: { userId: session.userId, address: body.targetWallet }, select: { id: true } });
  if (own) throw new ApiError("You cannot copy your own portfolio", 409);

  const intent: MirrorIntent = {
    targetWallet: target.address,
    target: targetWeights(target),
    symbols: targetSymbols(target),
    budgetUsd: Math.round(body.budgetUsd * 100) / 100,
    recordedAt: now.toISOString(),
    source: target.source,
  };
  try {
    await recordMirrorIntent(session.userId, intent);
  } catch (e) {
    if (e instanceof MirrorPlayMissingError) throw new ApiError(e.message, 409);
    throw e;
  }
  const row = await db.playProgress.findUnique({
    where: { userId_playKey: { userId: session.userId, playKey: MIRROR_PLAY_KEY } },
    select: { status: true },
  });

  // Snapshot + evaluate this user once the response is out, so a mirror done before
  // pressing the button completes in seconds instead of waiting for the 5-minute tick.
  after(() =>
    runForUser(session.userId).catch((e: unknown) => {
      console.warn(`[mirror/record] post-record run failed: ${e instanceof Error ? e.message : String(e)}`);
    }),
  );

  const data: MirrorRecordResponse = {
    targetWallet: intent.targetWallet,
    recordedAt: intent.recordedAt,
    budgetUsd: intent.budgetUsd,
    legs: Object.keys(intent.target).length,
    source: intent.source,
    status: row?.status ?? "in_progress",
  };
  return ok(data, { headers: { "cache-control": "no-store" } });
});
