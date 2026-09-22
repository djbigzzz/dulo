import { PlayRuleSchema, type PlayRule } from "./rules";
import { HOUSE_PARTNER_SLUG, SEASON0_PARTNERS, partnerBySlug } from "./partners";

/**
 * Season 0 quest catalogue (docs/HANDOFF.md §3.1). Code name: Play.
 *
 * 23 rows: 10 in-platform quests (internal_event rules, completed with starter points and
 * virtual cash; since 22 Sep two of them count paper trades in pre-IPO tokens only), 11 on-chain
 * quests (verified from the user's wallet snapshots; each description is the wallet state to
 * reach, never an instruction to buy: 9 fenced to xStocks and, since 22 Sep, 2 fenced to
 * PreStocks pre-IPO tokens) and 2 partner quests marked coming soon.
 * Live totals: 1,000 in-platform points, 2,950 on-chain points.
 *
 * This is the source of truth the seed writes to the Play table. Rules are pure JSON
 * (PlayRuleSchema); presentation flags such as `comingSoon` live on the catalogue entry,
 * never inside the rule.
 *
 * Convention for other modules: a Play with `comingSoon: true` is seeded with
 * Play.isActive = false. The engine skips inactive Plays; the UI shows them as
 * "coming soon". Nothing else about the row differs.
 *
 * Client-safe: no server imports.
 */

/** The AssetSource every Season 0 Play is evaluated against. */
export const SEASON0_ASSET_SOURCE = "xstocks";

export interface CataloguePlay {
  /** Stable natural key. Play.key in the DB and the `playKey` on PlayProgress / Badge. */
  key: string;
  partnerSlug: string;
  campaignTitle: string;
  title: string;
  /** Short, second person, Dulo voice. */
  desc: string;
  /** Points awarded once, on completion. Points only, no cash value. */
  points: number;
  /** Set when completing mints a soulbound Badge. */
  badgeKey?: string;
  rule: PlayRule;
  sortOrder: number;
  /** Listed but not yet verifiable (partner integration pending). Seeded as isActive=false. */
  comingSoon?: true;
  /**
   * The AssetSource this quest is fenced to (Play.assetSource; lib/assets/registry names).
   * Omitted means SEASON0_ASSET_SOURCE. The seed and the public preview both read it, so a
   * quest written for another issuer carries its own fence from the catalogue onwards.
   */
  assetSource?: string;
}

/** Play.assetSource for a catalogue entry: its own, else the Season 0 default. */
export function playAssetSource(play: Pick<CataloguePlay, "assetSource">): string {
  return play.assetSource ?? SEASON0_ASSET_SOURCE;
}

function campaignTitleFor(slug: string): string {
  const p = partnerBySlug(slug);
  if (!p) throw new Error(`Unknown Season 0 partner slug: ${slug}`);
  return p.campaign.title;
}

const XSTOCKS = campaignTitleFor("xstocks");
const PRESTOCKS = campaignTitleFor("prestocks");
/** The AssetSource name of the second issuer (lib/assets/registry); its quest is fenced to it. */
export const PRESTOCKS_ASSET_SOURCE = "prestocks";
/**
 * The eight PreStocks pre-IPO token symbols (lib/assets/prestocks PRESTOCKS_STATIC, 22 Sep 2026),
 * the symbol set the two pre-IPO paper-trade quests count. Listed here, not imported, so this
 * file stays client-safe; tests/internal-event-symbols.test.ts pins it equal to the static
 * catalogue, so the two cannot drift.
 */
export const PRE_IPO_SYMBOLS: readonly string[] = Object.freeze(["ANDURIL", "ANTHROPIC", "FIGUREAI", "KALSHI", "NEURALINK", "OPENAI", "POLYMARKET", "SPACEX"]);
/** In-platform quests (competition, predictions) sit under the hidden house Partner, not under a listed one. */
const DULO_GAMES = campaignTitleFor(HOUSE_PARTNER_SLUG);

export const SEASON0_PLAYS: readonly CataloguePlay[] = [
  // --- On-chain quests: xStocks (core campaign) ------------------------------
  // Every description states the wallet state the snapshot verifies, never an action to take.
  {
    key: "first_position",
    partnerSlug: "xstocks",
    campaignTitle: XSTOCKS,
    title: "First Position",
    desc: "Your connected wallet holds any xStock worth $5 or more. Read straight from Solana, with no form to fill in.",
    points: 100,
    badgeKey: "first_position",
    rule: { type: "hold_any", minUsd: 5 },
    sortOrder: 0,
  },
  {
    key: "diversified",
    partnerSlug: "xstocks",
    campaignTitle: XSTOCKS,
    title: "Diversified",
    desc: "Your wallet holds three or more xStocks across at least two sectors in the same snapshot.",
    points: 250,
    rule: { type: "diversified", minAssets: 3, minSectors: 2 },
    sortOrder: 1,
  },
  {
    key: "diamond_hands",
    partnerSlug: "xstocks",
    campaignTitle: XSTOCKS,
    title: "Diamond Hands",
    desc: "The same xStock stays in your wallet for seven daily snapshots in a row. A snapshot without it restarts the count.",
    points: 300,
    badgeKey: "diamond_hands",
    rule: { type: "hold_consecutive", days: 7 },
    sortOrder: 2,
  },
  {
    key: "dca_streak",
    partnerSlug: "xstocks",
    campaignTitle: XSTOCKS,
    title: "Steady Buyer",
    desc: "Your xStocks balance is higher than the day before on three separate days inside any 14-day window.",
    points: 300,
    rule: { type: "net_increase_days", count: 3, window: 14 },
    sortOrder: 3,
  },
  {
    key: "earnings_holder",
    partnerSlug: "xstocks",
    campaignTitle: XSTOCKS,
    title: "Earnings Holder",
    desc: "An xStock stays in your wallet through its company's earnings date, with a snapshot before and after.",
    points: 400,
    badgeKey: "earnings_holder",
    rule: { type: "hold_through_date", calendarKey: "earnings" },
    sortOrder: 4,
  },
  {
    // The copy tool (/copy) records the chosen portfolio; this quest only reads the wallet state after it.
    key: "mirror",
    partnerSlug: "xstocks",
    campaignTitle: XSTOCKS,
    title: "Portfolio Match",
    desc: "Your wallet's xStocks allocation lands within 20% of a portfolio you chose to copy. The next snapshot compares the two.",
    points: 500,
    badgeKey: "mirror",
    rule: { type: "mirror_match", tolerance: 0.2 },
    sortOrder: 5,
  },
  {
    key: "thousand_club",
    partnerSlug: "xstocks",
    campaignTitle: XSTOCKS,
    title: "Thousand Club",
    desc: "Your largest position in a single xStock is worth $1,000 or more in the latest snapshot.",
    points: 300,
    rule: { type: "hold_any", minUsd: 1000 },
    sortOrder: 6,
  },
  {
    key: "index_holder",
    partnerSlug: "xstocks",
    campaignTitle: XSTOCKS,
    title: "Index Holder",
    desc: "Your wallet holds SPYx, QQQx, VOOx or VTIx worth $5 or more. Each one tracks a whole index, read straight from Solana.",
    points: 150,
    // scopeOf (engine.ts) matches assetSymbols case-insensitively against the holding's symbol.
    rule: { type: "hold_any", minUsd: 5, assetSymbols: ["SPYx", "QQQx", "VOOx", "VTIx"] },
    sortOrder: 7,
  },
  {
    key: "sector_spread",
    partnerSlug: "xstocks",
    campaignTitle: XSTOCKS,
    title: "Sector Spread",
    desc: "Your wallet holds five or more xStocks across at least four sectors in the same snapshot.",
    points: 400,
    rule: { type: "diversified", minAssets: 5, minSectors: 4 },
    sortOrder: 8,
  },

  // --- On-chain quests: PreStocks (second issuer, added 22 Sep 2026) ---------
  // Fenced to the "prestocks" source, so an xStock can never complete it and it can never touch an
  // xStocks quest. Count-based on purpose: every pre-IPO token is priced by Jupiter only, and the
  // price cache is empty on a cold start, so a USD threshold could read incomplete for a wallet that
  // plainly holds the token. `hold_any` with minUsd 0 completes on any in-scope position with
  // qty > 0, priced or not (the engine never needs a price for it).
  {
    key: "pre_ipo_position",
    partnerSlug: "prestocks",
    campaignTitle: PRESTOCKS,
    title: "Pre-IPO Position",
    desc: "Your connected wallet holds any PreStocks pre-IPO token, whatever the amount. Read straight from Solana and counted by the token, not by a price, because pre-IPO tokens trade on thin pools.",
    points: 100,
    rule: { type: "hold_any", minUsd: 0 },
    sortOrder: 9,
    assetSource: PRESTOCKS_ASSET_SOURCE,
  },
  // multiplier_change (the eighth rule type) reads consecutive day-end snapshots and completes when the
  // same raw balance sits under a new Token-2022 ScaledUiAmount multiplier AND the mint's own record
  // (lib/corporate-actions) dates that change between the two ticks. An adjustment changes the
  // number of tokens shown, never the holder's value, and the copy says so. Both PreStocks adjustments
  // on record (SpaceX 1 -> 5 on 10 Jun 2026, OpenAI 1 -> 1.4861347 on 17 Jul 2026) predate Dulo's first
  // production snapshot (21 Sep 2026), so this quest is truthful only as "completes on the next one".
  {
    key: "held_through_split",
    partnerSlug: "prestocks",
    campaignTitle: PRESTOCKS,
    title: "Held Through a Split",
    desc: "Your wallet held a pre-IPO token across an on-chain adjustment: the same raw balance in two daily snapshots, with a new multiplier between them. Completes on the next adjustment; SpaceX's 5-for-1 and OpenAI's x1.4861 happened before Dulo took its first snapshot.",
    points: 150,
    rule: { type: "multiplier_change" },
    sortOrder: 10,
    assetSource: PRESTOCKS_ASSET_SOURCE,
  },

  // --- In-platform quests (hidden house Partner) ----------------------------
  // Completed with starter points and virtual cash; every one completes inline on the request.
  {
    key: "oracle",
    partnerSlug: HOUSE_PARTNER_SLUG,
    campaignTitle: DULO_GAMES,
    title: "First Prediction",
    desc: "Make your first prediction. Points only, settled from the Friday close, source shown on the card.",
    points: 50,
    rule: { type: "internal_event", event: "call_placed", count: 1 },
    sortOrder: 0,
  },
  {
    key: "scout",
    partnerSlug: HOUSE_PARTNER_SLUG,
    campaignTitle: DULO_GAMES,
    title: "First Paper Trades",
    desc: "Place three paper trades in the weekly competition. Virtual cash, real xStock prices, no real money.",
    points: 50,
    rule: { type: "internal_event", event: "league_trade", count: 3 },
    sortOrder: 1,
  },
  {
    // The event ref is the question's id, so both sides of one question count once.
    key: "three_predictions",
    partnerSlug: HOUSE_PARTNER_SLUG,
    campaignTitle: DULO_GAMES,
    title: "Three Predictions",
    desc: "Make predictions on three different questions. Your starter points cover it, and both sides of one question count once.",
    points: 75,
    rule: { type: "internal_event", event: "call_placed", count: 3, distinctBy: "ref" },
    sortOrder: 2,
  },
  {
    key: "paper_portfolio",
    partnerSlug: HOUSE_PARTNER_SLUG,
    campaignTitle: DULO_GAMES,
    title: "Paper Portfolio",
    desc: "Place paper trades in three different xStocks. Virtual cash only, and sells count too.",
    points: 75,
    rule: { type: "internal_event", event: "league_trade", count: 3, distinctBy: "symbol" },
    sortOrder: 3,
  },
  {
    key: "ten_paper_trades",
    partnerSlug: HOUSE_PARTNER_SLUG,
    campaignTitle: DULO_GAMES,
    title: "Ten Paper Trades",
    desc: "Place ten paper trades. Virtual cash, real prices, no real money, and trades from any week count.",
    points: 150,
    rule: { type: "internal_event", event: "league_trade", count: 10 },
    sortOrder: 4,
  },
  {
    key: "paper_portfolio_five",
    partnerSlug: HOUSE_PARTNER_SLUG,
    campaignTitle: DULO_GAMES,
    title: "Five-Stock Paper Portfolio",
    desc: "Place paper trades in five different xStocks. Virtual cash only, and trades from any week count.",
    points: 150,
    rule: { type: "internal_event", event: "league_trade", count: 5, distinctBy: "symbol" },
    sortOrder: 5,
  },
  {
    // game_action is derived from paper trades and prediction positions; days are UTC calendar days.
    key: "game_days",
    partnerSlug: HOUSE_PARTNER_SLUG,
    campaignTitle: DULO_GAMES,
    title: "Three Game Days",
    desc: "Be active on three different days (UTC). A paper trade or a new prediction counts for that day.",
    points: 150,
    rule: { type: "internal_event", event: "game_action", count: 3, distinctBy: "day" },
    sortOrder: 6,
  },
  {
    key: "five_predictions",
    partnerSlug: HOUSE_PARTNER_SLUG,
    campaignTitle: DULO_GAMES,
    title: "Five Predictions",
    desc: "Make predictions on five different questions. New questions open every week, and both sides of one question count once.",
    points: 150,
    rule: { type: "internal_event", event: "call_placed", count: 5, distinctBy: "ref" },
    sortOrder: 7,
  },
  // Pre-IPO tokens trade in the same virtual-cash competition since 22 Sep. These two count only
  // league_trade events whose symbol is one of the eight (assetSymbols on an internal_event rule),
  // and carry the PreStocks fence so every hint, pill and proof label says "pre-IPO token", never
  // "stock". Points only, no cash value, and never an instruction to buy a real asset.
  {
    key: "first_preipo_trade",
    partnerSlug: HOUSE_PARTNER_SLUG,
    campaignTitle: DULO_GAMES,
    title: "First Pre-IPO Trade",
    desc: "Place your first paper trade in a pre-IPO token with virtual cash. Points only, never real money.",
    points: 50,
    rule: { type: "internal_event", event: "league_trade", count: 1, assetSymbols: [...PRE_IPO_SYMBOLS] },
    sortOrder: 8,
    assetSource: PRESTOCKS_ASSET_SOURCE,
  },
  {
    key: "preipo_trio",
    partnerSlug: HOUSE_PARTNER_SLUG,
    campaignTitle: DULO_GAMES,
    title: "Pre-IPO Trio",
    desc: "Place paper trades in three different pre-IPO tokens with virtual cash. Trades from any week count, and sells count too.",
    points: 100,
    rule: { type: "internal_event", event: "league_trade", count: 3, distinctBy: "symbol", assetSymbols: [...PRE_IPO_SYMBOLS] },
    sortOrder: 9,
    assetSource: PRESTOCKS_ASSET_SOURCE,
  },

  // --- Partner on-chain quests, coming soon ----------------------------------
  // Seeded isActive=false and never evaluated. No partner has signed; the listing is a plan.
  {
    key: "kamino_collateral",
    partnerSlug: "kamino",
    campaignTitle: campaignTitleFor("kamino"),
    title: "Kamino Collateral",
    desc: "SPYx or QQQx posted as collateral in Kamino's xStocks market. Coming soon: Dulo will read it from Kamino's public API once the listing is live.",
    points: 300,
    rule: { type: "hold_any", minUsd: 1, partnerAssetIds: [] },
    sortOrder: 0,
    comingSoon: true,
  },
  {
    key: "jupiter_dca",
    partnerSlug: "jupiter",
    campaignTitle: campaignTitleFor("jupiter"),
    title: "Jupiter Recurring",
    desc: "An active Jupiter Recurring order into an xStock from your wallet. Coming soon: Dulo will read it from the order account once the listing is live.",
    points: 200,
    rule: { type: "hold_any", minUsd: 1, partnerAssetIds: [] },
    sortOrder: 0,
    comingSoon: true,
  },
];

// Fail fast at module load if the catalogue drifts from the schema or the partner list.
for (const play of SEASON0_PLAYS) {
  const parsed = PlayRuleSchema.safeParse(play.rule);
  if (!parsed.success) throw new Error(`Catalogue Play "${play.key}" has an invalid rule`);
  if (!SEASON0_PARTNERS.some((p) => p.slug === play.partnerSlug)) {
    throw new Error(`Catalogue Play "${play.key}" references unknown partner "${play.partnerSlug}"`);
  }
}

export function playByKey(key: string): CataloguePlay | undefined {
  return SEASON0_PLAYS.find((p) => p.key === key);
}

/** Keys of the Plays that mint a Badge on completion (four in Season 0). */
export const SEASON0_BADGE_KEYS: readonly string[] = SEASON0_PLAYS.filter((p) => p.badgeKey).map((p) => p.badgeKey as string);

/** Plays that are live (seeded isActive=true). */
export function activePlays(): CataloguePlay[] {
  return SEASON0_PLAYS.filter((p) => !p.comingSoon);
}
