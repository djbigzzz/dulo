/**
 * Issuer (AssetSource) names as the UI shows them. Client-safe, no React, no server imports:
 * lib/assets/registry is server-side (it loads the issuer modules), so the plain nouns are
 * repeated here and pinned equal to the registry's by tests/prestocks-ui.test.ts.
 *
 * Holding.source and Play.assetSource carry the registry names ("xstocks", "prestocks"). A
 * PreStocks token is a "pre-IPO token" (tokenized pre-IPO exposure): never a share, a stock or equity.
 */

export const XSTOCKS_SOURCE = "xstocks";
export const PRESTOCKS_SOURCE = "prestocks";

/** Season 0 Partner slug of the PreStocks issuer (lib/plays/partners); its page carries the pre-IPO lines. */
export const PRESTOCKS_PARTNER_SLUG = "prestocks";

export interface IssuerNoun {
  singular: string;
  plural: string;
}

interface IssuerInfo {
  /** Pill text ("xStocks" / "PreStocks"). */
  label: string;
  noun: IssuerNoun;
  /** The word after a quantity ("3 shares" / "3 tokens"). */
  unit: { singular: string; plural: string };
}

const ISSUERS: Readonly<Record<string, IssuerInfo>> = Object.freeze({
  [XSTOCKS_SOURCE]: { label: "xStocks", noun: { singular: "xStock", plural: "xStocks" }, unit: { singular: "share", plural: "shares" } },
  [PRESTOCKS_SOURCE]: { label: "PreStocks", noun: { singular: "pre-IPO token", plural: "pre-IPO tokens" }, unit: { singular: "token", plural: "tokens" } },
});

function info(source: string | null | undefined): IssuerInfo | null {
  if (typeof source !== "string") return null;
  const key = source.trim();
  return Object.prototype.hasOwnProperty.call(ISSUERS, key) ? ISSUERS[key] : null;
}

/** "xStocks" / "PreStocks" for a source name; null for a source this build does not know. */
export function issuerLabel(source: string | null | undefined): string | null {
  return info(source)?.label ?? null;
}

/** Plain nouns for a source name; unknown or missing names read as xStocks (the Season 0 default). */
export function assetNounFor(source: string | null | undefined): IssuerNoun {
  return info(source)?.noun ?? ISSUERS[XSTOCKS_SOURCE].noun;
}

/** "share" / "shares" for an xStock, "token" / "tokens" for a pre-IPO token (never "shares" for those). */
export function unitWordFor(source: string | null | undefined, qty: number): string {
  const unit = (info(source) ?? ISSUERS[XSTOCKS_SOURCE]).unit;
  return qty === 1 ? unit.singular : unit.plural;
}

export function isPreIpoSource(source: string | null | undefined): boolean {
  return typeof source === "string" && source.trim() === PRESTOCKS_SOURCE;
}

/** A quest key that names the pre-IPO issuer ("pre_ipo_position", "prestocks_holder"). */
const PRE_IPO_KEY_RE = /pre[-_]?ipo|prestocks/i;

/**
 * The issuer a quest is fenced to, as the UI can know it: the view's `assetSource` when the API
 * sends one (the preview does), else the quest key when it names the pre-IPO issuer, else null
 * (the Season 0 default, xStocks). Never a guess from the rule: rules are strict objects and carry
 * no issuer.
 */
export function questAssetSource(play: { key?: string; assetSource?: string | null }): string | null {
  if (typeof play.assetSource === "string" && play.assetSource.trim()) return play.assetSource.trim();
  if (typeof play.key === "string" && PRE_IPO_KEY_RE.test(play.key)) return PRESTOCKS_SOURCE;
  return null;
}

/** True when the quest is fenced to PreStocks pre-IPO tokens. */
export function isPreIpoQuest(play: { key?: string; assetSource?: string | null }): boolean {
  return isPreIpoSource(questAssetSource(play));
}
