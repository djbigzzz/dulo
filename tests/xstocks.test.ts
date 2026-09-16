import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetId } from "@/lib/core";
import { SOLANA_MAINNET } from "@/lib/core";
import { normaliseQty as normaliseQtyImpl } from "@/lib/assets/normalise";
import {
  CATALOGUE_TTL_MS,
  MAX_PAGES,
  MULTIPLIER_TTL_MS,
  MULTIPLIER_FAILURE_TTL_MS,
  PAGE_CONCURRENCY,
  REFRESH_RETRY_MS,
  XSTOCKS_CATALOGUE_BUNDLE,
  XSTOCKS_DEFAULT_API_URL,
  XSTOCKS_FALLBACK,
  assetInfoFromNode,
  bundleEntriesFromNodes,
  bundleEntryFromNode,
  clearMultiplierCache,
  configureXstocks,
  effectiveXstocksMultiplier,
  entriesToNodes,
  fetchAllNodes,
  fetchMultiplierInfo,
  getAssetByMint,
  getMultiplier,
  listAssetsFromNodes,
  normaliseQty,
  parseMultiplierResponse,
  refreshXstocksCatalogue,
  resetXstocks,
  setXstocksFetch,
  waitForXstocksRefresh,
  xstocks,
  xstocksCatalogueOrigin,
  type FetchLike,
  type XStocksNode,
  type XStocksPage,
} from "@/lib/assets/xstocks";
import fixture from "./fixtures/xstocks-assets.json";

// ---------------------------------------------------------------------------
// Fixtures: the trimmed live response split across two mocked pages
// ---------------------------------------------------------------------------

const NODES = fixture.nodes as unknown as XStocksNode[];
const BASE = "https://xstocks.test/api/v2/public";

const XRXX_MINT = "XsensupeZBdHxZtdnLptf1UfWpVyancWcit7qWFYZrJ";
const XRXX_ID = `${SOLANA_MAINNET}/token:${XRXX_MINT}` as AssetId;
const INDIX_MINT = "XsHYm9cRdEJoogpxDSZVDa4g19fKqUFXWxKisLpEuVm";
const TSLAX_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const AAPLX_MINT = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const METAX_MINT = "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu";

const T0 = Date.UTC(2026, 8, 14, 12, 0, 0);

function page(nodes: XStocksNode[], currentPage: number, hasNextPage: boolean): XStocksPage {
  return { nodes, page: { currentPage, hasNextPage } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Two pages: nodes 0-2 then nodes 3-4, like the real API's page=N cursor. */
function twoPages(nodes: XStocksNode[] = NODES): Record<string, XStocksPage> {
  return {
    [`${BASE}/assets?page=0`]: page(nodes.slice(0, 3), 0, true),
    [`${BASE}/assets?page=1`]: page(nodes.slice(3), 1, false),
  };
}

interface FakeFetch {
  fn: FetchLike;
  calls: string[];
  /** Replace the routing table (URL -> body | Response | Error | function). */
  route(table: Record<string, unknown>): void;
}

function fakeFetch(table: Record<string, unknown> = {}): FakeFetch {
  let routes = table;
  const calls: string[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push(url);
    const hit = routes[url];
    if (hit === undefined) return json({ message: "not found" }, 404);
    const value = typeof hit === "function" ? await (hit as (u: string, i?: RequestInit) => unknown)(url, init) : hit;
    if (value instanceof Error) throw value;
    if (value instanceof Response) return value;
    return json(value);
  };
  return {
    fn,
    calls,
    route(t) {
      routes = t;
    },
  };
}

let clock = T0;
const now = () => clock;

/**
 * The pre-bundle behaviour most tests below pin down exactly (call counts, cold-start await):
 * no bundle seed and one page at a time. The production defaults (seed + 4 pages in flight)
 * are covered in "bundled catalogue" and "parallel pagination" at the end of this file.
 */
function configureSequential(): void {
  configureXstocks({ baseUrl: BASE, now, seedFromBundle: false, pageConcurrency: 1 });
}

const BUNDLE = XSTOCKS_CATALOGUE_BUNDLE.assets;

beforeEach(() => {
  resetXstocks();
  clock = T0;
  configureSequential();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  resetXstocks();
});

// ---------------------------------------------------------------------------
// Pure mapping
// ---------------------------------------------------------------------------

describe("listAssetsFromNodes", () => {
  it("maps a node to AssetInfo with a CAIP-19 id, 8 decimals, sector and logo", () => {
    const [xrx] = listAssetsFromNodes([NODES[0]]);
    expect(xrx).toEqual({
      assetId: XRXX_ID,
      chainId: SOLANA_MAINNET,
      symbol: "XRXx",
      underlying: "XRX",
      name: "Xerox xStock",
      decimals: 8,
      sector: "Technology",
      logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/XRXx.png",
      pythFeedId: null,
      multiplier: 1,
    });
  });

  it("keeps only nodes with a Solana deployment", () => {
    const tonOnly: XStocksNode = {
      ...NODES[1],
      deployments: (NODES[1].deployments ?? []).filter((d) => d.network !== "Solana"),
    };
    const noDeployments: XStocksNode = { ...NODES[2], deployments: [] };
    const out = listAssetsFromNodes([NODES[0], tonOnly, noDeployments, NODES[3]]);
    expect(out.map((a) => a.symbol)).toEqual(["XRXx", "WRLDx"]);
  });

  it("drops nodes with an invalid mint, a missing symbol, and duplicate mints", () => {
    const badMint: XStocksNode = { ...NODES[1], deployments: [{ address: "not-base58!", network: "Solana" }] };
    const noSymbol: XStocksNode = { ...NODES[2], symbol: "" };
    const dup: XStocksNode = { ...NODES[0], symbol: "DUPx" };
    const out = listAssetsFromNodes([NODES[0], badMint, noSymbol, dup]);
    expect(out.map((a) => a.symbol)).toEqual(["XRXx"]);
  });

  it("applies a decimals override by mint and falls back to underlying.symbol / stripped symbol", () => {
    const [a] = listAssetsFromNodes([NODES[0]], { [XRXX_MINT]: 6 });
    expect(a.decimals).toBe(6);

    const viaUnderlying = assetInfoFromNode({ ...NODES[0], underlyingSymbol: null, underlying: { symbol: "XRX" } });
    expect(viaUnderlying?.underlying).toBe("XRX");

    const viaStrip = assetInfoFromNode({ ...NODES[0], underlyingSymbol: null, underlying: null });
    expect(viaStrip?.underlying).toBe("XRX");
    expect(viaStrip?.sector).toBe("Technology");
  });

  it("maps an unknown underlying to the Other sector, not null", () => {
    const [a] = listAssetsFromNodes([{ ...NODES[0], underlyingSymbol: "ZZZZZZ" }]);
    expect(a.sector).toBe("Other");
  });
});

// ---------------------------------------------------------------------------
// Pagination + catalogue
// ---------------------------------------------------------------------------

describe("xstocks.listAssets pagination", () => {
  it("follows page.hasNextPage across two pages and returns every Solana asset", async () => {
    const f = fakeFetch(twoPages());
    setXstocksFetch(f.fn);

    const assets = await xstocks.listAssets();
    expect(f.calls).toEqual([`${BASE}/assets?page=0`, `${BASE}/assets?page=1`]);
    expect(assets.map((a) => a.symbol)).toEqual(["XRXx", "FLNCx", "WGSx", "WRLDx", "INDIx"]);
    expect(assets.every((a) => a.decimals === 8 && a.chainId === SOLANA_MAINNET)).toBe(true);
    expect(xstocksCatalogueOrigin()).toBe("api");
  });

  it("passes an AbortSignal and the JSON accept header to fetch", async () => {
    let seen: RequestInit | undefined;
    const f = fakeFetch({
      [`${BASE}/assets?page=0`]: (_u: string, init?: RequestInit) => {
        seen = init;
        return page(NODES, 0, false);
      },
    });
    setXstocksFetch(f.fn);
    await xstocks.listAssets();
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect((seen?.headers as Record<string, string>).accept).toBe("application/json");
  });

  it("uses env().XSTOCKS_API_URL's default when no base url is configured", async () => {
    configureXstocks({ baseUrl: null });
    const f = fakeFetch({ [`${XSTOCKS_DEFAULT_API_URL}/assets?page=0`]: page(NODES, 0, false) });
    setXstocksFetch(f.fn);
    const assets = await xstocks.listAssets();
    expect(assets.length).toBe(5);
    expect(f.calls[0]).toBe(`${XSTOCKS_DEFAULT_API_URL}/assets?page=0`);
  });
});

describe("lookups", () => {
  beforeEach(() => {
    setXstocksFetch(fakeFetch(twoPages()).fn);
  });

  it("getAssetBySymbol is case-insensitive and tolerant of whitespace", async () => {
    const a = await xstocks.getAssetBySymbol("XRXx");
    expect(a?.assetId).toBe(XRXX_ID);
    expect((await xstocks.getAssetBySymbol("xrxx"))?.assetId).toBe(XRXX_ID);
    expect((await xstocks.getAssetBySymbol("XRXX"))?.assetId).toBe(XRXX_ID);
    expect((await xstocks.getAssetBySymbol("  indix "))?.symbol).toBe("INDIx");
    expect(await xstocks.getAssetBySymbol("NOPEx")).toBeNull();
    expect(await xstocks.getAssetBySymbol("")).toBeNull();
  });

  it("getAssetBySymbol also accepts the bare underlying ticker", async () => {
    expect((await xstocks.getAssetBySymbol("XRX"))?.symbol).toBe("XRXx");
    expect((await xstocks.getAssetBySymbol("wgs"))?.symbol).toBe("WGSx");
  });

  it("getAsset resolves by CAIP-19 id and rejects malformed ids", async () => {
    expect((await xstocks.getAsset(XRXX_ID))?.symbol).toBe("XRXx");
    expect(await xstocks.getAsset(`${SOLANA_MAINNET}/token:${TSLAX_MINT}` as AssetId)).toBeNull();
    expect(await xstocks.getAsset("garbage" as AssetId)).toBeNull();
  });

  it("getAssetByMint and mintSet expose the Solana mints", async () => {
    expect((await getAssetByMint(INDIX_MINT))?.symbol).toBe("INDIx");
    expect(await getAssetByMint("nope")).toBeNull();
    const mints = await xstocks.mintSet();
    expect(mints.size).toBe(5);
    expect(mints.has(XRXX_MINT)).toBe(true);
    expect(mints.has(TSLAX_MINT)).toBe(false);
  });

  it("normaliseQty delegates to lib/assets/normalise (exact BigInt math)", () => {
    expect(xstocks.normaliseQty("12345678900", 8, 1)).toBe(123.456789);
    expect(xstocks.normaliseQty("12345678900", 8, 1.5)).toBe(185.1851835);
    expect(normaliseQty).toBe(normaliseQtyImpl);
    expect(normaliseQty("100000000", 8, 1.0000001)).toBe(1.0000001);
  });
});

// ---------------------------------------------------------------------------
// Cache behaviour (injected clock)
// ---------------------------------------------------------------------------

describe("catalogue cache", () => {
  it("serves from cache within the 1h TTL without refetching", async () => {
    const f = fakeFetch(twoPages());
    setXstocksFetch(f.fn);
    await xstocks.listAssets();
    clock = T0 + CATALOGUE_TTL_MS - 1;
    await xstocks.listAssets();
    await xstocks.getAssetBySymbol("XRXx");
    await xstocks.mintSet();
    expect(f.calls.length).toBe(2);
  });

  it("stale-while-revalidate: serves the stale list at once and refreshes in the background", async () => {
    const f = fakeFetch(twoPages());
    setXstocksFetch(f.fn);
    const first = await xstocks.listAssets();
    expect(first.length).toBe(5);

    // The API now lists only the first two assets.
    f.route({ [`${BASE}/assets?page=0`]: page(NODES.slice(0, 2), 0, false) });
    clock = T0 + CATALOGUE_TTL_MS + 1;

    const stale = await xstocks.listAssets();
    expect(stale).toBe(first); // same array, served immediately
    expect(f.calls.length).toBe(3); // background refresh already started

    await waitForXstocksRefresh();
    const fresh = await xstocks.listAssets();
    expect(fresh.map((a) => a.symbol)).toEqual(["XRXx", "FLNCx"]);
    expect(f.calls.length).toBe(3);
  });

  it("shares one in-flight refresh between concurrent callers", async () => {
    const f = fakeFetch(twoPages());
    setXstocksFetch(f.fn);
    await Promise.all([xstocks.listAssets(), xstocks.mintSet(), xstocks.getAssetBySymbol("XRXx")]);
    expect(f.calls.length).toBe(2);
  });

  it("keeps serving the cached catalogue when a background refresh fails, and rate-limits retries", async () => {
    const f = fakeFetch(twoPages());
    setXstocksFetch(f.fn);
    const first = await xstocks.listAssets();

    f.route({ [`${BASE}/assets?page=0`]: new Error("upstream down") });
    clock = T0 + CATALOGUE_TTL_MS + 1;
    expect(await xstocks.listAssets()).toBe(first);
    await waitForXstocksRefresh();
    expect(await xstocks.listAssets()).toBe(first);
    expect(xstocksCatalogueOrigin()).toBe("api");
    expect(f.calls.length).toBe(3); // one failed attempt; the second stale call did not retry yet

    clock += REFRESH_RETRY_MS;
    await xstocks.listAssets();
    await waitForXstocksRefresh();
    expect(f.calls.length).toBe(4);
  });

  it("a partial pagination failure does not replace the catalogue", async () => {
    const f = fakeFetch(twoPages());
    setXstocksFetch(f.fn);
    const first = await xstocks.listAssets();

    f.route({
      [`${BASE}/assets?page=0`]: page(NODES.slice(0, 1), 0, true),
      [`${BASE}/assets?page=1`]: json({ error: "boom" }, 500),
    });
    expect(await refreshXstocksCatalogue()).toBe(false);
    expect(await xstocks.listAssets()).toBe(first);
  });

  it("rejects an empty or malformed catalogue", async () => {
    const f = fakeFetch({ [`${BASE}/assets?page=0`]: { nope: true } });
    setXstocksFetch(f.fn);
    await xstocks.listAssets();
    expect(xstocksCatalogueOrigin()).toBe("fallback");

    resetXstocks();
    configureSequential();
    setXstocksFetch(fakeFetch({ [`${BASE}/assets?page=0`]: page([], 0, false) }).fn);
    await xstocks.listAssets();
    expect(xstocksCatalogueOrigin()).toBe("fallback");
  });
});

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

describe("fallback catalogue", () => {
  it("serves the bundled catalogue with the three verified mints when there is no cache and the fetch fails", async () => {
    const f = fakeFetch({ [`${BASE}/assets?page=0`]: new Error("ECONNRESET") });
    setXstocksFetch(f.fn);

    const assets = await xstocks.listAssets();
    expect(xstocksCatalogueOrigin()).toBe("fallback");
    const mints = await xstocks.mintSet();
    expect(mints.has(TSLAX_MINT)).toBe(true);
    expect(mints.has(AAPLX_MINT)).toBe(true);
    expect(mints.has(METAX_MINT)).toBe(true);
    expect(assets.length).toBe(BUNDLE.length);

    const tsla = await xstocks.getAssetBySymbol("tslax");
    expect(tsla).toMatchObject({
      assetId: `${SOLANA_MAINNET}/token:${TSLAX_MINT}`,
      symbol: "TSLAx",
      underlying: "TSLA",
      decimals: 8,
      sector: "Consumer Discretionary",
      logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/TSLAx.png",
    });
  });

  it("every verified shortlist mint is a distinct base58 address starting with Xs and every symbol ends in x", () => {
    const mints = new Set(XSTOCKS_FALLBACK.map((e) => e.mint));
    expect(mints.size).toBe(XSTOCKS_FALLBACK.length);
    for (const e of XSTOCKS_FALLBACK) {
      expect(e.mint).toMatch(/^Xs[1-9A-HJ-NP-Za-km-z]{30,42}$/);
      expect(e.symbol.endsWith("x")).toBe(true);
      expect(e.symbol.slice(0, -1)).toBe(e.underlying);
    }
  });

  it("retries after the retry window and replaces the fallback once the API answers", async () => {
    // A bundle under SHRINK_GUARD_MIN_ASSETS, so the 5-asset live fixture may replace it.
    configureXstocks({ bundle: XSTOCKS_FALLBACK });
    const f = fakeFetch({ [`${BASE}/assets?page=0`]: new Error("down") });
    setXstocksFetch(f.fn);
    await xstocks.listAssets();
    expect(f.calls.length).toBe(1);

    // Within the retry window the fallback is served without a network call.
    clock = T0 + REFRESH_RETRY_MS - 1;
    await xstocks.listAssets();
    expect(f.calls.length).toBe(1);

    clock = T0 + REFRESH_RETRY_MS;
    f.route(twoPages());
    const stillFallback = await xstocks.listAssets();
    expect(stillFallback.length).toBe(XSTOCKS_FALLBACK.length);
    await waitForXstocksRefresh();
    const live = await xstocks.listAssets();
    expect(live.map((a) => a.symbol)).toEqual(["XRXx", "FLNCx", "WGSx", "WRLDx", "INDIx"]);
    expect(xstocksCatalogueOrigin()).toBe("api");
  });

  it("times out a hanging fetch via AbortController and falls back", async () => {
    configureXstocks({ timeoutMs: 20 });
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    setXstocksFetch(hanging);
    const assets = await xstocks.listAssets();
    expect(xstocksCatalogueOrigin()).toBe("fallback");
    expect(assets.some((a) => a.symbol === "METAx")).toBe(true);
  });

  it("never throws from listAssets even when fetch itself throws synchronously", async () => {
    setXstocksFetch(() => {
      throw new Error("sync boom");
    });
    await expect(xstocks.listAssets()).resolves.toHaveLength(BUNDLE.length);
  });
});

// ---------------------------------------------------------------------------
// Multiplier
// ---------------------------------------------------------------------------

describe("getMultiplier", () => {
  const MULT_URL = `${BASE}/assets/XRXx/multiplier?network=Solana`;

  it("returns currentMultiplier and caches it for 10 minutes", async () => {
    const f = fakeFetch({
      ...twoPages(),
      [MULT_URL]: { currentMultiplier: 1.0342, newMultiplier: 0, activationDateTime: 0, reason: null },
    });
    setXstocksFetch(f.fn);

    expect(await getMultiplier("XRXx")).toBe(1.0342);
    clock = T0 + MULTIPLIER_TTL_MS - 1;
    expect(await getMultiplier("xrxx")).toBe(1.0342);
    expect(f.calls.filter((u) => u === MULT_URL).length).toBe(1);

    clock = T0 + MULTIPLIER_TTL_MS;
    expect(await getMultiplier("XRXx")).toBe(1.0342);
    expect(f.calls.filter((u) => u === MULT_URL).length).toBe(2);
  });

  it("resolves a mint or CAIP-19 id to the symbol the API expects", async () => {
    const f = fakeFetch({ ...twoPages(), [MULT_URL]: { currentMultiplier: 2, newMultiplier: 0, activationDateTime: 0 } });
    setXstocksFetch(f.fn);
    expect(await getMultiplier(XRXX_MINT)).toBe(2);
    expect(await getMultiplier(XRXX_ID)).toBe(2);
    expect(f.calls.filter((u) => u.includes("/multiplier")).length).toBe(1);
    expect(f.calls.some((u) => u.includes(XRXX_MINT) && u.includes("/multiplier"))).toBe(false);
  });

  it("defaults to 1 on HTTP failure, network error, and malformed body", async () => {
    const f = fakeFetch({ ...twoPages() }); // no multiplier route -> 404
    setXstocksFetch(f.fn);
    expect(await getMultiplier("XRXx")).toBe(1);
    expect(await getMultiplier("NOPEx")).toBe(1);

    clearMultiplierCache();
    f.route({ ...twoPages(), [MULT_URL]: new Error("boom") });
    expect(await getMultiplier("XRXx")).toBe(1);

    clearMultiplierCache();
    f.route({ ...twoPages(), [MULT_URL]: { currentMultiplier: "abc" } });
    expect(await getMultiplier("XRXx")).toBe(1);

    clearMultiplierCache();
    f.route({ ...twoPages(), [MULT_URL]: { currentMultiplier: 0 } });
    expect(await getMultiplier("XRXx")).toBe(1);
  });

  it("caches a failure only briefly", async () => {
    const f = fakeFetch(twoPages());
    setXstocksFetch(f.fn);
    expect(await getMultiplier("XRXx")).toBe(1);
    expect(await getMultiplier("XRXx")).toBe(1);
    expect(f.calls.filter((u) => u === MULT_URL).length).toBe(1);

    clock = T0 + MULTIPLIER_FAILURE_TTL_MS;
    f.route({ ...twoPages(), [MULT_URL]: { currentMultiplier: 1.5 } });
    expect(await getMultiplier("XRXx")).toBe(1.5);
  });

  it("applies a scheduled newMultiplier once activationDateTime has passed", async () => {
    const nowSec = Math.floor(T0 / 1000);
    const f = fakeFetch({
      ...twoPages(),
      [MULT_URL]: { currentMultiplier: 1, newMultiplier: 1.25, activationDateTime: nowSec + 600, reason: "dividend" },
    });
    setXstocksFetch(f.fn);
    expect(await getMultiplier("XRXx")).toBe(1);

    clock = T0 + 600_000;
    // Cached entry is still valid; the effective multiplier is recomputed against the clock.
    expect(await getMultiplier("XRXx")).toBe(1.25);
    const info = await fetchMultiplierInfo("XRXx");
    expect(info).toEqual({ currentMultiplier: 1, newMultiplier: 1.25, activationDateTime: nowSec + 600, reason: "dividend" });
  });

  it("parses seconds, milliseconds and ISO activation times", () => {
    const sec = 1_789_000_000;
    expect(parseMultiplierResponse({ currentMultiplier: 1, newMultiplier: 2, activationDateTime: sec })?.activationDateTime).toBe(sec);
    expect(parseMultiplierResponse({ currentMultiplier: 1, newMultiplier: 2, activationDateTime: sec * 1000 })?.activationDateTime).toBe(sec);
    expect(
      parseMultiplierResponse({ currentMultiplier: 1, newMultiplier: 2, activationDateTime: new Date(sec * 1000).toISOString() })
        ?.activationDateTime,
    ).toBe(sec);
    expect(parseMultiplierResponse({ currentMultiplier: 1, newMultiplier: 0, activationDateTime: 0 })).toEqual({
      currentMultiplier: 1,
      newMultiplier: null,
      activationDateTime: null,
      reason: null,
    });
    expect(parseMultiplierResponse(null)).toBeNull();
    expect(parseMultiplierResponse({ currentMultiplier: Number.NaN })).toBeNull();
  });

  it("effectiveXstocksMultiplier mirrors the on-chain rule", () => {
    expect(effectiveXstocksMultiplier({ currentMultiplier: 1, newMultiplier: 2, activationDateTime: 100, reason: null }, 99)).toBe(1);
    expect(effectiveXstocksMultiplier({ currentMultiplier: 1, newMultiplier: 2, activationDateTime: 100, reason: null }, 100)).toBe(2);
    expect(effectiveXstocksMultiplier({ currentMultiplier: 1, newMultiplier: 2, activationDateTime: null, reason: null }, 5)).toBe(2);
    expect(effectiveXstocksMultiplier({ currentMultiplier: 1.1, newMultiplier: null, activationDateTime: null, reason: null }, 5)).toBe(1.1);
  });

  it("does not hit the multiplier endpoint for an empty input", async () => {
    const f = fakeFetch(twoPages());
    setXstocksFetch(f.fn);
    expect(await getMultiplier("")).toBe(1);
    expect(f.calls.some((u) => u.includes("/multiplier"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bundled catalogue (src/lib/assets/xstocks-catalogue.json, npm run catalogue:build)
// ---------------------------------------------------------------------------

/** The bundle as live API pages of 100, exactly like the real /assets cursor (9 pages on 15 Sep 2026). */
function bundlePages(): Record<string, XStocksPage> {
  const nodes = entriesToNodes(BUNDLE);
  const out: Record<string, XStocksPage> = {};
  const count = Math.ceil(nodes.length / 100);
  for (let i = 0; i < count; i += 1) out[`${BASE}/assets?page=${i}`] = page(nodes.slice(i * 100, (i + 1) * 100), i, i < count - 1);
  // Past the end the real API answers 200 with no nodes.
  for (let i = count; i < count + 8; i += 1) out[`${BASE}/assets?page=${i}`] = page([], i, false);
  return out;
}

const HOLDINGS_THE_30_LIST_DROPPED: Array<[string, string, string]> = [
  ["MUx", "MU", "XsQLZycSZ7QnBBdBXQaTbQdiUcbRqjNJgyBGAMzhHav"],
  ["ACNx", "ACN", "Xs5UJzmCRQ8DWZjskExdSQDnbE6iLkRu2jjrRAB1JSU"],
  ["NKEx", "NKE", "XsGYpMvKbVt6ViHqRd7cF3s746dAMFBQWcC49hB9VVP"],
  ["MCDx", "MCD", "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2"],
];

describe("bundled catalogue file", () => {
  it("holds every Solana xStock (832 on 15 Sep 2026) and its _meta agrees", () => {
    expect(BUNDLE.length).toBeGreaterThanOrEqual(800);
    expect(XSTOCKS_CATALOGUE_BUNDLE._meta.solanaAssets).toBe(BUNDLE.length);
    expect(XSTOCKS_CATALOGUE_BUNDLE._meta.nodes).toBeGreaterThanOrEqual(BUNDLE.length);
    expect(XSTOCKS_CATALOGUE_BUNDLE._meta.generator).toBe("scripts/build-xstocks-catalogue.ts");
    expect(Number.isFinite(Date.parse(XSTOCKS_CATALOGUE_BUNDLE._meta.generatedAt))).toBe(true);
  });

  it("includes MUx, ACNx, NKEx and MCDx, which the old 30-mint fallback dropped", () => {
    for (const [symbol, underlying, mint] of HOLDINGS_THE_30_LIST_DROPPED) {
      expect(BUNDLE.find((e) => e.symbol === symbol)).toMatchObject({ symbol, underlying, mint });
      expect(XSTOCKS_FALLBACK.some((e) => e.symbol === symbol)).toBe(false);
    }
  });

  it("has distinct mints and symbols, valid Xs mints, and maps every entry to an asset", () => {
    expect(new Set(BUNDLE.map((e) => e.mint)).size).toBe(BUNDLE.length);
    expect(new Set(BUNDLE.map((e) => e.symbol.toUpperCase())).size).toBe(BUNDLE.length);
    for (const e of BUNDLE) {
      expect(e.mint).toMatch(/^Xs[1-9A-HJ-NP-Za-km-z]{30,42}$/);
      expect(e.symbol.endsWith("x")).toBe(true);
      expect(e.name.length).toBeGreaterThan(0);
    }
    expect(listAssetsFromNodes(entriesToNodes(BUNDLE))).toHaveLength(BUNDLE.length);
  });

  it("agrees with every verified shortlist mint", () => {
    const byMint = new Map(BUNDLE.map((e) => [e.mint, e]));
    for (const v of XSTOCKS_FALLBACK) expect(byMint.get(v.mint)).toMatchObject({ symbol: v.symbol, underlying: v.underlying });
  });

  it("bundle entries round-trip through the live mapping (same symbol, underlying, name, mint, logo, sector)", () => {
    const entries = bundleEntriesFromNodes(NODES);
    expect(entries[0]).toEqual({ symbol: "XRXx", underlying: "XRX", name: "Xerox xStock", mint: XRXX_MINT });
    expect(listAssetsFromNodes(entriesToNodes(entries))).toEqual(listAssetsFromNodes(NODES));

    const oddLogo = bundleEntryFromNode({ ...NODES[0], logo: "https://cdn.example/xrx.svg" });
    expect(oddLogo?.logo).toBe("https://cdn.example/xrx.svg");
    expect(listAssetsFromNodes(entriesToNodes([oddLogo!]))[0].logoUrl).toBe("https://cdn.example/xrx.svg");
    expect(bundleEntryFromNode({ ...NODES[0], deployments: [] })).toBeNull();
    expect(bundleEntriesFromNodes([NODES[0], { ...NODES[0], symbol: "DUPx" }])).toHaveLength(1);
  });
});

describe("cold start with production defaults (bundle seed)", () => {
  beforeEach(() => {
    resetXstocks();
    configureXstocks({ baseUrl: BASE, now });
  });

  it("serves the bundle at once, refreshes in the background, then serves the live catalogue", async () => {
    // A small bundle keeps the live fixture (5 assets) clear of the shrink guard.
    configureXstocks({ bundle: XSTOCKS_FALLBACK });
    const f = fakeFetch(twoPages());
    setXstocksFetch(f.fn);

    const first = await xstocks.listAssets();
    expect(first).toHaveLength(XSTOCKS_FALLBACK.length);
    expect(xstocksCatalogueOrigin()).toBe("bundle");
    expect(f.calls[0]).toBe(`${BASE}/assets?page=0`); // the refresh already started

    await waitForXstocksRefresh();
    expect((await xstocks.listAssets()).map((a) => a.symbol)).toEqual(["XRXx", "FLNCx", "WGSx", "WRLDx", "INDIx"]);
    expect(xstocksCatalogueOrigin()).toBe("api");
  });

  it("an API outage at cold start keeps every holding resolvable (MUx, ACNx, NKEx, MCDx) and reports 'fallback'", async () => {
    const f = fakeFetch({ [`${BASE}/assets?page=0`]: new Error("ECONNRESET") });
    setXstocksFetch(f.fn);

    await xstocks.listAssets();
    await waitForXstocksRefresh();
    expect(xstocksCatalogueOrigin()).toBe("fallback");
    const mints = await xstocks.mintSet();
    expect(mints.size).toBe(BUNDLE.length);
    for (const [symbol, , mint] of HOLDINGS_THE_30_LIST_DROPPED) {
      expect(mints.has(mint)).toBe(true);
      expect((await xstocks.getAssetBySymbol(symbol))?.assetId).toBe(`${SOLANA_MAINNET}/token:${mint}`);
      expect((await getAssetByMint(mint))?.symbol).toBe(symbol);
    }

    // Retries on the 30s cadence and switches to the live catalogue once it answers.
    const callsAfterFailure = f.calls.length;
    await xstocks.listAssets();
    expect(f.calls.length).toBe(callsAfterFailure);
    clock = T0 + REFRESH_RETRY_MS;
    f.route(bundlePages());
    await xstocks.listAssets();
    await waitForXstocksRefresh();
    expect(xstocksCatalogueOrigin()).toBe("api");
    expect((await xstocks.listAssets()).length).toBe(BUNDLE.length);
  });

  it("refuses a refresh that would shrink a 100+ asset catalogue by more than half (truncated response)", async () => {
    const f = fakeFetch(twoPages()); // 5 assets against the 832-asset bundle
    setXstocksFetch(f.fn);
    const seeded = await xstocks.listAssets();
    await waitForXstocksRefresh();
    expect(xstocksCatalogueOrigin()).toBe("fallback");
    expect(await xstocks.listAssets()).toBe(seeded);

    // Once live, a later refresh of half the size is refused too; a full one is accepted.
    clock = T0 + REFRESH_RETRY_MS;
    f.route(bundlePages());
    expect(await refreshXstocksCatalogue()).toBe(true);
    const live = await xstocks.listAssets();
    const half = entriesToNodes(BUNDLE.slice(0, Math.floor(BUNDLE.length / 2) - 1));
    f.route({ [`${BASE}/assets?page=0`]: page(half, 0, false) });
    expect(await refreshXstocksCatalogue()).toBe(false);
    expect(await xstocks.listAssets()).toBe(live);
    expect(xstocksCatalogueOrigin()).toBe("api");
  });

  it("resetXstocks restores the seed after a test turned it off", async () => {
    configureXstocks({ seedFromBundle: false });
    resetXstocks();
    configureXstocks({ baseUrl: BASE, now });
    setXstocksFetch(fakeFetch({}).fn);
    expect(await xstocks.listAssets()).toHaveLength(BUNDLE.length);
    expect(xstocksCatalogueOrigin()).toBe("bundle");
    await waitForXstocksRefresh();
  });
});

describe("parallel pagination", () => {
  /** Fetch that answers from a table after a short delay and records the peak concurrency. */
  function slowFetch(table: Record<string, unknown>, delayMs = 5) {
    const calls: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const fn: FetchLike = async (url) => {
      calls.push(url);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((r) => setTimeout(r, delayMs));
        const hit = table[url];
        if (hit === undefined) return json({ message: "not found" }, 404);
        if (hit instanceof Error) throw hit;
        if (hit instanceof Response) return hit;
        return json(hit);
      } finally {
        inFlight -= 1;
      }
    };
    return { fn, calls, peak: () => peak };
  }

  beforeEach(() => {
    configureXstocks({ pageConcurrency: PAGE_CONCURRENCY });
  });

  it("fetches the 9-page catalogue with at most 4 pages in flight, in page order, and at most 3 requests past the end", async () => {
    expect(PAGE_CONCURRENCY).toBe(4);
    const f = slowFetch(bundlePages());
    setXstocksFetch(f.fn);
    const nodes = await fetchAllNodes();
    expect(nodes.map((n) => n.symbol)).toEqual(BUNDLE.map((e) => e.symbol));
    expect(f.peak()).toBeLessThanOrEqual(4);
    expect(f.peak()).toBeGreaterThan(1);
    const pagesAsked = f.calls.map((u) => Number(new URL(u).searchParams.get("page")));
    const lastPage = Math.ceil(BUNDLE.length / 100) - 1;
    for (let i = 0; i <= lastPage; i += 1) expect(pagesAsked).toContain(i);
    expect(Math.max(...pagesAsked)).toBeLessThanOrEqual(lastPage + 3);
  });

  it("ignores failures on speculative pages past the end", async () => {
    const table: Record<string, unknown> = twoPages();
    table[`${BASE}/assets?page=2`] = new Error("past the end");
    table[`${BASE}/assets?page=3`] = json({ error: "boom" }, 500);
    setXstocksFetch(slowFetch(table).fn);
    await expect(fetchAllNodes()).resolves.toHaveLength(NODES.length);
  });

  it("a failed page before the end fails the fetch and never replaces a good catalogue", async () => {
    const good = slowFetch(bundlePages());
    setXstocksFetch(good.fn);
    expect(await refreshXstocksCatalogue()).toBe(true);
    const before = await xstocks.listAssets();

    for (const broken of [new Error("ECONNRESET"), json({ error: "rate limited" }, 429), { nope: true }]) {
      const table: Record<string, unknown> = bundlePages();
      table[`${BASE}/assets?page=5`] = broken;
      const f = slowFetch(table);
      setXstocksFetch(f.fn);
      await expect(fetchAllNodes()).rejects.toBeTruthy();
      expect(await refreshXstocksCatalogue()).toBe(false);
      expect(await xstocks.listAssets()).toBe(before);
      // No page starts after a failure is seen: at most the 3 already in flight follow page 5.
      const pagesAsked = f.calls.map((u) => Number(new URL(u).searchParams.get("page")));
      expect(Math.max(...pagesAsked)).toBeLessThanOrEqual(8);
    }
    expect(xstocksCatalogueOrigin()).toBe("api");
  });

  it("gives up after MAX_PAGES when the API never reports a last page", async () => {
    const endless: FetchLike = async (url) => json(page([], Number(new URL(url).searchParams.get("page")), true));
    setXstocksFetch(endless);
    await expect(fetchAllNodes()).rejects.toThrow(`did not terminate within ${MAX_PAGES} pages`);
  });
});
