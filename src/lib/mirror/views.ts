/**
 * Wire shaping for /api/v1/mirror/** (docs/HANDOFF.md §3.4). Server-only.
 *
 * getMirrorView(wallet, userId)   the target (from lib/server/queries.getMirrorTarget: a Dulo
 *                                 wallet's snapshot or paper portfolio, or a live public read),
 *                                 one PriceQuote per leg so the page can show source/age,
 *                                 and `stale` when any leg's quote is stale.
 * getMirrorIndex()                mirrorable wallets: top Season leaderboard rows, model
 *                                 portfolios (League accounts, paper) and the curated public
 *                                 wallets on Solana (not Dulo players, never scored).
 * mirrorTolerance()               the mirror_match tolerance from the Play row (0.2 default).
 * publicReadApiError(e)           PublicWalletReadError -> ApiError(503) for the routes.
 */
import type { AssetId, PriceQuote } from "@/lib/core";
import { isAssetId } from "@/lib/core";
import { getPrices } from "@/lib/price";
import { ApiError } from "@/lib/server/api";
import { db } from "@/lib/server/db";
import { getMirrorTarget, listMirrorTargets } from "@/lib/server/queries";
import { createRateLimiter } from "@/lib/server/rate-limit";
import type { MirrorIndexResponse, MirrorPublicRow, MirrorResponse, PriceQuoteView } from "@/lib/api-client";
import { USDC_MINT } from "./allocation";
import { MIRROR_PLAY_KEY } from "./events";
import { PublicWalletReadError, listPublicMirrorRows } from "./public";
import { PUBLIC_WALLETS } from "./public-wallets";

export const DEFAULT_MIRROR_TOLERANCE = 0.2;

export function toQuoteView(q: PriceQuote): PriceQuoteView {
  return {
    assetId: q.assetId,
    symbol: q.symbol,
    price: q.price,
    source: q.source,
    publishedAt: q.publishedAt ? q.publishedAt.toISOString() : null,
    ageSeconds: q.ageSeconds,
    stale: q.stale,
    marketOpen: q.marketOpen,
  };
}

/** The Mirror Play's tolerance (fraction). Falls back to 0.2 when the Play is missing or malformed. */
export async function mirrorTolerance(): Promise<number> {
  try {
    const play = await db.play.findUnique({ where: { key: MIRROR_PLAY_KEY }, select: { rule: true } });
    const rule = play?.rule;
    if (rule && typeof rule === "object" && !Array.isArray(rule)) {
      const t = (rule as { tolerance?: unknown }).tolerance;
      if (typeof t === "number" && Number.isFinite(t) && t >= 0 && t <= 1) return t;
    }
  } catch {
    // fall through
  }
  return DEFAULT_MIRROR_TOLERANCE;
}

/** A failed or refused public wallet read as the API error the routes return (503 + Retry-After semantics in the message). */
export function publicReadApiError(e: unknown): ApiError | null {
  if (!(e instanceof PublicWalletReadError)) return null;
  return new ApiError(e.message, e.kind === "limited" ? 429 : 503);
}

/** Uncached public Mirror reads one client IP may start per minute (per server instance). */
export const MIRROR_PUBLIC_PER_IP_PER_MINUTE = 10;
export const mirrorPublicIpLimiter = createRateLimiter({ limit: MIRROR_PUBLIC_PER_IP_PER_MINUTE, windowMs: 60_000 });

/**
 * The beforeUncachedRead hook for one caller: takes a slot from that IP's window and throws
 * PublicWalletReadError("limited") when it is spent, before the shared budget is touched.
 */
export function publicReadIpGate(ipKey: string): () => void {
  return () => {
    const decision = mirrorPublicIpLimiter.take(ipKey);
    if (!decision.ok) {
      throw new PublicWalletReadError("limited", "Too many wallet lookups from this connection. Try again in a minute.", decision.retryAfterSeconds);
    }
  };
}

export interface MirrorViewOptions {
  /** See ReadPublicWalletOptions.beforeUncachedRead (the route passes publicReadIpGate). */
  beforeUncachedRead?: () => void;
}

/**
 * Everything /mirror/[wallet] renders. Null when a Dulo wallet has nothing to mirror or the
 * address is invalid. Throws PublicWalletReadError when a public wallet cannot be read.
 */
export async function getMirrorView(
  walletAddress: string,
  userId: string | null,
  now: Date = new Date(),
  opts: MirrorViewOptions = {},
): Promise<MirrorResponse | null> {
  const target = await getMirrorTarget(walletAddress, now, { beforeUncachedRead: opts.beforeUncachedRead });
  if (!target) return null;

  const ids = target.legs.map((l) => l.assetId).filter(isAssetId) as AssetId[];
  const quoted = ids.length > 0 ? await getPrices(ids) : new Map<AssetId, PriceQuote>();
  const quotes: PriceQuoteView[] = [];
  let stale = false;
  for (const leg of target.legs) {
    const q = isAssetId(leg.assetId) ? quoted.get(leg.assetId) : undefined;
    if (q) quotes.push(toQuoteView(q));
    if (!q || q.stale) stale = true;
  }
  const tolerance = await mirrorTolerance();

  return { now: now.toISOString(), signedIn: userId !== null, target, quotes, stale, usdcMint: USDC_MINT, tolerance };
}

/** Curated public wallets that have since signed in to Dulo (they show up as players instead). Never throws. */
async function curatedDuloWallets(): Promise<Set<string>> {
  if (PUBLIC_WALLETS.length === 0) return new Set();
  try {
    const rows = await db.wallet.findMany({ where: { address: { in: PUBLIC_WALLETS.map((w) => w.address) } }, select: { address: true } });
    return new Set(rows.map((r) => r.address));
  } catch {
    return new Set();
  }
}

/** The /mirror index. */
export async function getMirrorIndex(now: Date = new Date(), opts: { publicWaitMs?: number } = {}): Promise<MirrorIndexResponse> {
  const [{ leaderboard, league }, publicRows] = await Promise.all([
    listMirrorTargets(now),
    curatedDuloWallets().then(
      (exclude) => listPublicMirrorRows({ waitMs: opts.publicWaitMs, exclude }),
      (): MirrorPublicRow[] => [],
    ),
  ]);
  return { now: now.toISOString(), leaderboard, league, public: publicRows };
}
