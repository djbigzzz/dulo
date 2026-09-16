/**
 * lib/price — the only way the app obtains a price. Every quote carries source + age.
 *
 * Selection (HANDOFF §4):
 *   1. Resolve AssetInfo through the AssetSource (xstocks).
 *   2. If the US session is open AND Pyth has a quote for the underlying AND it is
 *      younger than PYTH_MAX_AGE_SECONDS (60s) -> source "pyth".
 *   3. Otherwise the Jupiter Price v3 quote for the token mint -> source "jupiter".
 *      (Pyth is not even fetched while the market is closed: it can never win.)
 *   4. Nothing quotes -> price null, source "none".
 *
 * Staleness is deliberately simple and documented: stale = ageSeconds > STALE_AFTER_SECONDS
 * (6h), and an unknown age (publishedAt null) is stale too. Pyth stamps publish_time;
 * Jupiter is dated by the estimated time of the slot its quote came from (one getSlot
 * anchor per minute, ±a few seconds; else the underlying's stockData.updatedAt, else null),
 * so a Friday-close price served on Sunday reads as ~40h old and stale instead of "12s ago".
 * The UI should still read `marketOpen` + `source` to explain a weekend price ("Jupiter
 * last swap, market closed").
 *
 * Quotes are cached in memory for CACHE_TTL_MS (30s) per assetId. A cache hit keeps the
 * original source (a cached Pyth price is still a Pyth price) and recomputes ageSeconds,
 * stale and marketOpen at serve time.
 *
 * Resilience (15 Sep review M-I). Keyless Jupiter allows ~0.5 RPS and 429s during
 * ordinary click-through; its source swallows the failure and simply returns no quote. So:
 *   - an answer without a price ("none", or a last-good fallback below) is cached only
 *     NONE_CACHE_TTL_MS (5s), so the next request retries the source almost at once instead
 *     of pinning "No price for X" for 30s;
 *   - every priced quote a source returned is remembered per assetId. When a later fetch
 *     yields no price, that last good quote is served for up to LAST_GOOD_MAX_AGE_MS (10 min)
 *     after it was fetched, with its original source and publish time, its REAL age (from
 *     publishedAt, not from when we fetched it) and stale forced to true. Anything that
 *     requires a fresh price (Calls settlement reads `!stale`) therefore never uses it.
 *     Past 10 minutes the asset reads "none" again.
 *
 * getPrices is batched: both upstream sources are called at most once per invocation for
 * the whole list of uncached ids.
 */
import type { AssetId, AssetInfo, PriceQuote, PriceSource, SourceQuote } from "@/lib/core";
import { isAssetId, parseAssetId } from "@/lib/core";
import { xstocks } from "@/lib/assets/xstocks";
import { isMarketOpen as calendarIsMarketOpen } from "@/lib/prices/calendar";
import { jupiter } from "@/lib/prices/jupiter";
import { pyth } from "@/lib/prices/pyth";

export const PYTH_MAX_AGE_SECONDS = 60;
export const STALE_AFTER_SECONDS = 6 * 60 * 60;
export const CACHE_TTL_MS = 30_000;
/** Cache lifetime of an answer that carries no fresh price (source "none" or a last-good fallback). */
export const NONE_CACHE_TTL_MS = 5_000;
/** How long after it was fetched a last good quote may stand in for a failed or throttled source. */
export const LAST_GOOD_MAX_AGE_MS = 10 * 60_000;

export class UnknownAssetError extends Error {
  constructor(public readonly ref: string) {
    super(`Unknown asset: ${ref}`);
    this.name = "UnknownAssetError";
  }
}

/** Is the US equity regular session open? Defaults to now. */
export function isMarketOpen(at: Date = new Date()): boolean {
  return calendarIsMarketOpen(at);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  quote: PriceQuote;
  cachedAt: number;
  /** CACHE_TTL_MS for a fresh upstream price, NONE_CACHE_TTL_MS for "none" / last-good answers. */
  ttlMs: number;
  /** A last-good fallback: stays stale on every cache hit, whatever its age. */
  forceStale: boolean;
}

interface LastGood {
  /** The quote as the source produced it (price non-null). */
  quote: PriceQuote;
  fetchedAt: number;
}

const cache = new Map<AssetId, CacheEntry>();
const lastGood = new Map<AssetId, LastGood>();

/** Drop every cached quote and every remembered last good quote. Test hook; also useful after a manual price-source outage. */
export function clearPriceCache(): void {
  cache.clear();
  lastGood.clear();
}

function ageOf(publishedAt: Date | null, now: Date): number | null {
  if (!publishedAt) return null;
  return Math.max(0, Math.floor((now.getTime() - publishedAt.getTime()) / 1000));
}

/**
 * Re-stamp a quote's time-dependent fields for the moment it is served. An unknown
 * publish time (ageSeconds null) is stale: we cannot vouch for a price we cannot date.
 */
function restamp(quote: PriceQuote, now: Date, marketOpen: boolean): PriceQuote {
  const ageSeconds = ageOf(quote.publishedAt, now);
  return {
    ...quote,
    ageSeconds,
    stale: quote.price === null || ageSeconds === null || ageSeconds > STALE_AFTER_SECONDS,
    marketOpen,
  };
}

function noneQuote(assetId: AssetId, symbol: string, marketOpen: boolean): PriceQuote {
  return {
    assetId,
    symbol,
    price: null,
    source: "none",
    publishedAt: null,
    ageSeconds: null,
    stale: true,
    marketOpen,
  };
}

/**
 * A remembered quote served because the source gave nothing this time: same price, source and
 * publish time, real age at serve time, always stale. Cached for NONE_CACHE_TTL_MS with
 * `forceStale`, so a cache hit keeps it stale too.
 */
function lastGoodQuote(quote: PriceQuote, now: Date, marketOpen: boolean): PriceQuote {
  return { ...restamp(quote, now, marketOpen), stale: true };
}

function fallbackSymbol(assetId: string): string {
  try {
    return parseAssetId(assetId).assetReference;
  } catch {
    return assetId;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Quote one asset. Never throws for an unknown asset: returns source "none". */
export async function getPrice(assetId: AssetId): Promise<PriceQuote> {
  const m = await getPrices([assetId]);
  return m.get(assetId) ?? noneQuote(assetId, fallbackSymbol(assetId), isMarketOpen());
}

/** Quote by xStocks symbol (e.g. "TSLAx"). Throws UnknownAssetError when the symbol is not in the catalogue. */
export async function getPriceBySymbol(symbol: string): Promise<PriceQuote> {
  const { quotes, unknown } = await getPricesBySymbols([symbol]);
  if (unknown.length > 0 || quotes.length === 0) throw new UnknownAssetError(symbol);
  return quotes[0];
}

/** Batch quote by symbol. Unknown symbols are reported, not thrown. */
export async function getPricesBySymbols(
  symbols: readonly string[],
): Promise<{ quotes: PriceQuote[]; unknown: string[] }> {
  const unique = [...new Set(symbols.map((s) => s.trim()).filter(Boolean))];
  const unknown: string[] = [];
  const idBySymbol = new Map<string, AssetId>();
  await Promise.all(
    unique.map(async (sym) => {
      const info = await safeGetAssetBySymbol(sym);
      if (info) idBySymbol.set(sym, info.assetId);
      else unknown.push(sym);
    }),
  );
  const ids = [...new Set(idBySymbol.values())];
  const quoted = ids.length ? await getPrices(ids) : new Map<AssetId, PriceQuote>();
  const quotes: PriceQuote[] = [];
  const seen = new Set<AssetId>();
  for (const sym of unique) {
    const id = idBySymbol.get(sym);
    if (!id || seen.has(id)) continue;
    const q = quoted.get(id);
    if (q) {
      quotes.push(q);
      seen.add(id);
    }
  }
  return { quotes, unknown };
}

/**
 * Batch quote. Both sources are fetched at most once for the whole set of uncached ids.
 * Every requested id is present in the result (unknown ids as source "none").
 */
export async function getPrices(assetIds: readonly AssetId[]): Promise<Map<AssetId, PriceQuote>> {
  const now = new Date();
  const marketOpen = isMarketOpen(now);
  const result = new Map<AssetId, PriceQuote>();
  const unique = [...new Set(assetIds)];
  if (unique.length === 0) return result;

  // 1. Serve cache hits; collect misses.
  const misses: AssetId[] = [];
  for (const id of unique) {
    const hit = cache.get(id);
    if (hit && now.getTime() - hit.cachedAt < hit.ttlMs) {
      const served = restamp(hit.quote, now, marketOpen);
      result.set(id, hit.forceStale ? { ...served, stale: true } : served);
    } else {
      misses.push(id);
    }
  }
  if (misses.length === 0) return result;

  // 2. Resolve asset metadata through the AssetSource.
  const infos = await Promise.all(misses.map((id) => safeGetAsset(id)));
  const known: AssetInfo[] = [];
  misses.forEach((id, i) => {
    const info = infos[i];
    if (info) known.push(info);
    else result.set(id, noneQuote(id, fallbackSymbol(id), marketOpen));
  });

  // 3. Fetch upstream once for the whole batch. Pyth only matters while the market is open.
  const [pythQuotes, jupiterQuotes] = await Promise.all([
    marketOpen && known.length ? safeSource(pyth, known) : Promise.resolve(emptySourceMap()),
    known.length ? safeSource(jupiter, known) : Promise.resolve(emptySourceMap()),
  ]);

  // 4. Select per asset and cache. A missing price falls back to the last good quote (<= 10 min).
  const nowMs = now.getTime();
  for (const info of known) {
    const p = pythQuotes.get(info.assetId);
    const pythAge = p ? ageOf(p.publishedAt, now) : null;
    let quote: PriceQuote;
    if (marketOpen && p && pythAge !== null && pythAge < PYTH_MAX_AGE_SECONDS) {
      quote = restamp(
        { assetId: info.assetId, symbol: info.symbol, price: p.price, source: "pyth", publishedAt: p.publishedAt, ageSeconds: null, stale: false, marketOpen },
        now,
        marketOpen,
      );
    } else {
      const j = jupiterQuotes.get(info.assetId);
      quote = j
        ? restamp(
            { assetId: info.assetId, symbol: info.symbol, price: j.price, source: "jupiter", publishedAt: j.publishedAt, ageSeconds: null, stale: false, marketOpen },
            now,
            marketOpen,
          )
        : noneQuote(info.assetId, info.symbol, marketOpen);
    }
    let ttlMs = CACHE_TTL_MS;
    let forceStale = false;
    if (quote.price !== null) {
      lastGood.set(info.assetId, { quote, fetchedAt: nowMs });
    } else {
      ttlMs = NONE_CACHE_TTL_MS;
      const good = lastGood.get(info.assetId);
      if (good && nowMs - good.fetchedAt <= LAST_GOOD_MAX_AGE_MS) {
        quote = lastGoodQuote(good.quote, now, marketOpen);
        forceStale = true;
      } else if (good) {
        lastGood.delete(info.assetId);
      }
    }
    cache.set(info.assetId, { quote, cachedAt: nowMs, ttlMs, forceStale });
    result.set(info.assetId, quote);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Upstream guards — a source or catalogue outage must degrade to "none", not a 500.
// ---------------------------------------------------------------------------

type SourceMap = Map<AssetId, SourceQuote>;

function emptySourceMap(): SourceMap {
  return new Map();
}

/** Sources promise never to throw; hold them to it anyway. */
async function safeSource(source: PriceSource, assets: AssetInfo[]): Promise<SourceMap> {
  try {
    return await source.getPrices(assets);
  } catch (e) {
    console.warn(`[price] source ${source.name} failed: ${e instanceof Error ? e.message : String(e)}`);
    return emptySourceMap();
  }
}

async function safeGetAsset(assetId: AssetId): Promise<AssetInfo | null> {
  if (!isAssetId(assetId)) return null;
  try {
    return await xstocks.getAsset(assetId);
  } catch (e) {
    console.warn(`[price] asset lookup failed for ${assetId}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function safeGetAssetBySymbol(symbol: string): Promise<AssetInfo | null> {
  try {
    return await xstocks.getAssetBySymbol(symbol);
  } catch (e) {
    console.warn(`[price] symbol lookup failed for ${symbol}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
