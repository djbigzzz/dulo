/**
 * Corporate actions (server-side view model, no UI).
 *
 * A Token-2022 ScaledUiAmount mint carries `multiplier`, and optionally a `newMultiplier` that
 * takes over at `newMultiplierEffectiveTimestamp`. When the two differ, the mint has a corporate
 * action on record: a split (an integer ratio of 2 or more) or an adjustment (anything else, an
 * issuer's periodic rebase included). An action changes the NUMBER OF TOKENS SHOWN for every
 * holder, never the holder's value or raw balance, and this model carries no price on purpose:
 * it is never a price signal.
 *
 * listCorporateActions reads every registered issuer's catalogue (lib/assets/registry), batches
 * ONE mint read for all of their mints through the ChainAdapter (SolanaAdapter.getMintInfos, which
 * is itself cached) and keeps the resulting list in memory for 10 minutes. It never throws: on a
 * failure it serves the last good list (or []) and waits CORPORATE_ACTIONS_RETRY_MS before asking
 * again, so a Partner page never stalls on an RPC outage.
 *
 * Live facts (verified on-chain 22 Sep 2026): SPACEX 1 -> 5 effective 2026-06-10T04:30:00Z and
 * OPENAI 1 -> 1.4861347 effective 2026-07-17T16:30:00Z. Every other PreStocks mint and every
 * xStock: multiplier 1, no pending change.
 *
 * Testing: configureCorporateActions injects the adapter, the asset list and the clock;
 * resetCorporateActions clears the cache and the options.
 */
import { type MintInfo, type SolanaAdapter, effectiveMultiplier, solana, type ScaledUiAmountState } from "@/lib/adapters/solana";
import { ASSET_SOURCES, registeredSourceByName } from "@/lib/assets/registry";
import type { AssetInfo } from "@/lib/core";
import { mintFromAssetId } from "@/lib/core";
import type { CorporateActionView } from "@/lib/api-client";
import { partnerBySlug } from "@/lib/plays/partners";

// ---------------------------------------------------------------------------
// Types + constants
// ---------------------------------------------------------------------------

/** One pending or past ScaledUiAmount change on a mint. The API shape (CorporateActionView) and this are the same type. */
export type CorporateAction = CorporateActionView;

export type CorporateActionKind = CorporateAction["kind"];

/** The list is re-read from the chain after this long. */
export const CORPORATE_ACTIONS_TTL_MS = 10 * 60 * 1000;
/** After a failed read, the last good list (or []) is served without another read for this long. */
export const CORPORATE_ACTIONS_RETRY_MS = 60 * 1000;

const LOG_PREFIX = "[corporate-actions]";

/** An asset together with the registry source that lists it. */
export interface SourcedAsset {
  info: AssetInfo;
  /** AssetSource.name ("xstocks", "prestocks"). */
  source: string;
}

export interface CorporateActionsOptions {
  /** The chain adapter the mint states are read through. Defaults to the app's Solana adapter. */
  adapter: Pick<SolanaAdapter, "getMintInfos">;
  /** Every registered issuer's catalogue, tagged with its source. Defaults to the registry. */
  listAssets: () => Promise<SourcedAsset[]>;
  /** Clock in ms. Defaults to Date.now. */
  now: () => number;
  ttlMs: number;
  retryMs: number;
}

function defaultOptions(): CorporateActionsOptions {
  return { adapter: solana, listAssets: listRegistryAssets, now: Date.now, ttlMs: CORPORATE_ACTIONS_TTL_MS, retryMs: CORPORATE_ACTIONS_RETRY_MS };
}

let options: CorporateActionsOptions = defaultOptions();

/** Patch module options (adapter, asset list, clock, TTLs). The cache is untouched. */
export function configureCorporateActions(patch: Partial<CorporateActionsOptions>): void {
  options = { ...options, ...patch };
}

/** Clear the cache and restore default options. Test hook. */
export function resetCorporateActions(): void {
  options = defaultOptions();
  cache = null;
  inflight = null;
  retryAt = 0;
}

// ---------------------------------------------------------------------------
// Pure mapping
// ---------------------------------------------------------------------------

/** Ratio is an integer of at least 2 (a split); anything else, a reverse split included, is an adjustment. */
function kindOf(ratio: number): CorporateActionKind {
  return ratio >= 2 && Math.abs(ratio - Math.round(ratio)) < 1e-9 ? "split" : "adjustment";
}

/**
 * The corporate action a mint's ScaledUiAmount state describes, or null when nothing changes
 * (no newMultiplier, or the same value). `effective` follows the on-chain rule (effectiveMultiplier):
 * the new multiplier is in force once its timestamp is <= now. A timestamp of 0 or null has no
 * date to show (effectiveAt null).
 */
export function corporateActionFor(info: AssetInfo, source: string, state: ScaledUiAmountState | null, nowSeconds: number): CorporateAction | null {
  if (!state || state.newMultiplier === null) return null;
  const before = state.multiplier;
  const after = state.newMultiplier;
  if (!(before > 0) || !(after > 0) || !Number.isFinite(before) || !Number.isFinite(after)) return null;
  if (Math.abs(after - before) <= 1e-12 * Math.max(1, before, after)) return null;
  const ratio = Math.round((after / before) * 1e8) / 1e8;
  const ts = state.newMultiplierEffectiveTimestamp;
  return {
    assetId: info.assetId,
    symbol: info.symbol,
    source,
    kind: kindOf(ratio),
    multiplierBefore: before,
    multiplierAfter: after,
    ratio,
    effectiveAt: ts !== null && ts > 0 ? new Date(ts * 1000).toISOString() : null,
    effective: effectiveMultiplier(state, nowSeconds) === after,
  };
}

// ---------------------------------------------------------------------------
// Registry + adapter reads
// ---------------------------------------------------------------------------

/** Every registered source's catalogue, in registration order, tagged with the source name. A failing source contributes nothing. */
async function listRegistryAssets(): Promise<SourcedAsset[]> {
  const lists = await Promise.all(
    ASSET_SOURCES.map(async (entry) => {
      try {
        const assets = await entry.source.listAssets();
        return (Array.isArray(assets) ? assets : []).map((info) => ({ info, source: entry.source.name }));
      } catch (e) {
        console.warn(`${LOG_PREFIX} ${entry.source.name}.listAssets failed — ${describe(e)}`);
        return [] as SourcedAsset[];
      }
    }),
  );
  return lists.flat();
}

interface Cache {
  actions: CorporateAction[];
  fetchedAt: number;
}

let cache: Cache | null = null;
let inflight: Promise<CorporateAction[]> | null = null;
let retryAt = 0;

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The mint of a Solana token asset id, or null for any other id. */
function mintOf(info: AssetInfo): string | null {
  try {
    return mintFromAssetId(info.assetId);
  } catch {
    return null;
  }
}

/** One batched read of every registered mint's state, mapped to actions. Throws on failure (the caller degrades). */
async function readAll(): Promise<CorporateAction[]> {
  const assets = await options.listAssets();
  const byMint = new Map<string, SourcedAsset>();
  for (const a of assets) {
    if (!a || !a.info || typeof a.source !== "string") continue;
    const mint = mintOf(a.info);
    if (mint && !byMint.has(mint)) byMint.set(mint, a);
  }
  if (byMint.size === 0) return [];
  const infos: Map<string, MintInfo> = await options.adapter.getMintInfos([...byMint.keys()]);
  const nowSeconds = Math.floor(options.now() / 1000);
  const order = new Map(ASSET_SOURCES.map((entry, i) => [entry.source.name, i]));
  const out: CorporateAction[] = [];
  for (const [mint, { info, source }] of byMint) {
    const action = corporateActionFor(info, source, infos.get(mint)?.scaledUi ?? null, nowSeconds);
    if (action) out.push(action);
  }
  // Registration order, then symbol: a stable order for the API.
  return out.sort((a, b) => (order.get(a.source) ?? 99) - (order.get(b.source) ?? 99) || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
}

/** The cached list when fresh, else one shared read; on failure the last good list or []. Never throws. */
async function current(): Promise<CorporateAction[]> {
  const now = options.now();
  if (cache && now - cache.fetchedAt < options.ttlMs) return cache.actions;
  if (inflight) return inflight;
  if (now < retryAt) return cache?.actions ?? [];
  inflight = (async () => {
    try {
      const actions = await readAll();
      cache = { actions, fetchedAt: options.now() };
      retryAt = 0;
      return actions;
    } catch (e) {
      retryAt = options.now() + options.retryMs;
      console.warn(`${LOG_PREFIX} read failed; serving ${cache ? "the last good list" : "no actions"} for ${Math.round(options.retryMs / 1000)}s — ${describe(e)}`);
      return cache?.actions ?? [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Every corporate action on record across the registered issuers, or only those of `source`
 * ("prestocks", "xstocks"). One entry per mint whose newMultiplier is set and differs from its
 * multiplier; `effective` says whether it is already in force. Never throws.
 */
export async function listCorporateActions(source?: string): Promise<CorporateAction[]> {
  try {
    const all = await current();
    if (source === undefined) return all.slice();
    const key = typeof source === "string" ? source.trim() : "";
    return key ? all.filter((a) => a.source === key) : [];
  } catch (e) {
    // current() already degrades; belt and braces so a caller can never see a rejection.
    console.warn(`${LOG_PREFIX} listCorporateActions failed unexpectedly — ${describe(e)}`);
    return [];
  }
}

/**
 * The AssetSource an issuer Partner page shows corporate actions for: the Partner's slug when it
 * is a Season 0 issuer Partner whose slug names a registered source ("prestocks", "xstocks"); null
 * for every other Partner (a DEX, a lender, the hidden house Partner) and for unknown slugs.
 */
export function issuerSourceForPartner(slug: string): string | null {
  if (typeof slug !== "string" || !slug.trim()) return null;
  const partner = partnerBySlug(slug.trim());
  if (!partner || partner.kind !== "issuer") return null;
  return registeredSourceByName(partner.slug) ? partner.slug : null;
}
