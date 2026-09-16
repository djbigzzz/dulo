import { SOLANA_MAINNET, type ChainId } from "../core/caip";

/**
 * Season 0 and its seeded Partners.
 *
 * Partners are seeded by hand for the hackathon (no self-serve dashboard — cut list).
 * Each Partner has exactly one Campaign in Season 0 whose id is deterministic so the
 * seed is idempotent and other modules can link to it without a lookup. No placeholder
 * Partners: a new project is added here (and upserted by the seed) when it lists a Play.
 *
 * Client-safe: no server imports.
 */

export const SEASON0_ID = "season-0";

export interface SeasonDef {
  id: string;
  name: string;
  chainScope: ChainId[];
  /** ISO timestamps (UTC). */
  startsAt: string;
  endsAt: string;
}

export const SEASON0: SeasonDef = {
  id: SEASON0_ID,
  name: "Stocks Season",
  chainScope: [SOLANA_MAINNET],
  startsAt: "2026-09-14T00:00:00.000Z",
  endsAt: "2026-12-31T23:59:59.000Z",
};

export type PartnerKind = "issuer" | "dex" | "lending" | "app";

export interface PartnerLinks {
  website?: string;
  x?: string;
  docs?: string;
}

export interface SeasonPartner {
  slug: string;
  name: string;
  kind: PartnerKind;
  /** null = render the neutral placeholder (initials on the tamga). */
  logoUrl: string | null;
  blurb: string;
  links: PartnerLinks;
  chainIds: ChainId[];
  sortOrder: number;
  /** The Partner's single Season 0 Campaign. */
  campaign: { id: string; title: string };
  /**
   * True for the house Partner (Dulo's own games). It owns a Campaign and Plays like any other
   * Partner, but it is not a listed project: it never appears on /partners or the landing row.
   */
  hidden?: true;
}

/** Deterministic Campaign id: `camp-<partnerSlug>-<seasonId>`. */
export function campaignIdFor(partnerSlug: string, seasonId: string = SEASON0_ID): string {
  return `camp-${partnerSlug}-${seasonId}`;
}

/** Slug of the house Partner that holds Dulo's own game Plays (League, Calls). */
export const HOUSE_PARTNER_SLUG = "dulo";

/** Slugs never listed as Partners (/partners, landing row). Queries filter on this. */
export const HIDDEN_PARTNER_SLUGS: readonly string[] = [HOUSE_PARTNER_SLUG];

export const SEASON0_PARTNERS: readonly SeasonPartner[] = [
  {
    slug: "xstocks",
    name: "xStocks",
    kind: "issuer",
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/SPYx.png",
    blurb:
      "Tokenized US stocks and ETFs on Solana, issued by Backed. Every xStock is a Token-2022 mint you hold in your own wallet, which is exactly what lets Dulo verify an on-chain quest.",
    links: {
      website: "https://xstocks.fi",
      x: "https://x.com/xStocksFi",
      docs: "https://docs.xstocks.fi",
    },
    chainIds: [SOLANA_MAINNET],
    sortOrder: 0,
    campaign: { id: campaignIdFor("xstocks"), title: "xStocks · Stocks Season" },
  },
  {
    slug: "jupiter",
    name: "Jupiter",
    kind: "dex",
    logoUrl: "https://static.jup.ag/jup/icon.png",
    blurb:
      "Solana's swap aggregator. Dulo's copy tool links out to Jupiter, where any swap is yours to make from your own wallet. A Jupiter Recurring quest is coming soon: Dulo would read an active order from its order account.",
    links: {
      website: "https://jup.ag",
      x: "https://x.com/JupiterExchange",
      docs: "https://dev.jup.ag",
    },
    chainIds: [SOLANA_MAINNET],
    sortOrder: 1,
    campaign: { id: campaignIdFor("jupiter"), title: "Jupiter · Stocks Season" },
  },
  {
    slug: "kamino",
    name: "Kamino",
    kind: "lending",
    logoUrl: "https://cdn.kamino.finance/kamino.svg",
    blurb:
      "Lending on Solana. The Kamino xStocks market lets you post SPYx and QQQx as collateral. Dulo will read your Kamino xStocks position from Kamino's public API.",
    links: {
      website: "https://kamino.finance",
      x: "https://x.com/KaminoFinance",
    },
    chainIds: [SOLANA_MAINNET],
    sortOrder: 2,
    campaign: { id: campaignIdFor("kamino"), title: "Kamino · Stocks Season" },
  },
  {
    // House Partner: Dulo's own games. Hidden from /partners and the landing row (HIDDEN_PARTNER_SLUGS).
    slug: HOUSE_PARTNER_SLUG,
    name: "Dulo games",
    kind: "app",
    logoUrl: "/icons/icon-192.png",
    blurb:
      "Dulo's own games: a weekly competition with virtual cash, and predictions for points only. No xStocks needed and no real money involved.",
    links: {},
    chainIds: [SOLANA_MAINNET],
    sortOrder: 3,
    campaign: { id: campaignIdFor(HOUSE_PARTNER_SLUG), title: "Dulo games · Stocks Season" },
    hidden: true,
  },
];

/** Partners a listing may show (/partners, landing row): everything except the house Partner. */
export function isListedPartnerSlug(slug: string): boolean {
  return !HIDDEN_PARTNER_SLUGS.includes(slug);
}

export function partnerBySlug(slug: string): SeasonPartner | undefined {
  return SEASON0_PARTNERS.find((p) => p.slug === slug);
}
