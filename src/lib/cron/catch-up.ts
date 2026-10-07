/**
 * Games catch-up on read: the scheduled tick is the primary driver, but on Vercel Hobby it is
 * not reliable (the daily cron fires anywhere in its hour, GitHub schedules drift by hours).
 * So the public boards repair themselves: when /api/v1/calls or /api/v1/league is read and a
 * settlement or a weekly rollover is overdue, the "games" step runs after the response.
 *
 * Safe to overlap with the cron: every game module's tick is idempotent (src/lib/games/index.ts),
 * settlement claims a market with `updateMany where outcome: null`, and League awards are
 * claimed the same way. Per instance, at most one check per CHECK_INTERVAL_MS and one run in
 * flight, so a busy page costs one cheap count query a minute.
 */
import { db } from "@/lib/server/db";
import { currentWeek } from "@/lib/games/league";
import { runTick } from "./tick";
import { describeError } from "./util";

export const CHECK_INTERVAL_MS = 60_000;

export interface GamesDue {
  due: boolean;
  reasons: string[];
}

/** Which clock-driven game work is overdue at `now`. Four counts, no writes. */
export async function gamesDue(now: Date): Promise<GamesDue> {
  const week = currentWeek(now);
  const [unsettled, upcoming, endedOpen, thisWeek] = await Promise.all([
    db.market.count({ where: { outcome: null, settleAt: { lte: now } } }),
    db.market.count({ where: { settleAt: { gt: now } } }),
    db.league.count({ where: { status: "open", weekEnd: { lte: now } } }),
    db.league.count({ where: { weekStart: week.weekStart } }),
  ]);
  const reasons: string[] = [];
  if (unsettled > 0) reasons.push("market past settle");
  if (upcoming === 0) reasons.push("no upcoming market");
  if (endedOpen > 0) reasons.push("ended week still open");
  if (thisWeek === 0) reasons.push("no league for this week");
  return { due: reasons.length > 0, reasons };
}

let lastCheck = 0;
let inFlight: Promise<void> | null = null;

/** Test hook. */
export function resetCatchUp(): void {
  lastCheck = 0;
  inFlight = null;
}

/**
 * Check, and run the games step when something is overdue. Never throws; meant for after().
 * Resolves to what it did, for logs and tests.
 */
export async function catchUpGames(now: Date = new Date()): Promise<"throttled" | "busy" | "idle" | "ran" | "failed"> {
  if (inFlight) return "busy";
  if (now.getTime() - lastCheck < CHECK_INTERVAL_MS) return "throttled";
  lastCheck = now.getTime();
  let outcome: "idle" | "ran" | "failed" = "idle";
  inFlight = (async () => {
    try {
      const { due, reasons } = await gamesDue(now);
      if (!due) return;
      console.log(`[cron/catch-up] running games: ${reasons.join(", ")}`);
      const result = await runTick(new Date(), { steps: ["games"] });
      outcome = result.steps.every((s) => s.ok) ? "ran" : "failed";
    } catch (e) {
      outcome = "failed";
      console.error(`[cron/catch-up] failed: ${describeError(e)}`);
    }
  })();
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
  return outcome;
}
