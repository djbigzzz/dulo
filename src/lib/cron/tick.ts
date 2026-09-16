/**
 * The 5-minute cron pipeline (docs/HANDOFF.md §4.2) and its per-user fast path.
 *
 *   runTick(now)            games -> snapshot -> evaluate -> badges, each timed and isolated.
 *                           "games" runs first: the League rollover and the Calls settlement
 *                           are clock-driven (Friday 20:00/20:05 UTC), never read a Snapshot,
 *                           and must not starve behind a rate-limited RPC (a public-RPC
 *                           snapshot of a wallet fleet has taken 80s; docs/REVIEW-2026-09-14.md
 *                           M2). "snapshot" then "evaluate" keep their dependency order.
 *                           "badges" (P4) runs last: it mints pending soulbound Badges,
 *                           which are confirmed chain writes and the slowest step, so the
 *                           games must never wait behind it; the League podium rows it
 *                           creates come from PointsEvents the games step wrote moments
 *                           earlier in the same tick.
 *   runForUser(userId, now) snapshot that user's wallets + evaluate them, capped at ~8s,
 *                           never throws. Fired right after sign-in and by the Plays
 *                           page's Refresh button so "First Position" is already
 *                           complete when the board loads.
 *
 * Server-only. Routes: /api/cron/tick (runTick), /api/v1/plays/refresh (runForUser).
 */
import { games } from "@/lib/games";
import { db } from "@/lib/server/db";
import { mintPendingBadges, type MintPendingResult } from "./badges";
import { evaluateAllUsers, evaluateUser, type EvaluateAllResult, type UserEvalResult } from "./evaluate";
import { snapshotAllWallets, type SnapshotAllResult } from "./snapshot";
import { describeError } from "./util";

const LOG_PREFIX = "[cron/tick]";

/** Pipeline order. `runTick` runs any requested subset in this order. */
export const TICK_STEPS = ["games", "snapshot", "evaluate", "badges"] as const;
export type TickStepName = (typeof TICK_STEPS)[number];

export function isTickStepName(s: string): s is TickStepName {
  return (TICK_STEPS as readonly string[]).includes(s);
}

export interface TickStep {
  name: TickStepName;
  /** False when the step threw or reported any failure in its detail. */
  ok: boolean;
  /** Wall-clock milliseconds. */
  took: number;
  /** The step's own result (SnapshotAllResult, EvaluateAllResult, GamesStepResult, MintPendingResult) or { error }. */
  detail?: unknown;
}

export interface TickResult {
  ranAt: string;
  steps: TickStep[];
}

export interface RunTickOptions {
  /** Subset of steps to run, in pipeline order. Default: all. */
  steps?: readonly TickStepName[];
}

export interface GameModuleOutcome {
  key: string;
  ok: boolean;
  took: number;
  error?: string;
}

export interface GamesStepResult {
  modules: GameModuleOutcome[];
}

interface StepOutcome {
  ok: boolean;
  detail: unknown;
}

async function runSnapshotStep(now: Date): Promise<StepOutcome> {
  const detail: SnapshotAllResult = await snapshotAllWallets({ takenAt: now });
  return { ok: detail.failed.length === 0, detail };
}

async function runEvaluateStep(now: Date): Promise<StepOutcome> {
  const detail: EvaluateAllResult = await evaluateAllUsers(now);
  return { ok: detail.failed.length === 0, detail };
}

/** Tick every registered GameModule; one module's failure never blocks the next. */
async function runGamesStep(now: Date): Promise<StepOutcome> {
  const modules: GameModuleOutcome[] = [];
  for (const g of games) {
    const started = Date.now();
    try {
      await g.tick(now);
      modules.push({ key: g.key, ok: true, took: Date.now() - started });
    } catch (e) {
      const error = describeError(e);
      modules.push({ key: g.key, ok: false, took: Date.now() - started, error });
      console.error(`${LOG_PREFIX} game module ${g.key} failed: ${error}`);
    }
  }
  const detail: GamesStepResult = { modules };
  return { ok: modules.every((m) => m.ok), detail };
}

/** Award League podium badges and mint pending Badge rows (a disabled server wallet is a skip, not a failure). */
async function runBadgesStep(now: Date): Promise<StepOutcome> {
  const detail: MintPendingResult = await mintPendingBadges(now);
  return { ok: detail.failed.length === 0, detail };
}

const STEP_RUNNERS: Record<TickStepName, (now: Date) => Promise<StepOutcome>> = {
  snapshot: runSnapshotStep,
  evaluate: runEvaluateStep,
  games: runGamesStep,
  badges: runBadgesStep,
};

async function runStep(name: TickStepName, now: Date): Promise<TickStep> {
  const started = Date.now();
  try {
    const { ok, detail } = await STEP_RUNNERS[name](now);
    return { name, ok, took: Date.now() - started, detail };
  } catch (e) {
    const error = describeError(e);
    console.error(`${LOG_PREFIX} step ${name} threw: ${error}`);
    return { name, ok: false, took: Date.now() - started, detail: { error } };
  }
}

/** Run the pipeline (or the requested subset) in order. A failing step is reported, not thrown. */
export async function runTick(now: Date = new Date(), opts: RunTickOptions = {}): Promise<TickResult> {
  const wanted = opts.steps && opts.steps.length > 0 ? TICK_STEPS.filter((s) => opts.steps?.includes(s)) : TICK_STEPS;
  const steps: TickStep[] = [];
  for (const name of wanted) steps.push(await runStep(name, now));
  return { ranAt: now.toISOString(), steps };
}

// ---------------------------------------------------------------------------
// Per-user fast path
// ---------------------------------------------------------------------------

/** Upper bound for runForUser; a serverless sign-in response must not wait longer than this. */
export const RUN_FOR_USER_TIMEOUT_MS = 8_000;

export interface RunForUserOptions {
  timeoutMs?: number;
}

export interface UserRunResult {
  userId: string;
  /** True when both steps finished without a failure inside the time budget. */
  ok: boolean;
  timedOut: boolean;
  took: number;
  snapshot: SnapshotAllResult | null;
  evaluate: UserEvalResult | null;
  error: string | null;
}

/**
 * Snapshot one user's wallets and evaluate their Plays. Resolves within ~timeoutMs
 * (default 8s) and never throws: on timeout the work keeps running in the background
 * (its writes are idempotent, the next tick repairs anything half-done) and the caller
 * gets { timedOut: true }.
 */
export async function runForUser(userId: string, now: Date = new Date(), opts: RunForUserOptions = {}): Promise<UserRunResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? RUN_FOR_USER_TIMEOUT_MS;
  const base: UserRunResult = { userId, ok: false, timedOut: false, took: 0, snapshot: null, evaluate: null, error: null };

  const work = (async () => {
    const wallets = await db.wallet.findMany({ where: { userId }, select: { id: true } });
    const snapshot = await snapshotAllWallets({ walletIds: wallets.map((w) => w.id), takenAt: now });
    const evaluate = await evaluateUser(userId, now);
    return { snapshot, evaluate };
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    // Never keep a process alive just for this deadline.
    (timer as { unref?: () => void }).unref?.();
  });

  try {
    const outcome = await Promise.race([work, timeout]);
    if (outcome === "timeout") {
      work
        .then(() => console.warn(`${LOG_PREFIX} runForUser(${userId}) finished after the ${timeoutMs}ms budget`))
        .catch((e) => console.error(`${LOG_PREFIX} runForUser(${userId}) failed after timeout: ${describeError(e)}`));
      return { ...base, timedOut: true, took: Date.now() - started, error: `timed out after ${timeoutMs}ms` };
    }
    const { snapshot, evaluate } = outcome;
    return {
      ...base,
      ok: snapshot.failed.length === 0 && evaluate.errors === 0,
      took: Date.now() - started,
      snapshot,
      evaluate,
    };
  } catch (e) {
    const error = describeError(e);
    console.error(`${LOG_PREFIX} runForUser(${userId}) failed: ${error}`);
    return { ...base, took: Date.now() - started, error };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
