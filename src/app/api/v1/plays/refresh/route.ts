import { requireSession } from "@/lib/auth/session";
import { runForUser } from "@/lib/cron/tick";
import { ApiError, assertSameOrigin, handler, ok } from "@/lib/server/api";
import type { RefreshPlaysResponse } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** runForUser caps itself at ~8s; leave headroom for the response. */
export const maxDuration = 15;

/**
 * One manual refresh per user per minute; the cron covers the rest. Not exported: a route
 * module may only export handlers and route config, and `next build` (webpack) fails otherwise.
 */
const REFRESH_COOLDOWN_MS = 60_000;
/** Entries older than the cooldown are dropped once the map grows past this. */
const PRUNE_ABOVE = 1_000;

/** userId -> last accepted run (ms). In-memory: per instance, reset on deploy, good enough for a cooldown. */
const lastRunAt = new Map<string, number>();

function prune(now: number) {
  if (lastRunAt.size < PRUNE_ABOVE) return;
  for (const [userId, at] of lastRunAt) if (now - at >= REFRESH_COOLDOWN_MS) lastRunAt.delete(userId);
}

/**
 * POST /api/v1/plays/refresh
 * Re-read the caller's wallets now and re-evaluate their Plays (lib/cron/tick runForUser),
 * instead of waiting for the next 5-minute tick. Session cookie required; cross-site
 * requests are refused (403); more than one call per minute per user is a 429.
 * -> ok(RefreshPlaysResponse)
 */
export const POST = handler(async (req) => {
  assertSameOrigin(req);
  const session = await requireSession();

  const now = Date.now();
  const last = lastRunAt.get(session.userId);
  if (last !== undefined && now - last < REFRESH_COOLDOWN_MS) {
    const wait = Math.max(1, Math.ceil((REFRESH_COOLDOWN_MS - (now - last)) / 1000));
    throw new ApiError(`Already refreshed in the last minute; try again in ${wait}s`, 429);
  }
  lastRunAt.set(session.userId, now);
  prune(now);

  const run = await runForUser(session.userId, new Date(now));
  const data: RefreshPlaysResponse = {
    ok: run.ok,
    timedOut: run.timedOut,
    took: run.took,
    error: run.error,
    snapshot: run.snapshot ? { ok: run.snapshot.ok, failed: run.snapshot.failed.length, skipped: run.snapshot.skipped } : null,
    evaluate: run.evaluate
      ? {
          evaluated: run.evaluate.evaluated,
          completed: run.evaluate.completed,
          newlyCompleted: run.evaluate.newlyCompleted,
          awarded: run.evaluate.awarded,
        }
      : null,
  };
  return ok(data, { headers: { "cache-control": "no-store" } });
});
