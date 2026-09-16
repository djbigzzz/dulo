/**
 * Solana ChainAdapter (server-only).
 *
 * The ONLY place in the app that talks to a Solana RPC. Routes, cron jobs and
 * components never touch @solana/web3.js `Connection` directly; they use the
 * lazily-built default `solana` adapter or `createSolanaAdapter(rpcUrl)`.
 *
 * Responsibilities
 *   - Token balances for an owner across SPL Token and Token-2022, one row per mint.
 *   - Token-2022 ScaledUiAmount multipliers (batched via getMultipleParsedAccounts,
 *     100 mints per call, cached in-memory for 10 minutes).
 *   - Block production time for a slot (getBlockTime), cached for the life of the
 *     process because block times never change. One RPC per slot: for exact needs only.
 *   - Estimated wall-clock time for a slot (estimateSlotTime): arithmetic from ONE
 *     (slot, time) anchor obtained with getSlot and reused for 60 s, ±(a few seconds).
 *     lib/prices/jupiter dates every quote by the slot it was observed in this way, so a
 *     price read costs at most one RPC call per minute instead of one per distinct slot
 *     (which the public RPC rate-limits into multi-second stalls).
 *   - Ed25519 signature verification for SIWS.
 *   - Address validity (PDAs count as valid; no on-curve check).
 *
 * Reliability
 *   - Every RPC call gets a 15 s timeout and 3 attempts with exponential backoff; a
 *     single backoff sleep is capped at 2 s. The slot anchor is the exception: ONE
 *     attempt with a 3 s timeout and no retry, so a price read never waits on the RPC
 *     for more than ~3 s and a failure (10 s cool-off) degrades to "age unknown".
 *   - Raw RPC errors never escape: they are wrapped in SolanaAdapterError carrying
 *     the operation name, an error kind and the original error as `cause`.
 *
 * Nothing here calls env() at import time. The default adapter reads rpcUrl()
 * on first use so the module can be imported during `next build`.
 */

import { Connection, PublicKey, type AccountInfo, type Commitment, type ParsedAccountData } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getScaledUiAmountConfig, unpackMint } from "@solana/spl-token";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { SOLANA_MAINNET, type ChainAdapter, type ChainId, type RawTokenBalance } from "@/lib/core";
import { rpcUrl } from "@/lib/server/env";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TokenProgram = RawTokenBalance["program"];

/** The subset of `Connection` the adapter uses. Tests inject a fake. */
export type SolanaRpc = Pick<Connection, "getParsedTokenAccountsByOwner" | "getMultipleParsedAccounts" | "getBlockTime" | "getSlot">;

/** A recent (slot, wall-clock) observation from getSlot. estimateSlotTime is arithmetic on it. */
export interface SlotAnchor {
  slot: number;
  /** ms since epoch when `slot` was the current slot. */
  at: number;
}

/** Token-2022 ScaledUiAmount extension state as read from the mint. */
export interface ScaledUiAmountState {
  /** Multiplier in force before `newMultiplierEffectiveTimestamp`. */
  multiplier: number;
  /** Multiplier that takes over at `newMultiplierEffectiveTimestamp` (null when not reported). */
  newMultiplier: number | null;
  /** Unix seconds. 0 means "no scheduled change" on chain. */
  newMultiplierEffectiveTimestamp: number | null;
}

/** What we know about a mint after one RPC round-trip. Cached per mint. */
export interface MintInfo {
  mint: string;
  /** null when the account does not exist or is not a token mint. */
  program: TokenProgram | null;
  /** Present only for Token-2022 mints carrying the ScaledUiAmount extension. */
  scaledUi: ScaledUiAmountState | null;
}

export type SolanaAdapterErrorKind = "rpc" | "timeout" | "invalid_input";

/** Every error thrown by the adapter. `cause` holds the raw RPC error when there is one. */
export class SolanaAdapterError extends Error {
  readonly op: string;
  readonly kind: SolanaAdapterErrorKind;
  readonly cause?: unknown;

  constructor(message: string, op: string, kind: SolanaAdapterErrorKind, cause?: unknown) {
    super(message);
    this.name = "SolanaAdapterError";
    this.op = op;
    this.kind = kind;
    this.cause = cause;
  }
}

export interface SolanaAdapterOptions {
  /** Chain this adapter serves. Defaults to Solana mainnet. */
  chainId?: ChainId;
  /** Injected RPC client (tests). When omitted a `Connection` is built from the rpc url. */
  rpc?: SolanaRpc;
  /** Commitment for every read. Default "confirmed". */
  commitment?: Commitment;
  /** Per-attempt timeout in ms. Default 15 000. */
  timeoutMs?: number;
  /** Total attempts per RPC call. Default 3. */
  attempts?: number;
  /** Base backoff delay in ms; attempt i waits base * 2^i plus up to `base` of jitter. Default 250. */
  retryBaseDelayMs?: number;
  /** Upper bound for a single backoff sleep in ms, whatever the attempt count. Default 2 000. */
  maxRetryDelayMs?: number;
  /** How long a slot anchor is reused before getSlot is asked again, in ms. Default 60 s. */
  slotAnchorTtlMs?: number;
  /** Timeout for the single getSlot attempt behind estimateSlotTime, in ms. Default 3 s. */
  slotAnchorTimeoutMs?: number;
  /** How long a mint's ScaledUiAmount config stays cached, in ms. Default 10 minutes. */
  multiplierTtlMs?: number;
  /** Clock (ms since epoch). Default Date.now. */
  now?: () => number;
  /** Sleep used between retries. Default setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export interface SolanaAdapter extends ChainAdapter {
  /**
   * Effective ScaledUiAmount multiplier for a mint right now.
   *   - Token-2022 mint with the extension: the multiplier in force (pending
   *     `newMultiplier` once its effective timestamp has passed).
   *   - Token-2022 mint without the extension: 1.
   *   - SPL Token mint, missing account, or not a mint: null.
   */
  getMintMultiplier(mint: string): Promise<number | null>;
  /** Batched form of getMintMultiplier. Every requested mint is present in the result. */
  getMintMultipliers(mints: Iterable<string>): Promise<Map<string, number | null>>;
  /** Drop the in-memory multiplier cache (tests, admin tooling). */
  clearMultiplierCache(): void;
  /** Drop the in-memory block-time cache (tests). */
  clearBlockTimeCache(): void;
  /** The anchor estimateSlotTime currently works from; null before the first successful getSlot. */
  slotAnchor(): SlotAnchor | null;
  /** Forget the slot anchor so the next estimate asks getSlot again (tests, admin tooling). */
  clearSlotAnchor(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_MAX_RETRY_DELAY_MS = 2_000;
const DEFAULT_MULTIPLIER_TTL_MS = 10 * 60 * 1000;
/** Nominal Solana slot duration. Real slots drift by a few ms either way, which is where the estimate's ± comes from. */
export const SLOT_MS = 400;
/** A slot anchor is reused this long before getSlot is asked again (~150 slots; drift stays within a few seconds). */
export const SLOT_ANCHOR_TTL_MS = 60_000;
/** The single getSlot attempt behind the anchor gets this long; no retries. */
export const SLOT_ANCHOR_TIMEOUT_MS = 3_000;
/** After a failed getSlot, do not ask again for this long (bounds the cost of an RPC outage to one attempt per window). */
export const SLOT_ANCHOR_RETRY_MS = 10_000;
/** While getSlot keeps failing, an anchor younger than this is still used (worst-case drift ~±15 s); older -> null. */
export const SLOT_ANCHOR_MAX_AGE_MS = 5 * 60_000;
/** getMultipleAccounts accepts at most 100 pubkeys per request. */
const MULTIPLE_ACCOUNTS_CHUNK = 100;
/** Block times are immutable, so entries never expire; only the count is bounded (oldest slot evicted first). */
const BLOCK_TIME_CACHE_MAX = 10_000;

const TOKEN_PROGRAM_B58 = TOKEN_PROGRAM_ID.toBase58();
const TOKEN_2022_PROGRAM_B58 = TOKEN_2022_PROGRAM_ID.toBase58();

const LOG_PREFIX = "[solana-adapter]";

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests and for the AssetSource)
// ---------------------------------------------------------------------------

/**
 * Multiplier in force at `nowSeconds`, mirroring Token-2022's on-chain rule:
 * `new_multiplier` applies once `now >= new_multiplier_effective_timestamp`,
 * otherwise `multiplier`. A timestamp of 0 with a distinct newMultiplier is
 * therefore already effective (that is how the program treats it too); on a
 * freshly initialised mint both values are equal so the branch is harmless.
 */
export function effectiveMultiplier(state: ScaledUiAmountState, nowSeconds: number): number {
  const ts = state.newMultiplierEffectiveTimestamp;
  if (state.newMultiplier !== null && ts !== null && ts <= nowSeconds) return state.newMultiplier;
  return state.multiplier;
}

/**
 * Extract the ScaledUiAmount extension from a jsonParsed mint's
 * `data.parsed.info.extensions` array. Returns null when the extension is
 * absent or its multiplier cannot be read as a positive finite number.
 */
export function parseScaledUiAmountExtension(extensions: unknown): ScaledUiAmountState | null {
  if (!Array.isArray(extensions)) return null;
  const ext = extensions.find(
    (e): e is { extension: string; state?: unknown } =>
      !!e && typeof e === "object" && (e as { extension?: unknown }).extension === "scaledUiAmountConfig",
  );
  if (!ext) return null;
  const state = (ext.state ?? {}) as Record<string, unknown>;
  const multiplier = toPositiveFinite(state.multiplier);
  if (multiplier === null) return null;
  const newMultiplier = toPositiveFinite(state.newMultiplier);
  const ts = toNonNegativeInt(state.newMultiplierEffectiveTimestamp);
  return { multiplier, newMultiplier, newMultiplierEffectiveTimestamp: ts };
}

/** Verify an Ed25519 signature over `message` for a base58 Solana address. Never throws. */
/**
 * Canonical encodings of the eight small-order points on the Ed25519 curve (identity, the
 * order-2 point, two order-4 and four order-8 points). tweetnacl performs no small-order
 * check, so a signature of all zeros "verifies" under these keys for a large fraction of
 * messages. The all-zero key is the System Program address, so this is reachable.
 */
const ED25519_SMALL_ORDER_KEYS: ReadonlySet<string> = new Set([
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0100000000000000000000000000000000000000000000000000000000000000",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
  "0000000000000000000000000000000000000000000000000000000000000080",
]);

/** 2^255 - 19: the field prime. Encoded y-coordinates at or above it are non-canonical. */
const ED25519_P = (1n << 255n) - 19n;

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Little-endian y-coordinate with the sign bit cleared. */
function encodedY(pub: Uint8Array): bigint {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? pub[i] & 0x7f : pub[i]);
  return y;
}

/**
 * True when the encoded key must be rejected before signature verification: small-order
 * points (any of the eight canonical encodings) or non-canonical encodings (y >= p).
 */
export function isWeakEd25519PublicKey(pub: Uint8Array): boolean {
  if (pub.length !== 32) return true;
  if (ED25519_SMALL_ORDER_KEYS.has(toHex(pub))) return true;
  return encodedY(pub) >= ED25519_P;
}

export function verifyEd25519(address: string, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    const pub = bs58.decode(address);
    if (pub.length !== nacl.sign.publicKeyLength) return false;
    if (signature.length !== nacl.sign.signatureLength) return false;
    if (isWeakEd25519PublicKey(pub)) return false;
    return nacl.sign.detached.verify(message, signature, pub);
  } catch {
    return false;
  }
}

/** True when `address` decodes to a 32-byte Solana public key. PDAs (off-curve) are valid. */
export function isValidSolanaAddress(address: string): boolean {
  if (typeof address !== "string" || address.length === 0) return false;
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSolanaAdapter(rpcUrl: string, options: SolanaAdapterOptions = {}): SolanaAdapter {
  const chainId = options.chainId ?? SOLANA_MAINNET;
  const commitment: Commitment = options.commitment ?? "confirmed";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = Math.max(1, Math.floor(options.attempts ?? DEFAULT_ATTEMPTS));
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_MS;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  const slotAnchorTtlMs = options.slotAnchorTtlMs ?? SLOT_ANCHOR_TTL_MS;
  const slotAnchorTimeoutMs = options.slotAnchorTimeoutMs ?? SLOT_ANCHOR_TIMEOUT_MS;
  const multiplierTtlMs = options.multiplierTtlMs ?? DEFAULT_MULTIPLIER_TTL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;

  let rpcClient: SolanaRpc | null = options.rpc ?? null;
  function rpc(): SolanaRpc {
    if (!rpcClient) {
      if (!rpcUrl || !/^https?:\/\//.test(rpcUrl)) {
        // Never echo the url itself: a Helius url carries the API key in its query string and
        // this message can reach an API response or a log line.
        throw new SolanaAdapterError(`Invalid Solana RPC url (host ${describeRpcHost(rpcUrl)}): expected http(s)`, "connect", "invalid_input");
      }
      // web3.js retries a 429 up to five times with a 500ms-doubling sleep (~45s per call) unless
      // told not to; `call()` below owns retry and backoff, with a bounded delay.
      rpcClient = new Connection(rpcUrl, { commitment, disableRetryOnRateLimit: true });
    }
    return rpcClient;
  }

  const mintCache = new Map<string, { info: MintInfo; expiresAt: number }>();
  /** slot -> block time. Insertion-ordered so the oldest slot is evicted when the cap is hit. */
  const blockTimeCache = new Map<number, Date>();

  /**
   * Run one RPC call with timeout + retry, wrapping any failure in SolanaAdapterError.
   * Per-call `attempts` / `timeoutMs` override the adapter defaults (the slot anchor
   * uses 1 attempt and a short timeout). Backoff is base * 2^attempt + jitter, capped at
   * maxRetryDelayMs per sleep so raising the attempt count can never stall for minutes.
   */
  async function call<T>(op: string, fn: () => Promise<T>, opts: { attempts?: number; timeoutMs?: number } = {}): Promise<T> {
    const tries = Math.max(1, Math.floor(opts.attempts ?? attempts));
    const perAttemptMs = opts.timeoutMs ?? timeoutMs;
    let lastError: unknown;
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        return await withTimeout(Promise.resolve().then(fn), perAttemptMs, op);
      } catch (e) {
        lastError = e;
        if (isNonRetryable(e) || attempt === tries - 1) break;
        const delay = retryBaseDelayMs * 2 ** attempt + Math.floor(Math.random() * retryBaseDelayMs);
        await sleep(Math.min(delay, maxRetryDelayMs));
      }
    }
    if (lastError instanceof SolanaAdapterError) throw lastError;
    throw new SolanaAdapterError(
      `Solana RPC ${op} failed after ${tries} attempt${tries === 1 ? "" : "s"}: ${describeError(lastError)}`,
      op,
      "rpc",
      lastError,
    );
  }

  // --- balances -----------------------------------------------------------

  async function fetchProgramBalances(owner: PublicKey, programId: PublicKey, program: TokenProgram) {
    const op = `getParsedTokenAccountsByOwner(${owner.toBase58()}, ${program})`;
    const res = await call(op, () => rpc().getParsedTokenAccountsByOwner(owner, { programId }, commitment));
    const rows: RawTokenBalance[] = [];
    for (const entry of res.value ?? []) {
      const info = readParsedTokenAccount(entry.account?.data);
      if (!info) {
        console.warn(`${LOG_PREFIX} skipping token account ${String(entry.pubkey)}: not jsonParsed`);
        continue;
      }
      rows.push({
        chainId,
        mint: info.mint,
        account: String(entry.pubkey),
        amountRaw: info.amount,
        decimals: info.decimals,
        program,
        multiplier: null,
      });
    }
    return rows;
  }

  async function getTokenBalances(owner: string, mints?: ReadonlySet<string>): Promise<RawTokenBalance[]> {
    if (!isValidSolanaAddress(owner)) {
      throw new SolanaAdapterError(`Invalid Solana address: "${owner}"`, "getTokenBalances", "invalid_input");
    }
    if (mints && mints.size === 0) return [];
    const ownerKey = new PublicKey(owner);

    const [spl, t22] = await Promise.all([
      fetchProgramBalances(ownerKey, TOKEN_PROGRAM_ID, "spl-token"),
      fetchProgramBalances(ownerKey, TOKEN_2022_PROGRAM_ID, "token-2022"),
    ]);

    const filtered = mints ? [...spl, ...t22].filter((r) => mints.has(r.mint)) : [...spl, ...t22];
    const merged = mergeByMint(filtered);

    const t22Mints = merged.filter((r) => r.program === "token-2022").map((r) => r.mint);
    if (t22Mints.length > 0) {
      const multipliers = await getMintMultipliers(t22Mints);
      for (const row of merged) {
        if (row.program === "token-2022") row.multiplier = multipliers.get(row.mint) ?? 1;
      }
    }
    return merged;
  }

  // --- multipliers --------------------------------------------------------

  async function getMintInfos(mints: Iterable<string>): Promise<Map<string, MintInfo>> {
    const result = new Map<string, MintInfo>();
    const missing: string[] = [];
    const nowMs = now();
    for (const mint of new Set(mints)) {
      const cached = mintCache.get(mint);
      if (cached && cached.expiresAt > nowMs) {
        result.set(mint, cached.info);
        continue;
      }
      if (!isValidSolanaAddress(mint)) {
        result.set(mint, { mint, program: null, scaledUi: null });
        continue;
      }
      missing.push(mint);
    }

    for (const chunk of chunks(missing, MULTIPLE_ACCOUNTS_CHUNK)) {
      const keys = chunk.map((m) => new PublicKey(m));
      const res = await call(`getMultipleParsedAccounts(${chunk.length} mints)`, () =>
        rpc().getMultipleParsedAccounts(keys, { commitment }),
      );
      const values = res.value ?? [];
      const expiresAt = now() + multiplierTtlMs;
      chunk.forEach((mint, i) => {
        const info = readMintAccount(mint, values[i] ?? null);
        mintCache.set(mint, { info, expiresAt });
        result.set(mint, info);
      });
    }
    return result;
  }

  async function getMintMultipliers(mints: Iterable<string>): Promise<Map<string, number | null>> {
    const infos = await getMintInfos(mints);
    const nowSeconds = Math.floor(now() / 1000);
    const out = new Map<string, number | null>();
    for (const [mint, info] of infos) out.set(mint, multiplierFromInfo(info, nowSeconds));
    return out;
  }

  async function getMintMultiplier(mint: string): Promise<number | null> {
    const m = await getMintMultipliers([mint]);
    return m.get(mint) ?? null;
  }

  // --- block times --------------------------------------------------------

  /**
   * Production time of the block at `slot`. Successful lookups are cached for the life
   * of the process (block times never change); failures and "not available" answers are
   * not cached, so a transient RPC problem does not pin a slot to null. Never throws.
   */
  async function getBlockTime(slot: number): Promise<Date | null> {
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0) return null;
    const cached = blockTimeCache.get(slot);
    if (cached) return cached;
    try {
      const seconds = await call(`getBlockTime(${slot})`, () => rpc().getBlockTime(slot));
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
      const at = new Date(seconds * 1000);
      if (blockTimeCache.size >= BLOCK_TIME_CACHE_MAX) {
        const oldest = blockTimeCache.keys().next().value;
        if (oldest !== undefined) blockTimeCache.delete(oldest);
      }
      blockTimeCache.set(slot, at);
      return at;
    } catch (e) {
      console.warn(`${LOG_PREFIX} getBlockTime(${slot}) failed: ${describeError(e)}`);
      return null;
    }
  }

  // --- estimated slot times -------------------------------------------------
  //
  // One (slot, time) anchor for the whole adapter; every estimate is arithmetic on it:
  //   estimate(slot) = anchor.at - (anchor.slot - slot) * SLOT_MS, never later than now.
  // Nothing is cached per slot. The anchor is refreshed by ONE getSlot at most every
  // slotAnchorTtlMs, shared by concurrent callers through a single in-flight promise.

  let anchor: SlotAnchor | null = null;
  let anchorInFlight: Promise<SlotAnchor | null> | null = null;
  /** Earliest time another getSlot may be attempted after a failure (0 = no cool-off). */
  let anchorRetryAt = 0;

  /** The anchor while it is young enough to trust the drift; null once it is too old. */
  function usableAnchor(nowMs: number): SlotAnchor | null {
    return anchor && nowMs - anchor.at < SLOT_ANCHOR_MAX_AGE_MS ? anchor : null;
  }

  async function refreshAnchor(): Promise<SlotAnchor | null> {
    try {
      const slot = await call("getSlot", () => rpc().getSlot(commitment), { attempts: 1, timeoutMs: slotAnchorTimeoutMs });
      if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0) {
        throw new SolanaAdapterError(`Solana RPC getSlot returned ${describeError(slot)}`, "getSlot", "rpc");
      }
      anchor = { slot, at: now() };
      anchorRetryAt = 0;
      return anchor;
    } catch (e) {
      const nowMs = now();
      anchorRetryAt = nowMs + SLOT_ANCHOR_RETRY_MS;
      const fallback = usableAnchor(nowMs);
      const consequence = fallback
        ? `estimating from the ${Math.round((nowMs - fallback.at) / 1000)}s-old anchor`
        : "slot times unavailable";
      console.warn(`${LOG_PREFIX} getSlot failed (${describeError(e)}); ${consequence} for the next ${SLOT_ANCHOR_RETRY_MS / 1000}s`);
      return fallback;
    }
  }

  function currentAnchor(): Promise<SlotAnchor | null> {
    const nowMs = now();
    if (anchor && nowMs - anchor.at < slotAnchorTtlMs) return Promise.resolve(anchor);
    if (anchorInFlight) return anchorInFlight;
    if (nowMs < anchorRetryAt) return Promise.resolve(usableAnchor(nowMs));
    anchorInFlight = refreshAnchor().finally(() => {
      anchorInFlight = null;
    });
    return anchorInFlight;
  }

  /**
   * Wall-clock estimate for `slot` from the current anchor, ±(a few seconds). Slots newer
   * than the anchor (possible inside the TTL window) extrapolate forward but are clamped
   * so no estimate is ever in the future. Null for invalid slots or when no anchor is
   * available. Never throws.
   */
  async function estimateSlotTime(slot: number): Promise<Date | null> {
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0) return null;
    const a = await currentAnchor();
    if (!a) return null;
    const estimate = a.at - (a.slot - slot) * SLOT_MS;
    return new Date(Math.min(estimate, now()));
  }

  function clearSlotAnchor(): void {
    anchor = null;
    anchorRetryAt = 0;
  }

  return {
    chainId,
    getTokenBalances,
    getMintMultiplier,
    getMintMultipliers,
    clearMultiplierCache: () => mintCache.clear(),
    getBlockTime,
    clearBlockTimeCache: () => blockTimeCache.clear(),
    estimateSlotTime,
    slotAnchor: () => anchor,
    clearSlotAnchor,
    verifySignature: verifyEd25519,
    isValidAddress: isValidSolanaAddress,
  };
}

// ---------------------------------------------------------------------------
// Default adapter — built on first use so importing this module needs no env.
// ---------------------------------------------------------------------------

let defaultAdapter: SolanaAdapter | null = null;

function live(): SolanaAdapter {
  if (!defaultAdapter) defaultAdapter = createSolanaAdapter(rpcUrl());
  return defaultAdapter;
}

/** The app's Solana adapter. Reads env (rpcUrl) lazily on the first chain call. */
export const solana: SolanaAdapter = {
  chainId: SOLANA_MAINNET,
  getTokenBalances: (owner, mints) => live().getTokenBalances(owner, mints),
  getMintMultiplier: (mint) => live().getMintMultiplier(mint),
  getMintMultipliers: (mints) => live().getMintMultipliers(mints),
  clearMultiplierCache: () => defaultAdapter?.clearMultiplierCache(),
  getBlockTime: (slot) => live().getBlockTime(slot),
  clearBlockTimeCache: () => defaultAdapter?.clearBlockTimeCache(),
  estimateSlotTime: (slot) => live().estimateSlotTime(slot),
  slotAnchor: () => defaultAdapter?.slotAnchor() ?? null,
  clearSlotAnchor: () => defaultAdapter?.clearSlotAnchor(),
  verifySignature: verifyEd25519,
  isValidAddress: isValidSolanaAddress,
};

/** Effective ScaledUiAmount multiplier for a mint via the default adapter. See SolanaAdapter.getMintMultiplier. */
export async function getMintMultiplier(mint: string): Promise<number | null> {
  return live().getMintMultiplier(mint);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function readParsedTokenAccount(data: unknown): { mint: string; amount: string; decimals: number } | null {
  if (!data || typeof data !== "object" || Buffer.isBuffer(data)) return null;
  const parsed = (data as ParsedAccountData).parsed as { type?: unknown; info?: Record<string, unknown> } | undefined;
  const info = parsed?.info;
  if (!info || (parsed?.type !== undefined && parsed.type !== "account")) return null;
  const mint = info.mint;
  const tokenAmount = info.tokenAmount as { amount?: unknown; decimals?: unknown } | undefined;
  const amount = tokenAmount?.amount;
  const decimals = tokenAmount?.decimals;
  if (typeof mint !== "string" || !isValidSolanaAddress(mint)) return null;
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) return null;
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  return { mint, amount, decimals };
}

/** Sum raw amounts per mint, drop zero balances, keep the largest account as the representative. */
function mergeByMint(rows: RawTokenBalance[]): RawTokenBalance[] {
  const byMint = new Map<string, { row: RawTokenBalance; total: bigint; largest: bigint }>();
  for (const row of rows) {
    const amount = BigInt(row.amountRaw);
    if (amount === BigInt(0)) continue;
    const current = byMint.get(row.mint);
    if (!current) {
      byMint.set(row.mint, { row: { ...row }, total: amount, largest: amount });
      continue;
    }
    current.total += amount;
    if (amount > current.largest) {
      current.largest = amount;
      current.row.account = row.account;
    }
  }
  return [...byMint.values()]
    .map(({ row, total }) => ({ ...row, amountRaw: total.toString() }))
    .sort((a, b) => (a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0));
}

function readMintAccount(mint: string, account: AccountInfo<Buffer | ParsedAccountData> | null): MintInfo {
  if (!account) return { mint, program: null, scaledUi: null };
  const owner = String(account.owner);
  const program: TokenProgram | null =
    owner === TOKEN_2022_PROGRAM_B58 ? "token-2022" : owner === TOKEN_PROGRAM_B58 ? "spl-token" : null;
  if (program !== "token-2022") return { mint, program, scaledUi: null };

  const data = account.data;
  if (Buffer.isBuffer(data)) {
    // RPC returned raw bytes (jsonParsed unavailable). Decode with spl-token.
    try {
      const state = unpackMint(new PublicKey(mint), account as AccountInfo<Buffer>, TOKEN_2022_PROGRAM_ID);
      const cfg = getScaledUiAmountConfig(state);
      if (!cfg) return { mint, program, scaledUi: null };
      const multiplier = toPositiveFinite(cfg.multiplier);
      if (multiplier === null) {
        console.warn(`${LOG_PREFIX} mint ${mint}: unreadable ScaledUiAmount multiplier in raw data; assuming 1`);
        return { mint, program, scaledUi: null };
      }
      return {
        mint,
        program,
        scaledUi: {
          multiplier,
          newMultiplier: toPositiveFinite(cfg.newMultiplier),
          newMultiplierEffectiveTimestamp: toNonNegativeInt(cfg.newMultiplierEffectiveTimestamp),
        },
      };
    } catch (e) {
      console.warn(`${LOG_PREFIX} mint ${mint}: could not decode raw Token-2022 mint (${describeError(e)}); assuming 1`);
      return { mint, program, scaledUi: null };
    }
  }

  const parsed = (data as ParsedAccountData).parsed as { type?: unknown; info?: Record<string, unknown> } | undefined;
  if (parsed?.type !== undefined && parsed.type !== "mint") return { mint, program: null, scaledUi: null };
  const extensions = parsed?.info?.extensions;
  const scaledUi = parseScaledUiAmountExtension(extensions);
  if (!scaledUi && hasExtension(extensions, "scaledUiAmountConfig")) {
    console.warn(`${LOG_PREFIX} mint ${mint}: ScaledUiAmount extension present but multiplier unreadable; assuming 1`);
  }
  return { mint, program, scaledUi };
}

function multiplierFromInfo(info: MintInfo, nowSeconds: number): number | null {
  if (info.program !== "token-2022") return null;
  if (!info.scaledUi) return 1;
  return effectiveMultiplier(info.scaledUi, nowSeconds);
}

function hasExtension(extensions: unknown, name: string): boolean {
  return Array.isArray(extensions) && extensions.some((e) => !!e && typeof e === "object" && e.extension === name);
}

function toPositiveFinite(v: unknown): number | null {
  if (typeof v === "bigint") v = Number(v);
  if (typeof v === "string") v = v.trim() === "" ? NaN : Number(v);
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

function toNonNegativeInt(v: unknown): number | null {
  if (typeof v === "bigint") v = Number(v);
  if (typeof v === "string") v = v.trim() === "" ? NaN : Number(v);
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.floor(v);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The host of an RPC url for error messages — never the url, whose query string may carry an API key. */
function describeRpcHost(url: string): string {
  if (!url) return "<empty>";
  try {
    return new URL(url).host || "<none>";
  } catch {
    return "<unparseable>";
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve/reject with `p`, or reject with a timeout error after `ms`. Late settlement of `p` is swallowed. */
function withTimeout<T>(p: Promise<T>, ms: number, op: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SolanaAdapterError(`Solana RPC ${op} timed out after ${ms}ms`, op, "timeout"));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * JSON-RPC "invalid request/method/params" will fail identically on retry; our own input
 * errors too. So will "slot was skipped" (-32007 / -32009) from getBlockTime: a skipped
 * slot never gets a block.
 */
function isNonRetryable(e: unknown): boolean {
  if (e instanceof SolanaAdapterError) return e.kind === "invalid_input";
  const code = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
  return code === -32600 || code === -32601 || code === -32602 || code === -32007 || code === -32009;
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
