/**
 * Mirror intents -> mirror_executed events (docs/HANDOFF.md §3.4 "as built").
 *
 * When a user presses "I've done my swaps — verify" on /mirror/[wallet], the API
 * records the INTENT on their PlayProgress row for the `mirror` Play (status
 * in_progress, proof.intent = { targetWallet, target, symbols, budgetUsd, recordedAt }).
 * No points, no PointsEvent, no money: it is a bookmark that says "compare my next
 * snapshot against this allocation".
 *
 * The cron's buildEvalContext calls mirrorEventsForUser(userId) and feeds the result to
 * the engine as the `mirror_executed` InternalEvent (ts = recordedAt, meta = target),
 * which is what the mirror_match rule consumes. cron/evaluate keeps proof.intent across
 * proof refreshes (see carryIntent there) so the intent survives until the Play completes.
 *
 * Server-only (Prisma). Pure helpers are exported for tests.
 */
import type { Prisma } from "@prisma/client";
import type { InternalEvent } from "@/lib/core/types";
import { db } from "@/lib/server/db";
import { isUniqueViolation } from "@/lib/cron/util";

const LOG_PREFIX = "[mirror/events]";

/** Play key whose PlayProgress row carries the intent (the Mirror Play of the Season 0 catalogue). */
export const MIRROR_PLAY_KEY = "mirror";

export interface MirrorIntent {
  targetWallet: string;
  /** assetId -> weight (0..1). */
  target: Record<string, number>;
  /** assetId -> symbol, for proof labels. */
  symbols: Record<string, string>;
  budgetUsd: number;
  /** ISO. Snapshots strictly after this moment are compared against `target`. */
  recordedAt: string;
  /** "snapshot" (a Dulo wallet's on-chain allocation), "paper" (League positions) or "public" (live read of a non-Dulo wallet). */
  source: "snapshot" | "paper" | "public";
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate a stored intent (proof.intent or the whole proof). Null when it cannot drive the engine. */
export function parseMirrorIntent(v: unknown): MirrorIntent | null {
  if (!isObj(v)) return null;
  const targetWallet = typeof v.targetWallet === "string" && v.targetWallet.length > 0 ? v.targetWallet : null;
  const recordedAt = typeof v.recordedAt === "string" && Number.isFinite(Date.parse(v.recordedAt)) ? v.recordedAt : null;
  if (!targetWallet || !recordedAt || !isObj(v.target)) return null;
  const target: Record<string, number> = {};
  for (const [assetId, w] of Object.entries(v.target)) {
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > 1 || assetId.length === 0) return null;
    target[assetId] = w;
  }
  if (Object.keys(target).length === 0) return null;
  const symbols: Record<string, string> = {};
  if (isObj(v.symbols)) {
    for (const [assetId, s] of Object.entries(v.symbols)) if (typeof s === "string" && s.length > 0) symbols[assetId] = s;
  }
  const budgetUsd = typeof v.budgetUsd === "number" && Number.isFinite(v.budgetUsd) ? v.budgetUsd : 0;
  const source = v.source === "paper" || v.source === "public" ? v.source : "snapshot";
  return { targetWallet, target, symbols, budgetUsd, recordedAt, source };
}

/** The intent stored on a PlayProgress proof (under `intent`), or null. */
export function intentFromProof(proof: unknown): MirrorIntent | null {
  if (!isObj(proof)) return null;
  return parseMirrorIntent(proof.intent);
}

/** The InternalEvent the engine's mirror_match rule consumes for an intent. Pure. */
export function mirrorEventFromIntent(userId: string, intent: MirrorIntent): InternalEvent {
  return {
    type: "mirror_executed",
    userId,
    ref: `mirror:${intent.targetWallet}`,
    ts: new Date(intent.recordedAt),
    meta: { targetWallet: intent.targetWallet, target: intent.target, symbols: intent.symbols, budgetUsd: intent.budgetUsd, source: intent.source },
  };
}

/**
 * The user's mirror_executed events (at most one: the latest recorded intent). Never
 * throws: a read failure is logged and yields [] so one bad row cannot stop evaluation.
 */
export async function mirrorEventsForUser(userId: string): Promise<InternalEvent[]> {
  try {
    const rows = await db.playProgress.findMany({
      where: { userId, playKey: MIRROR_PLAY_KEY },
      select: { playKey: true, proof: true },
      take: 1,
    });
    const row = rows.find((r) => r.playKey === MIRROR_PLAY_KEY);
    const intent = row ? intentFromProof(row.proof) : null;
    return intent ? [mirrorEventFromIntent(userId, intent)] : [];
  } catch (e) {
    console.warn(`${LOG_PREFIX} could not read the mirror intent for ${userId}: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

export class MirrorPlayMissingError extends Error {
  constructor() {
    super("The Portfolio Match quest is not listed this Season");
    this.name = "MirrorPlayMissingError";
  }
}

/**
 * Persist an intent on the user's `mirror` PlayProgress row. A row that is already
 * complete keeps its status, completedAt and proof and only gains the new intent (the
 * Play is sticky; re-mirroring is allowed but scores nothing new). Throws
 * MirrorPlayMissingError when the Play row does not exist (FK), so the API can answer 409.
 */
export async function recordMirrorIntent(userId: string, intent: MirrorIntent): Promise<void> {
  const existing = await db.playProgress.findUnique({
    where: { userId_playKey: { userId, playKey: MIRROR_PLAY_KEY } },
    select: { status: true, proof: true },
  });
  const priorProof = existing && isObj(existing.proof) ? existing.proof : {};
  const proof = { ...priorProof, intent } as unknown as Prisma.InputJsonValue;
  try {
    if (existing) {
      await db.playProgress.update({ where: { userId_playKey: { userId, playKey: MIRROR_PLAY_KEY } }, data: { proof } });
    } else {
      await db.playProgress.create({ data: { userId, playKey: MIRROR_PLAY_KEY, status: "in_progress", completedAt: null, proof } });
    }
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Lost a race with the cron's upsert: apply the intent on top of whatever it wrote.
      await db.playProgress.update({ where: { userId_playKey: { userId, playKey: MIRROR_PLAY_KEY } }, data: { proof } });
      return;
    }
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2003") throw new MirrorPlayMissingError();
    throw e;
  }
}
