/**
 * xStocks AssetSource — the catalogue of tokenised stocks on Solana and the only
 * place that talks to the xStocks public API. Server-side (reads env() lazily).
 *
 * Catalogue
 *   GET {XSTOCKS_API_URL}/assets?page=N          (0-indexed, 100 nodes per page)
 *   -> { nodes: XStocksNode[], page: { currentPage, hasNextPage } }
 *   The API reports no page count (9 pages / 832 nodes on 15 Sep 2026; pages past the end
 *   answer 200 with no nodes), so pages are fetched in order with up to PAGE_CONCURRENCY (4)
 *   in flight until one says hasNextPage false. At most 3 speculative requests land past the
 *   end and their outcome is ignored; ANY failure at or before the last page fails the whole
 *   fetch, so a partial catalogue never replaces a good one. Only nodes with a "Solana"
 *   deployment are kept; the mint is that deployment's address. The API carries no sector
 *   field, so the sector comes from ./sectors keyed by the underlying ticker. xStocks mints
 *   are Token-2022 with 8 decimals (XSTOCKS_DECIMALS_OVERRIDES exists for the day that stops
 *   being true).
 *
 * Bundled catalogue: ./xstocks-catalogue.json holds every Solana xStock (symbol, underlying,
 * name, mint), generated from the live API by `npm run catalogue:build`
 * (scripts/build-xstocks-catalogue.ts). It is the initial stale-while-revalidate seed: a cold
 * process serves it at once (origin "bundle") and refreshes from the API in the background,
 * so the first request never waits ~8s on nine pages. If that refresh fails, the bundle keeps
 * being served (origin "fallback") and retries every 30s. Before the bundle existed the
 * fallback was XSTOCKS_FALLBACK's 30 mints, which silently dropped most holdings of a real
 * wallet; XSTOCKS_FALLBACK stays as the verified tradable shortlist the League seeds from.
 *
 * Cache: in-memory, 1h TTL, stale-while-revalidate. A stale catalogue is served at once and
 * refreshed in the background (retries rate-limited to one per 30s). A failed refresh keeps
 * the old catalogue; so does a "successful" one that would shrink a catalogue of 100+ assets
 * by more than half (a truncated response, not a real delisting). listAssets never throws.
 *
 * Multiplier
 *   GET {XSTOCKS_API_URL}/assets/{symbol}/multiplier?network=Solana
 *   -> { currentMultiplier, newMultiplier, activationDateTime, reason }
 *   The endpoint only answers to the SYMBOL (a mint 404s), so getMultiplier resolves a
 *   mint or CAIP-19 id to its symbol through the catalogue first. Cached 10 minutes,
 *   failures default to 1 (cached 1 minute so an outage is not re-hit per holding).
 *
 * Testing: setXstocksFetch / configureXstocks inject fetch, clock, base URL, TTLs, page
 * concurrency, the bundle and whether it seeds the cache (`seedFromBundle: false` restores the
 * await-the-API cold start); resetXstocks clears caches and options. Nothing here touches the
 * network at import.
 */
import type { AssetId, AssetInfo, AssetSource } from "@/lib/core";
import { SOLANA_MAINNET, isAssetId, mintFromAssetId, solanaTokenAssetId } from "@/lib/core";
import { env } from "@/lib/server/env";
import { normaliseQty as normaliseQtyImpl } from "./normalise";
import { sectorFor } from "./sectors";
import catalogueBundleJson from "./xstocks-catalogue.json";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const XSTOCKS_DEFAULT_API_URL = "https://api.xstocks.fi/api/v2/public";
export const XSTOCKS_DECIMALS = 8;
export const XSTOCKS_LOGO_BASE = "https://xstocks-metadata.backed.fi/logos/tokens";
export const CATALOGUE_TTL_MS = 60 * 60 * 1000;
export const MULTIPLIER_TTL_MS = 10 * 60 * 1000;
export const MULTIPLIER_FAILURE_TTL_MS = 60 * 1000;
export const DEFAULT_TIMEOUT_MS = 10_000;
/** Minimum gap between two refresh attempts while the catalogue is stale or fallback. */
export const REFRESH_RETRY_MS = 30_000;
/** Hard stop for pagination in case the API ever reports hasNextPage forever. */
export const MAX_PAGES = 50;
/** Catalogue pages in flight at once. */
export const PAGE_CONCURRENCY = 4;
/** A refresh may not shrink a catalogue of at least SHRINK_GUARD_MIN_ASSETS by more than this fraction. */
export const SHRINK_GUARD_MAX_DROP = 0.5;
export const SHRINK_GUARD_MIN_ASSETS = 100;
export const SOLANA_NETWORK = "Solana";

/** Mint -> decimals for any xStock that is not 8 decimals. None known today. */
export const XSTOCKS_DECIMALS_OVERRIDES: Readonly<Record<string, number>> = Object.freeze({});

/** Shape of ./xstocks-catalogue.json (written by scripts/build-xstocks-catalogue.ts). */
export interface XStocksCatalogueBundle {
  _meta: {
    source: string;
    generatedAt: string;
    generator: string;
    pages: number;
    nodes: number;
    solanaAssets: number;
  };
  assets: XStocksFallbackEntry[];
}

/** Every Solana xStock as of the last `npm run catalogue:build`. Declared before the options that default to it. */
export const XSTOCKS_CATALOGUE_BUNDLE: Readonly<XStocksCatalogueBundle> = catalogueBundleJson as XStocksCatalogueBundle;

const LOG_PREFIX = "[assets/xstocks]";
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ---------------------------------------------------------------------------
// API shapes (only the fields we read; everything else is passed through)
// ---------------------------------------------------------------------------

export interface XStocksDeployment {
  address: string;
  /** "Solana" | "Ton" | "Arbitrum" | "Optimism" | "Ink" | "XLayer" | "Ethereum" | "Mantle" | "BinanceSmartChain" | "HyperEVM" | ... */
  network: string;
  supportsAtomicSwaps?: boolean;
  stablecoins?: unknown[];
  [k: string]: unknown;
}

export interface XStocksNode {
  id: string;
  name: string;
  /** e.g. "TSLAx" */
  symbol: string;
  isin?: string | null;
  /** e.g. "TSLA" */
  underlyingSymbol?: string | null;
  underlyingIsin?: string | null;
  underlying?: { symbol?: string | null; isin?: string | null; type?: string | null; listingCountry?: string | null } | null;
  description?: string | null;
  /** Logo URL. */
  logo?: string | null;
  isTradingHalted?: boolean;
  trading?: Record<string, unknown> | null;
  deployments?: XStocksDeployment[] | null;
  [k: string]: unknown;
}

export interface XStocksPage {
  nodes: XStocksNode[];
  page: { currentPage: number; hasNextPage: boolean };
}

export interface XStocksMultiplier {
  currentMultiplier: number;
  /** 0 / null when no change is scheduled. */
  newMultiplier: number | null;
  /** Unix seconds (0 / null when no change is scheduled). */
  activationDateTime: number | null;
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Options / injection
// ---------------------------------------------------------------------------

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface XstocksOptions {
  /** Defaults to globalThis.fetch. Tests inject a fake. */
  fetch: FetchLike | null;
  /** Clock in ms. Defaults to Date.now. */
  now: () => number;
  /** Overrides env().XSTOCKS_API_URL. */
  baseUrl: string | null;
  timeoutMs: number;
  catalogueTtlMs: number;
  multiplierTtlMs: number;
  refreshRetryMs: number;
  decimalsOverrides: Readonly<Record<string, number>>;
  /** Catalogue pages fetched in parallel (1 = strictly sequential). */
  pageConcurrency: number;
  /** Entries served before the first live fetch and whenever it fails. Defaults to the generated bundle. */
  bundle: readonly XStocksFallbackEntry[];
  /** Serve the bundle at cold start and refresh in the background (default). False awaits the API first. */
  seedFromBundle: boolean;
}

function defaultOptions(): XstocksOptions {
  return {
    fetch: null,
    now: Date.now,
    baseUrl: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    catalogueTtlMs: CATALOGUE_TTL_MS,
    multiplierTtlMs: MULTIPLIER_TTL_MS,
    refreshRetryMs: REFRESH_RETRY_MS,
    decimalsOverrides: XSTOCKS_DECIMALS_OVERRIDES,
    pageConcurrency: PAGE_CONCURRENCY,
    bundle: XSTOCKS_CATALOGUE_BUNDLE.assets,
    seedFromBundle: true,
  };
}

let options: XstocksOptions = defaultOptions();

/** Patch module options (fetch, clock, base URL, TTLs). Caches are untouched. */
export function configureXstocks(patch: Partial<XstocksOptions>): void {
  options = { ...options, ...patch };
}

/** Inject the fetch implementation (null restores globalThis.fetch). */
export function setXstocksFetch(fn: FetchLike | null): void {
  options = { ...options, fetch: fn };
}

/** Clear every cache and restore default options. Test hook. */
export function resetXstocks(): void {
  options = defaultOptions();
  catalogue = null;
  inflight = null;
  lastAttemptAt = Number.NEGATIVE_INFINITY;
  multiplierCache.clear();
}

function baseUrl(): string {
  if (options.baseUrl) return options.baseUrl.replace(/\/+$/, "");
  try {
    return env().XSTOCKS_API_URL.replace(/\/+$/, "");
  } catch {
    // env() throws when required server vars are missing (scripts, tests); the API URL is optional.
    return XSTOCKS_DEFAULT_API_URL;
  }
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

export class XstocksHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = "XstocksHttpError";
  }
}

/** GET a JSON document with an AbortController timeout. Throws on non-2xx / timeout / bad JSON. */
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
    if (!res.ok) throw new XstocksHttpError(res.status, url);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Pure mapping
// ---------------------------------------------------------------------------

function solanaDeployment(node: XStocksNode): XStocksDeployment | null {
  const deps = Array.isArray(node.deployments) ? node.deployments : [];
  return deps.find((d) => !!d && d.network === SOLANA_NETWORK && typeof d.address === "string") ?? null;
}

function underlyingOf(node: XStocksNode): string {
  const u = node.underlyingSymbol || node.underlying?.symbol || "";
  if (u) return String(u).trim();
  const s = String(node.symbol ?? "").trim();
  return s.length > 1 && /x$/i.test(s) ? s.slice(0, -1) : s;
}

/**
 * Map one API node to AssetInfo. Returns null when the node has no Solana deployment,
 * no symbol, or a mint that cannot form a CAIP-19 id.
 */
export function assetInfoFromNode(
  node: XStocksNode,
  decimalsOverrides: Readonly<Record<string, number>> = options.decimalsOverrides,
): AssetInfo | null {
  if (!node || typeof node !== "object") return null;
  const symbol = typeof node.symbol === "string" ? node.symbol.trim() : "";
  if (!symbol) return null;
  const dep = solanaDeployment(node);
  if (!dep) return null;
  const mint = dep.address.trim();
  if (!BASE58_RE.test(mint)) return null;
  let assetId: AssetId;
  try {
    assetId = solanaTokenAssetId(mint, SOLANA_MAINNET);
  } catch {
    return null;
  }
  const underlying = underlyingOf(node);
  const name = typeof node.name === "string" && node.name.trim() ? node.name.trim() : `${underlying} xStock`;
  const logo = typeof node.logo === "string" && node.logo.trim() ? node.logo.trim() : null;
  const decimals = decimalsOverrides[mint] ?? XSTOCKS_DECIMALS;
  return {
    assetId,
    chainId: SOLANA_MAINNET,
    symbol,
    underlying,
    name,
    decimals,
    sector: sectorFor(underlying),
    logoUrl: logo,
    pythFeedId: null,
    multiplier: 1,
  };
}

/**
 * Pure mapping of API nodes to the Solana-only AssetInfo list. Nodes without a Solana
 * deployment are dropped; a duplicated mint keeps its first occurrence.
 */
export function listAssetsFromNodes(
  nodes: readonly XStocksNode[],
  decimalsOverrides: Readonly<Record<string, number>> = options.decimalsOverrides,
): AssetInfo[] {
  const out: AssetInfo[] = [];
  const seen = new Set<AssetId>();
  for (const node of nodes ?? []) {
    const info = assetInfoFromNode(node, decimalsOverrides);
    if (!info || seen.has(info.assetId)) continue;
    seen.add(info.assetId);
    out.push(info);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verified shortlist — every mint below was read from the live API on 14 Sep 2026.
// Never add an address here that has not been verified against /assets. The League's
// tradable list resolves through it; the catalogue fallback is the generated bundle below.
// ---------------------------------------------------------------------------

export interface XStocksFallbackEntry {
  symbol: string;
  underlying: string;
  name: string;
  mint: string;
  /** Only when the API's logo is not `${XSTOCKS_LOGO_BASE}/${symbol}.png`. */
  logo?: string;
}

export const XSTOCKS_FALLBACK: readonly XStocksFallbackEntry[] = Object.freeze([
  { symbol: "TSLAx", underlying: "TSLA", name: "Tesla xStock", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB" },
  { symbol: "AAPLx", underlying: "AAPL", name: "Apple xStock", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
  { symbol: "METAx", underlying: "META", name: "Meta xStock", mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu" },
  { symbol: "NVDAx", underlying: "NVDA", name: "NVIDIA xStock", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
  { symbol: "SPYx", underlying: "SPY", name: "SP500 xStock", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" },
  { symbol: "QQQx", underlying: "QQQ", name: "Nasdaq xStock", mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ" },
  { symbol: "GOOGLx", underlying: "GOOGL", name: "Alphabet xStock", mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN" },
  { symbol: "AMZNx", underlying: "AMZN", name: "Amazon.com xStock", mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg" },
  { symbol: "MSFTx", underlying: "MSFT", name: "Microsoft xStock", mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX" },
  { symbol: "COINx", underlying: "COIN", name: "Coinbase xStock", mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu" },
  { symbol: "MSTRx", underlying: "MSTR", name: "MicroStrategy xStock", mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ" },
  { symbol: "CRCLx", underlying: "CRCL", name: "Circle xStock", mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1" },
  { symbol: "HOODx", underlying: "HOOD", name: "Robinhood xStock", mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg" },
  { symbol: "AVGOx", underlying: "AVGO", name: "Broadcom xStock", mint: "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo" },
  { symbol: "PLTRx", underlying: "PLTR", name: "Palantir xStock", mint: "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4" },
  { symbol: "AMDx", underlying: "AMD", name: "AMD xStock", mint: "XsXcJ6GZ9kVnjqGsjBnktRcuwMBmvKWh8S93RefZ1rF" },
  { symbol: "NFLXx", underlying: "NFLX", name: "Netflix xStock", mint: "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL" },
  { symbol: "JPMx", underlying: "JPM", name: "JPMorgan Chase xStock", mint: "XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C" },
  { symbol: "BRK.Bx", underlying: "BRK.B", name: "Berkshire Hathaway xStock", mint: "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x" },
  { symbol: "GLDx", underlying: "GLD", name: "Gold xStock", mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re" },
  { symbol: "TQQQx", underlying: "TQQQ", name: "TQQQ xStock", mint: "XsjQP3iMAaQ3kQScQKthQpx9ALRbjKAjQtHg6TFomoc" },
  { symbol: "MRVLx", underlying: "MRVL", name: "Marvell xStock", mint: "XsuxRGDzbLjnJ72v74b7p9VY6N66uYgTCyfwwRjVCJA" },
  { symbol: "INTCx", underlying: "INTC", name: "Intel xStock", mint: "XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM" },
  { symbol: "LLYx", underlying: "LLY", name: "Eli Lilly xStock", mint: "Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH" },
  { symbol: "ORCLx", underlying: "ORCL", name: "Oracle xStock", mint: "XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL" },
  { symbol: "XOMx", underlying: "XOM", name: "Exxon Mobil xStock", mint: "XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh" },
  { symbol: "UNHx", underlying: "UNH", name: "UnitedHealth xStock", mint: "XszvaiXGPwvk2nwb3o9C1CX4K6zH8sez11E6uyup6fe" },
  { symbol: "VOOx", underlying: "VOO", name: "Vanguard S&P 500 xStock", mint: "Xsd7TduTbjuYCFL7Uoujb8SbkZLmUsuYNLn7KdvX21x" },
  { symbol: "VTIx", underlying: "VTI", name: "Vanguard xStock", mint: "XsssYEQjzxBCFgvYFFNuhJFBeHNdLWYeUSP8F45cDr9" },
  { symbol: "IWMx", underlying: "IWM", name: "Russell 2000 xStock", mint: "XsbELVbLGBkn7xfMfyYuUipKGt1iRUc2B7pYRvFTFu3" },
]);

// ---------------------------------------------------------------------------
// Bundled catalogue (generated by scripts/build-xstocks-catalogue.ts)
// ---------------------------------------------------------------------------

/**
 * One API node as a compact bundle entry, through the same mapping the live catalogue uses
 * (so the bundle can never disagree with the API about symbol, underlying or mint). Null for a
 * node the catalogue would drop. The logo is kept only when it is not the standard URL.
 */
export function bundleEntryFromNode(node: XStocksNode): XStocksFallbackEntry | null {
  const info = assetInfoFromNode(node, {});
  if (!info) return null;
  const entry: XStocksFallbackEntry = { symbol: info.symbol, underlying: info.underlying, name: info.name, mint: mintFromAssetId(info.assetId) };
  if (info.logoUrl && info.logoUrl !== `${XSTOCKS_LOGO_BASE}/${info.symbol}.png`) entry.logo = info.logoUrl;
  return entry;
}

/** API nodes -> bundle entries, deduplicated by mint exactly like listAssetsFromNodes. */
export function bundleEntriesFromNodes(nodes: readonly XStocksNode[]): XStocksFallbackEntry[] {
  const out: XStocksFallbackEntry[] = [];
  const seen = new Set<string>();
  for (const node of nodes ?? []) {
    const e = bundleEntryFromNode(node);
    if (!e || seen.has(e.mint)) continue;
    seen.add(e.mint);
    out.push(e);
  }
  return out;
}

/** Bundle entries expressed as API nodes so they flow through the same mapping. */
export function entriesToNodes(entries: readonly XStocksFallbackEntry[]): XStocksNode[] {
  return entries.map((e) => ({
    id: `bundle:${e.symbol}`,
    name: e.name,
    symbol: e.symbol,
    underlyingSymbol: e.underlying,
    underlying: { symbol: e.underlying },
    logo: e.logo ?? `${XSTOCKS_LOGO_BASE}/${e.symbol}.png`,
    isTradingHalted: false,
    deployments: [{ address: e.mint, network: SOLANA_NETWORK, supportsAtomicSwaps: true, stablecoins: [] }],
  }));
}

/** The configured bundle (the generated catalogue unless a test injected one) as API nodes. */
export function fallbackNodes(): XStocksNode[] {
  return entriesToNodes(options.bundle);
}

// ---------------------------------------------------------------------------
// Catalogue cache (stale-while-revalidate)
// ---------------------------------------------------------------------------

/**
 * "api": fetched live. "bundle": the generated catalogue seeded at cold start, first live fetch
 * pending. "fallback": the bundle, served because a live fetch failed.
 */
export type CatalogueOrigin = "api" | "bundle" | "fallback";

interface Catalogue {
  assets: AssetInfo[];
  byId: Map<AssetId, AssetInfo>;
  bySymbol: Map<string, AssetInfo>;
  byUnderlying: Map<string, AssetInfo>;
  byMint: Map<string, AssetInfo>;
  mints: ReadonlySet<string>;
  /** ms clock value when fetched; 0 for the bundle (always stale). */
  fetchedAt: number;
  origin: CatalogueOrigin;
}

let catalogue: Catalogue | null = null;
let inflight: Promise<Catalogue | null> | null = null;
let lastAttemptAt = Number.NEGATIVE_INFINITY;

function keyOf(s: string): string {
  return String(s ?? "").trim().toUpperCase();
}

function buildCatalogue(assets: AssetInfo[], fetchedAt: number, origin: CatalogueOrigin): Catalogue {
  const byId = new Map<AssetId, AssetInfo>();
  const bySymbol = new Map<string, AssetInfo>();
  const byUnderlying = new Map<string, AssetInfo>();
  const byMint = new Map<string, AssetInfo>();
  for (const a of assets) {
    byId.set(a.assetId, a);
    const sym = keyOf(a.symbol);
    if (!bySymbol.has(sym)) bySymbol.set(sym, a);
    const und = keyOf(a.underlying);
    if (und && !byUnderlying.has(und)) byUnderlying.set(und, a);
    try {
      byMint.set(mintFromAssetId(a.assetId), a);
    } catch {
      // not a Solana token id; cannot happen for nodes we produced, but never trust it
    }
  }
  return { assets, byId, bySymbol, byUnderlying, byMint, mints: new Set(byMint.keys()), fetchedAt, origin };
}

function bundleCatalogue(origin: "bundle" | "fallback"): Catalogue {
  return buildCatalogue(listAssetsFromNodes(fallbackNodes(), options.decimalsOverrides), 0, origin);
}

/**
 * Fetch every catalogue page, `options.pageConcurrency` at a time, in page order. The first
 * page with hasNextPage false is the last page. Throws when any page up to and including the
 * last one failed or was malformed (a partial catalogue is worse than a stale one); a failure
 * on a speculative page past the end is ignored. After a failure no further pages start.
 */
export async function fetchAllNodes(): Promise<XStocksNode[]> {
  const base = baseUrl();
  const limit = Math.max(1, Math.min(MAX_PAGES, Math.floor(options.pageConcurrency) || 1));
  const pages = new Map<number, XStocksNode[]>();
  const errors = new Map<number, unknown>();
  let lastPage = Number.POSITIVE_INFINITY;
  let next = 0;

  const worker = async (): Promise<void> => {
    while (errors.size === 0 && next < MAX_PAGES && next <= lastPage) {
      const index = next;
      next += 1;
      const url = `${base}/assets?page=${index}`;
      try {
        const body = await getJson<Partial<XStocksPage>>(url);
        if (!body || !Array.isArray(body.nodes)) throw new Error(`unexpected catalogue shape from ${url}`);
        pages.set(index, body.nodes);
        if (!body.page?.hasNextPage) lastPage = Math.min(lastPage, index);
      } catch (e) {
        errors.set(index, e);
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));

  if (Number.isFinite(lastPage)) {
    const nodes: XStocksNode[] = [];
    for (let i = 0; i <= lastPage; i += 1) {
      if (errors.has(i)) throw errors.get(i);
      const got = pages.get(i);
      if (!got) throw new Error(`catalogue page ${i} was not fetched`);
      nodes.push(...got);
    }
    return nodes;
  }
  if (errors.size > 0) throw errors.get(Math.min(...errors.keys()));
  throw new Error(`catalogue pagination did not terminate within ${MAX_PAGES} pages`);
}

function isFresh(c: Catalogue, now: number): boolean {
  return c.origin === "api" && now - c.fetchedAt < options.catalogueTtlMs;
}

/**
 * Refresh the catalogue from the API. Resolves to the new catalogue, or null on failure
 * (logged; the previous catalogue is left in place). Concurrent callers share one flight.
 */
function refresh(): Promise<Catalogue | null> {
  if (inflight) return inflight;
  lastAttemptAt = options.now();
  inflight = (async () => {
    try {
      const nodes = await fetchAllNodes();
      const assets = listAssetsFromNodes(nodes, options.decimalsOverrides);
      if (assets.length === 0) throw new Error("catalogue contained no Solana assets");
      const current = catalogue?.assets.length ?? 0;
      if (current >= SHRINK_GUARD_MIN_ASSETS && assets.length < current * (1 - SHRINK_GUARD_MAX_DROP)) {
        throw new Error(`refusing a catalogue of ${assets.length} Solana assets in place of ${current} (truncated response?)`);
      }
      catalogue = buildCatalogue(assets, options.now(), "api");
      return catalogue;
    } catch (e) {
      if (catalogue && catalogue.origin === "bundle") catalogue = { ...catalogue, origin: "fallback" };
      warn(
        !catalogue
          ? "catalogue fetch failed"
          : catalogue.origin === "api"
            ? "catalogue refresh failed; serving the cached catalogue"
            : "catalogue fetch failed; serving the bundled catalogue",
        e,
      );
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Return the catalogue, never throwing. Fresh -> serve. Missing -> seed the bundle (default).
 * Stale or bundle -> serve immediately and refresh in the background. Missing with seeding
 * off -> await one fetch, then fall back to the bundle.
 */
async function ensureCatalogue(): Promise<Catalogue> {
  const now = options.now();
  if (catalogue && isFresh(catalogue, now)) return catalogue;

  if (!catalogue && options.seedFromBundle) {
    const seeded = bundleCatalogue("bundle");
    if (seeded.assets.length > 0) catalogue = seeded;
  }

  if (catalogue) {
    if (!inflight && now - lastAttemptAt >= options.refreshRetryMs) {
      void refresh().catch(() => null);
    }
    return catalogue;
  }

  const fetched = await refresh();
  if (fetched) return fetched;
  if (catalogue) return catalogue; // another caller won the race
  catalogue = bundleCatalogue("fallback");
  return catalogue;
}

/** Resolve once no refresh is in flight. Test hook for the background path. */
export async function waitForXstocksRefresh(): Promise<void> {
  while (inflight) await inflight;
}

/** Where the currently served catalogue came from (null before the first load). */
export function xstocksCatalogueOrigin(): CatalogueOrigin | null {
  return catalogue?.origin ?? null;
}

/** Force a refresh now and report whether it succeeded. Cron/admin hook. */
export async function refreshXstocksCatalogue(): Promise<boolean> {
  return (await refresh()) !== null;
}

// ---------------------------------------------------------------------------
// AssetSource
// ---------------------------------------------------------------------------

/** Re-exported for the AssetSource contract: qty = raw / 10^decimals * multiplier. */
export const normaliseQty = normaliseQtyImpl;

async function lookupBySymbol(symbol: string): Promise<AssetInfo | null> {
  const key = keyOf(symbol);
  if (!key) return null;
  const c = await ensureCatalogue();
  // "TSLAx" / "tslax" first; then the bare underlying "TSLA" as a courtesy.
  return c.bySymbol.get(key) ?? c.byUnderlying.get(key) ?? null;
}

async function lookupByMint(mint: string): Promise<AssetInfo | null> {
  const c = await ensureCatalogue();
  return c.byMint.get(mint.trim()) ?? null;
}

export const xstocks: AssetSource = {
  name: "xstocks",

  async listAssets(): Promise<AssetInfo[]> {
    try {
      return (await ensureCatalogue()).assets;
    } catch (e) {
      // ensureCatalogue already degrades to the bundle; this is belt and braces.
      warn("listAssets failed unexpectedly; serving the bundled catalogue", e);
      return listAssetsFromNodes(fallbackNodes(), options.decimalsOverrides);
    }
  },

  async getAsset(assetId: AssetId): Promise<AssetInfo | null> {
    if (typeof assetId !== "string" || !isAssetId(assetId)) return null;
    const c = await ensureCatalogue();
    return c.byId.get(assetId) ?? null;
  },

  async getAssetBySymbol(symbol: string): Promise<AssetInfo | null> {
    if (typeof symbol !== "string") return null;
    return lookupBySymbol(symbol);
  },

  async mintSet(): Promise<ReadonlySet<string>> {
    return (await ensureCatalogue()).mints;
  },

  normaliseQty(amountRaw: string, decimals: number, multiplier: number): number {
    return normaliseQtyImpl(amountRaw, decimals, multiplier);
  },
};

/** Look an asset up by its Solana mint address. */
export async function getAssetByMint(mint: string): Promise<AssetInfo | null> {
  if (typeof mint !== "string" || !mint.trim()) return null;
  return lookupByMint(mint);
}

// ---------------------------------------------------------------------------
// Multiplier
// ---------------------------------------------------------------------------

interface MultiplierEntry {
  info: XStocksMultiplier | null;
  expiresAt: number;
}

const multiplierCache = new Map<string, MultiplierEntry>();

function toFinite(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Accepts unix seconds, unix milliseconds or an ISO string; returns unix seconds (null when unset). */
function toUnixSeconds(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === 0) return null;
  if (typeof v === "string" && !/^\d+(\.\d+)?$/.test(v.trim())) {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const n = toFinite(v);
  if (n === null || n <= 0) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

/** Parse the /multiplier response. Returns null when currentMultiplier is not a positive finite number. */
export function parseMultiplierResponse(body: unknown): XStocksMultiplier | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const current = toFinite(b.currentMultiplier);
  if (current === null || current <= 0) return null;
  const next = toFinite(b.newMultiplier);
  return {
    currentMultiplier: current,
    newMultiplier: next !== null && next > 0 ? next : null,
    activationDateTime: toUnixSeconds(b.activationDateTime),
    reason: typeof b.reason === "string" && b.reason ? b.reason : null,
  };
}

/**
 * Multiplier in force at `nowSeconds`, mirroring the Token-2022 rule the chain applies:
 * the scheduled multiplier applies once activationDateTime <= now, otherwise the current one.
 */
export function effectiveXstocksMultiplier(info: XStocksMultiplier, nowSeconds: number): number {
  if (info.newMultiplier !== null && info.newMultiplier > 0) {
    const at = info.activationDateTime ?? 0;
    if (at <= nowSeconds) return info.newMultiplier;
  }
  return info.currentMultiplier;
}

/** Turn a symbol, mint or CAIP-19 id into the canonical API symbol (best effort). */
async function resolveSymbol(symbolOrMint: string): Promise<string> {
  const s = String(symbolOrMint ?? "").trim();
  if (!s) return s;
  if (isAssetId(s)) {
    try {
      const byMint = await lookupByMint(mintFromAssetId(s));
      if (byMint) return byMint.symbol;
    } catch {
      // not a Solana token id; fall through and let the API 404
    }
    return s;
  }
  // A 32–44 char base58 string is a mint, never a symbol ("TSLAx" is 5 chars).
  if (BASE58_RE.test(s)) {
    const byMint = await lookupByMint(s);
    if (byMint) return byMint.symbol;
  }
  const bySym = await lookupBySymbol(s);
  return bySym ? bySym.symbol : s;
}

/**
 * Raw multiplier record from the API for a symbol, mint or CAIP-19 id. Cached 10 minutes
 * (1 minute for failures). Null when the API could not answer.
 */
export async function fetchMultiplierInfo(symbolOrMint: string): Promise<XStocksMultiplier | null> {
  const symbol = await resolveSymbol(symbolOrMint);
  if (!symbol) return null;
  const key = keyOf(symbol);
  const now = options.now();
  const hit = multiplierCache.get(key);
  if (hit && hit.expiresAt > now) return hit.info;

  const url = `${baseUrl()}/assets/${encodeURIComponent(symbol)}/multiplier?network=${SOLANA_NETWORK}`;
  try {
    const body = await getJson<unknown>(url);
    const info = parseMultiplierResponse(body);
    if (!info) throw new Error("unexpected multiplier shape");
    multiplierCache.set(key, { info, expiresAt: now + options.multiplierTtlMs });
    return info;
  } catch (e) {
    warn(`multiplier fetch failed for ${symbol}; defaulting to 1`, e);
    multiplierCache.set(key, { info: null, expiresAt: now + MULTIPLIER_FAILURE_TTL_MS });
    return null;
  }
}

/**
 * Current ScaledUiAmount multiplier for an xStock by symbol ("TSLAx"), mint or CAIP-19 id.
 * Never throws; 1 when the API cannot answer.
 */
export async function getMultiplier(symbolOrMint: string): Promise<number> {
  try {
    const info = await fetchMultiplierInfo(symbolOrMint);
    if (!info) return 1;
    const m = effectiveXstocksMultiplier(info, Math.floor(options.now() / 1000));
    return Number.isFinite(m) && m > 0 ? m : 1;
  } catch (e) {
    warn(`getMultiplier failed for ${String(symbolOrMint)}; defaulting to 1`, e);
    return 1;
  }
}

/** Drop cached multipliers. Test hook. */
export function clearMultiplierCache(): void {
  multiplierCache.clear();
}
