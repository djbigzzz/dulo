import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetId, AssetInfo } from "@/lib/core";
import { SOLANA_MAINNET } from "@/lib/core";
import { SLOT_MS } from "@/lib/adapters/solana";
import { JUPITER_PRICE_URL, createJupiterSource, fetchJupiterPrices, getJupiterStockData, type SlotTimeSource } from "@/lib/prices/jupiter";

// Jupiter Price v3 gives no publish time, only the slot (`blockId`) a quote came from.
// These tests pin how a quote is dated, in order of preference:
//   (a) the estimated slot time through the ChainAdapter (one shared anchor, no per-slot RPC),
//   (b) else stockData.updatedAt,
//   (c) else null — never the fetch time.
// The exact per-slot block time is opt-in via { exactBlockTime: true }.

const TSLAX_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const AAPLX_MINT = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const METAX_MINT = "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu";
const NVDAX_MINT = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";

function asset(mint: string, symbol: string, underlying: string): AssetInfo {
  return {
    assetId: `${SOLANA_MAINNET}/token:${mint}` as AssetId,
    chainId: SOLANA_MAINNET,
    symbol,
    underlying,
    name: `${underlying} xStock`,
    decimals: 8,
    sector: null,
    logoUrl: null,
    pythFeedId: null,
    multiplier: 1,
  };
}

const TSLAX = asset(TSLAX_MINT, "TSLAx", "TSLA");
const AAPLX = asset(AAPLX_MINT, "AAPLx", "AAPL");
const METAX = asset(METAX_MINT, "METAx", "META");
const NVDAX = asset(NVDAX_MINT, "NVDAx", "NVDA");
/** A native-SOL id: valid CAIP-19 but not a token, so Jupiter is never asked for it. */
const SOL_NATIVE: AssetInfo = { ...asset("ignored", "SOL", "SOL"), assetId: `${SOLANA_MAINNET}/slip44:501` as AssetId };

const SLOT_A = 372_795_734;
const SLOT_B = 372_795_800;
const SLOT_UNKNOWN = 372_000_000;
/** Exact block times the fake ledger knows (exactBlockTime mode). */
const BLOCK_TIME_A = new Date("2026-09-11T19:59:40.000Z");
const BLOCK_TIME_B = new Date("2026-09-11T20:00:10.000Z");
/**
 * The fake adapter's slot anchor: 100 slots after SLOT_B, i.e. 40 s later, so SLOT_B estimates
 * exactly and SLOT_A lands 3.6 s early (the fake ledger runs ~454 ms/slot between A and B —
 * the real-world drift the ± in "±a few seconds" stands for). Estimates are arithmetic on it.
 */
const ANCHOR_SLOT = SLOT_B + 100;
const ANCHOR_AT = new Date("2026-09-11T20:00:50.000Z");
const ESTIMATE_A = new Date(ANCHOR_AT.getTime() - (ANCHOR_SLOT - SLOT_A) * SLOT_MS);
const ESTIMATE_B = new Date(ANCHOR_AT.getTime() - (ANCHOR_SLOT - SLOT_B) * SLOT_MS);
const STOCK_UPDATED_AT = "2026-09-11T20:00:00.000Z";

const FETCHED_AT = new Date("2026-09-13T14:00:00.000Z"); // a Sunday, two days after the last trade

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

type FakeChain = SlotTimeSource & { estimateSlotTime: ReturnType<typeof vi.fn>; getBlockTime: ReturnType<typeof vi.fn> };

function fakeChain(): FakeChain {
  return {
    estimateSlotTime: vi.fn(async (slot: number) => new Date(ANCHOR_AT.getTime() - (ANCHOR_SLOT - slot) * SLOT_MS)),
    getBlockTime: vi.fn(async (slot: number) => (slot === SLOT_A ? BLOCK_TIME_A : slot === SLOT_B ? BLOCK_TIME_B : null)),
  };
}

beforeAll(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(FETCHED_AT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("jupiter.getPrices — publishedAt", () => {
  it("(a) dates each quote by the estimated time of its blockId, one estimate per distinct slot, no block-time RPC", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        [TSLAX_MINT]: { usdPrice: 249.9, blockId: SLOT_A, decimals: 8, stockData: { id: "xstocks", price: 250, updatedAt: STOCK_UPDATED_AT } },
        [AAPLX_MINT]: { usdPrice: 190.5, blockId: SLOT_A, decimals: 8 }, // same slot as TSLAx
        [METAX_MINT]: { usdPrice: 512.25, blockId: SLOT_B, decimals: 8 },
      }),
    );
    const chain = fakeChain();
    const out = await createJupiterSource({ chain }).getPrices([TSLAX, AAPLX, METAX, SOL_NATIVE]);

    expect(out.size).toBe(3);
    expect(out.get(TSLAX.assetId)).toEqual({ price: 249.9, publishedAt: ESTIMATE_A });
    expect(out.get(AAPLX.assetId)).toEqual({ price: 190.5, publishedAt: ESTIMATE_A });
    expect(out.get(METAX.assetId)).toEqual({ price: 512.25, publishedAt: ESTIMATE_B });
    expect(out.has(SOL_NATIVE.assetId)).toBe(false);

    // Sanity: the estimate is within a few seconds of the real block time, and the two slots keep their spacing.
    expect(Math.abs(ESTIMATE_A.getTime() - BLOCK_TIME_A.getTime())).toBeLessThanOrEqual(5_000);
    expect(ESTIMATE_B.getTime() - ESTIMATE_A.getTime()).toBe((SLOT_B - SLOT_A) * SLOT_MS);

    // The estimate beats stockData.updatedAt when both exist, and it is never the fetch time.
    expect(out.get(TSLAX.assetId)!.publishedAt).not.toEqual(new Date(STOCK_UPDATED_AT));
    expect(out.get(TSLAX.assetId)!.publishedAt).not.toEqual(FETCHED_AT);

    // Two distinct slots -> two (cheap, anchor-sharing) estimates, no duplicates; the exact path is never touched.
    expect(chain.estimateSlotTime).toHaveBeenCalledTimes(2);
    expect(chain.estimateSlotTime.mock.calls.map((c) => c[0]).sort()).toEqual([SLOT_A, SLOT_B]);
    expect(chain.getBlockTime).not.toHaveBeenCalled();

    // One Jupiter request for the whole batch, only for token mints.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(JUPITER_PRICE_URL);
    expect(url.searchParams.get("ids")!.split(",").sort()).toEqual([TSLAX_MINT, AAPLX_MINT, METAX_MINT].sort());
  });

  it("(b) falls back to stockData.updatedAt when there is no usable blockId", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        [TSLAX_MINT]: { usdPrice: 249.9, stockData: { id: "xstocks", price: 250, updatedAt: STOCK_UPDATED_AT } }, // no blockId
        [METAX_MINT]: { usdPrice: 512.25, blockId: -5, stockData: { id: "xstocks", price: 512, updatedAt: STOCK_UPDATED_AT } }, // junk blockId
        [NVDAX_MINT]: { usdPrice: 181, blockId: 1.5, stockData: { id: "xstocks", price: 181, updatedAt: STOCK_UPDATED_AT } }, // junk blockId
      }),
    );
    const chain = fakeChain();
    const out = await createJupiterSource({ chain }).getPrices([TSLAX, METAX, NVDAX]);

    for (const a of [TSLAX, METAX, NVDAX]) {
      expect(out.get(a.assetId)?.publishedAt, a.symbol).toEqual(new Date(STOCK_UPDATED_AT));
    }
    // Nothing plausible to estimate, so the chain is not asked at all.
    expect(chain.estimateSlotTime).not.toHaveBeenCalled();
    expect(chain.getBlockTime).not.toHaveBeenCalled();
  });

  it("(b) falls back to stockData.updatedAt when the adapter has no anchor (estimate null)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        [TSLAX_MINT]: { usdPrice: 249.9, blockId: SLOT_A, stockData: { id: "xstocks", price: 250, updatedAt: STOCK_UPDATED_AT } },
        [AAPLX_MINT]: { usdPrice: 190.5, blockId: SLOT_B, stockData: { id: "xstocks", price: 190, updatedAt: STOCK_UPDATED_AT } },
      }),
    );
    const chain = fakeChain();
    chain.estimateSlotTime.mockResolvedValue(null); // RPC down: getSlot failed, adapter reports "no anchor"
    const out = await createJupiterSource({ chain }).getPrices([TSLAX, AAPLX]);

    expect(out.get(TSLAX.assetId)).toEqual({ price: 249.9, publishedAt: new Date(STOCK_UPDATED_AT) });
    expect(out.get(AAPLX.assetId)).toEqual({ price: 190.5, publishedAt: new Date(STOCK_UPDATED_AT) });
    expect(chain.estimateSlotTime).toHaveBeenCalledTimes(2);
    // The estimate failing never triggers the per-slot RPC path on the hot path.
    expect(chain.getBlockTime).not.toHaveBeenCalled();
  });

  it("(c) yields publishedAt null when neither an estimate nor stockData.updatedAt is available", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        [TSLAX_MINT]: { usdPrice: 249.9 }, // nothing to date it with
        [AAPLX_MINT]: { usdPrice: 190.5, blockId: SLOT_UNKNOWN }, // estimate unavailable, no stockData
        [METAX_MINT]: { usdPrice: 512.25, blockId: SLOT_A, stockData: { id: "xstocks", price: 512, updatedAt: "not-a-date" } },
        [NVDAX_MINT]: { usdPrice: 181, blockId: SLOT_B },
      }),
    );
    const chain = fakeChain();
    chain.estimateSlotTime.mockImplementation(async (slot: number) => {
      if (slot === SLOT_A) throw new Error("RPC exploded"); // adapter contract is null, but be defensive
      return null;
    });
    const out = await createJupiterSource({ chain }).getPrices([TSLAX, AAPLX, METAX, NVDAX]);

    expect(out.get(TSLAX.assetId)).toEqual({ price: 249.9, publishedAt: null });
    expect(out.get(AAPLX.assetId)).toEqual({ price: 190.5, publishedAt: null });
    expect(out.get(METAX.assetId)).toEqual({ price: 512.25, publishedAt: null });
    expect(out.get(NVDAX.assetId)).toEqual({ price: 181, publishedAt: null });
    // Prices are never stamped with the fetch time.
    for (const q of out.values()) expect(q.publishedAt).not.toEqual(FETCHED_AT);
  });

  it("uses the exact block time per distinct slot only when asked ({ exactBlockTime: true })", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        [TSLAX_MINT]: { usdPrice: 249.9, blockId: SLOT_A, stockData: { id: "xstocks", price: 250, updatedAt: STOCK_UPDATED_AT } },
        [AAPLX_MINT]: { usdPrice: 190.5, blockId: SLOT_A },
        [METAX_MINT]: { usdPrice: 512.25, blockId: SLOT_B },
        [NVDAX_MINT]: { usdPrice: 181, blockId: SLOT_UNKNOWN, stockData: { id: "xstocks", price: 181, updatedAt: STOCK_UPDATED_AT } }, // pruned slot
      }),
    );
    const chain = fakeChain();
    const out = await createJupiterSource({ chain, exactBlockTime: true }).getPrices([TSLAX, AAPLX, METAX, NVDAX]);

    expect(out.get(TSLAX.assetId)).toEqual({ price: 249.9, publishedAt: BLOCK_TIME_A });
    expect(out.get(AAPLX.assetId)).toEqual({ price: 190.5, publishedAt: BLOCK_TIME_A });
    expect(out.get(METAX.assetId)).toEqual({ price: 512.25, publishedAt: BLOCK_TIME_B });
    // Unknown block time -> stockData, exactly like the estimate path.
    expect(out.get(NVDAX.assetId)).toEqual({ price: 181, publishedAt: new Date(STOCK_UPDATED_AT) });

    expect(chain.getBlockTime).toHaveBeenCalledTimes(3);
    expect(chain.getBlockTime.mock.calls.map((c) => c[0]).sort()).toEqual([SLOT_UNKNOWN, SLOT_A, SLOT_B]);
    expect(chain.estimateSlotTime).not.toHaveBeenCalled();
  });

  it("skips mints Jupiter did not price or priced with junk, and never throws on transport failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        [TSLAX_MINT]: { usdPrice: 249.9, blockId: SLOT_A },
        [AAPLX_MINT]: null,
        [METAX_MINT]: { usdPrice: 0, blockId: SLOT_A },
        [NVDAX_MINT]: { usdPrice: "181", blockId: SLOT_A },
      }),
    );
    const chain = fakeChain();
    const source = createJupiterSource({ chain });
    const out = await source.getPrices([TSLAX, AAPLX, METAX, NVDAX]);
    expect([...out.keys()]).toEqual([TSLAX.assetId]);

    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await source.getPrices([TSLAX])).toEqual(new Map());
    expect(warn).toHaveBeenCalled();

    expect(await source.getPrices([])).toEqual(new Map());
    expect(await source.getPrices([SOL_NATIVE])).toEqual(new Map());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prices 50 mints with one Jupiter request and one estimate per distinct slot (no per-slot RPC)", async () => {
    const mints = Array.from({ length: 50 }, (_, i) => `Xs${String(i).padStart(42, "0")}`);
    const assets = mints.map((m, i) => asset(m, `S${i}x`, `S${i}`));
    fetchMock.mockImplementation(async (input) => {
      const ids = new URL(String(input)).searchParams.get("ids")!.split(",");
      const body: Record<string, unknown> = {};
      // 50 mints spread over 12 distinct slots — the shape that used to cost 12 getBlockTime RPCs.
      ids.forEach((m, i) => (body[m] = { usdPrice: 1 + i, blockId: SLOT_A + (i % 12) }));
      return jsonResponse(200, body);
    });
    const chain = fakeChain();
    const out = await createJupiterSource({ chain }).getPrices(assets);

    expect(out.size).toBe(50);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(chain.estimateSlotTime).toHaveBeenCalledTimes(12);
    expect(new Set(chain.estimateSlotTime.mock.calls.map((c) => c[0])).size).toBe(12);
    expect(chain.getBlockTime).not.toHaveBeenCalled();
    for (const [i, a] of assets.entries()) {
      expect(out.get(a.assetId)!.publishedAt).toEqual(new Date(ANCHOR_AT.getTime() - (ANCHOR_SLOT - (SLOT_A + (i % 12))) * SLOT_MS));
    }
  });
});

describe("fetchJupiterPrices / getJupiterStockData", () => {
  it("dedupes mints, chunks at 50 and exposes underlying stock data", async () => {
    const mints = Array.from({ length: 60 }, (_, i) => `Xs${String(i).padStart(42, "0")}`);
    fetchMock.mockImplementation(async (input) => {
      const ids = new URL(String(input)).searchParams.get("ids")!.split(",");
      const body: Record<string, unknown> = {};
      for (const m of ids) body[m] = { usdPrice: 1, blockId: SLOT_A, stockData: { id: "xstocks", price: 1, updatedAt: STOCK_UPDATED_AT } };
      return jsonResponse(200, body);
    });
    const entries = await fetchJupiterPrices([...mints, ...mints, " ", TSLAX_MINT]);
    expect(entries.size).toBe(61);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sizes = fetchMock.mock.calls.map((c) => new URL(String(c[0])).searchParams.get("ids")!.split(",").length);
    expect(sizes.sort()).toEqual([11, 50]);

    fetchMock.mockClear();
    const sd = await getJupiterStockData([TSLAX_MINT]);
    expect(sd.get(TSLAX_MINT)).toEqual({ id: "xstocks", price: 1, updatedAt: STOCK_UPDATED_AT });
  });
});
