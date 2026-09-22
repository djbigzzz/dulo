import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetId, AssetInfo } from "@/lib/core";

/**
 * lib/assets/registry: the union over every AssetSource, in registration order, with each
 * source's failure isolated. Both issuer modules are replaced by fakes here; the real ones are
 * covered by tests/xstocks.test.ts and tests/prestocks.test.ts.
 */

const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const TSLAX_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const AAPLX_MINT = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const SPACEX_MINT = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const OPENAI_MINT = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
/** In PreStocks' mint set but in no catalogue (the "in the mint set but not in the catalogue" path). */
const ORPHAN_MINT = "Pre9999999999999999999999999999999999999999";
const TSLAX_ID = `${SOL}/token:${TSLAX_MINT}` as AssetId;
const AAPLX_ID = `${SOL}/token:${AAPLX_MINT}` as AssetId;
const SPACEX_ID = `${SOL}/token:${SPACEX_MINT}` as AssetId;
const ORPHAN_ID = `${SOL}/token:${ORPHAN_MINT}` as AssetId;

function asset(mint: string, symbol: string, decimals: number, sector: string | null): AssetInfo {
  return { assetId: `${SOL}/token:${mint}` as AssetId, chainId: SOL, symbol, underlying: symbol, name: symbol, decimals, sector, logoUrl: null, pythFeedId: null, multiplier: 1 };
}

const TSLAX = asset(TSLAX_MINT, "TSLAx", 8, "Consumer Discretionary");
const AAPLX = asset(AAPLX_MINT, "AAPLx", 8, "Technology");
const SPACEX = asset(SPACEX_MINT, "SPACEX", 9, null);
const OPENAI = asset(OPENAI_MINT, "OPENAI", 9, null);

const mocks = vi.hoisted(() => {
  const source = (name: string) => ({
    name,
    listAssets: vi.fn(),
    getAsset: vi.fn(),
    getAssetBySymbol: vi.fn(),
    mintSet: vi.fn(),
    normaliseQty: vi.fn(),
  });
  return { xstocks: source("xstocks"), prestocks: source("prestocks") };
});

vi.mock("@/lib/assets/xstocks", () => ({ xstocks: mocks.xstocks }));
vi.mock("@/lib/assets/prestocks", () => ({ prestocks: mocks.prestocks }));

import {
  ASSET_SOURCES,
  assetNoun,
  getAssetAnySource,
  getAssetBySymbolAnySource,
  listAllAssets,
  normaliseQtyFor,
  registeredSourceByName,
  resolveAssetAnySource,
  resolveAssetBySymbolAnySource,
  sourceByName,
  sourceOfAsset,
  sourceOfMint,
  unionMintSet,
} from "@/lib/assets/registry";
import { normaliseQty as normaliseQtyImpl } from "@/lib/assets/normalise";

function catalogue(src: typeof mocks.xstocks, assets: AssetInfo[], extraMints: string[] = []) {
  const byId = new Map(assets.map((a) => [a.assetId, a]));
  const bySymbol = new Map(assets.map((a) => [a.symbol.toUpperCase(), a]));
  src.listAssets.mockResolvedValue(assets);
  src.getAsset.mockImplementation(async (id: AssetId) => byId.get(id) ?? null);
  src.getAssetBySymbol.mockImplementation(async (s: string) => bySymbol.get(s.trim().toUpperCase()) ?? null);
  src.mintSet.mockResolvedValue(new Set([...assets.map((a) => a.assetId.split(":").pop() as string), ...extraMints]));
  src.normaliseQty.mockImplementation((raw: string, decimals: number, multiplier: number) => (Number(raw) / 10 ** decimals) * multiplier);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  catalogue(mocks.xstocks, [TSLAX, AAPLX]);
  catalogue(mocks.prestocks, [SPACEX, OPENAI], [ORPHAN_MINT]);
});

describe("ASSET_SOURCES", () => {
  it("registers xStocks first (Pyth-listed underlyings) and PreStocks second (DEX price only), with plain nouns", () => {
    expect(ASSET_SOURCES.map((s) => [s.source.name, s.pythUnderlyings])).toEqual([
      ["xstocks", true],
      ["prestocks", false],
    ]);
    expect(assetNoun("xstocks")).toEqual({ singular: "xStock", plural: "xStocks" });
    expect(assetNoun("prestocks")).toEqual({ singular: "pre-IPO token", plural: "pre-IPO tokens" });
    // Unknown or missing names read as the first source, which is what every legacy row is.
    expect(assetNoun(null)).toEqual(assetNoun("xstocks"));
    expect(assetNoun("kamino")).toEqual(assetNoun("xstocks"));
  });

  it("sourceByName / registeredSourceByName resolve by exact name, trimmed, and reject anything else", () => {
    expect(sourceByName("prestocks")).toBe(mocks.prestocks);
    expect(sourceByName(" xstocks ")).toBe(mocks.xstocks);
    expect(registeredSourceByName("prestocks")?.pythUnderlyings).toBe(false);
    expect(sourceByName("XSTOCKS")).toBeNull();
    expect(sourceByName("")).toBeNull();
    expect(sourceByName(undefined as unknown as string)).toBeNull();
  });
});

describe("union reads", () => {
  it("unionMintSet is every source's mint set together", async () => {
    expect(await unionMintSet()).toEqual(new Set([TSLAX_MINT, AAPLX_MINT, SPACEX_MINT, OPENAI_MINT, ORPHAN_MINT]));
    expect(mocks.xstocks.mintSet).toHaveBeenCalledTimes(1);
    expect(mocks.prestocks.mintSet).toHaveBeenCalledTimes(1);
  });

  it("listAllAssets concatenates the catalogues in registration order and deduplicates by asset id", async () => {
    mocks.prestocks.listAssets.mockResolvedValue([SPACEX, { ...TSLAX, symbol: "TSLA-DUPLICATE" }, OPENAI]);
    const all = await listAllAssets();
    expect(all.map((a) => a.symbol)).toEqual(["TSLAx", "AAPLx", "SPACEX", "OPENAI"]);
  });

  it("resolveAssetAnySource returns the asset, the owning source's name and its Pyth flag; the first registered source wins a tie", async () => {
    expect(await resolveAssetAnySource(TSLAX_ID)).toEqual({ info: TSLAX, source: "xstocks", pythUnderlyings: true });
    expect(await resolveAssetAnySource(SPACEX_ID)).toEqual({ info: SPACEX, source: "prestocks", pythUnderlyings: false });
    expect(await resolveAssetAnySource(ORPHAN_ID)).toBeNull();
    expect(await resolveAssetAnySource("garbage" as AssetId)).toBeNull();
    expect(mocks.xstocks.getAsset).not.toHaveBeenCalledWith("garbage");

    mocks.prestocks.getAsset.mockResolvedValue({ ...TSLAX, symbol: "IMPOSTOR" });
    expect((await resolveAssetAnySource(TSLAX_ID))?.info.symbol).toBe("TSLAx");
    expect(await getAssetAnySource(AAPLX_ID)).toBe(AAPLX);
  });

  it("symbol lookups work across sources and are the sources' own (case-insensitive) lookups", async () => {
    expect(await getAssetBySymbolAnySource("tslax")).toBe(TSLAX);
    expect(await getAssetBySymbolAnySource("spacex")).toBe(SPACEX);
    expect(await resolveAssetBySymbolAnySource("OPENAI")).toEqual({ info: OPENAI, source: "prestocks", pythUnderlyings: false });
    expect(await getAssetBySymbolAnySource("NVDAx")).toBeNull();
    expect(await getAssetBySymbolAnySource("  ")).toBeNull();
    expect(mocks.xstocks.getAssetBySymbol).not.toHaveBeenCalledWith("  ");
  });

  it("sourceOfMint / sourceOfAsset name the owner, through the mint set when the catalogue does not know the mint", async () => {
    expect(await sourceOfMint(TSLAX_MINT)).toBe("xstocks");
    expect(await sourceOfMint(SPACEX_MINT)).toBe("prestocks");
    expect(await sourceOfMint(ORPHAN_MINT)).toBe("prestocks");
    expect(await sourceOfMint("Xs1111111111111111111111111111111111111111")).toBeNull();
    expect(await sourceOfMint("")).toBeNull();
    expect(await sourceOfAsset(AAPLX_ID)).toBe("xstocks");
    expect(await sourceOfAsset(ORPHAN_ID)).toBe("prestocks");
    expect(await sourceOfAsset(`${SOL}/slip44:501` as AssetId)).toBeNull();
  });

  it("normaliseQtyFor uses the named source's maths and the shared exact implementation for an unknown name", () => {
    expect(normaliseQtyFor("prestocks", "1000000000", 9, 5)).toBe(5);
    expect(mocks.prestocks.normaliseQty).toHaveBeenCalledWith("1000000000", 9, 5);
    expect(normaliseQtyFor(null, "150000000", 8, 2)).toBe(normaliseQtyImpl("150000000", 8, 2));
    expect(normaliseQtyFor("kamino", "150000000", 8, 2)).toBe(3);
    expect(mocks.xstocks.normaliseQty).not.toHaveBeenCalled();
  });
});

describe("failure isolation", () => {
  it("a source whose mintSet rejects contributes nothing to the union and the other source still answers", async () => {
    mocks.prestocks.mintSet.mockRejectedValue(new Error("prestocks.com down"));
    expect(await unionMintSet()).toEqual(new Set([TSLAX_MINT, AAPLX_MINT]));
    expect(await sourceOfMint(TSLAX_MINT)).toBe("xstocks");
    expect(await sourceOfMint(SPACEX_MINT)).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("prestocks.mintSet failed — prestocks.com down"));
  });

  it("a source whose listAssets throws synchronously is logged and skipped; the other catalogue is still listed", async () => {
    mocks.xstocks.listAssets.mockImplementation(() => {
      throw new TypeError("boom");
    });
    expect((await listAllAssets()).map((a) => a.symbol)).toEqual(["SPACEX", "OPENAI"]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("xstocks.listAssets failed — boom"));
  });

  it("a source whose getAsset / getAssetBySymbol fails never hides the other source's answer", async () => {
    mocks.xstocks.getAsset.mockRejectedValue(new Error("xstocks api 502"));
    mocks.xstocks.getAssetBySymbol.mockRejectedValue(new Error("xstocks api 502"));
    expect(await getAssetAnySource(SPACEX_ID)).toBe(SPACEX);
    expect(await getAssetAnySource(TSLAX_ID)).toBeNull();
    expect(await getAssetBySymbolAnySource("OPENAI")).toBe(OPENAI);
    expect(await getAssetBySymbolAnySource("TSLAx")).toBeNull();
    // Ownership still resolves through the mint set when the catalogue call failed.
    expect(await sourceOfAsset(TSLAX_ID)).toBe("xstocks");
  });

  it("a source that returns junk instead of a list is treated as empty", async () => {
    mocks.prestocks.listAssets.mockResolvedValue({ not: "a list" });
    expect((await listAllAssets()).map((a) => a.symbol)).toEqual(["TSLAx", "AAPLx"]);
  });
});
