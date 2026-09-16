/**
 * Inline quest (Play) evaluation right after a prediction is placed (15 Sep review M-F).
 *
 * The cron evaluates every user every 5 minutes, so without this a first prediction would
 * leave First Prediction "Not started" for up to 5 minutes. evaluateCallPlays runs only the
 * quests a prediction can move (internal_event call_placed, and game_action, which a new
 * prediction also emits) for the caller, straight after the points-in row commits:
 *   - DB-only: the context is the user's internal events (Call positions, League trades) with
 *     no snapshots, no catalogue fetch and no price read. Holding quests stay with the cron,
 *     which has the wallet snapshots they need.
 *   - The same writes as the cron (lib/cron/evaluate evaluateUser): sticky completion, one
 *     PointsEvent per Play (unique ref), PlayProgress upsert. The next tick is a no-op for it.
 *   - Only quests whose points THIS run wrote are returned (newlyCompleted && awarded), so a
 *     "Quest complete" toast never repeats an award the cron or another request already made.
 *   - Short: evaluateAfterPlacement waits at most INLINE_EVALUATE_TIMEOUT_MS. A slower run
 *     keeps going inside after() and the response carries no keys (the next board read shows
 *     the completion); a failed run is retried once inside after(). The Call never fails
 *     because of evaluation.
 */
import { after } from "next/server";
import { evaluateUser, findCurrentSeason, loadInternalEvents } from "@/lib/cron/evaluate";
import type { NewlyCompletedPlay } from "@/lib/games/calls";
import type { EvalContext } from "@/lib/plays/engine";
import { safeParsePlayRule } from "@/lib/plays/rules";
import { db } from "@/lib/server/db";

const LOG_PREFIX = "[calls/place]";

/** Longest the placement response waits for the inline evaluation. */
export const INLINE_EVALUATE_TIMEOUT_MS = 2000;

/** The internal events a prediction produces (lib/cron/evaluate loadInternalEvents). */
const CALL_EVENTS: ReadonlySet<string> = new Set(["call_placed", "game_action"]);

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** True for a rule a Call placement can complete. Invalid rules are false (the cron reports those). */
export function isCallPlayRule(rawRule: unknown): boolean {
  const rule = safeParsePlayRule(rawRule);
  return rule !== null && rule.type === "internal_event" && CALL_EVENTS.has(rule.event);
}

/**
 * Evaluate the caller's active call_placed / game_action Plays now and return the ones this run
 * completed AND awarded (its PointsEvent was written by this run). Empty when no Season or no
 * such Play exists. Throws only when a shared read fails; evaluateAfterPlacement handles that.
 */
export async function evaluateCallPlays(userId: string, now: Date = new Date()): Promise<NewlyCompletedPlay[]> {
  const season = await findCurrentSeason(now);
  if (!season) return [];
  const rows = await db.play.findMany({
    where: { isActive: true, campaign: { seasonId: season.id } },
    select: { key: true, title: true, points: true, badgeKey: true, rule: true },
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
  });
  const plays = rows.filter((p) => isCallPlayRule(p.rule));
  if (plays.length === 0) return [];

  const events = await loadInternalEvents(userId);
  const ctx: EvalContext = {
    now,
    snapshots: [],
    events: [...events].sort((a, b) => a.ts.getTime() - b.ts.getTime()),
    earnings: {},
    sectorOf: () => null,
    underlyingOf: () => null,
  };
  const result = await evaluateUser(userId, now, ctx, { season, plays });
  const byKey = new Map(plays.map((p) => [p.key, p]));
  return result.plays.flatMap((o) => {
    const play = o.newlyCompleted && o.awarded ? byKey.get(o.key) : undefined;
    return play ? [{ key: play.key, title: play.title, points: play.points }] : [];
  });
}

export interface InlineEvaluateOptions {
  /** Default INLINE_EVALUATE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Runs work after the response is sent. Default next/server after(); tests pass a spy. */
  schedule?: (task: () => Promise<void>) => void;
  /** Default evaluateCallPlays. */
  run?: (userId: string, now: Date) => Promise<NewlyCompletedPlay[]>;
  /** Default () => new Date(). */
  clock?: () => Date;
}

/**
 * Inline evaluation with a deadline, for POST /api/v1/calls/place. Never throws.
 *   finished in time  -> the newly completed Plays
 *   too slow          -> []; the same run finishes inside after()
 *   failed            -> []; one retry inside after()
 */
export async function evaluateAfterPlacement(userId: string, opts: InlineEvaluateOptions = {}): Promise<NewlyCompletedPlay[]> {
  const timeoutMs = opts.timeoutMs ?? INLINE_EVALUATE_TIMEOUT_MS;
  const run = opts.run ?? evaluateCallPlays;
  const clock = opts.clock ?? (() => new Date());
  const schedule = (task: () => Promise<void>) => {
    try {
      (opts.schedule ?? after)(task);
    } catch (e) {
      console.warn(`${LOG_PREFIX} could not schedule the background evaluation for ${userId}: ${message(e)}`);
    }
  };

  let started: Promise<NewlyCompletedPlay[]>;
  try {
    started = run(userId, clock());
  } catch (e) {
    started = Promise.reject(e);
  }
  // Observe the outcome immediately so a rejection that lands after the deadline is never unhandled.
  const settled = started.then(
    (plays) => ({ ok: true as const, plays }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const outcome = await Promise.race([settled, deadline]);
  clearTimeout(timer);

  if (outcome === null) {
    schedule(async () => {
      const late = await settled;
      if (!late.ok) console.warn(`${LOG_PREFIX} background evaluation for ${userId} failed: ${message(late.error)}`);
    });
    return [];
  }
  if (!outcome.ok) {
    console.warn(`${LOG_PREFIX} inline evaluation for ${userId} failed, retrying after the response: ${message(outcome.error)}`);
    schedule(async () => {
      try {
        await run(userId, clock());
      } catch (e) {
        console.warn(`${LOG_PREFIX} retry evaluation for ${userId} failed: ${message(e)}`);
      }
    });
    return [];
  }
  return outcome.plays;
}
