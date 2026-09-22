import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * PreStocks on screen (Build 2 UI). A pre-IPO holding is honest and legible: the issuer pill from
 * Holding.source, the pre-IPO noun in every quest sentence, the multiplier arithmetic once, the
 * issuer mark beside the DEX price worded as an explanation and never a signal, and the pre-IPO
 * compliance line beside the standard one wherever a pre-IPO token is on screen. The landing
 * first screen, nav, tabs and game tiles never mention PreStocks. No network: the preview is
 * built from in-process reads.
 */

vi.mock("@/lib/server/db", () => ({ db: {} }));
// Presentational only in these renders; the real logo tile needs a browser image.
vi.mock("@/components/common/PartnerLogo", () => ({ PartnerLogo: ({ name }: { name: string }) => createElement("span", null, name) }));
vi.mock("@/components/wallet/ConnectButton", () => ({ ConnectButton: () => null }));

import { COMPLIANCE_LINE, PRE_IPO_COMPLIANCE_LINE, PRE_IPO_TOKEN_2022_NOTE } from "@/components/common/compliance";
import { assetNounFor, isPreIpoQuest, issuerLabel, questAssetSource, unitWordFor } from "@/components/common/issuer";
import { ASSET_SOURCES } from "@/lib/assets/registry";
import { POSITIONING } from "@/lib/config";
import { ruleToHint } from "@/components/plays/rule-hint";
import { flattenProof } from "@/components/plays/proof";
import { cardProgress } from "@/components/plays/play-meta";
import { PlayCard } from "@/components/plays/PlayCard";
import { PlayGrid } from "@/components/plays/PlayGrid";
import { PartnerBody, isPreIpoPartner } from "@/components/partners/PartnerView";
import { HoldingRow, HoldingsList } from "@/app/check/_components/HoldingsList";
import { PreviewPlayCard } from "@/app/check/_components/PreviewPlayCard";
import { ISSUER_MARK_EXPLANATION, formatShortAge, hasPreIpoHolding, hasPreIpoQuest, issuerMarkLine, multiplierArithmetic, positionsHint } from "@/app/check/_components/check-format";
import { buildPreview, issuerMarkView } from "@/app/api/v1/preview/preview";
import { catalogueIndexFrom } from "@/lib/cron/evaluate";
import type { PreStocksMark } from "@/lib/assets/prestocks";
import type { AssetId, ChainId, Holding, PriceQuote } from "@/lib/core";
import type { PartnerDetail, PartnerGroup, PlayView, PreviewHoldingView, PreviewPlayView, PreviewResponse } from "@/lib/api-client";

const ROOT = path.resolve(__dirname, "..");
const repoFile = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const SOL: ChainId = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SPACEX_MINT = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const TSLA_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const SPACEX = `${SOL}/token:${SPACEX_MINT}` as AssetId;
const TSLA = `${SOL}/token:${TSLA_MINT}` as AssetId;
const NOW = new Date("2026-09-22T12:00:00.000Z");
const NOW_MS = NOW.getTime();

/** Words that would turn a pre-IPO token into a security or an explanation into a signal. */
const SECURITY_WORDS = /\b(shares?|stocks?|equity|equities)\b/i;
const SIGNAL_WORDS = /discount|premium|cheap|upside|%/i;

function quoteView(price: number | null, ageSec: number, source: "jupiter" | "none" = "jupiter"): PreviewHoldingView["quote"] {
  return {
    assetId: SPACEX,
    symbol: "SPACEX",
    price,
    source,
    publishedAt: new Date(NOW_MS - ageSec * 1000).toISOString(),
    ageSeconds: ageSec,
    stale: false,
    marketOpen: true,
  };
}

function preHolding(over: Partial<PreviewHoldingView> = {}): PreviewHoldingView {
  return {
    assetId: SPACEX,
    symbol: "SPACEX",
    source: "prestocks",
    qty: 16,
    multiplier: 5,
    usd: 3200,
    quote: quoteView(200, 40),
    issuerMark: { price: 250, publishedAt: new Date(NOW_MS - 120_000).toISOString(), ageSeconds: 120 },
    ...over,
  };
}

function xHolding(over: Partial<PreviewHoldingView> = {}): PreviewHoldingView {
  return {
    assetId: TSLA,
    symbol: "TSLAx",
    source: "xstocks",
    qty: 3,
    multiplier: 1,
    usd: 600,
    quote: { ...quoteView(200, 12), assetId: TSLA, symbol: "TSLAx" },
    issuerMark: null,
    ...over,
  };
}

function preview(holdings: PreviewHoldingView[], plays: PreviewPlayView[] = []): PreviewResponse {
  return {
    now: NOW.toISOString(),
    address: "preview",
    chainId: SOL,
    readAt: new Date(NOW_MS - 30_000).toISOString(),
    label: null,
    totalUsd: holdings.reduce((s, h) => s + h.usd, 0),
    holdings,
    plays,
    qualifying: 0,
    qualifyingPoints: 0,
  };
}

function previewPlay(over: Partial<PreviewPlayView> = {}): PreviewPlayView {
  return {
    key: "pre_ipo_position",
    title: "Pre-IPO Position",
    desc: "A pre-IPO token worth $5 or more in your wallet.",
    points: 50,
    badgeKey: null,
    rule: { type: "hold_any", minUsd: 5 },
    assetSource: "prestocks",
    status: "not_yet",
    note: "No qualifying pre-IPO token in this wallet right now",
    proof: { reason: "no_in_scope_holding" },
    progress: null,
    ...over,
  };
}

function playView(over: Partial<PlayView> = {}): PlayView {
  return {
    key: "first_position",
    title: "First Position",
    desc: "Any xStock worth $5 or more.",
    points: 100,
    badgeKey: null,
    rule: { type: "hold_any", minUsd: 5 },
    status: "locked",
    completedAt: null,
    proof: null,
    completions: 0,
    comingSoon: false,
    ...over,
  };
}

describe("compliance copy", () => {
  it("keeps COMPLIANCE_LINE byte-identical and adds the pre-IPO lines beside it", () => {
    expect(COMPLIANCE_LINE).toBe("Not investment advice. xStocks are not available to U.S. persons or in restricted jurisdictions.");
    expect(PRE_IPO_COMPLIANCE_LINE).toBe(
      "Not investment advice. Pre-IPO tokens give economic exposure only, with no ownership or voting rights, carry a 1% fee on every transfer, and are not available in the U.S. or to U.S. persons. The companies named do not issue or endorse them.",
    );
    expect(PRE_IPO_TOKEN_2022_NOTE).toMatch(/Token-2022/);
    expect(PRE_IPO_TOKEN_2022_NOTE).toMatch(/freeze/);
    expect(PRE_IPO_TOKEN_2022_NOTE).toMatch(/permanent-delegate/);
    for (const line of [PRE_IPO_COMPLIANCE_LINE, PRE_IPO_TOKEN_2022_NOTE]) expect(line).not.toMatch(SECURITY_WORDS);
  });
});

describe("issuer helpers (client-safe copy of the registry nouns)", () => {
  it("agrees with lib/assets/registry on every registered source's noun", () => {
    expect(ASSET_SOURCES.map((s) => s.source.name)).toEqual(["xstocks", "prestocks"]);
    for (const s of ASSET_SOURCES) expect(assetNounFor(s.source.name)).toEqual(s.noun);
    expect(assetNounFor(null)).toEqual({ singular: "xStock", plural: "xStocks" });
    expect(assetNounFor("tessera")).toEqual({ singular: "xStock", plural: "xStocks" });
  });

  it("labels the pill and the unit word per issuer, never 'shares' for a pre-IPO token", () => {
    expect(issuerLabel("xstocks")).toBe("xStocks");
    expect(issuerLabel("prestocks")).toBe("PreStocks");
    expect(issuerLabel("other")).toBeNull();
    expect(unitWordFor("xstocks", 3)).toBe("shares");
    expect(unitWordFor("prestocks", 3)).toBe("tokens");
    expect(unitWordFor("prestocks", 1)).toBe("token");
  });

  it("reads a quest's issuer from assetSource first, then from a key that names the pre-IPO issuer", () => {
    expect(questAssetSource({ key: "first_position" })).toBeNull();
    expect(questAssetSource({ key: "first_position", assetSource: "xstocks" })).toBe("xstocks");
    expect(questAssetSource({ key: "pre_ipo_position" })).toBe("prestocks");
    expect(questAssetSource({ key: "prestocks_holder" })).toBe("prestocks");
    expect(questAssetSource({ key: "pre_ipo_position", assetSource: "xstocks" })).toBe("xstocks");
    expect(isPreIpoQuest({ key: "pre_ipo_position" })).toBe(true);
    expect(isPreIpoQuest({ key: "diversified" })).toBe(false);
  });
});

describe("quest sentences with the pre-IPO noun", () => {
  it("swaps the noun on every on-chain hint and leaves xStocks hints unchanged", () => {
    expect(ruleToHint({ type: "hold_any", minUsd: 5 }, "prestocks")).toBe("Any pre-IPO token worth $5+ in your wallet");
    expect(ruleToHint({ type: "hold_any", minUsd: 5, assetIds: [SPACEX] }, "prestocks")).toBe("A selected pre-IPO token worth $5+ in your wallet");
    expect(ruleToHint({ type: "diversified", minAssets: 3, minSectors: 2 }, "prestocks")).toBe("3+ pre-IPO tokens across 2+ sectors in your wallet");
    expect(ruleToHint({ type: "hold_consecutive", days: 7 }, "prestocks")).toBe("The same pre-IPO token held for 7 daily snapshots in a row");
    expect(ruleToHint({ type: "net_increase_days", count: 3, window: 14 }, "prestocks")).toBe("Pre-IPO tokens balance up on 3 separate days in any 14-day window");
    // The Season 0 default, with and without the fence spelled out.
    expect(ruleToHint({ type: "hold_any", minUsd: 5 })).toBe("Any xStock worth $5+ in your wallet");
    expect(ruleToHint({ type: "hold_any", minUsd: 5 }, "xstocks")).toBe("Any xStock worth $5+ in your wallet");
    expect(ruleToHint({ type: "net_increase_days", count: 3, window: 14 }, "xstocks")).toBe("xStocks balance up on 3 separate days in any 14-day window");
    // The competition is xStocks-only whatever the fence says.
    expect(ruleToHint({ type: "internal_event", event: "league_trade", count: 3, distinctBy: "symbol" }, "prestocks")).toBe("Make paper trades in 3 different xStocks");
  });

  it("never calls a pre-IPO token a share, a stock or equity, and never tells anyone to buy", () => {
    const rules = [
      { type: "hold_any", minUsd: 5 },
      { type: "diversified", minAssets: 3, minSectors: 2 },
      { type: "hold_consecutive", days: 7 },
      { type: "net_increase_days", count: 3, window: 14 },
      { type: "hold_through_date", calendarKey: "earnings" },
    ] as const;
    for (const rule of rules) {
      const hint = ruleToHint(rule, "prestocks");
      expect(hint, hint).not.toMatch(SECURITY_WORDS);
      expect(hint, hint).not.toMatch(/\b(buy|purchase|top up|add to)\b/i);
    }
  });

  it("labels a pre-IPO proof and its progress with the pre-IPO noun, and leaves the default alone", () => {
    const proof = { symbol: "SPACEX", assetCount: 1, minAssets: 3, assets: [{ symbol: "SPACEX", usd: 3200 }], progress: { current: 1, target: 3, unit: "assets" } };
    const pre = Object.fromEntries(flattenProof(proof, { assetSource: "prestocks" }).map((r) => [r.key, r]));
    expect(pre.symbol.label).toBe("Pre-IPO token");
    expect(pre.assetCount.label).toBe("Pre-IPO tokens held");
    expect(pre.minAssets.label).toBe("Minimum pre-IPO tokens");
    expect(pre.assets.label).toBe("Pre-IPO tokens");
    expect(pre.progress.value).toBe("1 of 3 pre-IPO tokens");
    const def = Object.fromEntries(flattenProof(proof).map((r) => [r.key, r]));
    expect(def.symbol.label).toBe("Stock");
    expect(def.assets.label).toBe("Stocks");
    expect(def.progress.value).toBe("1 of 3 stocks");
    expect(cardProgress({ current: 1, target: 3, unit: "assets" }, "prestocks")).toEqual({ current: 1, target: 3, unit: "pre-IPO tokens" });
    expect(cardProgress({ current: 1, target: 3, unit: "assets" })).toEqual({ current: 1, target: 3, unit: "xStocks" });
  });
});

describe("the preview carries the source, the fence and the issuer mark", () => {
  const holding = (assetId: AssetId, symbol: string, source: string, qty: number, multiplier: number, price: number): Holding => ({
    assetId,
    symbol,
    source,
    raw: "0",
    multiplier,
    qty,
    price,
    priceSource: "jupiter",
    usd: qty * price,
  });
  const quote = (assetId: AssetId, symbol: string, price: number): PriceQuote => ({
    assetId,
    symbol,
    price,
    source: "jupiter",
    publishedAt: new Date(NOW_MS - 40_000),
    ageSeconds: 40,
    stale: false,
    marketOpen: true,
  });
  const marks = new Map<string, PreStocksMark>([["SPACEX", { symbol: "SPACEX", markPrice: 250, tokenPrice: 200, fetchedAt: new Date(NOW_MS - 120_000) }]]);
  const read = {
    address: "preview",
    chainId: SOL,
    readAt: NOW,
    holdings: [holding(TSLA, "TSLAx", "xstocks", 3, 1, 200), holding(SPACEX, "SPACEX", "prestocks", 16, 5, 200)],
    quotes: new Map<AssetId, PriceQuote>([
      [TSLA, quote(TSLA, "TSLAx", 200)],
      [SPACEX, quote(SPACEX, "SPACEX", 200)],
    ]),
  };
  const plays = [
    { key: "first_position", title: "First Position", desc: "", points: 100, badgeKey: null, rule: { type: "hold_any", minUsd: 5 }, assetSource: "xstocks" },
    { key: "pre_ipo_position", title: "Pre-IPO Position", desc: "", points: 50, badgeKey: null, rule: { type: "hold_any", minUsd: 5 }, assetSource: "prestocks" },
  ];

  it("tags every holding with its source and gives only the pre-IPO one an issuer mark", () => {
    const out = buildPreview({ read, plays, catalogue: catalogueIndexFrom([]), earnings: {}, now: NOW, marks });
    const bySymbol = Object.fromEntries(out.holdings.map((h) => [h.symbol, h]));
    expect(bySymbol.TSLAx).toMatchObject({ source: "xstocks", issuerMark: null });
    expect(bySymbol.SPACEX).toMatchObject({ source: "prestocks", issuerMark: { price: 250, publishedAt: new Date(NOW_MS - 120_000).toISOString(), ageSeconds: 120 } });
    expect(out.plays.map((p) => [p.key, p.assetSource, p.status])).toEqual([
      ["first_position", "xstocks", "qualifies"],
      ["pre_ipo_position", "prestocks", "qualifies"],
    ]);
  });

  it("gives no mark without a payload, without the symbol, or with a mark that is not a positive number", () => {
    const none = buildPreview({ read, plays, catalogue: catalogueIndexFrom([]), earnings: {}, now: NOW });
    expect(none.holdings.every((h) => h.issuerMark === null)).toBe(true);
    const h = { source: "prestocks", symbol: "SPACEX" };
    expect(issuerMarkView(h, undefined, NOW)).toBeNull();
    expect(issuerMarkView(h, new Map(), NOW)).toBeNull();
    expect(issuerMarkView(h, new Map([["SPACEX", { symbol: "SPACEX", markPrice: null, tokenPrice: 200, fetchedAt: NOW }]]), NOW)).toBeNull();
    expect(issuerMarkView(h, new Map([["SPACEX", { symbol: "SPACEX", markPrice: 0, tokenPrice: 200, fetchedAt: NOW }]]), NOW)).toBeNull();
    expect(issuerMarkView({ source: "xstocks", symbol: "SPACEX" }, marks, NOW)).toBeNull();
    expect(issuerMarkView(h, marks, NOW)).toMatchObject({ price: 250, ageSeconds: 120 });
  });

  it("reads the marks only for a wallet that holds a pre-IPO token, and only from a payload that already arrived", () => {
    const src = repoFile("src/app/api/v1/preview/preview.ts");
    expect(src).toContain("h.source === PRESTOCKS_SOURCE_NAME");
    expect(src).toContain("await waitForPreStocksRefresh()");
    expect(src).toMatch(/origin !== "api" && origin !== "fallback"\) return undefined/);
  });
});

describe("/check/[address] holdings", () => {
  it("prints the issuer mark as two numbers with their own sources and ages, then the explanation", () => {
    const line = issuerMarkLine(preHolding(), NOW_MS);
    expect(line).toBe(`DEX price $200.00 (Jupiter, 40s) vs issuer mark $250.00 (PreStocks, 2m). ${ISSUER_MARK_EXPLANATION}`);
    expect(ISSUER_MARK_EXPLANATION).toBe("The issuer mark is the issuer's own valuation of the underlying, not a tradeable quote.");
    expect(line).not.toMatch(SIGNAL_WORDS);
    expect(line).not.toMatch(SECURITY_WORDS);
    // The mark traded above the DEX price here; the sentence reads the same when it is below (NEURALINK, 22 Sep).
    const above = issuerMarkLine(preHolding({ quote: quoteView(500, 40) }), NOW_MS);
    expect(above).toBe(`DEX price $500.00 (Jupiter, 40s) vs issuer mark $250.00 (PreStocks, 2m). ${ISSUER_MARK_EXPLANATION}`);
  });

  it("omits the line entirely without a mark, without a DEX price, or for an xStock", () => {
    expect(issuerMarkLine(preHolding({ issuerMark: null }), NOW_MS)).toBeNull();
    expect(issuerMarkLine(preHolding({ quote: quoteView(null, 0, "none") }), NOW_MS)).toBeNull();
    expect(issuerMarkLine(xHolding({ issuerMark: { price: 250, publishedAt: null, ageSeconds: 120 } }), NOW_MS)).toBeNull();
    expect(formatShortAge(40)).toBe("40s");
    expect(formatShortAge(120)).toBe("2m");
    expect(formatShortAge(7200)).toBe("2h");
    expect(formatShortAge(null)).toBe("age unknown");
  });

  it("renders the arithmetic once for a pre-IPO token: balance × multiplier = quantity", () => {
    expect(multiplierArithmetic(16, 5)).toBe("3.2 × 5 = 16");
    expect(multiplierArithmetic(3, 1)).toBeNull();
    expect(multiplierArithmetic(3, 0)).toBeNull();
  });

  it("renders a pre-IPO row with the PreStocks pill, tokens (never shares), the arithmetic and the mark line", () => {
    const out = html(createElement(HoldingRow, { holding: preHolding(), now: NOW_MS }));
    expect(out).toContain('data-source="prestocks"');
    expect(out).toContain(">PreStocks<");
    expect(out).toContain("16 tokens");
    expect(out).not.toContain("shares");
    expect(out).toContain("×5 multiplier");
    expect(out).toContain('data-slot="multiplier-arithmetic"');
    expect(out).toContain("3.2 × 5 = 16");
    expect(out).toContain('data-slot="issuer-mark"');
    expect(out).toContain("vs issuer mark $250.00 (PreStocks, 2m)");
    expect(out).not.toMatch(SIGNAL_WORDS);
  });

  it("renders an xStock row as before: xStocks pill, shares, no mark line", () => {
    const out = html(createElement(HoldingRow, { holding: xHolding(), now: NOW_MS }));
    expect(out).toContain('data-source="xstocks"');
    expect(out).toContain(">xStocks<");
    expect(out).toContain("3 shares");
    expect(out).not.toContain('data-slot="issuer-mark"');
    expect(out).not.toContain('data-slot="multiplier-arithmetic"');
  });

  it("prints both compliance lines under the list only when a pre-IPO token is on screen", () => {
    const withPre = html(createElement(HoldingsList, { data: preview([xHolding(), preHolding()]), now: NOW_MS }));
    expect(withPre).toContain(COMPLIANCE_LINE);
    expect(withPre).toContain(PRE_IPO_COMPLIANCE_LINE);
    const without = html(createElement(HoldingsList, { data: preview([xHolding()]), now: NOW_MS }));
    expect(without).not.toContain(PRE_IPO_COMPLIANCE_LINE);
    expect(hasPreIpoHolding(preview([xHolding()]))).toBe(false);
    expect(hasPreIpoHolding(preview([preHolding()]))).toBe(true);
    expect(positionsHint(preview([xHolding(), xHolding()]))).toBe("2 stocks");
    expect(positionsHint(preview([xHolding(), preHolding()]))).toBe("2 positions");
    expect(positionsHint(preview([preHolding()]))).toBe("1 position");
  });

  it("renders the Pre-IPO Position card with the pre-IPO sentence and the issuer pill, and flags the page", () => {
    const out = html(createElement(PreviewPlayCard, { play: previewPlay(), onProof: () => undefined }));
    expect(out).toContain("Any pre-IPO token worth $5+ in your wallet");
    expect(out).toContain(">PreStocks<");
    expect(out).toContain("No qualifying pre-IPO token in this wallet right now.");
    const x = html(createElement(PreviewPlayCard, { play: previewPlay({ key: "first_position", assetSource: "xstocks" }), onProof: () => undefined }));
    expect(x).toContain("Any xStock worth $5+ in your wallet");
    expect(x).not.toContain(">PreStocks<");
    expect(hasPreIpoQuest(preview([], [previewPlay()]))).toBe(true);
    expect(hasPreIpoQuest(preview([], [previewPlay({ assetSource: "xstocks" })]))).toBe(false);
    const page = repoFile("src/app/check/[address]/page.tsx");
    expect(page).toContain("{PRE_IPO_COMPLIANCE_LINE}");
    expect(page).toContain("<HoldingsList data={data} />");
  });
});

describe("quests board and Partner page", () => {
  const prePlay = playView({ key: "pre_ipo_position", title: "Pre-IPO Position", desc: "A pre-IPO token worth $5 or more in your wallet.", points: 50 });
  type PartnerSeed = Omit<PartnerDetail["partner"], "chainIds">;
  const partner: PartnerSeed = { slug: "prestocks", name: "PreStocks", logoUrl: null, blurb: "Tokenized pre-IPO exposure on Solana.", links: { website: "https://prestocks.com" } };
  const xPartner: PartnerSeed = { slug: "xstocks", name: "xStocks", logoUrl: null, blurb: "Tokenized US stocks.", links: {} };

  it("renders the quest card with the pre-IPO sentence and pill from the key alone", () => {
    const out = html(createElement(PlayCard, { play: prePlay }));
    expect(out).toContain("Any pre-IPO token worth $5+ in your wallet");
    expect(out).toContain('data-source="prestocks"');
    const x = html(createElement(PlayCard, { play: playView() }));
    expect(x).toContain("Any xStock worth $5+ in your wallet");
    expect(x).not.toContain('data-slot="issuer-pill"');
  });

  it("prints the pre-IPO line under the on-chain group only when a pre-IPO quest card is visible", () => {
    const groups = (plays: PlayView[]): PartnerGroup[] => [{ partner, campaigns: [{ id: "camp-prestocks-season-0", title: "PreStocks · Stocks Season", plays }] }];
    const withPre = html(createElement(PlayGrid, { groups: groups([playView(), prePlay]), signedIn: false }));
    expect(withPre).toContain(COMPLIANCE_LINE);
    expect(withPre).toContain(PRE_IPO_COMPLIANCE_LINE);
    const without = html(createElement(PlayGrid, { groups: groups([playView()]), signedIn: false }));
    expect(without).toContain(COMPLIANCE_LINE);
    expect(without).not.toContain(PRE_IPO_COMPLIANCE_LINE);
  });

  it("gives the PreStocks Partner page both compliance lines and the Token-2022 note under its outbound links", () => {
    const detail = (p: PartnerSeed, plays: PlayView[]): PartnerDetail => ({
      partner: { ...p, chainIds: [SOL] },
      campaigns: [{ id: `camp-${p.slug}-season-0`, title: `${p.name} · Stocks Season`, seasonId: "season-0", startsAt: NOW.toISOString(), endsAt: NOW.toISOString(), plays }],
      totals: { plays: plays.length, completions: 0 },
      corporateActions: [],
    });
    const pre = html(createElement(PartnerBody, { detail: detail(partner, [prePlay]) }));
    expect(pre).toContain(COMPLIANCE_LINE);
    expect(pre).toContain(PRE_IPO_COMPLIANCE_LINE);
    expect(pre).toContain(PRE_IPO_TOKEN_2022_NOTE);
    expect(pre.indexOf('data-slot="partner-notice"')).toBeGreaterThan(pre.indexOf("https://prestocks.com"));
    const x = html(createElement(PartnerBody, { detail: detail(xPartner, [playView()]) }));
    expect(x).toContain(COMPLIANCE_LINE);
    expect(x).not.toContain(PRE_IPO_COMPLIANCE_LINE);
    expect(x).not.toContain(PRE_IPO_TOKEN_2022_NOTE);
    expect(isPreIpoPartner("prestocks", [])).toBe(true);
    expect(isPreIpoPartner("xstocks", [prePlay])).toBe(true);
    expect(isPreIpoPartner("xstocks", [playView()])).toBe(false);
  });
});

describe("frozen surfaces", () => {
  it("keeps PreStocks off the landing first screen, the nav, the tabs and the game tiles", () => {
    for (const rel of ["src/app/page.tsx", "src/components/layout/nav.ts", "src/components/landing/ScoreboardPreview.tsx"]) {
      expect(repoFile(rel), rel).not.toMatch(/prestocks|pre-ipo/i);
    }
    expect(POSITIONING).toBe("The entertainment layer for xStocks. Compete, predict and get rewarded, for points.");
  });

  it("names no forbidden address or person anywhere in the new copy", () => {
    for (const rel of ["src/components/common/compliance.ts", "src/components/common/issuer.ts", "src/app/check/_components/check-format.ts", "src/app/check/_components/HoldingsList.tsx"]) {
      const src = repoFile(rel);
      expect(src, rel).not.toMatch(/dulo\.fun|dum\.fun/i);
      expect(src, rel).not.toMatch(/SpaceX stock|pre-IPO (shares?|stocks?|equity)/i);
    }
  });
});
