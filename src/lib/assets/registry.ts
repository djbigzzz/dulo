/**
 * AssetSource registry — every issuer the app reads, in one list, behind the same interface.
 *
 * Season 0 ships two sources: xStocks (tokenised US equities, Pyth-priced while the session is
 * open) and PreStocks (tokenized pre-IPO exposure, DEX-priced only). Nothing outside lib/assets
 * imports an issuer module directly for a wallet read: cron/snapshot, cron/evaluate, lib/price
 * and the public preview resolve mints, ids and symbols through this file, and every Holding is
 * tagged with the name of the source that resolved it, so the Plays engine can fence a quest to
 * the issuer it was written for (Play.assetSource). Adding a third issuer is one more entry in
 * ASSET_SOURCES; no second scoring path exists.
 *
 * Every helper preserves each source's never-throws contract and isolates failures: a source
 * that throws is logged and treated as empty for that call, so it can never take the other down.
 * Registration order is precedence: were two sources ever to claim one mint, the first wins.
 */
import type { AssetId, AssetInfo, AssetSource } from "@/lib/core";
import { isAssetId, mintFromAssetId } from "@/lib/core";
import { normaliseQty as normaliseQtyImpl } from "./normalise";
import { prestocks } from "./prestocks";
import { xstocks } from "./xstocks";

const LOG_PREFIX = "[assets/registry]";

export interface RegisteredAssetSource {
  source: AssetSource;
  /**
   * True when the source's underlyings are US-listed equities with a Pyth Equity.US feed, so
   * lib/price may ask Hermes for them while the session is open. False means DEX price only:
   * lib/price never sends the asset to Pyth (no Hermes call, no negative-cache entry).
   */
  pythUnderlyings: boolean;
  /** Plain public noun for one asset of this source and for several ("xStock" / "xStocks"). */
  noun: { singular: string; plural: string };
}

/** Registration order is precedence. */
export const ASSET_SOURCES: readonly RegisteredAssetSource[] = Object.freeze([
  { source: xstocks, pythUnderlyings: true, noun: { singular: "xStock", plural: "xStocks" } },
  { source: prestocks, pythUnderlyings: false, noun: { singular: "pre-IPO token", plural: "pre-IPO tokens" } },
]);

/** An AssetInfo together with the source that resolved it. */
export interface ResolvedAsset {
  info: AssetInfo;
  /** AssetSource.name, the value written to Holding.source. */
  source: string;
  pythUnderlyings: boolean;
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Run one source call, turning a throw into `fallback` plus a warning. */
async function safe<T>(entry: RegisteredAssetSource, op: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`${LOG_PREFIX} ${String(entry.source.name)}.${op} failed — ${describe(e)}`);
    return fallback;
  }
}

/** The registry entry for a source name, or null. */
export function registeredSourceByName(name: string): RegisteredAssetSource | null {
  if (typeof name !== "string") return null;
  const key = name.trim();
  return ASSET_SOURCES.find((s) => s.source.name === key) ?? null;
}

/** The AssetSource for a name ("xstocks", "prestocks"), or null. */
export function sourceByName(name: string): AssetSource | null {
  return registeredSourceByName(name)?.source ?? null;
}

/** Plain nouns for a source name; unknown names read as the first registered source's. */
export function assetNoun(name: string | null | undefined): RegisteredAssetSource["noun"] {
  return (name ? registeredSourceByName(name) : null)?.noun ?? ASSET_SOURCES[0].noun;
}

/** Every source's mint set, in registration order. A failing source contributes an empty set. */
async function mintSets(): Promise<Array<{ entry: RegisteredAssetSource; mints: ReadonlySet<string> }>> {
  return Promise.all(
    ASSET_SOURCES.map(async (entry) => ({ entry, mints: await safe(entry, "mintSet", () => entry.source.mintSet(), new Set<string>()) })),
  );
}

/** The union of every source's mint set (the filter a wallet read is scoped to). */
export async function unionMintSet(): Promise<ReadonlySet<string>> {
  const out = new Set<string>();
  for (const { mints } of await mintSets()) for (const m of mints) out.add(m);
  return out;
}

/** Every source's catalogue concatenated in registration order, deduplicated by asset id. */
export async function listAllAssets(): Promise<AssetInfo[]> {
  const lists = await Promise.all(ASSET_SOURCES.map((entry) => safe(entry, "listAssets", () => entry.source.listAssets(), [] as AssetInfo[])));
  const out: AssetInfo[] = [];
  const seen = new Set<AssetId>();
  for (const list of lists) {
    for (const a of Array.isArray(list) ? list : []) {
      if (!a || seen.has(a.assetId)) continue;
      seen.add(a.assetId);
      out.push(a);
    }
  }
  return out;
}

/** The asset and the source that knows it, first registered source first. Null when none does. */
export async function resolveAssetAnySource(assetId: AssetId): Promise<ResolvedAsset | null> {
  if (typeof assetId !== "string" || !isAssetId(assetId)) return null;
  const hits = await Promise.all(ASSET_SOURCES.map((entry) => safe(entry, "getAsset", () => entry.source.getAsset(assetId), null)));
  for (let i = 0; i < ASSET_SOURCES.length; i += 1) {
    const info = hits[i];
    if (info) return { info, source: ASSET_SOURCES[i].source.name, pythUnderlyings: ASSET_SOURCES[i].pythUnderlyings };
  }
  return null;
}

/** AssetInfo for a CAIP-19 id from whichever source knows it. */
export async function getAssetAnySource(assetId: AssetId): Promise<AssetInfo | null> {
  return (await resolveAssetAnySource(assetId))?.info ?? null;
}

/** The asset and source for a symbol ("TSLAx", "SPACEX"), first registered source first. */
export async function resolveAssetBySymbolAnySource(symbol: string): Promise<ResolvedAsset | null> {
  if (typeof symbol !== "string" || !symbol.trim()) return null;
  const hits = await Promise.all(ASSET_SOURCES.map((entry) => safe(entry, "getAssetBySymbol", () => entry.source.getAssetBySymbol(symbol), null)));
  for (let i = 0; i < ASSET_SOURCES.length; i += 1) {
    const info = hits[i];
    if (info) return { info, source: ASSET_SOURCES[i].source.name, pythUnderlyings: ASSET_SOURCES[i].pythUnderlyings };
  }
  return null;
}

/** AssetInfo for a symbol from whichever source knows it. */
export async function getAssetBySymbolAnySource(symbol: string): Promise<AssetInfo | null> {
  return (await resolveAssetBySymbolAnySource(symbol))?.info ?? null;
}

/** The name of the first source whose mint set holds `mint`, or null. */
export async function sourceOfMint(mint: string): Promise<string | null> {
  if (typeof mint !== "string" || !mint.trim()) return null;
  const m = mint.trim();
  for (const { entry, mints } of await mintSets()) if (mints.has(m)) return entry.source.name;
  return null;
}

/** The name of the source that owns a CAIP-19 id: its catalogue first, then its mint set. Null for anything else. */
export async function sourceOfAsset(assetId: AssetId): Promise<string | null> {
  const resolved = await resolveAssetAnySource(assetId);
  if (resolved) return resolved.source;
  try {
    return await sourceOfMint(mintFromAssetId(assetId));
  } catch {
    return null;
  }
}

/** A source's normaliseQty by name; the shared exact implementation for an unknown name. */
export function normaliseQtyFor(sourceName: string | null | undefined, amountRaw: string, decimals: number, multiplier: number): number {
  const source = sourceName ? sourceByName(sourceName) : null;
  return (source ?? { normaliseQty: normaliseQtyImpl }).normaliseQty(amountRaw, decimals, multiplier);
}
