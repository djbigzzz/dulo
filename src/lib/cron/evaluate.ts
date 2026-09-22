/**
 * Cron step 2 — evaluate every active Play for every user (docs/HANDOFF.md §4.2).
 *
 * buildEvalContext(userId, now)   the user's 45-day snapshot history (all wallets merged
 *                                 per 5-minute bucket, ascending), internal events, the
 *                                 earnings calendar and the sector / underlying lookups.
 * evaluateUser(userId, now, ctx)  runs lib/plays/engine over every active Play in the
 *                                 current Season and persists PlayProgress; the FIRST
 *                                 completion appends one PointsEvent and, for badge Plays,
 *                                 one Badge row (mint later, P4).
 * evaluateAllUsers(now)           evaluateUser for every real User (bots — users with a
 *                                 LeagueAccount.isBot — are skipped: their seeded League
 *                                 trades would otherwise complete Scout, and bots never
 *                                 score; docs/REVIEW-2026-09-14.md H2), failures isolated.
 *                                 It also backfills starter points (lib/games/starter) for
 *                                 every real user without them in the active Season.
 * evaluateUser refuses a bot-league-* id up front, with no database read, whoever calls it.
 *
 * Idempotency
 *   - A completed Play never goes back to in_progress and keeps its original completedAt.
 *   - PointsEvent is guarded by @@unique(userId, seasonId, ref): a P2002 means the points
 *     were already awarded (an earlier run wrote the event but died before PlayProgress).
 *   - Badge is guarded by @@unique(userId, playKey) the same way.
 *   - Writes go points -> badge -> progress, so a crash anywhere is repaired by the next run.
 *
 * Server-only.
 */
import type { Prisma } from "@prisma/client";
import { listAllAssets } from "@/lib/assets/registry";
import { listCorporateActions } from "@/lib/corporate-actions";
import { DEFAULT_ASSET_SOURCE, type AssetInfo, type Holding, type HoldingsSnapshot, type InternalEvent, type PriceSourceName } from "@/lib/core";
import { mirrorEventsForUser } from "@/lib/mirror/events";
import { evaluatePlay, mergeSnapshots, type EvalContext, type EvalResult } from "@/lib/plays/engine";
import { getCalendar, safeParsePlayRule } from "@/lib/plays/rules";
import { isBotUserId } from "@/lib/games/bots";
import { backfillStarterPoints } from "@/lib/games/starter";
import { db } from "@/lib/server/db";
import { REAL_USER_WHERE } from "@/lib/server/queries";
import { describeError, forEachLimited, isUniqueViolation } from "./util";

const LOG_PREFIX = "[cron/evaluate]";

/** How much snapshot history a Play may look back over (hold_through_date needs the most). */
export const SNAPSHOT_HISTORY_DAYS = 45;
/** Snapshots taken within the same 5-minute window count as one tick. */
export const SNAPSHOT_BUCKET_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CatalogueIndex {
  sectorOf: (assetId: string) => string | null;
  underlyingOf: (assetId: string) => string | null;
}

/** The Snapshot columns the context needs. */
export interface SnapshotRowInput {
  walletId: string;
  takenAt: Date;
  /** The Snapshot.holdings JSON column (Holding[] as written by cron/snapshot). */
  holdings: unknown;
}

/** The Play columns the evaluator needs. */
export interface PlayRowInput {
  key: string;
  points: number;
  badgeKey: string | null;
  rule: unknown;
  /** Play.assetSource: the issuer this quest is written for. Scopes which holdings satisfy it. */
  assetSource?: string | null;
}

export interface SeasonRef {
  id: string;
}

export interface BuildEvalContextOptions {
  /**
   * Extra events merged into the context (tests, one-off replays). Mirror intents are
   * NOT supplied here any more: buildEvalContext reads them itself through
   * lib/mirror/events.mirrorEventsForUser (the `mirror` PlayProgress row's proof.intent,
   * written by POST /api/v1/mirror/record) as `mirror_executed` events.
   */
  extraEvents?: InternalEvent[];
  /** Pre-built catalogue index (evaluateAllUsers builds one per run). */
  catalogue?: CatalogueIndex;
  /** Snapshot look-back in days. Default SNAPSHOT_HISTORY_DAYS. */
  historyDays?: number;
}

export interface EvaluateUserOptions extends BuildEvalContextOptions {
  /** Skip the Season lookup (evaluateAllUsers resolves it once). */
  season?: SeasonRef | null;
  /** Skip the Play lookup (evaluateAllUsers loads them once). */
  plays?: PlayRowInput[];
}

export interface PlayOutcome {
  key: string;
  status: "complete" | "in_progress";
  /** True when this run flipped the Play to complete. */
  newlyCompleted: boolean;
  /** True when this run appended the PointsEvent (false when it already existed). */
  awarded: boolean;
  /** True when this run created the Badge row. */
  badge: boolean;
  error?: string;
}

export interface UserEvalResult {
  userId: string;
  /** Null when no Season is seeded (nothing can be evaluated or awarded). */
  seasonId: string | null;
  evaluated: number;
  completed: number;
  newlyCompleted: number;
  awarded: number;
  badges: number;
  errors: number;
  plays: PlayOutcome[];
}

export interface EvaluateAllOptions {
  /** Users evaluated in parallel. Default 4. */
  concurrency?: number;
  /** Test hook: pass a Season instead of looking it up. */
  season?: SeasonRef | null;
}

export interface EvaluateAllResult {
  seasonId: string | null;
  /** Users evaluated without an unhandled error. */
  ok: number;
  failed: Array<{ userId: string; error: string }>;
  evaluated: number;
  newlyCompleted: number;
  awarded: number;
  badges: number;
  /** Starter point grants written by this run's backfill (0 once everyone has theirs). */
  starterGranted: number;
  took: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

const PRICE_SOURCES: ReadonlySet<string> = new Set<PriceSourceName>(["pyth", "jupiter", "cache", "none"]);

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Coerce a Snapshot.holdings JSON column back into Holding[]. Malformed entries are dropped, never thrown. */
export function toHoldings(json: unknown): Holding[] {
  if (!Array.isArray(json)) return [];
  const out: Holding[] = [];
  for (const item of json) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const h = item as Record<string, unknown>;
    if (typeof h.assetId !== "string" || h.assetId.length === 0) continue;
    const price = typeof h.price === "number" && Number.isFinite(h.price) ? h.price : null;
    out.push({
      assetId: h.assetId as Holding["assetId"],
      symbol: typeof h.symbol === "string" ? h.symbol : h.assetId,
      source: typeof h.source === "string" && h.source.trim().length > 0 ? h.source.trim() : DEFAULT_ASSET_SOURCE,
      raw: typeof h.raw === "string" ? h.raw : "0",
      multiplier: num(h.multiplier, 1),
      qty: num(h.qty),
      price,
      priceSource: typeof h.priceSource === "string" && PRICE_SOURCES.has(h.priceSource) ? (h.priceSource as PriceSourceName) : "none",
      usd: num(h.usd),
    });
  }
  return out;
}

/**
 * Group snapshot rows into `bucketMs` windows and merge every wallet's latest row in a
 * window into one HoldingsSnapshot (takenAt = window start), ascending. A wallet that
 * was snapshotted twice inside one window (cron + manual refresh) counts once.
 */
export function bucketSnapshots(rows: readonly SnapshotRowInput[], bucketMs = SNAPSHOT_BUCKET_MS): HoldingsSnapshot[] {
  const buckets = new Map<number, Map<string, HoldingsSnapshot>>();
  for (const row of rows) {
    const key = Math.floor(row.takenAt.getTime() / bucketMs) * bucketMs;
    let byWallet = buckets.get(key);
    if (!byWallet) {
      byWallet = new Map();
      buckets.set(key, byWallet);
    }
    const prev = byWallet.get(row.walletId);
    if (prev && prev.takenAt.getTime() > row.takenAt.getTime()) continue;
    byWallet.set(row.walletId, { walletId: row.walletId, takenAt: row.takenAt, holdings: toHoldings(row.holdings) });
  }
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((key) => mergeSnapshots([...(buckets.get(key) as Map<string, HoldingsSnapshot>).values()], new Date(key)));
}

/** Sector / underlying lookups over every registered catalogue, built once per run. */
export function catalogueIndexFrom(assets: readonly AssetInfo[]): CatalogueIndex {
  const byId = new Map<string, AssetInfo>();
  for (const a of assets) byId.set(a.assetId, a);
  return {
    sectorOf: (assetId) => byId.get(assetId)?.sector ?? null,
    underlyingOf: (assetId) => byId.get(assetId)?.underlying ?? null,
  };
}

/** The index over every AssetSource in lib/assets/registry (a pre-IPO token has sector null, so it never counts towards Sector Spread). */
export async function buildCatalogueIndex(): Promise<CatalogueIndex> {
  return catalogueIndexFrom(await listAllAssets());
}

/** The earnings calendar keyed by underlying ticker ("_note" / "asOf" already stripped by rules.ts). */
export function earningsCalendar(): Record<string, string[]> {
  return getCalendar("earnings").dates;
}

// ---------------------------------------------------------------------------
// Database reads
// ---------------------------------------------------------------------------

/** The Season whose window contains `now`, else the latest by endsAt (same rule as the UI). */
export async function findCurrentSeason(now: Date): Promise<SeasonRef | null> {
  const active = await db.season.findFirst({
    where: { startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { startsAt: "desc" },
    select: { id: true },
  });
  if (active) return active;
  return db.season.findFirst({ orderBy: { endsAt: "desc" }, select: { id: true } });
}

/** Active Plays (isActive = true) in a Season. "Coming soon" Plays are never evaluated. */
export async function loadActivePlays(seasonId: string): Promise<PlayRowInput[]> {
  return db.play.findMany({
    where: { isActive: true, campaign: { seasonId } },
    select: { key: true, points: true, badgeKey: true, rule: true, assetSource: true },
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
  });
}

/**
 * Internal events for internal_event Plays (quests), in load order; buildEvalContext sorts them.
 *   LeagueTrade  -> league_trade (ref: trade id)
 *   Position     -> call_placed  (ref: market id; side/points in meta)
 *   both         -> game_action, derived from the same two reads (no extra query): one per
 *                   paper trade (ref `trade:<id>`, ts = trade time) and one per prediction
 *                   side (ref `prediction:<marketId>:<side>`, ts = first placement, so a
 *                   top-up never adds a day). Rules count distinct days of it (Three Game Days).
 * mirror_executed is loaded separately by buildEvalContext (lib/mirror/events).
 */
export async function loadInternalEvents(userId: string): Promise<InternalEvent[]> {
  const [trades, positions] = await Promise.all([
    db.leagueTrade.findMany({
      where: { account: { userId } },
      select: { id: true, ts: true, symbol: true, side: true, leagueAccountId: true },
      orderBy: { ts: "asc" },
    }),
    db.position.findMany({
      where: { userId },
      select: { marketId: true, side: true, points: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const events: InternalEvent[] = [
    ...trades.map((t) => ({
      type: "league_trade",
      userId,
      ref: t.id,
      ts: t.ts,
      meta: { symbol: t.symbol, side: t.side, leagueAccountId: t.leagueAccountId },
    })),
    ...positions.map((p) => ({
      type: "call_placed",
      userId,
      ref: p.marketId,
      ts: p.createdAt,
      meta: { side: p.side, points: p.points },
    })),
    ...trades.map((t) => ({
      type: "game_action",
      userId,
      ref: `trade:${t.id}`,
      ts: t.ts,
      meta: { kind: "trade" },
    })),
    ...positions.map((p) => ({
      type: "game_action",
      userId,
      ref: `prediction:${p.marketId}:${p.side}`,
      ts: p.createdAt,
      meta: { kind: "prediction" },
    })),
  ];
  return events;
}

function sortEvents(events: InternalEvent[]): InternalEvent[] {
  return [...events].sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

/** Everything the engine needs to evaluate one user at `now`. */
export async function buildEvalContext(userId: string, now: Date, opts: BuildEvalContextOptions = {}): Promise<EvalContext> {
  const historyDays = opts.historyDays ?? SNAPSHOT_HISTORY_DAYS;
  const since = new Date(now.getTime() - historyDays * 24 * 60 * 60 * 1000);

  const wallets = await db.wallet.findMany({ where: { userId }, select: { id: true } });
  const walletIds = wallets.map((w) => w.id);

  const [rows, dbEvents, mirrorEvents, catalogue, corporateActions] = await Promise.all([
    walletIds.length > 0
      ? db.snapshot.findMany({
          where: { walletId: { in: walletIds }, takenAt: { gte: since } },
          select: { walletId: true, takenAt: true, holdings: true },
          orderBy: { takenAt: "asc" },
        })
      : Promise.resolve([] as SnapshotRowInput[]),
    loadInternalEvents(userId),
    // P4: the user's recorded Mirror intent as a mirror_executed event (never throws).
    mirrorEventsForUser(userId),
    opts.catalogue ? Promise.resolve(opts.catalogue) : buildCatalogueIndex(),
    // The adjustments each mint records (cached 10 minutes, never throws): multiplier_change
    // completes only for a change one of them corroborates, never for a snapshot pair alone.
    listCorporateActions(),
  ]);

  return {
    now,
    snapshots: bucketSnapshots(rows),
    events: sortEvents([...dbEvents, ...mirrorEvents, ...(opts.extraEvents ?? [])]),
    earnings: earningsCalendar(),
    sectorOf: catalogue.sectorOf,
    underlyingOf: catalogue.underlyingOf,
    corporateActions,
  };
}

// ---------------------------------------------------------------------------
// Writes (each idempotent on its own)
// ---------------------------------------------------------------------------

/** Append the Play's PointsEvent. False when it already existed (unique violation). */
async function awardPoints(userId: string, seasonId: string, play: PlayRowInput): Promise<boolean> {
  try {
    await db.pointsEvent.create({
      data: { userId, seasonId, source: "play", ref: `play:${play.key}`, delta: play.points },
    });
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
}

/** Queue the Badge row (mint + txSig filled in by P4). False when it already existed. */
async function ensureBadge(userId: string, play: PlayRowInput): Promise<boolean> {
  try {
    await db.badge.create({ data: { userId, playKey: play.key, mint: null, txSig: null } });
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
}

function toDate(iso: string | undefined, fallback: Date): Date {
  if (!iso) return fallback;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t) : fallback;
}

/** proof + progress, as one JSON object for the PlayProgress row. */
function proofFor(result: EvalResult): Record<string, unknown> {
  const proof: Record<string, unknown> = { ...(result.proof ?? {}) };
  if (result.progress) proof.progress = result.progress;
  return proof;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Keep a Mirror intent (`proof.intent`, written by POST /api/v1/mirror/record) across
 * proof refreshes: the engine's proof replaces the row's proof every tick, and the
 * mirror_executed event is derived from that intent, so dropping it would forget the
 * mirror before the user's post-swap snapshot could be compared (lib/mirror/events).
 */
function carryIntent(next: unknown, prior: unknown): unknown {
  if (!isObj(prior) || prior.intent === undefined) return next;
  if (!isObj(next) || next.intent !== undefined) return next;
  return { ...next, intent: prior.intent };
}

interface ExistingProgress {
  status: string;
  completedAt: Date | null;
  proof: unknown;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate every active Play in the current Season for one user and persist the outcome.
 * Never throws for a single Play's failure (recorded in `plays[i].error`); throws only
 * when the shared reads (Season, Plays, context) fail.
 */
export async function evaluateUser(
  userId: string,
  now: Date = new Date(),
  ctx?: EvalContext,
  opts: EvaluateUserOptions = {},
): Promise<UserEvalResult> {
  const result: UserEvalResult = {
    userId,
    seasonId: null,
    evaluated: 0,
    completed: 0,
    newlyCompleted: 0,
    awarded: 0,
    badges: 0,
    errors: 0,
    plays: [],
  };
  // House bots never complete quests or earn points, whoever asks (cron, inline routes, refresh).
  if (isBotUserId(userId)) return result;

  const season = opts.season !== undefined ? opts.season : await findCurrentSeason(now);
  if (!season) {
    console.warn(`${LOG_PREFIX} no Season seeded; nothing to evaluate for ${userId}`);
    return result;
  }
  result.seasonId = season.id;

  const plays = opts.plays ?? (await loadActivePlays(season.id));
  if (plays.length === 0) return result;

  const context = ctx ?? (await buildEvalContext(userId, now, opts));

  const existingRows = await db.playProgress.findMany({
    where: { userId, playKey: { in: plays.map((p) => p.key) } },
    select: { playKey: true, status: true, completedAt: true, proof: true },
  });
  const existing = new Map<string, ExistingProgress>(existingRows.map((r) => [r.playKey, r]));

  for (const play of plays) {
    const outcome: PlayOutcome = { key: play.key, status: "in_progress", newlyCompleted: false, awarded: false, badge: false };
    result.plays.push(outcome);

    const rule = safeParsePlayRule(play.rule);
    if (!rule) {
      outcome.error = "invalid rule";
      result.errors += 1;
      console.warn(`${LOG_PREFIX} Play ${play.key} has an invalid rule; skipped`);
      continue;
    }

    try {
      const evaluation = evaluatePlay(rule, context, play.assetSource ?? null);
      result.evaluated += 1;

      const prior = existing.get(play.key);
      const wasComplete = prior?.status === "complete";
      const isComplete = wasComplete || evaluation.complete;
      const newlyCompleted = evaluation.complete && !wasComplete;

      // Completion is sticky: the original completedAt survives and, once complete, the
      // stored proof is only replaced by another complete evaluation (never by a later
      // "not satisfied" state, which would erase the evidence the badge was minted on).
      const completedAt = wasComplete
        ? (prior?.completedAt ?? toDate(evaluation.completedAt, now))
        : evaluation.complete
          ? toDate(evaluation.completedAt, now)
          : null;
      const proof: unknown = carryIntent(wasComplete && !evaluation.complete ? (prior?.proof ?? {}) : proofFor(evaluation), prior?.proof);

      if (newlyCompleted) {
        outcome.awarded = await awardPoints(userId, season.id, play);
        if (play.badgeKey) outcome.badge = await ensureBadge(userId, play);
      }

      const status = isComplete ? "complete" : "in_progress";
      await db.playProgress.upsert({
        where: { userId_playKey: { userId, playKey: play.key } },
        create: { userId, playKey: play.key, status, completedAt, proof: proof as Prisma.InputJsonValue },
        update: { status, completedAt, proof: proof as Prisma.InputJsonValue },
      });

      outcome.status = status;
      outcome.newlyCompleted = newlyCompleted;
      if (isComplete) result.completed += 1;
      if (newlyCompleted) result.newlyCompleted += 1;
      if (outcome.awarded) result.awarded += 1;
      if (outcome.badge) result.badges += 1;
    } catch (e) {
      outcome.error = describeError(e);
      result.errors += 1;
      console.error(`${LOG_PREFIX} Play ${play.key} for ${userId} failed: ${outcome.error}`);
    }
  }

  return result;
}

/** evaluateUser for every real User (bots excluded in the query). One user's failure is logged and skipped; the run always resolves. */
export async function evaluateAllUsers(now: Date = new Date(), opts: EvaluateAllOptions = {}): Promise<EvaluateAllResult> {
  const started = Date.now();
  const out: EvaluateAllResult = { seasonId: null, ok: 0, failed: [], evaluated: 0, newlyCompleted: 0, awarded: 0, badges: 0, starterGranted: 0, took: 0 };

  const season = opts.season !== undefined ? opts.season : await findCurrentSeason(now);
  if (!season) {
    console.warn(`${LOG_PREFIX} no Season seeded; evaluate step skipped`);
    out.took = Date.now() - started;
    return out;
  }
  out.seasonId = season.id;

  const [plays, catalogue, users] = await Promise.all([
    loadActivePlays(season.id),
    buildCatalogueIndex(),
    db.user.findMany({ where: REAL_USER_WHERE, select: { id: true }, orderBy: { createdAt: "asc" } }),
  ]);

  // Starter points for every real user who has none in this Season yet (active window only).
  // One insert with skipDuplicates; a failure is logged and never fails the step.
  out.starterGranted = await backfillStarterPoints(
    season.id,
    users.map((u) => u.id),
    now,
  ).catch((e: unknown) => {
    console.error(`${LOG_PREFIX} starter points backfill failed (the next tick retries): ${describeError(e)}`);
    return 0;
  });

  if (plays.length === 0) {
    out.took = Date.now() - started;
    return out;
  }

  await forEachLimited(users, Math.max(1, Math.floor(opts.concurrency ?? 4)), async (user) => {
    try {
      const r = await evaluateUser(user.id, now, undefined, { season, plays, catalogue });
      out.ok += 1;
      out.evaluated += r.evaluated;
      out.newlyCompleted += r.newlyCompleted;
      out.awarded += r.awarded;
      out.badges += r.badges;
    } catch (e) {
      const error = describeError(e);
      out.failed.push({ userId: user.id, error });
      console.error(`${LOG_PREFIX} user ${user.id} failed: ${error}`);
    }
  });

  out.took = Date.now() - started;
  return out;
}
