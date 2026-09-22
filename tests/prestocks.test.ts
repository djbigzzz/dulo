import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetId } from "@/lib/core";
import { SOLANA_MAINNET } from "@/lib/core";
import { normaliseQty as normaliseQtyImpl } from "@/lib/assets/normalise";
import {
  CATALOGUE_TTL_MS,
  PRESTOCKS_DECIMALS,
  PRESTOCKS_DEFAULT_API_URL,
  PRESTOCKS_LOGO_BASE,
  PRESTOCKS_SOURCE_NAME,
  PRESTOCKS_STATIC,
  REFRESH_RETRY_MS,
  assetInfoFromToken,
  configurePreStocks,
  entriesToTokens,
  getPreStocksByMint,
  getPreStocksMarks,
  listAssetsFromTokens,
  marksFromTokens,
  preStocksCatalogueOrigin,
  preStocksLogoUrl,
  prestocks,
  refreshPreStocksCatalogue,
  resetPreStocks,
  setPreStocksFetch,
  waitForPreStocksRefresh,
  type FetchLike,
  type PreStocksToken,
} from "@/lib/assets/prestocks";
import fixture from "./fixtures/prestocks-api-2026-09-22.json";

/**
 * The PreStocks AssetSource against the recorded API response (tests/fixtures/
 * prestocks-api-2026-09-22.json, fetched once on 22 Sep 2026). Nothing here touches the network:
 * every fetch is the fake below, and the lookups are proven to need no fetch at all.
 */

const TOKENS = fixture.response as unknown as PreStocksToken[];
const BASE = "https://prestocks.test/api/prestocks";
const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);

const SPACEX_MINT = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const SPACEX_ID = `${SOLANA_MAINNET}/token:${SPACEX_MINT}` as AssetId;
const OPENAI_MINT = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const NINTH_MINT = "Pre9999999999999999999999999999999999999999";

/** The eight symbol -> mint pairs the task text lists (verified live on 17 Sep 2026). */
const EXPECTED_MINTS: Record<string, string> = {
  ANDURIL: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB",
  ANTHROPIC: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
  FIGUREAI: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd",
  KALSHI: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua",
  NEURALINK: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S",
  OPENAI: OPENAI_MINT,
  POLYMARKET: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP",
  SPACEX: SPACEX_MINT,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface FakeFetch {
  fn: FetchLike;
  calls: string[];
  /** Replace what the API answers (body | Response | Error | function). */
  answer(value: unknown): void;
}

function fakeFetch(initial: unknown = TOKENS): FakeFetch {
  let value = initial;
  const calls: string[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push(url);
    const v = typeof value === "function" ? await (value as (u: string, i?: RequestInit) => unknown)(url, init) : value;
    if (v instanceof Error) throw v;
    if (v instanceof Response) return v;
    return json(v);
  };
  return {
    fn,
    calls,
    answer(v) {
      value = v;
    },
  };
}

let clock = T0;
const now = () => clock;

beforeEach(() => {
  resetPreStocks();
  clock = T0;
  configurePreStocks({ apiUrl: BASE, now });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Static list
// ---------------------------------------------------------------------------

describe("the inlined static list", () => {
  it("holds exactly the eight verified mints, every one starting with Pre, distinct and base58", () => {
    expect(PRESTOCKS_STATIC).toHaveLength(8);
    const byMint = Object.fromEntries(PRESTOCKS_STATIC.map((e) => [e.symbol, e.mint]));
    expect(byMint).toEqual(EXPECTED_MINTS);
    for (const e of PRESTOCKS_STATIC) {
      expect(e.mint.startsWith("Pre"), e.symbol).toBe(true);
      expect(e.mint, e.symbol).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      expect(e.symbol).toBe(e.symbol.toUpperCase());
    }
    expect(new Set(PRESTOCKS_STATIC.map((e) => e.mint)).size).toBe(8);
    expect(new Set(PRESTOCKS_STATIC.map((e) => e.symbol)).size).toBe(8);
  });

  it("agrees with the recorded API on symbol, name, mint and logo for every token", () => {
    const live = listAssetsFromTokens(TOKENS);
    const stat = listAssetsFromTokens(entriesToTokens(PRESTOCKS_STATIC));
    expect(stat.map((a) => [a.symbol, a.name, a.assetId, a.logoUrl]).sort()).toEqual(live.map((a) => [a.symbol, a.name, a.assetId, a.logoUrl]).sort());
  });

  it("names the source prestocks and points at the public API by default", () => {
    expect(prestocks.name).toBe(PRESTOCKS_SOURCE_NAME);
    expect(PRESTOCKS_SOURCE_NAME).toBe("prestocks");
    expect(PRESTOCKS_DEFAULT_API_URL).toBe("https://prestocks.com/api/prestocks");
  });
});

// ---------------------------------------------------------------------------
// Pure mapping
// ---------------------------------------------------------------------------

describe("assetInfoFromToken / listAssetsFromTokens", () => {
  it("maps SPACEX to a CAIP-19 id, 9 decimals, symbol as underlying, sector null, no Pyth feed, multiplier 1 and the API logo", () => {
    const token = TOKENS.find((t) => t.symbol === "SPACEX")!;
    expect(assetInfoFromToken(token)).toEqual({
      assetId: SPACEX_ID,
      chainId: SOLANA_MAINNET,
      symbol: "SPACEX",
      underlying: "SPACEX",
      name: "SpaceX PreStocks",
      decimals: PRESTOCKS_DECIMALS,
      sector: null,
      logoUrl: "https://www.prestocks.com/logos/spacex.png",
      pythFeedId: null,
      multiplier: 1,
    });
    expect(PRESTOCKS_DECIMALS).toBe(9);
    expect(preStocksLogoUrl("SPACEX")).toBe(`${PRESTOCKS_LOGO_BASE}/spacex.png`);
  });

  it("maps all eight recorded tokens, none with a sector or a Pyth feed", () => {
    const assets = listAssetsFromTokens(TOKENS);
    expect(assets).toHaveLength(8);
    for (const a of assets) {
      expect(a.sector, a.symbol).toBeNull();
      expect(a.pythFeedId, a.symbol).toBeNull();
      expect(a.decimals, a.symbol).toBe(9);
      expect(a.underlying, a.symbol).toBe(a.symbol);
      expect(a.multiplier, a.symbol).toBe(1);
    }
  });

  it("drops a token with no symbol, an invalid mint, or a duplicated mint; applies a decimals override; defaults the name and logo", () => {
    const spacex = TOKENS.find((t) => t.symbol === "SPACEX")!;
    const assets = listAssetsFromTokens(
      [
        { ...spacex, symbol: "" },
        { ...spacex, contract_address: "not-a-mint" },
        { ...spacex, name: "", image: null },
        { ...spacex, symbol: "DUPLICATE" },
        { name: "x", symbol: "OTHER", contract_address: OPENAI_MINT },
      ],
      { [OPENAI_MINT]: 6 },
    );
    expect(assets.map((a) => [a.symbol, a.name, a.logoUrl, a.decimals])).toEqual([
      ["SPACEX", "SPACEX PreStocks", "https://www.prestocks.com/logos/spacex.png", 9],
      ["OTHER", "x", "https://www.prestocks.com/logos/other.png", 6],
    ]);
    expect(assetInfoFromToken(null as unknown as PreStocksToken)).toBeNull();
    expect(listAssetsFromTokens(null as unknown as PreStocksToken[])).toEqual([]);
  });

  it("marksFromTokens keeps the issuer mark and the DEX price as two numbers and nulls anything that is not a positive number", () => {
    const at = new Date(T0);
    const marks = marksFromTokens(TOKENS, at);
    expect(marks.size).toBe(8);
    expect(marks.get("SPACEX")).toEqual({ symbol: "SPACEX", markPrice: 151.51182610461655, tokenPrice: 114.29899414479613, fetchedAt: at });
    for (const m of marks.values()) expect(m.markPrice, m.symbol).not.toBe(m.tokenPrice);
    const spacex = TOKENS.find((t) => t.symbol === "SPACEX")!;
    const odd = marksFromTokens([{ ...spacex, markPrice: "abc", tokenPrice: -1 }, { ...spacex, symbol: "Z", contract_address: OPENAI_MINT, markPrice: "12.5", tokenPrice: undefined }], at);
    expect(odd.get("SPACEX")).toMatchObject({ markPrice: null, tokenPrice: null });
    expect(odd.get("Z")).toMatchObject({ markPrice: 12.5, tokenPrice: null });
  });
});

// ---------------------------------------------------------------------------
// Lookups never need the network
// ---------------------------------------------------------------------------

describe("lookups", () => {
  it("mintSet, getAsset, getAssetBySymbol and getPreStocksByMint answer from the static list without a single fetch", async () => {
    const f = fakeFetch(new Error("network must not be touched"));
    setPreStocksFetch(f.fn);

    expect(await prestocks.mintSet()).toEqual(new Set(Object.values(EXPECTED_MINTS)));
    expect((await prestocks.getAsset(SPACEX_ID))?.symbol).toBe("SPACEX");
    expect((await prestocks.getAssetBySymbol(" openai "))?.assetId).toBe(`${SOLANA_MAINNET}/token:${OPENAI_MINT}`);
    expect((await getPreStocksByMint(OPENAI_MINT))?.symbol).toBe("OPENAI");
    expect(await prestocks.getAsset("nonsense" as AssetId)).toBeNull();
    expect(await prestocks.getAssetBySymbol("TSLAx")).toBeNull();
    expect(await getPreStocksByMint("")).toBeNull();
    expect(f.calls).toEqual([]);
    expect(preStocksCatalogueOrigin()).toBe("static");
  });

  it("normaliseQty delegates to lib/assets/normalise (exact BigInt math, 9 decimals)", () => {
    expect(prestocks.normaliseQty("1000000000", 9, 5)).toBe(5);
    expect(prestocks.normaliseQty("123456789", 9, 1.4861347)).toBe(normaliseQtyImpl("123456789", 9, 1.4861347));
  });
});

// ---------------------------------------------------------------------------
// listAssets: static first, live in the background, 1h cache
// ---------------------------------------------------------------------------

describe("listAssets", () => {
  it("serves the static list at once, refreshes in the background, then serves the live catalogue for an hour", async () => {
    const f = fakeFetch();
    setPreStocksFetch(f.fn);

    const first = await prestocks.listAssets();
    expect(first).toHaveLength(8);
    expect(preStocksCatalogueOrigin()).toBe("static");
    expect(f.calls).toEqual([BASE]);

    await waitForPreStocksRefresh();
    expect(preStocksCatalogueOrigin()).toBe("api");

    clock += CATALOGUE_TTL_MS - 1;
    await prestocks.listAssets();
    expect(f.calls).toHaveLength(1);

    clock += 2;
    const stale = await prestocks.listAssets();
    expect(stale).toHaveLength(8);
    expect(f.calls).toHaveLength(2);
    await waitForPreStocksRefresh();
  });

  it("passes an AbortSignal and the JSON accept header", async () => {
    const seen: RequestInit[] = [];
    setPreStocksFetch(async (_url, init) => {
      seen.push(init ?? {});
      return json(TOKENS);
    });
    await prestocks.listAssets();
    await waitForPreStocksRefresh();
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
    expect((seen[0].headers as Record<string, string>).accept).toBe("application/json");
  });

  it("a live fetch can only add: a ninth token joins the mint set and an omitted static token stays in it", async () => {
    const ninth: PreStocksToken = { name: "Ninth PreStocks", symbol: "NINTH", contract_address: NINTH_MINT, image: null };
    const withoutSpacex = TOKENS.filter((t) => t.symbol !== "SPACEX");
    const f = fakeFetch([...withoutSpacex, ninth]);
    setPreStocksFetch(f.fn);

    await prestocks.listAssets();
    await waitForPreStocksRefresh();

    const mints = await prestocks.mintSet();
    expect(mints.has(NINTH_MINT)).toBe(true);
    expect(mints.has(SPACEX_MINT)).toBe(true);
    expect(mints.size).toBe(9);
    expect((await prestocks.getAssetBySymbol("ninth"))?.name).toBe("Ninth PreStocks");
    expect((await prestocks.getAsset(SPACEX_ID))?.symbol).toBe("SPACEX");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("omitted 1 static token(s) (SPACEX)"));
  });

  it("keeps the static list on HTTP failure, a malformed body or an empty array, reports 'fallback', and retries only after the cool-off", async () => {
    const f = fakeFetch(json({ message: "down" }, 503));
    setPreStocksFetch(f.fn);

    expect(await prestocks.listAssets()).toHaveLength(8);
    await waitForPreStocksRefresh();
    expect(preStocksCatalogueOrigin()).toBe("fallback");
    expect(f.calls).toHaveLength(1);

    clock += REFRESH_RETRY_MS - 1;
    await prestocks.listAssets();
    expect(f.calls).toHaveLength(1);

    f.answer({ not: "an array" });
    clock += 2;
    await prestocks.listAssets();
    await waitForPreStocksRefresh();
    expect(f.calls).toHaveLength(2);
    expect(preStocksCatalogueOrigin()).toBe("fallback");

    f.answer([]);
    clock += REFRESH_RETRY_MS;
    await prestocks.listAssets();
    await waitForPreStocksRefresh();
    expect(preStocksCatalogueOrigin()).toBe("fallback");
    expect(await prestocks.mintSet()).toEqual(new Set(Object.values(EXPECTED_MINTS)));

    f.answer(TOKENS);
    clock += REFRESH_RETRY_MS;
    await prestocks.listAssets();
    await waitForPreStocksRefresh();
    expect(preStocksCatalogueOrigin()).toBe("api");
  });

  it("a failed refresh keeps the previously fetched catalogue, not the static list", async () => {
    const ninth: PreStocksToken = { name: "Ninth PreStocks", symbol: "NINTH", contract_address: NINTH_MINT };
    const f = fakeFetch([...TOKENS, ninth]);
    setPreStocksFetch(f.fn);
    await prestocks.listAssets();
    await waitForPreStocksRefresh();
    expect((await prestocks.mintSet()).size).toBe(9);

    f.answer(new Error("ECONNRESET"));
    clock += CATALOGUE_TTL_MS + 1;
    await prestocks.listAssets();
    await waitForPreStocksRefresh();
    expect(preStocksCatalogueOrigin()).toBe("api");
    expect((await prestocks.mintSet()).size).toBe(9);
  });

  it("times out a hanging fetch via AbortController and falls back", async () => {
    configurePreStocks({ timeoutMs: 20 });
    setPreStocksFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    expect(await refreshPreStocksCatalogue()).toBe(false);
    expect(await prestocks.listAssets()).toHaveLength(8);
    expect(preStocksCatalogueOrigin()).toBe("fallback");
  });

  it("never throws, even when fetch itself throws synchronously", async () => {
    setPreStocksFetch(() => {
      throw new TypeError("fetch exploded");
    });
    await expect(prestocks.listAssets()).resolves.toHaveLength(8);
    await waitForPreStocksRefresh();
    await expect(getPreStocksMarks()).resolves.toEqual(new Map());
    expect(preStocksCatalogueOrigin()).toBe("fallback");
  });

  it("shares one in-flight refresh between concurrent callers", async () => {
    const f = fakeFetch();
    setPreStocksFetch(f.fn);
    await Promise.all([prestocks.listAssets(), prestocks.listAssets(), getPreStocksMarks()]);
    await waitForPreStocksRefresh();
    expect(f.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Marks: issuer mark vs DEX price
// ---------------------------------------------------------------------------

describe("getPreStocksMarks", () => {
  it("awaits one fetch, returns the mark and the DEX price for all eight symbols with the fetch time, and reuses the payload for an hour", async () => {
    const f = fakeFetch();
    setPreStocksFetch(f.fn);

    const marks = await getPreStocksMarks();
    expect(f.calls).toEqual([BASE]);
    expect([...marks.keys()].sort()).toEqual(Object.keys(EXPECTED_MINTS).sort());
    const spacex = marks.get("SPACEX")!;
    expect(spacex.markPrice).toBeCloseTo(151.5118, 4);
    expect(spacex.tokenPrice).toBeCloseTo(114.299, 3);
    expect(spacex.fetchedAt).toEqual(new Date(T0));
    // NEURALINK traded above its mark that day, SPACEX below: two numbers, never a discount.
    const neuralink = marks.get("NEURALINK")!;
    expect(neuralink.tokenPrice!).toBeGreaterThan(neuralink.markPrice!);
    expect(spacex.tokenPrice!).toBeLessThan(spacex.markPrice!);

    clock += CATALOGUE_TTL_MS - 1;
    await getPreStocksMarks();
    expect(f.calls).toHaveLength(1);
  });

  it("is empty before the API has ever answered and keeps the last good marks (with their original fetchedAt) across a failed refresh", async () => {
    const f = fakeFetch(new Error("offline"));
    setPreStocksFetch(f.fn);
    expect(await getPreStocksMarks()).toEqual(new Map());

    f.answer(TOKENS);
    clock += REFRESH_RETRY_MS;
    const good = await getPreStocksMarks();
    expect(good.size).toBe(8);
    const fetchedAt = good.get("OPENAI")!.fetchedAt;

    f.answer(json({ message: "down" }, 500));
    clock += CATALOGUE_TTL_MS + 1;
    const kept = await getPreStocksMarks();
    expect(kept.size).toBe(8);
    expect(kept.get("OPENAI")!.fetchedAt).toEqual(fetchedAt);
    expect(preStocksCatalogueOrigin()).toBe("api");
  });

  it("hands out a copy: mutating the result never touches the cache", async () => {
    setPreStocksFetch(fakeFetch().fn);
    const a = await getPreStocksMarks();
    a.delete("SPACEX");
    expect((await getPreStocksMarks()).has("SPACEX")).toBe(true);
  });
});
