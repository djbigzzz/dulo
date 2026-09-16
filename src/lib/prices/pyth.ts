/**
 * Pyth Hermes price source for US equities (the underlying of each xStock).
 *
 *   feed ids:  GET {HERMES}/v2/price_feeds?query=<TICKER>&asset_type=equity
 *              -> pick attributes.symbol === "Equity.US.<TICKER>/USD"  (cached 24h)
 *   prices:    GET {HERMES}/v2/updates/price/latest?ids[]=..&parsed=true
 *              -> parsed[].price = { price, conf, expo, publish_time }; usd = price × 10^expo,
 *                 parsed as the decimal string "<price>e<expo>" (see pythDecimal) so that
 *                 24567000000 / -8 is exactly 245.67 and not 245.67000000000002.
 *
 * Base URL comes from env().PYTH_HERMES_URL (default https://hermes.pyth.network). If
 * that fails we try the other known host (https://pyth.dourolabs.app/hermes) once. Requests
 * carry `Authorization: Bearer <PYTH_API_KEY>` when the key is set. This module never throws
 * from getPrices: on total failure (including 401) it returns an empty Map and lib/price
 * falls back to Jupiter.
 */
import type { AssetId, AssetInfo, PriceSource, SourceQuote } from "@/lib/core";
import { HttpError, chunk, fetchJson, mapWithConcurrency, serverEnvOrNull, warn } from "@/lib/prices/http";

export const PYTH_DEFAULT_HERMES_URL = "https://hermes.pyth.network";
export const PYTH_MIRROR_HERMES_URL = "https://pyth.dourolabs.app/hermes";

/** Verified Equity.US feed ids (hex, no 0x). Others are resolved at runtime and cached. */
export const PYTH_FEED_IDS: Readonly<Record<string, string>> = {
  TSLA: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
};

const FEED_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // positive lookups
const FEED_NEGATIVE_TTL_MS = 10 * 60 * 1000; // "no such equity feed" lookups
const LATEST_CHUNK_SIZE = 40;
const RESOLVE_CONCURRENCY = 6;

// ---------------------------------------------------------------------------
// Hermes response shapes (only the fields we read)
// ---------------------------------------------------------------------------

interface HermesPriceFeedMeta {
  id: string;
  market_hours?: { is_open?: boolean; next_open?: number | null; next_close?: number | null };
  attributes?: { symbol?: string; display_symbol?: string; asset_type?: string; [k: string]: unknown };
}

interface HermesParsedPrice {
  id: string;
  price: { price: string | number; conf: string | number; expo: number; publish_time: number };
  ema_price?: { price: string | number; conf: string | number; expo: number; publish_time: number };
}

interface HermesLatestResponse {
  parsed?: HermesParsedPrice[];
}

export interface PythPrice {
  feedId: string;
  price: number;
  /** Confidence interval in USD. */
  conf: number;
  publishedAt: Date;
}

// ---------------------------------------------------------------------------
// Base URLs
// ---------------------------------------------------------------------------

/** env().PYTH_HERMES_URL first, then whichever of the two known Hermes hosts it is not. */
function hermesBases(): string[] {
  const configured = (serverEnvOrNull()?.PYTH_HERMES_URL || PYTH_DEFAULT_HERMES_URL).replace(/\/+$/, "");
  const fallback = [PYTH_DEFAULT_HERMES_URL, PYTH_MIRROR_HERMES_URL]
    .map((u) => u.replace(/\/+$/, ""))
    .find((u) => u !== configured);
  return fallback ? [configured, fallback] : [configured];
}

/**
 * Hermes requires `Authorization: Bearer <PYTH_API_KEY>` since 26 Aug 2026 (401 otherwise).
 * Sent only when the key is configured; without it Hermes fails closed and Jupiter takes over.
 */
function hermesHeaders(): Record<string, string> {
  const key = serverEnvOrNull()?.PYTH_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/**
 * GET a Hermes path, trying the configured base first and the fallback host once on failure.
 * A "bad request" 4xx (400/404/422…) is not retried on the fallback: the request itself is wrong.
 * 401/403 (missing or bad key) is retried on the fallback and then surfaces to the caller, which
 * turns it into an empty result — never into an exception for lib/price.
 */
async function hermesGet<T>(path: string): Promise<T> {
  let lastErr: unknown;
  const headers = hermesHeaders();
  for (const base of hermesBases()) {
    try {
      return await fetchJson<T>(`${base}${path}`, { headers });
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && e.isBadRequest) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------------------------------------------------------------------------
// Feed id resolution
// ---------------------------------------------------------------------------

/** Lower-case hex without a 0x prefix. Returns null when it is not a 64-char hex id. */
export function normaliseFeedId(id: string | null | undefined): string | null {
  if (!id) return null;
  const hex = id.trim().toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

const feedCache = new Map<string, { id: string | null; expiresAt: number }>();

/** Test hook. */
export function clearPythCaches(): void {
  feedCache.clear();
}

/**
 * Resolve the Equity.US feed id for an underlying ticker (e.g. "TSLA"). Built-in map
 * first, then Hermes search, cached 24h (10 min for misses). Null when unknown/unreachable.
 */
export async function resolvePythFeedId(ticker: string): Promise<string | null> {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  const builtin = PYTH_FEED_IDS[t];
  if (builtin) return builtin;

  const now = Date.now();
  const cached = feedCache.get(t);
  if (cached && cached.expiresAt > now) return cached.id;

  const wanted = `Equity.US.${t}/USD`;
  try {
    const feeds = await hermesGet<HermesPriceFeedMeta[]>(
      `/v2/price_feeds?query=${encodeURIComponent(t)}&asset_type=equity`,
    );
    const hit = Array.isArray(feeds) ? feeds.find((f) => f.attributes?.symbol === wanted) : undefined;
    const id = hit ? normaliseFeedId(hit.id) : null;
    feedCache.set(t, { id, expiresAt: now + (id ? FEED_CACHE_TTL_MS : FEED_NEGATIVE_TTL_MS) });
    return id;
  } catch (e) {
    warn("pyth", `feed lookup failed for ${t}`, e);
    // Do not poison the cache on transport failures; a later call may succeed.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Latest prices
// ---------------------------------------------------------------------------

const INTEGER_RE = /^-?\d+$/;

/**
 * Exact decimal value of a Pyth (mantissa, expo) pair. `mantissa` must be an integer
 * (string or number), `expo` an integer; the result is the correctly rounded double of
 * the decimal `<mantissa>e<expo>`, which avoids the second rounding step of
 * `mantissa * 10 ** expo`. Null when either part is malformed or the value is not finite.
 */
export function pythDecimal(mantissa: string | number | null | undefined, expo: number | null | undefined): number | null {
  if (mantissa === null || mantissa === undefined) return null;
  const m = String(mantissa).trim();
  if (!INTEGER_RE.test(m)) return null;
  if (typeof expo !== "number" || !Number.isInteger(expo)) return null;
  const value = Number(`${m}e${expo}`);
  return Number.isFinite(value) ? value : null;
}

function parseLatest(res: HermesLatestResponse): PythPrice[] {
  const out: PythPrice[] = [];
  for (const p of res.parsed ?? []) {
    const feedId = normaliseFeedId(p.id);
    if (!feedId || !p.price) continue;
    const expo = Number(p.price.expo);
    const publishTime = Number(p.price.publish_time);
    if (!Number.isFinite(publishTime)) continue;
    const price = pythDecimal(p.price.price, expo);
    if (price === null || price <= 0) continue;
    const conf = pythDecimal(p.price.conf, expo);
    out.push({ feedId, price, conf: conf !== null && conf >= 0 ? conf : 0, publishedAt: new Date(publishTime * 1000) });
  }
  return out;
}

async function fetchLatestChunk(ids: string[]): Promise<PythPrice[]> {
  const qs = ids.map((id) => `ids[]=${encodeURIComponent(id)}`).join("&");
  try {
    const res = await hermesGet<HermesLatestResponse>(`/v2/updates/price/latest?${qs}&parsed=true`);
    return parseLatest(res);
  } catch (e) {
    // Hermes rejects the whole request when any id is unknown. Bisect so one bad id
    // cannot blank out every other quote in the chunk.
    if (e instanceof HttpError && e.isBadRequest && ids.length > 1) {
      const mid = Math.ceil(ids.length / 2);
      const [a, b] = await Promise.all([fetchLatestChunk(ids.slice(0, mid)), fetchLatestChunk(ids.slice(mid))]);
      return [...a, ...b];
    }
    warn("pyth", `latest price fetch failed for ${ids.length} id(s)`, e);
    return [];
  }
}

/** Latest Pyth prices keyed by normalised feed id. Missing/unreachable ids are simply absent. */
export async function fetchPythLatest(feedIds: readonly string[]): Promise<Map<string, PythPrice>> {
  const unique = [...new Set(feedIds.map(normaliseFeedId).filter((x): x is string => x !== null))];
  const out = new Map<string, PythPrice>();
  if (unique.length === 0) return out;
  const batches = await mapWithConcurrency(chunk(unique, LATEST_CHUNK_SIZE), 3, fetchLatestChunk);
  for (const batch of batches) for (const p of batch) out.set(p.feedId, p);
  return out;
}

// ---------------------------------------------------------------------------
// PriceSource
// ---------------------------------------------------------------------------

/** Feed id for an asset: the asset source's pythFeedId if valid, else resolved from the underlying. */
async function feedIdForAsset(asset: AssetInfo): Promise<string | null> {
  return normaliseFeedId(asset.pythFeedId) ?? (await resolvePythFeedId(asset.underlying));
}

export const pyth: PriceSource = {
  name: "pyth",
  async getPrices(assets: AssetInfo[]): Promise<Map<AssetId, SourceQuote>> {
    const out = new Map<AssetId, SourceQuote>();
    if (assets.length === 0) return out;
    try {
      const feedIds = await mapWithConcurrency(assets, RESOLVE_CONCURRENCY, feedIdForAsset);
      const latest = await fetchPythLatest(feedIds.filter((x): x is string => x !== null));
      assets.forEach((asset, i) => {
        const feedId = feedIds[i];
        if (!feedId) return;
        const p = latest.get(feedId);
        if (p) out.set(asset.assetId, { price: p.price, publishedAt: p.publishedAt });
      });
    } catch (e) {
      warn("pyth", "getPrices failed; returning no quotes", e);
    }
    return out;
  },
};
