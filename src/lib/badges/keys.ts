/**
 * Badge keys, names and copy. Client-safe (no SVG, no server imports) so the profile
 * can name a Badge without pulling the designs into the bundle. The SVG artwork lives
 * in ./designs.ts; the on-chain mint in ./mint.ts.
 *
 * Badge.playKey is the key here. The four Play badges use the Play's own key
 * (first_position, diamond_hands, earnings_holder, mirror); league_top3 is awarded by
 * cron/badges from `league:<id>:rank:1|2|3` PointsEvents and has no Play row.
 */

export const BADGE_KEYS = ["first_position", "diamond_hands", "earnings_holder", "mirror", "league_top3"] as const;
export type BadgeKey = (typeof BADGE_KEYS)[number];

/**
 * The design (motif) of a Badge. The names are stable identifiers (they appear in the API's
 * BadgeView.accent and the metadata "Accent" trait), not colours: since Mono (9 Oct 2026) the
 * colours are neutral metals plus the one blue accent, set in `color` below.
 */
export type BadgeAccent = "ember" | "ice" | "gold" | "violet" | "laurel";

export interface BadgeInfo {
  key: BadgeKey;
  /** On-chain token name, e.g. "Dulo · First Position". */
  name: string;
  /** Short title without the "Dulo ·" prefix, for tiles. */
  title: string;
  description: string;
  accent: BadgeAccent;
  /** Metal tone (hex) shared by the SVG and the UI: blue-400 or a zinc/slate neutral, each at least 7:1 on #09090b. */
  color: string;
}

/** Token symbol shared by every Badge mint. */
export const BADGE_SYMBOL = "DULO";
export const BADGE_SEASON = "Stocks Season";

export const BADGES: Readonly<Record<BadgeKey, BadgeInfo>> = Object.freeze({
  first_position: {
    key: "first_position",
    name: "Dulo · First Position",
    title: "First Position",
    description: "Held an xStock worth $5 or more in a connected wallet. The first on-chain quest of Stocks Season, read from Solana.",
    accent: "ember",
    // The one accent (blue-400): the first on-chain quest.
    color: "#60a5fa",
  },
  diamond_hands: {
    key: "diamond_hands",
    name: "Dulo · Diamond Hands",
    title: "Diamond Hands",
    description: "Kept the same xStock through seven consecutive daily snapshots without selling.",
    accent: "ice",
    // Cold steel (slate-300).
    color: "#cbd5e1",
  },
  earnings_holder: {
    key: "earnings_holder",
    name: "Dulo · Earnings Holder",
    title: "Earnings Holder",
    description: "Held an xStock through its company's earnings date: snapshot before, snapshot after, still there.",
    accent: "gold",
    // Pewter (zinc-400).
    color: "#a1a1aa",
  },
  mirror: {
    key: "mirror",
    name: "Dulo · Portfolio Match",
    title: "Portfolio Match",
    description: "Copied another wallet's portfolio through prefilled Jupiter swaps from your own wallet and landed within 20% of it, verified by the next snapshot.",
    accent: "violet",
    // Chrome (zinc-200).
    color: "#e4e4e7",
  },
  league_top3: {
    key: "league_top3",
    name: "Dulo · Podium Finish",
    title: "Podium Finish",
    description: "Finished a weekly competition (virtual cash) in the top three.",
    accent: "laurel",
    // Platinum (zinc-50): rank 1 is white on every board.
    color: "#fafafa",
  },
});

export function isBadgeKey(key: string): key is BadgeKey {
  return (BADGE_KEYS as readonly string[]).includes(key);
}

/** Badge copy for a key; null for an unknown key. */
export function badgeInfo(key: string): BadgeInfo | null {
  return isBadgeKey(key) ? BADGES[key] : null;
}

/** Public image URL for a badge key (relative; prefix with the app origin for on-chain metadata). */
export function badgeImagePath(key: string): string {
  return `/api/v1/badges/${encodeURIComponent(key)}/image.svg`;
}

/** Public metadata URL for a badge key (relative). */
export function badgeMetadataPath(key: string): string {
  return `/api/v1/badges/${encodeURIComponent(key)}/metadata.json`;
}

/** Solscan link for a transaction signature. */
export function txExplorerUrl(txSig: string): string {
  return `https://solscan.io/tx/${encodeURIComponent(txSig)}`;
}
