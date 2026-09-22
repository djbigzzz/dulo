import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetId, AssetInfo } from "@/lib/core";

// --- fixtures ---------------------------------------------------------------
const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const TSLAX_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const AAPLX_MINT = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const TSLAX_ID = `${SOL}/token:${TSLAX_MINT}` as AssetId;
const AAPLX_ID = `${SOL}/token:${AAPLX_MINT}` as AssetId;
const UNKNOWN_ID = `${SOL}/token:Xs1111111111111111111111111111111111111111` as AssetId;
// A PreStocks pre-IPO token. @/lib/assets/prestocks is NOT mocked: the registry resolves this
// symbol and id from the module's inlined static list, which never makes a request.
const SPACEX_MINT = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const SPACEX_ID = `${SOL}/token:${SPACEX_MINT}` as AssetId;

// Tue 10 Mar 2026 10:00 ET (EDT) -> session open. Sat 14 Mar 2026 -> closed.
const OPEN_NOW = new Date("2026-03-10T14:00:00Z");
const CLOSED_NOW = new Date("2026-03-14T14:00:00Z");

// --- module mocks (hoisted; keep fixtures inline) ----------------------------
vi.mock("@/lib/assets/xstocks", () => {
  const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  const mk = (mint: string, symbol: string, underlying: string) => ({
    assetId: `${SOL}/token:${mint}`,
    chainId: SOL,
    symbol,
    underlying,
    name: `${underlying} xStock`,
    decimals: 8,
    sector: null,
    logoUrl: null,
    pythFeedId: null,
    multiplier: 1,
  });
  const assets = [
    mk("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", "TSLAx", "TSLA"),
    mk("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", "AAPLx", "AAPL"),
  ];
  const byId = new Map(assets.map((a) => [a.assetId, a]));
  const bySymbol = new Map(assets.map((a) => [a.symbol.toUpperCase(), a]));
  return {
    xstocks: {
      name: "xstocks",
      listAssets: vi.fn(async () => assets),
      getAsset: vi.fn(async (id: string) => byId.get(id) ?? null),
      getAssetBySymbol: vi.fn(async (s: string) => bySymbol.get(s.toUpperCase()) ?? null),
      mintSet: vi.fn(async () => new Set(assets.map((a) => a.assetId.split(":").pop() as string))),
      normaliseQty: (raw: string, decimals: number, multiplier: number) => (Number(raw) / 10 ** decimals) * multiplier,
    },
    getMultiplier: vi.fn(async () => 1),
    normaliseQty: (raw: string, decimals: number, multiplier: number) => (Number(raw) / 10 ** decimals) * multiplier,
  };
});

vi.mock("@/lib/prices/pyth", () => ({
  pyth: { name: "pyth", getPrices: vi.fn(async () => new Map()) },
}));

// Same export shape as the real module: `jupiter` is what createJupiterSource() builds, and
// its getPrices resolves { price, publishedAt: Date | null } (null = Jupiter could not date it).
vi.mock("@/lib/prices/jupiter", () => {
  const jupiter = { name: "jupiter", getPrices: vi.fn(async () => new Map()) };
  return { jupiter, createJupiterSource: () => jupiter };
});

import { xstocks } from "@/lib/assets/xstocks";
import {
  CACHE_TTL_MS,
  LAST_GOOD_MAX_AGE_MS,
  NONE_CACHE_TTL_MS,
  UnknownAssetError,
  clearPriceCache,
  getPrice,
  getPriceBySymbol,
  getPrices,
  getPricesBySymbols,
  isMarketOpen,
} from "@/lib/price";
import { jupiter } from "@/lib/prices/jupiter";
import { pyth } from "@/lib/prices/pyth";

const pythGet = vi.mocked(pyth.getPrices);
const jupGet = vi.mocked(jupiter.getPrices);

type SourceMap = Map<AssetId, { price: number; publishedAt: Date | null }>;
const quotes = (entries: Array<[AssetId, number, Date | null]>): SourceMap =>
  new Map(entries.map(([id, price, publishedAt]) => [id, { price, publishedAt }]));

beforeEach(() => {
  clearPriceCache();
  pythGet.mockReset().mockResolvedValue(new Map());
  jupGet.mockReset().mockResolvedValue(new Map());
  vi.mocked(xstocks.getAsset).mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isMarketOpen (facade)", () => {
  it("defaults to now and delegates to the calendar", () => {
    vi.setSystemTime(OPEN_NOW);
    expect(isMarketOpen()).toBe(true);
    vi.setSystemTime(CLOSED_NOW);
    expect(isMarketOpen()).toBe(false);
    expect(isMarketOpen(OPEN_NOW)).toBe(true);
  });
});

describe("getPrice source selection", () => {
  it("market open + fresh Pyth quote -> pyth wins over jupiter", async () => {
    vi.setSystemTime(OPEN_NOW);
    pythGet.mockResolvedValue(quotes([[TSLAX_ID, 251.1, new Date(OPEN_NOW.getTime() - 5_000)]]));
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, OPEN_NOW]]));

    const q = await getPrice(TSLAX_ID);
    expect(q.source).toBe("pyth");
    expect(q.price).toBe(251.1);
    expect(q.symbol).toBe("TSLAx");
    expect(q.ageSeconds).toBe(5);
    expect(q.stale).toBe(false);
    expect(q.marketOpen).toBe(true);
    expect(q.publishedAt?.toISOString()).toBe(new Date(OPEN_NOW.getTime() - 5_000).toISOString());
  });

  it("market open but Pyth older than 60s -> jupiter", async () => {
    vi.setSystemTime(OPEN_NOW);
    pythGet.mockResolvedValue(quotes([[TSLAX_ID, 251.1, new Date(OPEN_NOW.getTime() - 61_000)]]));
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, OPEN_NOW]]));

    const q = await getPrice(TSLAX_ID);
    expect(q.source).toBe("jupiter");
    expect(q.price).toBe(249.9);
    expect(q.ageSeconds).toBe(0);
    expect(q.stale).toBe(false);
    expect(q.marketOpen).toBe(true);
  });

  it("market open, Pyth at exactly 60s is not fresh -> jupiter", async () => {
    vi.setSystemTime(OPEN_NOW);
    pythGet.mockResolvedValue(quotes([[TSLAX_ID, 251.1, new Date(OPEN_NOW.getTime() - 60_000)]]));
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, OPEN_NOW]]));
    expect((await getPrice(TSLAX_ID)).source).toBe("jupiter");
  });

  it("market closed -> jupiter, and Pyth is not even fetched", async () => {
    vi.setSystemTime(CLOSED_NOW);
    pythGet.mockResolvedValue(quotes([[TSLAX_ID, 251.1, CLOSED_NOW]]));
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, CLOSED_NOW]]));

    const q = await getPrice(TSLAX_ID);
    expect(q.source).toBe("jupiter");
    expect(q.price).toBe(249.9);
    expect(q.marketOpen).toBe(false);
    expect(q.stale).toBe(false);
    expect(pythGet).not.toHaveBeenCalled();
    expect(jupGet).toHaveBeenCalledTimes(1);
  });

  it("market open, Pyth empty, Jupiter has it -> jupiter", async () => {
    vi.setSystemTime(OPEN_NOW);
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, OPEN_NOW]]));
    expect((await getPrice(TSLAX_ID)).source).toBe("jupiter");
  });

  it("nothing quotes -> price null, source none, stale", async () => {
    vi.setSystemTime(OPEN_NOW);
    const q = await getPrice(TSLAX_ID);
    expect(q).toMatchObject({
      assetId: TSLAX_ID,
      symbol: "TSLAx",
      price: null,
      source: "none",
      publishedAt: null,
      ageSeconds: null,
      stale: true,
      marketOpen: true,
    });
  });

  it("unknown asset -> none quote without calling the sources for it", async () => {
    vi.setSystemTime(CLOSED_NOW);
    const q = await getPrice(UNKNOWN_ID);
    expect(q.source).toBe("none");
    expect(q.price).toBeNull();
    expect(q.symbol).toBe("Xs1111111111111111111111111111111111111111");
    expect(jupGet).not.toHaveBeenCalled();
  });

  it("flags a quote stale when it is older than 6h (a block-time-dated weekend Jupiter price)", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, new Date(CLOSED_NOW.getTime() - 7 * 3600 * 1000)]]));
    const q = await getPrice(TSLAX_ID);
    expect(q.source).toBe("jupiter");
    expect(q.ageSeconds).toBe(7 * 3600);
    expect(q.stale).toBe(true);
  });

  it("keeps a quote fresh at exactly 6h and flags it one second later", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, new Date(CLOSED_NOW.getTime() - 6 * 3600 * 1000)]]));
    expect((await getPrice(TSLAX_ID)).stale).toBe(false);
    clearPriceCache();
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, new Date(CLOSED_NOW.getTime() - 6 * 3600 * 1000 - 1000)]]));
    expect((await getPrice(TSLAX_ID)).stale).toBe(true);
  });

  it("jupiter quote with no publish time -> price kept, age unknown, stale (never '12s ago')", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, null]]));
    const q = await getPrice(TSLAX_ID);
    expect(q.source).toBe("jupiter");
    expect(q.price).toBe(249.9);
    expect(q.publishedAt).toBeNull();
    expect(q.ageSeconds).toBeNull();
    expect(q.stale).toBe(true);
    expect(q.marketOpen).toBe(false);

    // Still unknown / stale when served from cache.
    vi.setSystemTime(new Date(CLOSED_NOW.getTime() + 10_000));
    const cached = await getPrice(TSLAX_ID);
    expect(jupGet).toHaveBeenCalledTimes(1);
    expect(cached.ageSeconds).toBeNull();
    expect(cached.stale).toBe(true);
  });

  it("market open: an undated Pyth quote can never win; jupiter is used", async () => {
    vi.setSystemTime(OPEN_NOW);
    pythGet.mockResolvedValue(quotes([[TSLAX_ID, 251.1, null]]));
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, OPEN_NOW]]));
    const q = await getPrice(TSLAX_ID);
    expect(q.source).toBe("jupiter");
    expect(q.stale).toBe(false);
  });
});

describe("cache", () => {
  it("serves a second call within 30s from cache without refetching", async () => {
    vi.setSystemTime(OPEN_NOW);
    pythGet.mockResolvedValue(quotes([[TSLAX_ID, 251.1, OPEN_NOW]]));
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, OPEN_NOW]]));

    const first = await getPrice(TSLAX_ID);
    vi.setSystemTime(new Date(OPEN_NOW.getTime() + 10_000));
    const second = await getPrice(TSLAX_ID);

    expect(pythGet).toHaveBeenCalledTimes(1);
    expect(jupGet).toHaveBeenCalledTimes(1);
    expect(second.source).toBe("pyth");
    expect(second.price).toBe(first.price);
    // Age is recomputed at serve time even on a cache hit.
    expect(second.ageSeconds).toBe(10);
  });

  it("refetches once the 30s TTL has elapsed", async () => {
    vi.setSystemTime(OPEN_NOW);
    pythGet.mockResolvedValue(quotes([[TSLAX_ID, 251.1, OPEN_NOW]]));
    await getPrice(TSLAX_ID);

    vi.setSystemTime(new Date(OPEN_NOW.getTime() + CACHE_TTL_MS + 1));
    pythGet.mockResolvedValue(quotes([[TSLAX_ID, 260, new Date(OPEN_NOW.getTime() + CACHE_TTL_MS + 1)]]));
    const q = await getPrice(TSLAX_ID);

    expect(pythGet).toHaveBeenCalledTimes(2);
    expect(q.price).toBe(260);
  });

  it("clearPriceCache forces a refetch", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, CLOSED_NOW]]));
    await getPrice(TSLAX_ID);
    clearPriceCache();
    await getPrice(TSLAX_ID);
    expect(jupGet).toHaveBeenCalledTimes(2);
  });
});

describe("resilience: short negative cache + last good quote (WIN-PLAN M-I)", () => {
  const at = (ms: number) => new Date(CLOSED_NOW.getTime() + ms);

  it("caches a 'none' answer for 5s, not 30s", async () => {
    expect(NONE_CACHE_TTL_MS).toBe(5_000);
    vi.setSystemTime(CLOSED_NOW);
    expect((await getPrice(TSLAX_ID)).source).toBe("none");

    vi.setSystemTime(at(NONE_CACHE_TTL_MS - 1));
    expect((await getPrice(TSLAX_ID)).source).toBe("none");
    expect(jupGet).toHaveBeenCalledTimes(1);

    // Jupiter recovers: the very next request after 5s gets the price.
    vi.setSystemTime(at(NONE_CACHE_TTL_MS));
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, at(NONE_CACHE_TTL_MS)]]));
    const q = await getPrice(TSLAX_ID);
    expect(jupGet).toHaveBeenCalledTimes(2);
    expect(q).toMatchObject({ source: "jupiter", price: 249.9, stale: false });
  });

  it("serves the last good quote, marked stale with its real age and original source, when Jupiter later returns nothing (429)", async () => {
    const published = new Date(CLOSED_NOW.getTime() - 20_000);
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, published]]));
    expect(await getPrice(TSLAX_ID)).toMatchObject({ source: "jupiter", price: 249.9, stale: false, ageSeconds: 20 });

    // The 30s cache lapses and the throttled source now gives no quote (its 429 is swallowed upstream).
    vi.setSystemTime(at(CACHE_TTL_MS + 1_000));
    jupGet.mockResolvedValue(new Map());
    const fallback = await getPrice(TSLAX_ID);
    expect(jupGet).toHaveBeenCalledTimes(2);
    expect(fallback).toMatchObject({ assetId: TSLAX_ID, symbol: "TSLAx", source: "jupiter", price: 249.9, stale: true, marketOpen: false });
    expect(fallback.publishedAt?.toISOString()).toBe(published.toISOString());
    expect(fallback.ageSeconds).toBe(51); // 20s old when fetched + 31s since: the real age, not "0s"

    // Cached for the short TTL only, and still stale (never re-freshened) on the cache hit.
    vi.setSystemTime(at(CACHE_TTL_MS + 3_000));
    const hit = await getPrice(TSLAX_ID);
    expect(jupGet).toHaveBeenCalledTimes(2);
    expect(hit).toMatchObject({ price: 249.9, stale: true, ageSeconds: 53 });

    vi.setSystemTime(at(CACHE_TTL_MS + 1_000 + NONE_CACHE_TTL_MS));
    await getPrice(TSLAX_ID);
    expect(jupGet).toHaveBeenCalledTimes(3);
  });

  it("also covers a source that rejects outright", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, CLOSED_NOW]]));
    await getPrice(TSLAX_ID);
    vi.setSystemTime(at(CACHE_TTL_MS));
    jupGet.mockRejectedValue(new Error("HTTP 429 from https://api.jup.ag/price/v3"));
    expect(await getPrice(TSLAX_ID)).toMatchObject({ source: "jupiter", price: 249.9, stale: true, ageSeconds: CACHE_TTL_MS / 1000 });
  });

  it("stops serving the last good quote once it was fetched more than 10 minutes ago", async () => {
    expect(LAST_GOOD_MAX_AGE_MS).toBe(10 * 60_000);
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, CLOSED_NOW]]));
    await getPrice(TSLAX_ID);
    jupGet.mockResolvedValue(new Map());

    // Serving the fallback does not extend its life.
    vi.setSystemTime(at(CACHE_TTL_MS));
    expect((await getPrice(TSLAX_ID)).price).toBe(249.9);
    vi.setSystemTime(at(LAST_GOOD_MAX_AGE_MS));
    expect(await getPrice(TSLAX_ID)).toMatchObject({ price: 249.9, stale: true, ageSeconds: 600 });

    vi.setSystemTime(at(LAST_GOOD_MAX_AGE_MS + NONE_CACHE_TTL_MS));
    expect(await getPrice(TSLAX_ID)).toMatchObject({ source: "none", price: null, stale: true, ageSeconds: null });
  });

  it("a recovered source replaces the fallback with a fresh quote and a new 10-minute window", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, CLOSED_NOW]]));
    await getPrice(TSLAX_ID);

    vi.setSystemTime(at(CACHE_TTL_MS));
    jupGet.mockResolvedValue(new Map());
    expect((await getPrice(TSLAX_ID)).stale).toBe(true);

    vi.setSystemTime(at(CACHE_TTL_MS + NONE_CACHE_TTL_MS));
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 251, at(CACHE_TTL_MS + NONE_CACHE_TTL_MS)]]));
    expect(await getPrice(TSLAX_ID)).toMatchObject({ price: 251, stale: false, ageSeconds: 0 });

    vi.setSystemTime(at(CACHE_TTL_MS + NONE_CACHE_TTL_MS + LAST_GOOD_MAX_AGE_MS));
    jupGet.mockResolvedValue(new Map());
    expect(await getPrice(TSLAX_ID)).toMatchObject({ price: 251, stale: true });
  });

  it("falls back per asset inside a batch and never invents a quote for an asset that never had one", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, CLOSED_NOW]]));
    await getPrice(TSLAX_ID);

    vi.setSystemTime(at(CACHE_TTL_MS));
    jupGet.mockResolvedValue(new Map());
    const m = await getPrices([TSLAX_ID, AAPLX_ID]);
    expect(m.get(TSLAX_ID)).toMatchObject({ price: 249.9, stale: true });
    expect(m.get(AAPLX_ID)).toMatchObject({ source: "none", price: null });
  });

  it("clearPriceCache forgets the last good quotes too", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, CLOSED_NOW]]));
    await getPrice(TSLAX_ID);
    clearPriceCache();
    jupGet.mockResolvedValue(new Map());
    expect((await getPrice(TSLAX_ID)).source).toBe("none");
  });

  it("serves a remembered Pyth quote with source pyth when both sources later fail", async () => {
    vi.setSystemTime(OPEN_NOW);
    pythGet.mockResolvedValue(quotes([[TSLAX_ID, 251.1, OPEN_NOW]]));
    await getPrice(TSLAX_ID);
    vi.setSystemTime(new Date(OPEN_NOW.getTime() + CACHE_TTL_MS));
    pythGet.mockRejectedValue(new Error("hermes down"));
    jupGet.mockResolvedValue(new Map());
    expect(await getPrice(TSLAX_ID)).toMatchObject({ source: "pyth", price: 251.1, stale: true, ageSeconds: 30, marketOpen: true });
  });
});

describe("getPrices batching", () => {
  it("calls each source once for the whole batch and mixes sources per asset", async () => {
    vi.setSystemTime(OPEN_NOW);
    pythGet.mockResolvedValue(quotes([[TSLAX_ID, 251.1, OPEN_NOW]])); // no AAPL from Pyth
    jupGet.mockResolvedValue(
      quotes([
        [TSLAX_ID, 249.9, OPEN_NOW],
        [AAPLX_ID, 190.5, OPEN_NOW],
      ]),
    );

    const m = await getPrices([TSLAX_ID, AAPLX_ID, TSLAX_ID, UNKNOWN_ID]);
    expect(pythGet).toHaveBeenCalledTimes(1);
    expect(jupGet).toHaveBeenCalledTimes(1);
    expect(pythGet.mock.calls[0][0].map((a: AssetInfo) => a.symbol).sort()).toEqual(["AAPLx", "TSLAx"]);

    expect(m.size).toBe(3);
    expect(m.get(TSLAX_ID)?.source).toBe("pyth");
    expect(m.get(AAPLX_ID)?.source).toBe("jupiter");
    expect(m.get(AAPLX_ID)?.price).toBe(190.5);
    expect(m.get(UNKNOWN_ID)?.source).toBe("none");
  });

  it("only fetches the uncached subset on a partial cache hit", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, CLOSED_NOW]]));
    await getPrice(TSLAX_ID);

    jupGet.mockResolvedValue(quotes([[AAPLX_ID, 190.5, CLOSED_NOW]]));
    const m = await getPrices([TSLAX_ID, AAPLX_ID]);
    expect(jupGet).toHaveBeenCalledTimes(2);
    expect(jupGet.mock.calls[1][0].map((a: AssetInfo) => a.symbol)).toEqual(["AAPLx"]);
    expect(m.get(TSLAX_ID)?.price).toBe(249.9);
    expect(m.get(AAPLX_ID)?.price).toBe(190.5);
  });

  it("returns an empty map for an empty request without touching sources", async () => {
    const m = await getPrices([]);
    expect(m.size).toBe(0);
    expect(jupGet).not.toHaveBeenCalled();
  });

  it("degrades to none when a source rejects", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockRejectedValue(new Error("boom"));
    const q = await getPrice(TSLAX_ID);
    expect(q.source).toBe("none");
    expect(q.price).toBeNull();
    expect(q.stale).toBe(true);
  });

  it("falls through to jupiter when pyth rejects while the market is open", async () => {
    vi.setSystemTime(OPEN_NOW);
    pythGet.mockRejectedValue(new Error("hermes down"));
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, OPEN_NOW]]));
    const q = await getPrice(TSLAX_ID);
    expect(q.source).toBe("jupiter");
    expect(q.price).toBe(249.9);
  });
});

describe("symbols", () => {
  it("getPriceBySymbol resolves through the asset source (case-insensitive)", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(quotes([[TSLAX_ID, 249.9, CLOSED_NOW]]));
    const q = await getPriceBySymbol("tslax");
    expect(q.assetId).toBe(TSLAX_ID);
    expect(q.symbol).toBe("TSLAx");
    expect(q.source).toBe("jupiter");
  });

  it("getPriceBySymbol throws UnknownAssetError for an unknown symbol", async () => {
    vi.setSystemTime(CLOSED_NOW);
    await expect(getPriceBySymbol("NOPEx")).rejects.toBeInstanceOf(UnknownAssetError);
  });

  it("getPricesBySymbols reports unknown symbols and quotes the rest", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(
      quotes([
        [TSLAX_ID, 249.9, CLOSED_NOW],
        [AAPLX_ID, 190.5, CLOSED_NOW],
      ]),
    );
    const r = await getPricesBySymbols(["TSLAx", "NOPEx", "AAPLx", "TSLAx"]);
    expect(r.unknown).toEqual(["NOPEx"]);
    expect(r.quotes.map((q) => q.symbol)).toEqual(["TSLAx", "AAPLx"]);
  });

  it("resolves a pre-IPO token symbol through the second registered source (from its static list, no request)", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(quotes([[SPACEX_ID, 310.5, CLOSED_NOW]]));
    const q = await getPriceBySymbol("spacex");
    expect(q).toMatchObject({ assetId: SPACEX_ID, symbol: "SPACEX", price: 310.5, source: "jupiter" });
  });

  it("a source fence makes a symbol another source knows unknown: SPACEX is refused by an xstocks-only lookup", async () => {
    vi.setSystemTime(CLOSED_NOW);
    jupGet.mockResolvedValue(
      quotes([
        [TSLAX_ID, 249.9, CLOSED_NOW],
        [SPACEX_ID, 310.5, CLOSED_NOW],
      ]),
    );
    await expect(getPriceBySymbol("SPACEX", { source: "xstocks" })).rejects.toBeInstanceOf(UnknownAssetError);
    await expect(getPriceBySymbol("spacex", { source: "xstocks" })).rejects.toBeInstanceOf(UnknownAssetError);
    // The fenced source still quotes its own symbols, case-insensitively.
    expect((await getPriceBySymbol("tslax", { source: "xstocks" })).symbol).toBe("TSLAx");

    const r = await getPricesBySymbols(["TSLAx", "SPACEX", "NOPEx"], { source: "xstocks" });
    expect([...r.unknown].sort()).toEqual(["NOPEx", "SPACEX"]);
    expect(r.quotes.map((q) => q.symbol)).toEqual(["TSLAx"]);

    // The fence is symmetric, and a blank source means no fence.
    const p = await getPricesBySymbols(["TSLAx", "SPACEX"], { source: "prestocks" });
    expect(p.unknown).toEqual(["TSLAx"]);
    expect(p.quotes.map((q) => q.symbol)).toEqual(["SPACEX"]);
    const open = await getPricesBySymbols(["TSLAx", "SPACEX"], { source: " " });
    expect(open.unknown).toEqual([]);
    expect(open.quotes.map((q) => q.symbol)).toEqual(["TSLAx", "SPACEX"]);
  });
});

describe("a pre-IPO token never reaches Pyth", () => {
  it("market open: only the xStock is sent to Hermes; the pre-IPO token quotes from Jupiter in the same batch", async () => {
    vi.setSystemTime(OPEN_NOW);
    pythGet.mockResolvedValue(quotes([[TSLAX_ID, 251.1, new Date(OPEN_NOW.getTime() - 5_000)]]));
    jupGet.mockResolvedValue(
      quotes([
        [TSLAX_ID, 249.9, OPEN_NOW],
        [SPACEX_ID, 310.5, OPEN_NOW],
      ]),
    );

    const m = await getPrices([SPACEX_ID, TSLAX_ID]);

    expect(pythGet).toHaveBeenCalledTimes(1);
    const sentToPyth = pythGet.mock.calls[0][0] as AssetInfo[];
    expect(sentToPyth.map((a) => a.assetId)).toEqual([TSLAX_ID]);
    expect(sentToPyth[0]).toMatchObject({ symbol: "TSLAx", underlying: "TSLA" });
    expect(jupGet).toHaveBeenCalledTimes(1);
    expect((jupGet.mock.calls[0][0] as AssetInfo[]).map((a) => a.assetId).sort()).toEqual([SPACEX_ID, TSLAX_ID].sort());

    expect(m.get(SPACEX_ID)).toMatchObject({ symbol: "SPACEX", price: 310.5, source: "jupiter", marketOpen: true });
    expect(m.get(TSLAX_ID)).toMatchObject({ symbol: "TSLAx", price: 251.1, source: "pyth" });
  });

  it("market open, only pre-IPO tokens requested: Hermes is not called at all", async () => {
    vi.setSystemTime(OPEN_NOW);
    jupGet.mockResolvedValue(quotes([[SPACEX_ID, 310.5, OPEN_NOW]]));
    const q = await getPrice(SPACEX_ID);
    expect(pythGet).not.toHaveBeenCalled();
    expect(q).toMatchObject({ symbol: "SPACEX", price: 310.5, source: "jupiter" });
  });
});
