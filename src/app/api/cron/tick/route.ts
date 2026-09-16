import { z } from "zod";
import { solana } from "@/lib/adapters/solana";
import { xstocksCatalogueOrigin, type CatalogueOrigin } from "@/lib/assets/xstocks";
import { isTickStepName, runTick, TICK_STEPS, type TickResult, type TickStepName } from "@/lib/cron/tick";
import { ApiError, assertCronSecret, handler, ok, parseQuery } from "@/lib/server/api";
import { configWarnings, env, rpcHost } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Snapshotting a wallet fleet plus up to DEFAULT_MINT_LIMIT confirmed Badge mints can outlast the
 * 10s default. 300s is the Fluid-compute ceiling on Hobby (Pro allows 800s); the games step runs
 * first so a slow RPC never starves the Friday settle/rollover.
 */
export const maxDuration = 300;

const QuerySchema = z.object({
  /** Comma-separated subset of steps: games,snapshot,evaluate,badges (repeatable). Default: all. */
  steps: z.union([z.string(), z.array(z.string())]).optional(),
});

function parseSteps(req: Request): TickStepName[] | undefined {
  const { steps } = parseQuery(req, QuerySchema);
  if (steps === undefined) return undefined;
  const names = (Array.isArray(steps) ? steps : [steps])
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return undefined;
  const bad = names.filter((s) => !isTickStepName(s));
  if (bad.length > 0) {
    throw new ApiError(`Unknown step(s): ${bad.join(", ")}. Valid: ${TICK_STEPS.join(", ")}`, 400);
  }
  return names.filter(isTickStepName);
}

// ---------------------------------------------------------------------------
// Health summary — what a pinger or a human reads without parsing every step's detail.
// ---------------------------------------------------------------------------

interface TickHealth {
  /** True when every step that ran reported ok (`jq -e '.data.steps | all(.ok)'` agrees). */
  ok: boolean;
  /** Wall-clock milliseconds for the whole tick. */
  took: number;
  /**
   * Where the served xStocks catalogue came from: "api" live; "bundle" the generated catalogue
   * seeded at cold start while the first live fetch runs; "fallback" the bundle after the live
   * fetch failed (the public API is unreachable). Null before the first load.
   */
  catalogueOrigin: CatalogueOrigin | null;
  /** Age of the adapter's (slot, wall-clock) anchor in ms; null until the first chain read in this process. */
  slotAnchorAgeMs: number | null;
  /** Host of the RPC the server reads the chain through (host only; the Helius key lives in the query and is never shown). */
  rpcHost: string;
  /** Production deploy-configuration warnings (e.g. HELIUS_API_KEY empty -> public RPC). Empty when healthy or outside production. */
  warnings: string[];
  /** Null when the step did not run or threw before reporting. */
  snapshot: { ok: number; failed: number; skipped: number } | null;
  evaluate: { ok: number; failed: number; awarded: number } | null;
  badges: { pending: number; minted: number; failed: number; skipped: boolean; reason: string | null } | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A step's detail as a record, or null when the step did not run or reported `{ error }`. */
function stepDetail(result: TickResult, name: TickStepName): Record<string, unknown> | null {
  const step = result.steps.find((s) => s.name === name);
  if (!step || !isRecord(step.detail) || "error" in step.detail) return null;
  return step.detail;
}

/** Numeric field, or the length of an array field; 0 when absent. */
function count(detail: Record<string, unknown>, key: string): number {
  const v = detail[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (Array.isArray(v)) return v.length;
  return 0;
}

let warnedConfig = false;

/** Deploy warnings for the summary; logged once per process so a misconfigured prod shows up in the logs too. */
function deployWarnings(): string[] {
  const warnings = configWarnings();
  if (warnings.length > 0 && !warnedConfig) {
    warnedConfig = true;
    for (const w of warnings) console.warn(`[cron/tick] ${w}`);
  }
  return warnings;
}

function tickHealth(result: TickResult, took: number, nowMs: number): TickHealth {
  const snapshot = stepDetail(result, "snapshot");
  const evaluate = stepDetail(result, "evaluate");
  const badges = stepDetail(result, "badges");
  const anchor = solana.slotAnchor();
  return {
    ok: result.steps.every((s) => s.ok),
    took,
    catalogueOrigin: xstocksCatalogueOrigin(),
    slotAnchorAgeMs: anchor ? Math.max(0, nowMs - anchor.at) : null,
    rpcHost: rpcHost(),
    warnings: deployWarnings(),
    snapshot: snapshot ? { ok: count(snapshot, "ok"), failed: count(snapshot, "failed"), skipped: count(snapshot, "skipped") } : null,
    evaluate: evaluate ? { ok: count(evaluate, "ok"), failed: count(evaluate, "failed"), awarded: count(evaluate, "awarded") } : null,
    badges: badges
      ? {
          pending: count(badges, "pending"),
          minted: count(badges, "minted"),
          failed: count(badges, "failed"),
          skipped: badges.skipped === true,
          reason: typeof badges.reason === "string" ? badges.reason : null,
        }
      : null,
  };
}

/**
 * GET|POST /api/cron/tick[?steps=games,snapshot,evaluate,badges]
 * Scheduled by vercel.json every 5 minutes (Vercel sends `Authorization: Bearer <CRON_SECRET>`;
 * the GitHub Actions pinger in .github/workflows/tick.yml sends the same header; `?secret=` is
 * accepted outside production only). Runs docs/HANDOFF.md §4.2 via lib/cron/tick, in this order:
 *   games     every registered GameModule: League ensure/rollover, Calls settlement
 *   snapshot  every real user's wallet xStocks holdings via the ChainAdapter, priced through lib/price
 *   evaluate  every active Play for every user with lib/plays/engine -> PlayProgress, PointsEvent, Badge rows
 *   badges    League podium Badge rows, then mint pending soulbound Badges (skipped without a server wallet)
 * -> ok({ ranAt, steps: [{ name, ok, took, detail }], health }). A failing step is reported, never a 500;
 * pingers check `.data.steps | all(.ok)` and read `.data.health` for the catalogue origin, slot-anchor
 * age, RPC host, production config warnings, snapshot failures and badge queue.
 */
const tick = handler(async (req) => {
  assertCronSecret(req, env().CRON_SECRET);
  const steps = parseSteps(req);
  const started = Date.now();
  const result = await runTick(new Date(started), { steps });
  const finished = Date.now();
  const health = tickHealth(result, finished - started, finished);
  return ok({ ...result, health }, { headers: { "cache-control": "no-store" } });
});

export const GET = tick;
export const POST = tick;
