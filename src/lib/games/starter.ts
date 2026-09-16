/**
 * Starter points: the one-off welcome grant (16 Sep 2026 points policy, lib/games/ledger-policy).
 *
 * Every real player gets STARTER_POINTS once per Season, as one append-only ledger row
 *   { source: "starter", ref: "starter:<seasonId>", delta: 1000 }
 * so a new account can make a prediction in its first minute. The points can be put into
 * predictions but never count toward Season points or rank (NON_SCORING_SOURCES), and they
 * have no cash value.
 *
 * Idempotency: @@unique(userId, seasonId, ref) plus createMany skipDuplicates. Two concurrent
 * sign-ins, a sign-in racing a prediction, or the cron backfill can never write two rows, and
 * only the call that inserted the row sees granted = true. Neither function is ever called
 * inside another interactive transaction.
 *
 * Written from three places, whichever comes first: POST /api/v1/auth/verify (synchronously),
 * POST /api/v1/calls/place (before placeCall) and the cron evaluate step (backfill). Each
 * caller wraps it so a failed grant never fails the request.
 *
 * House bots never get starter points: the helper checks the bot id prefix and REAL_USER_WHERE
 * (which also catches an isBot LeagueAccount); the backfill drops bot ids and is only handed
 * REAL_USER_WHERE users. Only an active Season window grants, never an ended Season.
 *
 * Server-only (Prisma).
 */
import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/server/db";
import { REAL_USER_WHERE } from "@/lib/server/queries";
import { isBotUserId } from "./bots";
import { STARTER_POINTS, STARTER_SOURCE, starterRef } from "./ledger-policy";

/** The Prisma delegates the grant reads and writes. */
export type StarterDb = Pick<PrismaClient, "user" | "season" | "pointsEvent">;

export type StarterSkipReason = "bot" | "not_found" | "no_season" | "already_granted";

export interface StarterGrantResult {
  /** True only for the call that inserted the row. */
  granted: boolean;
  /** The active Season, or null when there is none (or the user was refused first). */
  seasonId: string | null;
  reason?: StarterSkipReason;
}

/** The Season whose window contains `now`. Unlike findCurrentSeason there is no fallback to an ended Season. */
async function activeSeasonId(client: StarterDb, now: Date, seasonId?: string): Promise<string | null> {
  const row = await client.season.findFirst({
    where: { ...(seasonId ? { id: seasonId } : {}), startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { startsAt: "desc" },
    select: { id: true },
  });
  return row?.id ?? null;
}

function starterRow(userId: string, seasonId: string) {
  return { userId, seasonId, source: STARTER_SOURCE, ref: starterRef(seasonId), delta: STARTER_POINTS };
}

/**
 * Grant this user's starter points for the active Season, once. Safe to call on every sign-in
 * and every prediction: after the first grant it is one read-only miss plus a no-op insert.
 */
export async function ensureStarterPoints(userId: string, now: Date = new Date(), client: StarterDb = db): Promise<StarterGrantResult> {
  if (isBotUserId(userId)) return { granted: false, seasonId: null, reason: "bot" };

  const user = await client.user.findFirst({ where: { id: userId, ...REAL_USER_WHERE }, select: { id: true } });
  if (!user) return { granted: false, seasonId: null, reason: "not_found" };

  const seasonId = await activeSeasonId(client, now);
  if (!seasonId) return { granted: false, seasonId: null, reason: "no_season" };

  const { count } = await client.pointsEvent.createMany({ data: [starterRow(userId, seasonId)], skipDuplicates: true });
  return count === 1 ? { granted: true, seasonId } : { granted: false, seasonId, reason: "already_granted" };
}

/**
 * Grant starter points to every listed user who has none yet in `seasonId`, in one insert.
 * The caller passes real users only (REAL_USER_WHERE); bot ids are dropped here as well.
 * Returns the number of rows written: 0 when the Season's window is not active at `now`.
 */
export async function backfillStarterPoints(seasonId: string, userIds: readonly string[], now: Date = new Date(), client: StarterDb = db): Promise<number> {
  const ids = [...new Set(userIds)].filter((id) => !isBotUserId(id));
  if (ids.length === 0) return 0;
  const active = await activeSeasonId(client, now, seasonId);
  if (active !== seasonId) return 0;
  const { count } = await client.pointsEvent.createMany({ data: ids.map((id) => starterRow(id, seasonId)), skipDuplicates: true });
  return count;
}
