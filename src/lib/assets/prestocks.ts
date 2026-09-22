/**
 * PreStocks AssetSource — tokenized pre-IPO exposure on Solana, the second issuer behind the
 * AssetSource interface and the only place that talks to the PreStocks API. Server-side.
 *
 * Catalogue
 *   GET https://prestocks.com/api/prestocks
 *   -> PreStocksToken[]  { name, symbol, description, image, external_url, contract_address,
 *                          markPrice, tokenPrice, supply, ... }   (8 tokens on 22 Sep 2026)
 *   No auth, no CORS header (server-side only), no rate-limit headers. Fetched with a 10s
 *   timeout. contract_address is the Token-2022 mint: 9 decimals with a ScaledUiAmount
 *   extension (PRESTOCKS_DECIMALS_OVERRIDES exists for the day that stops being true).
 *
 * Static catalogue: PRESTOCKS_STATIC inlines the eight tokens (symbol, name, mint, logo) read
 * from the live API on 22 Sep 2026, so mintSet(), getAsset() and getAssetBySymbol() never depend
 * on the network. A live fetch can only ADD tokens: a token in the static list stays in the mint
 * set even when the API omits it, so a holder's balance never silently vanishes from a snapshot.
 *
 * Cache: in-memory, 1h TTL, stale-while-revalidate. Lookups (getAsset, getAssetBySymbol,
 * mintSet) serve the cached-or-static catalogue and never start a request. listAssets serves the
 * same at once and refreshes in the background once the catalogue is stale (retries rate-limited
 * to one per 30s); the cron warms it every tick, so lookups see a catalogue at most ~1h old.
 * getPreStocksMarks awaits one fetch when nothing fresh is cached, because the issuer mark and
 * the DEX price only exist in the live payload. Nothing here throws to a caller.
 *
 * AssetInfo: symbol = API symbol ("SPACEX"), underlying = the same symbol (there is no listed
 * ticker), sector null (NOT sectorFor(): "Other" is a real sector string and would inflate Sector
 * Spread), pythFeedId null (no Pyth feed exists; lib/price never asks Hermes for these), and
 * multiplier 1: the Token-2022 ScaledUiAmount multiplier comes from the chain through the
 * ChainAdapter at snapshot time (RawTokenBalance.multiplier), exactly as it does for xStocks.
 * Jupiter's scaledUiConfig block is a cross-check (tests/prestocks-multiplier.test.ts), never
 * the source.
 *
 * Testing: configurePreStocks / setPreStocksFetch inject fetch, clock, URL and TTLs;
 * resetPreStocks clears caches and options. Nothing here touches the network at import.
 */
import type { AssetId, AssetInfo, AssetSource } from "@/lib/core";
import { SOLANA_MAINNET, isAssetId, mintFromAssetId, solanaTokenAssetId } from "@/lib/core";
import { normaliseQty as normaliseQtyImpl } from "./normalise";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PRESTOCKS_SOURCE_NAME = "prestocks";
export const PRESTOCKS_DEFAULT_API_URL = "https://prestocks.com/api/prestocks";
export const PRESTOCKS_DECIMALS = 9;
export const PRESTOCKS_LOGO_BASE = "https://www.prestocks.com/logos";
export const CATALOGUE_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_TIMEOUT_MS = 10_000;
/** Minimum gap between two refresh attempts while the catalogue is stale or fallback. */
export const REFRESH_RETRY_MS = 30_000;

/** Mint -> decimals for any PreStocks token that is not 9 decimals. None known today. */
export const PRESTOCKS_DECIMALS_OVERRIDES: Readonly<Record<string, number>> = Object.freeze({});

const LOG_PREFIX = "[assets/prestocks]";
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ---------------------------------------------------------------------------
// API shape (only the fields we read; everything else is passed through)
// ---------------------------------------------------------------------------

export interface PreStocksToken {
  /** e.g. "SpaceX PreStocks" */
  name: string;
  /** e.g. "SPACEX" */
  symbol: string;
  description?: string | null;
  /** Logo URL. */
  image?: string | null;
  external_url?: string | null;
  /** The Token-2022 mint on Solana mainnet. */
  contract_address: string;
  /** Issuer SPV mark in USD. */
  markPrice?: number | string | null;
  /** DEX price in USD. */
  tokenPrice?: number | string | null;
  supply?: number | string | null;
  [k: string]: unknown;
}

/** The two prices the issuer publishes for one token. They differ and are shown as two things. */
export interface PreStocksMark {
  symbol: string;
  /** Issuer SPV mark (USD); null when the API did not give a positive number. */
  markPrice: number | null;
  /** DEX price as the issuer reports it (USD); null when absent. The app's own quote comes from lib/price. */
  tokenPrice: number | null;
  /** When the payload was fetched. */
  fetchedAt: Date;
}

// ---------------------------------------------------------------------------
// Options / injection
// ---------------------------------------------------------------------------

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PreStocksOptions {
  /** Defaults to globalThis.fetch. Tests inject a fake. */
  fetch: FetchLike | null;
  /** Clock in ms. Defaults to Date.now. */
  now: () => number;
  apiUrl: string;
  timeoutMs: number;
  catalogueTtlMs: number;
  refreshRetryMs: number;
  decimalsOverrides: Readonly<Record<string, number>>;
  /** Entries served before the first live fetch and whenever it fails. Defaults to the inlined eight. */
  staticEntries: readonly PreStocksStaticEntry[];
}

export interface PreStocksStaticEntry {
  symbol: string;
  name: string;
  mint: string;
  /** Only when the API's image is not `${PRESTOCKS_LOGO_BASE}/${symbol.toLowerCase()}.png`. */
  logo?: string;
}

/**
 * The eight PreStocks tokens on Solana mainnet, read from the live API on 22 Sep 2026
 * (tests/fixtures/prestocks-api-2026-09-22.json). Every mint starts with "Pre". Never add an
 * address here that has not been verified against the API.
 */
export const PRESTOCKS_STATIC: readonly PreStocksStaticEntry[] = Object.freeze([
  { symbol: "ANDURIL", name: "Anduril PreStocks", mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB" },
  { symbol: "ANTHROPIC", name: "Anthropic PreStocks", mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw" },
  { symbol: "FIGUREAI", name: "Figure AI PreStocks", mint: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd" },
  { symbol: "KALSHI", name: "Kalshi PreStocks", mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua" },
  { symbol: "NEURALINK", name: "Neuralink PreStocks", mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S" },
  { symbol: "OPENAI", name: "OpenAI PreStocks", mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF" },
  { symbol: "POLYMARKET", name: "Polymarket PreStocks", mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP" },
  { symbol: "SPACEX", name: "SpaceX PreStocks", mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh" },
]);

function defaultOptions(): PreStocksOptions {
  return {
    fetch: null,
    now: Date.now,
    apiUrl: PRESTOCKS_DEFAULT_API_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    catalogueTtlMs: CATALOGUE_TTL_MS,
    refreshRetryMs: REFRESH_RETRY_MS,
    decimalsOverrides: PRESTOCKS_DECIMALS_OVERRIDES,
    staticEntries: PRESTOCKS_STATIC,
  };
}

let options: PreStocksOptions = defaultOptions();

/** Patch module options (fetch, clock, URL, TTLs). Caches are untouched. */
export function configurePreStocks(patch: Partial<PreStocksOptions>): void {
  options = { ...options, ...patch };
}

/** Inject the fetch implementation (null restores globalThis.fetch). */
export function setPreStocksFetch(fn: FetchLike | null): void {
  options = { ...options, fetch: fn };
}

/** Clear every cache and restore default options. Test hook. */
export function resetPreStocks(): void {
  options = defaultOptions();
  catalogue = null;
  inflight = null;
  lastAttemptAt = Number.NEGATIVE_INFINITY;
}

function fetchImpl(): FetchLike {
  if (options.fetch) return options.fetch;
  const f = globalThis.fetch;
  if (typeof f !== "function") throw new Error("fetch is not available in this runtime");
  return (input, init) => f(input, init);
}

function warn(message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err !== undefined ? String(err) : "";
  console.warn(`${LOG_PREFIX} ${message}${detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export class PreStocksHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = "PreStocksHttpError";
  }
}

/** GET the catalogue with an AbortController timeout. Throws on non-2xx / timeout / bad JSON. */
async function getJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs);
  try {
    const res = await fetchImpl()(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new PreStocksHttpError(res.status, url);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Pure mapping
// ---------------------------------------------------------------------------

function keyOf(s: string): string {
  return String(s ?? "").trim().toUpperCase();
}

function toPositiveFinite(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/** The logo URL the API serves for a symbol ("SPACEX" -> .../logos/spacex.png). */
export function preStocksLogoUrl(symbol: string): string {
  return `${PRESTOCKS_LOGO_BASE}/${encodeURIComponent(symbol.trim().toLowerCase())}.png`;
}

/**
 * Map one API token to AssetInfo. Returns null when the token has no symbol or a mint that
 * cannot form a CAIP-19 id.
 */
export function assetInfoFromToken(
  token: PreStocksToken,
  decimalsOverrides: Readonly<Record<string, number>> = options.decimalsOverrides,
): AssetInfo | null {
  if (!token || typeof token !== "object") return null;
  const symbol = typeof token.symbol === "string" ? token.symbol.trim() : "";
  if (!symbol) return null;
  const mint = typeof token.contract_address === "string" ? token.contract_address.trim() : "";
  if (!BASE58_RE.test(mint)) return null;
  let assetId: AssetId;
  try {
    assetId = solanaTokenAssetId(mint, SOLANA_MAINNET);
  } catch {
    return null;
  }
  const name = typeof token.name === "string" && token.name.trim() ? token.name.trim() : `${symbol} PreStocks`;
  const logo = typeof token.image === "string" && token.image.trim() ? token.image.trim() : preStocksLogoUrl(symbol);
  return {
    assetId,
    chainId: SOLANA_MAINNET,
    symbol,
    underlying: symbol,
    name,
    decimals: decimalsOverrides[mint] ?? PRESTOCKS_DECIMALS,
    sector: null,
    logoUrl: logo,
    pythFeedId: null,
    multiplier: 1,
  };
}

/** Pure mapping of API tokens to AssetInfo. Invalid rows are dropped; a duplicated mint keeps its first occurrence. */
export function listAssetsFromTokens(
  tokens: readonly PreStocksToken[],
  decimalsOverrides: Readonly<Record<string, number>> = options.decimalsOverrides,
): AssetInfo[] {
  const out: AssetInfo[] = [];
  const seen = new Set<AssetId>();
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const info = assetInfoFromToken(token, decimalsOverrides);
    if (!info || seen.has(info.assetId)) continue;
    seen.add(info.assetId);
    out.push(info);
  }
  return out;
}

/** The marks of every valid token, keyed by symbol. A missing or non-positive price is null, never 0. */
export function marksFromTokens(tokens: readonly PreStocksToken[], fetchedAt: Date): Map<string, PreStocksMark> {
  const out = new Map<string, PreStocksMark>();
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const info = assetInfoFromToken(token, {});
    if (!info || out.has(info.symbol)) continue;
    out.set(info.symbol, {
      symbol: info.symbol,
      markPrice: toPositiveFinite(token.markPrice),
      tokenPrice: toPositiveFinite(token.tokenPrice),
      fetchedAt,
    });
  }
  return out;
}

/** Static entries expressed as API tokens so they flow through the same mapping. */
export function entriesToTokens(entries: readonly PreStocksStaticEntry[]): PreStocksToken[] {
  return entries.map((e) => ({
    name: e.name,
    symbol: e.symbol,
    image: e.logo ?? preStocksLogoUrl(e.symbol),
    contract_address: e.mint,
  }));
}

/** The configured static entries (the inlined eight unless a test injected others) as API tokens. */
export function staticTokens(): PreStocksToken[] {
  return entriesToTokens(options.staticEntries);
}

// ---------------------------------------------------------------------------
// Catalogue cache (stale-while-revalidate)
// ---------------------------------------------------------------------------

/**
 * "api": fetched live (plus any static token the API omitted). "static": the inlined list, first
 * live fetch pending. "fallback": the inlined list, served because a live fetch failed.
 */
export type PreStocksCatalogueOrigin = "api" | "static" | "fallback";

interface Catalogue {
  assets: AssetInfo[];
  byId: Map<AssetId, AssetInfo>;
  bySymbol: Map<string, AssetInfo>;
  byMint: Map<string, AssetInfo>;
  mints: ReadonlySet<string>;
  /** Only a live payload carries marks; the static catalogue has none. */
  marks: Map<string, PreStocksMark>;
  /** ms clock value when fetched; 0 for the static list (always stale). */
  fetchedAt: number;
  origin: PreStocksCatalogueOrigin;
}

let catalogue: Catalogue | null = null;
let inflight: Promise<Catalogue | null> | null = null;
let lastAttemptAt = Number.NEGATIVE_INFINITY;

function buildCatalogue(assets: AssetInfo[], marks: Map<string, PreStocksMark>, fetchedAt: number, origin: PreStocksCatalogueOrigin): Catalogue {
  const byId = new Map<AssetId, AssetInfo>();
  const bySymbol = new Map<string, AssetInfo>();
  const byMint = new Map<string, AssetInfo>();
  for (const a of assets) {
    byId.set(a.assetId, a);
    const sym = keyOf(a.symbol);
    if (!bySymbol.has(sym)) bySymbol.set(sym, a);
    try {
      byMint.set(mintFromAssetId(a.assetId), a);
    } catch {
      // not a Solana token id; cannot happen for tokens we produced, but never trust it
    }
  }
  return { assets, byId, bySymbol, byMint, mints: new Set(byMint.keys()), marks, fetchedAt, origin };
}

function staticCatalogue(origin: "static" | "fallback"): Catalogue {
  return buildCatalogue(listAssetsFromTokens(staticTokens(), options.decimalsOverrides), new Map(), 0, origin);
}

/** The catalogue in hand: the cache, else the static list (never null, never a request). */
function current(): Catalogue {
  if (!catalogue) catalogue = staticCatalogue("static");
  return catalogue;
}

function isFresh(c: Catalogue, now: number): boolean {
  return c.origin === "api" && now - c.fetchedAt < options.catalogueTtlMs;
}

/** Fetch the catalogue once. Throws on transport failure or a malformed body. */
export async function fetchAllTokens(): Promise<PreStocksToken[]> {
  const body = await getJson<unknown>(options.apiUrl);
  if (!Array.isArray(body)) throw new Error(`unexpected catalogue shape from ${options.apiUrl}`);
  return body as PreStocksToken[];
}

/**
 * Refresh the catalogue from the API: the live tokens, plus every static token the API omitted
 * (a live fetch can only add). Resolves to the new catalogue, or null on failure (logged; the
 * previous catalogue is left in place). Concurrent callers share one flight.
 */
function refresh(): Promise<Catalogue | null> {
  if (inflight) return inflight;
  lastAttemptAt = options.now();
  inflight = (async () => {
    try {
      const tokens = await fetchAllTokens();
      const live = listAssetsFromTokens(tokens, options.decimalsOverrides);
      if (live.length === 0) throw new Error("catalogue contained no valid tokens");
      const seen = new Set(live.map((a) => a.assetId));
      const kept = listAssetsFromTokens(staticTokens(), options.decimalsOverrides).filter((a) => !seen.has(a.assetId));
      if (kept.length > 0) warn(`API omitted ${kept.length} static token(s) (${kept.map((a) => a.symbol).join(", ")}); keeping them in the mint set`);
      const now = options.now();
      catalogue = buildCatalogue([...live, ...kept], marksFromTokens(tokens, new Date(now)), now, "api");
      return catalogue;
    } catch (e) {
      const served = current();
      if (served.origin === "static") catalogue = { ...served, origin: "fallback" };
      warn(served.origin === "api" ? "catalogue refresh failed; serving the cached catalogue" : "catalogue fetch failed; serving the static catalogue", e);
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * The catalogue for a caller that may start a refresh. Fresh -> serve. Otherwise start a refresh
 * (rate-limited) and either serve what is in hand at once (`awaitRefresh` false) or wait for the
 * flight and serve its result, falling back to what is in hand.
 */
async function ensureCatalogue(awaitRefresh: boolean): Promise<Catalogue> {
  const now = options.now();
  const c = current();
  if (isFresh(c, now)) return c;
  if (!inflight && now - lastAttemptAt >= options.refreshRetryMs) {
    void refresh().catch(() => null);
  }
  if (awaitRefresh && inflight) {
    const fetched = await inflight;
    return fetched ?? current();
  }
  return c;
}

/** Resolve once no refresh is in flight. Test hook for the background path. */
export async function waitForPreStocksRefresh(): Promise<void> {
  while (inflight) await inflight;
}

/** Where the currently served catalogue came from (null before the first load). */
export function preStocksCatalogueOrigin(): PreStocksCatalogueOrigin | null {
  return catalogue?.origin ?? null;
}

/** Force a refresh now and report whether it succeeded. Cron/admin hook. */
export async function refreshPreStocksCatalogue(): Promise<boolean> {
  return (await refresh()) !== null;
}

// ---------------------------------------------------------------------------
// AssetSource
// ---------------------------------------------------------------------------

/** Re-exported for the AssetSource contract: qty = raw / 10^decimals * multiplier. */
export const normaliseQty = normaliseQtyImpl;

export const prestocks: AssetSource = {
  name: PRESTOCKS_SOURCE_NAME,

  async listAssets(): Promise<AssetInfo[]> {
    try {
      return (await ensureCatalogue(false)).assets;
    } catch (e) {
      // ensureCatalogue already degrades to the static list; this is belt and braces.
      warn("listAssets failed unexpectedly; serving the static catalogue", e);
      return listAssetsFromTokens(staticTokens(), options.decimalsOverrides);
    }
  },

  async getAsset(assetId: AssetId): Promise<AssetInfo | null> {
    if (typeof assetId !== "string" || !isAssetId(assetId)) return null;
    return current().byId.get(assetId) ?? null;
  },

  async getAssetBySymbol(symbol: string): Promise<AssetInfo | null> {
    if (typeof symbol !== "string") return null;
    const key = keyOf(symbol);
    if (!key) return null;
    return current().bySymbol.get(key) ?? null;
  },

  async mintSet(): Promise<ReadonlySet<string>> {
    return current().mints;
  },

  normaliseQty(amountRaw: string, decimals: number, multiplier: number): number {
    return normaliseQtyImpl(amountRaw, decimals, multiplier);
  },
};

/** Look a PreStocks token up by its Solana mint address. Never a request. */
export async function getPreStocksByMint(mint: string): Promise<AssetInfo | null> {
  if (typeof mint !== "string" || !mint.trim()) return null;
  return current().byMint.get(mint.trim()) ?? null;
}

/**
 * Issuer mark and DEX price per symbol from the cached payload (one fetch when nothing fresh is
 * cached, 1h TTL). Empty when the API has never answered; on a failed refresh the last good
 * payload's marks are served with their original fetchedAt so a panel can show the age. Never throws.
 */
export async function getPreStocksMarks(): Promise<Map<string, PreStocksMark>> {
  try {
    return new Map((await ensureCatalogue(true)).marks);
  } catch (e) {
    warn("getPreStocksMarks failed unexpectedly; serving no marks", e);
    return new Map();
  }
}
