/**
 * Public Mirror targets (15 Sep review M-D, work item C7). Server-only.
 *
 * Any valid Solana address that is not a Dulo wallet can be mirrored: its xStocks are read
 * LIVE through cron/snapshot's readWalletHoldings, the one read path shared with the cron and
 * the public preview (ChainAdapter balances filtered to the AssetSource mint set, multiplier
 * from the chain with the catalogue as fallback, quantity via AssetSource.normaliseQty, prices
 * via lib/price), then turned into an allocation. readWalletHoldings writes nothing.
 *
 *   - Nothing is written: no User, Wallet, Snapshot or PointsEvent row. A public wallet is not a
 *     Dulo player and is never scored; it only gives a copier something real to copy.
 *   - Reads are cached in memory for 10 minutes per address (in-flight promises included, so
 *     concurrent page loads share one read). A failed read is remembered for 30 seconds.
 *   - At most PUBLIC_READ_CONCURRENCY reads run at once, and uncached reads of addresses that
 *     are not on the curated list are capped per minute per instance, so a scripted sweep of
 *     random addresses cannot drain the RPC budget. Over the cap: PublicWalletReadError("busy").
 *
 *   readPublicWallet(address)          cached live read -> { holdings, allocation, readAt }
 *   getPublicMirrorTarget(address)     MirrorTargetView with source "public" (null: invalid address)
 *   listPublicMirrorRows(waitMs)       the curated wallets for /mirror, valued when the read lands in time
 */
import { isValidSolanaAddress } from "@/lib/adapters/solana";
import { SOLANA_MAINNET, type Holding } from "@/lib/core";
import type { MirrorPublicRow, MirrorTargetView } from "@/lib/api-client";
// Import cycle (public -> cron/snapshot -> server/queries -> public) is safe: every binding is used only inside functions.
import { readWalletHoldings } from "@/lib/cron/snapshot";
import { allocationFromSnapshot, type Allocation } from "./allocation";
import { PUBLIC_WALLETS, publicWalletLabel } from "./public-wallets";

const LOG_PREFIX = "[mirror/public]";

/** A live read is reused for this long. */
export const PUBLIC_READ_TTL_MS = 10 * 60 * 1000;
/** A failed read is not retried for this long (the caller sees the same error). */
export const PUBLIC_READ_FAILURE_TTL_MS = 30 * 1000;
/** Most addresses kept in the cache; the oldest entries go first. */
export const PUBLIC_CACHE_MAX = 500;
/** Reads running at the same time (each read is two token-program RPC calls plus multipliers). */
export const PUBLIC_READ_CONCURRENCY = 3;
/** Uncached reads of non-curated addresses allowed per rolling minute, per server instance. */
export const PUBLIC_UNCACHED_READS_PER_MINUTE = 30;
/** How long GET /api/v1/mirror waits for the curated wallets' values before answering without them. */
export const PUBLIC_INDEX_WAIT_MS = 2500;

export interface PublicWalletRead {
  address: string;
  chainId: typeof SOLANA_MAINNET;
  readAt: Date;
  holdings: Holding[];
  allocation: Allocation;
  /**
   * False when a position (qty > 0) had no price: its value is unknown, not $0. Such a read is
   * kept only for PUBLIC_READ_FAILURE_TTL_MS so the next call re-prices it, and the /mirror index
   * shows its value as unknown.
   */
  priced: boolean;
}

/** Every position with a quantity carries a price. */
export function holdingsFullyPriced(holdings: readonly Holding[]): boolean {
  return holdings.every((h) => !(h.qty > 0) || h.price !== null);
}

/** busy: the shared per-minute budget is spent · unavailable: the chain or price read failed · limited: this caller is over its own limit. */
export type PublicWalletReadErrorKind = "busy" | "unavailable" | "limited";

export class PublicWalletReadError extends Error {
  readonly kind: PublicWalletReadErrorKind;
  /** Seconds until the caller may retry ("limited" only). */
  readonly retryAfterSeconds?: number;
  constructor(kind: PublicWalletReadErrorKind, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "PublicWalletReadError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface Entry {
  expiresAt: number;
  promise: Promise<PublicWalletRead>;
}

const cache = new Map<string, Entry>();
let budget = { windowStart: 0, used: 0 };
let running = 0;
const waiting: Array<() => void> = [];

/** Test hook: forget every cached read, the per-minute budget and the queue. */
export function resetPublicReadCache(): void {
  cache.clear();
  budget = { windowStart: 0, used: 0 };
  running = 0;
  waiting.length = 0;
}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= PUBLIC_READ_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await fn();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

function evict(nowMs: number): void {
  if (cache.size < PUBLIC_CACHE_MAX) return;
  for (const [key, entry] of cache) if (entry.expiresAt <= nowMs) cache.delete(key);
  while (cache.size >= PUBLIC_CACHE_MAX) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

export interface ReadPublicWalletOptions {
  /** Clock (ms). Default Date.now. */
  now?: () => number;
  /**
   * Runs before an uncached read of a non-curated address spends the shared per-minute budget.
   * Throw to refuse the read (the route's per-IP limit); the returned promise rejects with that error.
   */
  beforeUncachedRead?: () => void;
}

/**
 * The live read for `address`, from the 10-minute cache when possible. Curated wallets skip the
 * per-minute budget (the list is fixed and small). Rejects with PublicWalletReadError: "busy"
 * when the budget is spent, "unavailable" when the chain or price read failed.
 */
export function readPublicWallet(address: string, opts: ReadPublicWalletOptions = {}): Promise<PublicWalletRead> {
  const now = opts.now ?? Date.now;
  const nowMs = now();
  const hit = cache.get(address);
  if (hit && hit.expiresAt > nowMs) return hit.promise;
  if (hit) cache.delete(address);

  if (!isValidSolanaAddress(address)) {
    return Promise.reject(new PublicWalletReadError("unavailable", "Invalid Solana address"));
  }
  if (publicWalletLabel(address) === null) {
    // The caller's own limit is decided first, so one client cannot spend the budget everyone shares.
    if (opts.beforeUncachedRead) {
      try {
        opts.beforeUncachedRead();
      } catch (e) {
        return Promise.reject(e);
      }
    }
    if (nowMs - budget.windowStart >= 60_000) budget = { windowStart: nowMs, used: 0 };
    if (budget.used >= PUBLIC_UNCACHED_READS_PER_MINUTE) {
      return Promise.reject(new PublicWalletReadError("busy", "Too many wallet lookups right now. Try again in a minute."));
    }
    budget.used += 1;
  }

  const promise = withSlot(() => readWalletHoldings(address, SOLANA_MAINNET)).then(
    ({ holdings, readAt }): PublicWalletRead => {
      const priced = holdingsFullyPriced(holdings);
      if (!priced) {
        // A missing price is not a $0 position: keep this read only briefly so the next call re-prices it.
        const entry = cache.get(address);
        if (entry && entry.promise === promise) entry.expiresAt = now() + PUBLIC_READ_FAILURE_TTL_MS;
      }
      return { address, chainId: SOLANA_MAINNET, readAt, holdings, allocation: allocationFromSnapshot({ holdings }), priced };
    },
    (e: unknown) => {
      console.warn(`${LOG_PREFIX} live read of ${address} failed: ${e instanceof Error ? e.message : String(e)}`);
      const entry = cache.get(address);
      if (entry && entry.promise === promise) entry.expiresAt = now() + PUBLIC_READ_FAILURE_TTL_MS;
      throw new PublicWalletReadError("unavailable", "Couldn't read this wallet from Solana right now. Try again shortly.");
    },
  );
  // Callers that never await (the index warm-up) must not surface an unhandled rejection.
  promise.catch(() => undefined);
  evict(nowMs);
  cache.set(address, { expiresAt: nowMs + PUBLIC_READ_TTL_MS, promise });
  return promise;
}

/**
 * The Mirror target of a public wallet: source "public", live allocation, no rank, no history,
 * never a bot. Null for an invalid address. Throws PublicWalletReadError when the read fails.
 */
export async function getPublicMirrorTarget(address: string, opts: ReadPublicWalletOptions = {}): Promise<MirrorTargetView | null> {
  if (!isValidSolanaAddress(address)) return null;
  const read = await readPublicWallet(address, opts);
  return {
    address: read.address,
    chainId: read.chainId,
    handle: publicWalletLabel(address),
    isBot: false,
    rank: null,
    leagueRank: null,
    source: "public",
    asOf: read.readAt.toISOString(),
    totalUsd: read.allocation.totalUsd,
    legs: read.allocation.legs,
    pnl7d: null,
    pnl30d: null,
    cashUsd: null,
    equityUsd: null,
  };
}

/**
 * The curated public wallets for the /mirror index, minus `exclude` (addresses that have since
 * become Dulo wallets). Starts (or reuses) every read and waits at most `waitMs` for them: a
 * row whose read has not landed, or failed, is listed with null value so the page still offers it.
 */
export async function listPublicMirrorRows(opts: { waitMs?: number; exclude?: ReadonlySet<string>; now?: () => number } = {}): Promise<MirrorPublicRow[]> {
  const waitMs = Math.max(0, opts.waitMs ?? PUBLIC_INDEX_WAIT_MS);
  const wallets = PUBLIC_WALLETS.filter((w) => !opts.exclude?.has(w.address));
  const settled = new Map<string, PublicWalletRead | null>();
  const reads = wallets.map((w) =>
    readPublicWallet(w.address, { now: opts.now }).then(
      (r) => void settled.set(w.address, r),
      () => void settled.set(w.address, null),
    ),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(reads), new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)))]);
  if (timer) clearTimeout(timer);
  return wallets.map((w) => {
    const r = settled.get(w.address) ?? null;
    // An unpriced read has an unknown value, not $0 across 0 stocks.
    const valued = r && r.priced ? r : null;
    return {
      address: w.address,
      label: w.label,
      totalUsd: valued ? valued.allocation.totalUsd : null,
      stocks: valued ? valued.allocation.legs.length : null,
      asOf: r ? r.readAt.toISOString() : null,
    };
  });
}
