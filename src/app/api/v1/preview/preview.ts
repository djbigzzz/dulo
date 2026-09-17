/**
 * Check any wallet (15 Sep review M-C, work item C7). Server-only.
 *
 * GET /api/v1/preview/[address] is a dry run of the Plays loop for a wallet that never signed in:
 *
 *   readWalletHoldings (ChainAdapter -> AssetSource -> lib/price, shared with the cron snapshot)
 *     -> one synthetic HoldingsSnapshot at the read time
 *     -> lib/plays/engine evaluatePlay for every active Play of the current Season
 *     -> a status per Play.
 *
 * NOTHING is written: no User, Wallet, Snapshot, PlayProgress or PointsEvent row. A previewed
 * wallet is never scored. The only database read is the Play list (with the catalogue as the
 * fallback when the database is unavailable), so the page still works on a cold database.
 *
 * Statuses
 *   qualifies       a holdings Play (hold_any, diversified, 1-day hold) the live holdings satisfy
 *   not_yet         a holdings Play they do not satisfy yet
 *   needs_history   a Play that reads daily snapshots (streaks, DCA, earnings): one read cannot
 *                   prove it, so it says "Needs daily snapshots — connect to start the clock"
 *   needs_activity  a Play earned inside Dulo (paper trades, predictions, game days, copying a portfolio)
 *
 * Abuse limits (per server instance): 10 checks per minute per client IP, 60 uncached checks per
 * minute overall (a sweep through many IPs still cannot drain the shared RPC budget). Successful
 * answers carry `s-maxage=300`, so the CDN serves repeat checks of the same address.
 */
import { z } from "zod";
import { isValidSolanaAddress } from "@/lib/adapters/solana";
import { xstocks } from "@/lib/assets/xstocks";
import { SOLANA_MAINNET, type Holding, type HoldingsSnapshot, type PriceQuote } from "@/lib/core";
import { catalogueIndexFrom, earningsCalendar, findCurrentSeason, type CatalogueIndex } from "@/lib/cron/evaluate";
import { readWalletHoldings, type WalletHoldingsRead } from "@/lib/cron/snapshot";
import { publicWalletLabel } from "@/lib/mirror/public-wallets";
import { activePlays, SEASON0_ASSET_SOURCE } from "@/lib/plays/catalogue";
import { evaluatePlay, type EvalContext, type EvalResult } from "@/lib/plays/engine";
import { safeParsePlayRule, type PlayRule } from "@/lib/plays/rules";
import { db } from "@/lib/server/db";
import { createRateLimiter } from "@/lib/server/rate-limit";
import type { PreviewHoldingView, PreviewPlayStatus, PreviewPlayView, PreviewResponse, PriceQuoteView } from "@/lib/api-client";

const LOG_PREFIX = "[api/preview]";

/** Checks per client IP per rolling minute window. */
export const PREVIEW_PER_IP_PER_MINUTE = 10;
/** Uncached checks per minute across every caller (per server instance). */
export const PREVIEW_UNCACHED_PER_MINUTE = 60;
/** CDN caches a successful preview for 5 minutes; browsers always revalidate. */
export const PREVIEW_CACHE_CONTROL = "public, max-age=0, s-maxage=300, stale-while-revalidate=60";

export const NEEDS_HISTORY_NOTE = "Needs daily snapshots — connect to start the clock";
export const QUALIFIES_NOTE = "Verified from this wallet's live holdings";
/** A game-day quest: any paper trade or new prediction counts, both done inside Dulo. */
export const GAME_ACTION_NOTE = "Earned inside Dulo with starter points or virtual cash. Connect to take part";

/** A base58 Solana address that decodes to 32 bytes. */
export const PreviewAddress = z
  .string()
  .trim()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana address")
  .refine((s) => isValidSolanaAddress(s), "Invalid Solana address");

// ---------------------------------------------------------------------------
// Status mapping (pure)
// ---------------------------------------------------------------------------

export type PreviewKind = "snapshot" | "history" | "activity";

/**
 * Which Plays one live read can decide. Every internal_event rule (league_trade, call_placed,
 * game_action, ...) is activity: a wallet read never proves in-platform activity. Unknown rule
 * types are treated as activity too (never "qualifies").
 */
export function previewKind(rule: PlayRule): PreviewKind {
  switch (rule.type) {
    case "internal_event":
    case "mirror_match":
      return "activity";
    case "hold_any":
    case "diversified":
      return "snapshot";
    case "hold_consecutive":
      return rule.days <= 1 ? "snapshot" : "history";
    case "net_increase_days":
    case "hold_through_date":
      return "history";
    default:
      return "activity";
  }
}

function usd(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n) ? `$${Number.isInteger(n) ? n : n.toFixed(2)}` : "$0";
}

function activityNote(rule: PlayRule): string {
  if (rule.type === "mirror_match") return "Copy another wallet's portfolio and the next snapshot verifies it. Connect to take part";
  if (rule.type === "internal_event") {
    if (rule.event === "league_trade") return "Earned in the weekly competition (virtual cash). Connect to take part";
    if (rule.event === "call_placed") return "Earned by making predictions with your starter points. Connect to take part";
    if (rule.event === "game_action") return GAME_ACTION_NOTE;
    if (rule.event === "mirror_executed") return "Earned by copying a portfolio. Connect to take part";
  }
  return "Earned inside Dulo. Connect to take part";
}

function notYetNote(proof: Record<string, unknown>): string {
  switch (proof.reason) {
    case "no_in_scope_holding":
    case "no_qualifying_holding":
      return "No qualifying xStock in this wallet right now";
    case "below_min_usd":
      return `Largest position is ${usd(proof.usd)}; needs ${usd(proof.minUsd)} or more`;
    case "too_few_assets":
      return `Holds ${proof.assetCount ?? 0} of ${proof.minAssets ?? "?"} xStocks needed (each ${usd(proof.minUsd)}+)`;
    case "too_few_sectors":
      return `Covers ${proof.sectorCount ?? 0} of ${proof.minSectors ?? "?"} sectors needed`;
    case "partner_pending":
      return "Partner listing pending";
    default:
      return "Not satisfied by this wallet's holdings yet";
  }
}

/** Status + one-line note for a Play evaluated on a single live read. */
export function previewStatus(rule: PlayRule, result: EvalResult): { status: PreviewPlayStatus; note: string } {
  const kind = previewKind(rule);
  if (kind === "history") return { status: "needs_history", note: NEEDS_HISTORY_NOTE };
  if (kind === "activity") return { status: "needs_activity", note: activityNote(rule) };
  if (result.complete) return { status: "qualifies", note: QUALIFIES_NOTE };
  return { status: "not_yet", note: notYetNote(result.proof ?? {}) };
}

const KIND_ORDER: Record<PreviewKind, number> = { snapshot: 0, history: 1, activity: 2 };
/** Proof keys from a history Play's one-read evaluation that are still true and useful (the next earnings date). */
const HISTORY_PROOF_KEYS = ["nextEarningsDate", "nextEarningsSymbol", "nextEarningsHoldBy"] as const;

// ---------------------------------------------------------------------------
// Preview builder (pure)
// ---------------------------------------------------------------------------

export interface PreviewPlayRow {
  key: string;
  title: string;
  desc: string;
  points: number;
  badgeKey: string | null;
  /** Play.rule JSON; rows whose rule fails PlayRuleSchema are skipped. */
  rule: unknown;
}

export interface BuildPreviewInput {
  read: WalletHoldingsRead;
  plays: readonly PreviewPlayRow[];
  catalogue: CatalogueIndex;
  earnings: Record<string, string[]>;
  now: Date;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function quoteView(h: Holding, q: PriceQuote | undefined): PriceQuoteView {
  if (!q) {
    return { assetId: h.assetId, symbol: h.symbol, price: null, source: "none", publishedAt: null, ageSeconds: null, stale: true, marketOpen: false };
  }
  return {
    assetId: q.assetId,
    symbol: q.symbol || h.symbol,
    price: q.price,
    source: q.source,
    publishedAt: q.publishedAt ? q.publishedAt.toISOString() : null,
    ageSeconds: q.ageSeconds,
    stale: q.stale,
    marketOpen: q.marketOpen,
  };
}

/** The preview for one live read: holdings (largest first) and every Play's status. No I/O. */
export function buildPreview({ read, plays, catalogue, earnings, now }: BuildPreviewInput): PreviewResponse {
  const held = read.holdings.filter((h) => Number.isFinite(h.qty) && h.qty > 0).sort((a, b) => b.usd - a.usd || (a.symbol < b.symbol ? -1 : 1));
  const snapshot: HoldingsSnapshot = { walletId: `preview:${read.address}`, takenAt: read.readAt, holdings: held };
  const ctx: EvalContext = {
    now,
    snapshots: [snapshot],
    events: [],
    earnings,
    sectorOf: catalogue.sectorOf,
    underlyingOf: catalogue.underlyingOf,
  };

  const evaluated: Array<{ view: PreviewPlayView; order: number; index: number }> = [];
  plays.forEach((row, index) => {
    const rule = safeParsePlayRule(row.rule);
    if (!rule) return;
    const result = evaluatePlay(rule, ctx, SEASON0_ASSET_SOURCE);
    const { status, note } = previewStatus(rule, result);
    const kind = previewKind(rule);
    let proof: Record<string, unknown>;
    if (kind === "snapshot") {
      proof = { ...(result.proof ?? {}) };
    } else {
      proof = { reason: kind === "history" ? "needs_daily_snapshots" : "needs_activity", readAt: read.readAt.toISOString() };
      if (kind === "history") for (const k of HISTORY_PROOF_KEYS) if (result.proof?.[k] !== undefined) proof[k] = result.proof[k];
    }
    evaluated.push({
      order: KIND_ORDER[kind],
      index,
      view: {
        key: row.key,
        title: row.title,
        desc: row.desc,
        points: row.points,
        badgeKey: row.badgeKey,
        rule,
        status,
        note,
        proof,
        progress: kind === "snapshot" && result.progress ? result.progress : null,
      },
    });
  });
  const views = evaluated.sort((a, b) => a.order - b.order || a.index - b.index).map((e) => e.view);

  const holdings: PreviewHoldingView[] = held.map((h) => ({
    assetId: h.assetId,
    symbol: h.symbol,
    qty: h.qty,
    multiplier: h.multiplier,
    usd: round2(h.usd),
    quote: quoteView(h, read.quotes.get(h.assetId)),
  }));
  const qualifying = views.filter((v) => v.status === "qualifies");

  return {
    now: now.toISOString(),
    address: read.address,
    chainId: read.chainId,
    readAt: read.readAt.toISOString(),
    label: publicWalletLabel(read.address),
    totalUsd: round2(held.reduce((sum, h) => sum + h.usd, 0)),
    holdings,
    plays: views,
    qualifying: qualifying.length,
    qualifyingPoints: qualifying.reduce((sum, v) => sum + v.points, 0),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Active Plays of the current Season, in catalogue order. Falls back to the bundled Season 0
 * catalogue when the database is unreachable or unseeded, so a preview never needs a healthy DB.
 */
export async function loadPreviewPlays(now: Date): Promise<PreviewPlayRow[]> {
  try {
    const season = await findCurrentSeason(now);
    if (season) {
      const rows = await db.play.findMany({
        where: { isActive: true, campaign: { seasonId: season.id } },
        select: { key: true, title: true, desc: true, points: true, badgeKey: true, rule: true },
        orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
      });
      if (rows.length > 0) return rows;
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} Play list unavailable, using the catalogue: ${e instanceof Error ? e.message : String(e)}`);
  }
  return activePlays()
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.key < b.key ? -1 : 1))
    .map((p) => ({ key: p.key, title: p.title, desc: p.desc, points: p.points, badgeKey: p.badgeKey ?? null, rule: p.rule }));
}

/** Read `address` live and preview every Play. Throws when the chain, catalogue or price read fails. */
export async function getPreview(address: string, now: Date = new Date()): Promise<PreviewResponse> {
  const [{ read, assets }, plays] = await Promise.all([
    readWalletHoldings(address, SOLANA_MAINNET).then(async (read) => ({ read, assets: await xstocks.listAssets() })),
    loadPreviewPlays(now),
  ]);
  return buildPreview({ read, plays, catalogue: catalogueIndexFrom(assets), earnings: earningsCalendar(), now });
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

// The limiter and the client IP key live in lib/server/rate-limit (shared with the Mirror public read).
export { clientIp, createRateLimiter, type RateLimitDecision, type RateLimiter } from "@/lib/server/rate-limit";

export const previewIpLimiter = createRateLimiter({ limit: PREVIEW_PER_IP_PER_MINUTE, windowMs: 60_000 });
export const previewGlobalLimiter = createRateLimiter({ limit: PREVIEW_UNCACHED_PER_MINUTE, windowMs: 60_000, maxKeys: 1 });

/** Test hook: forget every rate-limit window. */
export function resetPreviewLimits(): void {
  previewIpLimiter.reset();
  previewGlobalLimiter.reset();
}
