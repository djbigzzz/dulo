import type { AssetId, ChainId } from "./caip";

/** Where a price came from. Every price shown in the UI carries source + age. */
export type PriceSourceName = "pyth" | "jupiter" | "cache" | "none";

export interface PriceQuote {
  assetId: AssetId;
  symbol: string;
  /** USD price. null when no source could quote. */
  price: number | null;
  source: PriceSourceName;
  /** When the source last published this price. */
  publishedAt: Date | null;
  /** Age in seconds at the time the quote was produced. */
  ageSeconds: number | null;
  /** True when publishedAt is older than the freshness bound (6h by default). */
  stale: boolean;
  /** True when the US equity session is open at quote time. */
  marketOpen: boolean;
}

/**
 * The AssetSource a holding is assumed to come from when it carries no source of its own.
 * Snapshot rows written before holdings were source-tagged are all xStocks, so reading them
 * back with this default is exact rather than a guess.
 */
export const DEFAULT_ASSET_SOURCE = "xstocks";

/** One normalised holding inside a wallet Snapshot. Stored as JSON. */
export interface Holding {
  assetId: AssetId;
  symbol: string;
  /** AssetSource that resolved this holding, e.g. "xstocks". Scopes which quests can see it. */
  source: string;
  /** Raw token amount as a decimal string (base units, pre-multiplier). */
  raw: string;
  /** Token-2022 ScaledUiAmount multiplier (1 when not applicable). */
  multiplier: number;
  /** Human quantity = raw / 10^decimals * multiplier. */
  qty: number;
  price: number | null;
  priceSource: PriceSourceName;
  usd: number;
}

/** A point-in-time set of holdings for one wallet. */
export interface HoldingsSnapshot {
  walletId: string;
  takenAt: Date;
  holdings: Holding[];
}

/** Static metadata about an asset the app knows how to value. */
export interface AssetInfo {
  assetId: AssetId;
  chainId: ChainId;
  /** e.g. "TSLAx" */
  symbol: string;
  /** Underlying ticker, e.g. "TSLA" */
  underlying: string;
  name: string;
  decimals: number;
  /** e.g. "Technology" */
  sector: string | null;
  logoUrl: string | null;
  /** Pyth price feed id for the underlying (hex, 0x-prefixed) when known. */
  pythFeedId: string | null;
  /** Current ScaledUiAmount multiplier as reported by the asset source (1 if none). */
  multiplier: number;
}

export interface RawTokenBalance {
  chainId: ChainId;
  /** Mint address. */
  mint: string;
  /** Token account address. */
  account: string;
  /** Base-unit amount as a decimal string. */
  amountRaw: string;
  decimals: number;
  /** Which token program owns the mint. */
  program: "spl-token" | "token-2022";
  /** Token-2022 ScaledUiAmount multiplier if the mint carries the extension. */
  multiplier: number | null;
}

// ---------------------------------------------------------------------------
// Interfaces. Hackathon ships ONE implementation of each; never a second.
// ---------------------------------------------------------------------------

/** All chain reads go through here. No raw RPC in routes or components. */
export interface ChainAdapter {
  readonly chainId: ChainId;
  /** All token balances (SPL + Token-2022) for an owner, optionally filtered to a mint set. */
  getTokenBalances(owner: string, mints?: ReadonlySet<string>): Promise<RawTokenBalance[]>;
  /** Verify a message signature for an address on this chain. */
  verifySignature(address: string, message: Uint8Array, signature: Uint8Array): boolean;
  /** Basic address validity check. */
  isValidAddress(address: string): boolean;
  /**
   * Wall-clock time the block at `slot` was produced. Block times never change, so
   * implementations cache them for the life of the process. Null when the slot is
   * unknown, skipped, pruned, or the RPC fails — never throws.
   */
  getBlockTime(slot: number): Promise<Date | null>;
  /**
   * Wall-clock estimate for a slot derived from a recent (slot, time) anchor,
   * ±(a few seconds); use for age display, not for settlement. Costs at most one
   * cheap RPC call (the anchor) per minute for the whole process, never one per slot.
   * Null when no anchor can be obtained (RPC failure) — never throws.
   */
  estimateSlotTime(slot: number): Promise<Date | null>;
}

/** Asset catalogue + all asset math (multiplier normalisation). */
export interface AssetSource {
  readonly name: string;
  /** Full catalogue of assets this source knows about. Cached. */
  listAssets(): Promise<AssetInfo[]>;
  getAsset(assetId: AssetId): Promise<AssetInfo | null>;
  getAssetBySymbol(symbol: string): Promise<AssetInfo | null>;
  /** Set of mints in scope for this source (for balance filtering). */
  mintSet(): Promise<ReadonlySet<string>>;
  /** Convert a raw balance into a normalised human quantity applying the multiplier. */
  normaliseQty(amountRaw: string, decimals: number, multiplier: number): number;
}

/** One upstream quote before lib/price stamps age/staleness on it. */
export interface SourceQuote {
  /** USD price. */
  price: number;
  /**
   * When the upstream last published this price. Null when the source cannot say
   * (lib/price then treats the age as unknown and the quote as stale).
   */
  publishedAt: Date | null;
}

/** A single upstream price feed. lib/price composes these. */
export interface PriceSource {
  readonly name: PriceSourceName;
  getPrices(assets: AssetInfo[]): Promise<Map<AssetId, SourceQuote>>;
}

/** A game (League, Calls, ...). Each hooks into the cron tick and emits internal events. */
export interface GameModule {
  readonly key: string;
  /** Called by the cron tick. Must be idempotent. */
  tick(now: Date): Promise<void>;
}

/** Internal events consumed by internal_event Plays (league_trade, call_placed, ...). */
export interface InternalEvent {
  type: string;
  userId: string;
  ref: string;
  ts: Date;
  meta?: Record<string, unknown>;
}
