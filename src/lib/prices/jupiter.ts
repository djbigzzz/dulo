/**
 * Jupiter Price v3 source for xStocks token mints.
 *
 *   GET https://api.jup.ag/price/v3?ids=<mint,mint,...>   (max 50 per call; x-api-key optional)
 *   -> { "<mint>": { usdPrice, blockId, decimals, priceChange24h, createdAt, liquidity,
 *                     stockData?: { id: "xstocks", price, mcap, updatedAt } } }
 *
 * Mints without a price are omitted from the response. Jupiter gives no publish time
 * for the token price, only the slot (`blockId`) it was derived in, so publishedAt is
 * resolved per quote, in this order:
 *   (a) the estimated wall-clock time of `blockId` (ChainAdapter.estimateSlotTime):
 *       arithmetic from one recent (slot, time) anchor, ±(a few seconds). The anchor is
 *       ONE getSlot per 60 s for the whole process, never one RPC per slot;
 *   (b) else `stockData.updatedAt` (the underlying stock's last update) when present;
 *   (c) else null — lib/price then reports an unknown age and flags the quote stale.
 * Stamping the fetch time would hide a days-old weekend price behind "12s ago".
 *
 * Cost of one getPrices call: one Jupiter HTTP request per 50 mints (4 in flight) plus
 * at most one getSlot (shared anchor, reused for 60 s). The exact per-slot path — one
 * getBlockTime RPC per distinct slot, cached per slot — is kept behind
 * createJupiterSource({ exactBlockTime: true }) for callers that need block-accurate
 * times. It is off the hot path because the public RPC rate-limits a fan-out of 12+
 * getBlockTime calls into multi-second stalls.
 *
 * Why the estimate is safe for settlement: lib/games/calls.ts resolveSettlePrice settles
 * on Pyth's own publish_time compared with settleAt; it falls back to a lib/price quote
 * only when that quote is fresh (not stale, i.e. younger than STALE_AFTER_SECONDS = 6 h)
 * and never compares a Jupiter publishedAt with settleAt. A ±few-second error therefore
 * moves ageSeconds by a few seconds and can only matter at the 6 h staleness edge, which
 * the acceptance tolerates by design (a quote that old is a weekend price either way).
 *
 * getPrices never throws: a failed chunk is logged and skipped.
 */
import type { AssetId, AssetInfo, ChainAdapter, PriceSource, SourceQuote } from "@/lib/core";
import { mintFromAssetId } from "@/lib/core";
import { solana } from "@/lib/adapters/solana";
import { chunk, fetchJson, mapWithConcurrency, serverEnvOrNull, warn } from "@/lib/prices/http";

export const JUPITER_PRICE_URL = "https://api.jup.ag/price/v3";
export const JUPITER_MAX_IDS = 50;
const CHUNK_CONCURRENCY = 4;

export interface JupiterStockData {
  /** Provider tag, e.g. "xstocks". */
  id: string;
  /** Underlying stock last price in USD. */
  price: number;
  mcap?: number;
  /** ISO timestamp of the underlying price. */
  updatedAt: string;
}

export interface JupiterPriceEntry {
  usdPrice: number;
  blockId?: number;
  decimals?: number;
  priceChange24h?: number;
  createdAt?: string;
  liquidity?: number;
  stockData?: JupiterStockData;
}

type JupiterResponse = Record<string, JupiterPriceEntry | null | undefined>;

function headers(): Record<string, string> {
  const key = serverEnvOrNull()?.JUPITER_API_KEY;
  return key ? { "x-api-key": key } : {};
}

function isValidEntry(e: JupiterPriceEntry | null | undefined): e is JupiterPriceEntry {
  return !!e && typeof e.usdPrice === "number" && Number.isFinite(e.usdPrice) && e.usdPrice > 0;
}

async function fetchChunk(mints: string[]): Promise<JupiterResponse> {
  const url = `${JUPITER_PRICE_URL}?ids=${mints.map(encodeURIComponent).join(",")}`;
  try {
    const res = await fetchJson<JupiterResponse>(url, { headers: headers() });
    return res && typeof res === "object" ? res : {};
  } catch (e) {
    warn("jupiter", `price fetch failed for ${mints.length} mint(s)`, e);
    return {};
  }
}

/** Raw Jupiter entries keyed by mint. Mints Jupiter cannot price are absent. */
export async function fetchJupiterPrices(mints: readonly string[]): Promise<Map<string, JupiterPriceEntry>> {
  const unique = [...new Set(mints.map((m) => m.trim()).filter(Boolean))];
  const out = new Map<string, JupiterPriceEntry>();
  if (unique.length === 0) return out;
  const responses = await mapWithConcurrency(chunk(unique, JUPITER_MAX_IDS), CHUNK_CONCURRENCY, fetchChunk);
  for (const res of responses) {
    for (const [mint, entry] of Object.entries(res)) {
      if (isValidEntry(entry)) out.set(mint, entry);
    }
  }
  return out;
}

/** Underlying stock data (price + updatedAt) where Jupiter provides it, keyed by mint. */
export async function getJupiterStockData(mints: readonly string[]): Promise<Map<string, JupiterStockData>> {
  const entries = await fetchJupiterPrices(mints);
  const out = new Map<string, JupiterStockData>();
  for (const [mint, entry] of entries) {
    const sd = entry.stockData;
    if (sd && typeof sd.price === "number" && Number.isFinite(sd.price) && typeof sd.updatedAt === "string") {
      out.set(mint, sd);
    }
  }
  return out;
}

/** The slice of the ChainAdapter the source needs to date a quote by its slot. */
export type SlotTimeSource = Pick<ChainAdapter, "estimateSlotTime" | "getBlockTime">;

export interface JupiterSourceOptions {
  /** Resolves `blockId` -> time. Defaults to the app's Solana adapter. Tests inject a fake. */
  chain?: SlotTimeSource;
  /**
   * Date quotes with the exact block time of `blockId` (ChainAdapter.getBlockTime: one RPC
   * per distinct slot, cached per slot) instead of the anchored estimate. Off by default —
   * the hot path must not fan out RPC calls. The fallbacks (stockData.updatedAt, then
   * null) are the same in both modes.
   */
  exactBlockTime?: boolean;
}

/** Valid slot number from a raw `blockId`, or null. */
function slotOf(entry: JupiterPriceEntry): number | null {
  const s = entry.blockId;
  return typeof s === "number" && Number.isInteger(s) && s >= 0 ? s : null;
}

/** `stockData.updatedAt` as a Date, or null when absent or unparseable. */
function stockUpdatedAt(entry: JupiterPriceEntry): Date | null {
  const iso = entry.stockData?.updatedAt;
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * A time for every distinct slot. Estimates share one anchor inside the adapter, so
 * resolving them in parallel still costs at most one getSlot. A failing lookup maps to null.
 */
async function slotTimesFor(chain: SlotTimeSource, slots: Iterable<number>, exact: boolean): Promise<Map<number, Date | null>> {
  const unique = [...new Set(slots)];
  const lookup = exact ? (slot: number) => chain.getBlockTime(slot) : (slot: number) => chain.estimateSlotTime(slot);
  const times = await Promise.all(
    unique.map((slot) =>
      Promise.resolve()
        .then(() => lookup(slot))
        .catch((e: unknown) => {
          warn("jupiter", `${exact ? "block time" : "slot time"} lookup failed for slot ${slot}`, e);
          return null;
        }),
    ),
  );
  return new Map(unique.map((slot, i) => [slot, times[i]]));
}

/** Build a Jupiter PriceSource. The default export `jupiter` uses the app's Solana adapter. */
export function createJupiterSource(options: JupiterSourceOptions = {}): PriceSource {
  const chain: SlotTimeSource = options.chain ?? solana;
  const exact = options.exactBlockTime === true;
  return {
    name: "jupiter",
    async getPrices(assets: AssetInfo[]): Promise<Map<AssetId, SourceQuote>> {
      const out = new Map<AssetId, SourceQuote>();
      if (assets.length === 0) return out;
      const mintByAsset = new Map<AssetId, string>();
      for (const a of assets) {
        try {
          mintByAsset.set(a.assetId, mintFromAssetId(a.assetId));
        } catch {
          // Not a Solana token asset; Jupiter cannot price it.
        }
      }
      if (mintByAsset.size === 0) return out;
      try {
        const entries = await fetchJupiterPrices([...mintByAsset.values()]);
        const slots: number[] = [];
        for (const mint of mintByAsset.values()) {
          const e = entries.get(mint);
          const slot = e ? slotOf(e) : null;
          if (slot !== null) slots.push(slot);
        }
        const slotTimes = slots.length ? await slotTimesFor(chain, slots, exact) : new Map<number, Date | null>();
        for (const [assetId, mint] of mintByAsset) {
          const e = entries.get(mint);
          if (!e) continue;
          const slot = slotOf(e);
          const publishedAt = (slot !== null ? slotTimes.get(slot) : null) ?? stockUpdatedAt(e);
          out.set(assetId, { price: e.usdPrice, publishedAt });
        }
      } catch (e) {
        warn("jupiter", "getPrices failed; returning no quotes", e);
      }
      return out;
    },
  };
}

export const jupiter: PriceSource = createJupiterSource();
