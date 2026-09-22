import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The /prestocks feature page (22 Sep 2026): the board of eight pre-IPO tokens, the competition's
 * trade form fenced to pre-IPO tokens, the four pre-IPO quests and the corporate actions, plus
 * the desktop nav entry and the one landing hook. Every render is static, with the API hooks
 * mocked; no network, no DB.
 *
 * Pinned: a pre-IPO token is never a share, a stock or equity; the issuer mark and the DEX price
 * are two labelled numbers with no gap between them; both compliance lines print wherever a
 * pre-IPO token is on screen; the Token-2022 note prints once above the outbound links; the
 * mobile tab bar keeps five tabs; the landing's first screen changes by one link only.
 */

const mocks = vi.hoisted(() => ({
  queries: new Map<string, { data: unknown; error: string | null; loading: boolean }>(),
  session: { session: null as null | { userId: string }, loading: false, refresh: async () => undefined },
}));

vi.mock("@/components/common/useApiQuery", () => ({
  useApiQuery: (_fetcher: unknown, key: unknown) => {
    const k = Array.isArray(key) ? key.join("|") : String(key ?? "");
    const which = k.includes("prestocks:league") ? "league" : k.includes("prestocks:partner") ? "partner" : k.includes("prestocks:plays") ? "plays" : "symbols";
    const entry = mocks.queries.get(which) ?? { data: null, error: null, loading: true };
    return { ...entry, errorStatus: null, refreshing: false, refetch: () => undefined };
  },
}));
vi.mock("@/hooks/useSession", () => ({ useSession: () => mocks.session, useOptionalSession: () => mocks.session }));
vi.mock("@/components/wallet/ConnectButton", () => ({ ConnectButton: () => createElement("button", { type: "button" }, "Connect wallet") }));
vi.mock("@/components/common/PartnerLogo", () => ({
  PartnerLogo: ({ name, logoUrl }: { name: string; logoUrl: string | null }) => createElement("span", { "data-logo": logoUrl ?? "" }, name),
}));
vi.mock("@/lib/server/db", () => ({ db: {} }));

import type { CorporateActionView, LeagueResponse, LeagueSymbolView, LeagueSymbolsResponse, PartnerDetail, PlaysResponse, PlayView } from "@/lib/api-client";
import { COMPLIANCE_LINE, PRE_IPO_COMPLIANCE_LINE, PRE_IPO_TOKEN_2022_NOTE } from "@/components/common/compliance";
import { MOBILE_TABS, NAV_ITEMS } from "@/components/layout/nav";
import { PRESTOCKS_STATIC } from "@/lib/assets/prestocks";
import { activePlays } from "@/lib/plays/catalogue";
import { TradeForm, groupSymbols } from "@/components/league/TradeForm";
import { isPreIpoSymbol, symbolSource } from "@/components/league/symbol-source";
import { LIST, PreIpoBoard, PreIpoRow, ROW, ROW_GRID } from "@/components/prestocks/PreIpoBoard";
import { PRE_IPO_PAGE_DESCRIPTION, PRE_IPO_PAGE_TITLE, PreStocksView, preIpoQuests } from "@/components/prestocks/PreStocksView";
import {
  PRE_IPO_QUEST_KEYS,
  PRE_IPO_TOKENS,
  PRE_IPO_TRADE_NOTE,
  formatChange24h,
  jupiterOpenUrl,
  mintOfAssetId,
  preIpoBoardRows,
  preIpoLogoUrl,
  preIpoPnlUsd,
  preIpoPositions,
  preIpoSymbolSet,
} from "@/components/prestocks/tokens";

const ROOT = path.resolve(__dirname, "..");
const repoFile = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SPACEX_MINT = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const NOW = "2026-09-22T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

/** Words that would turn a pre-IPO token into a security, or two prices into a signal. */
const SECURITY_WORDS = /\b(shares?|stocks?|equity|equities)\b/i;
const SIGNAL_WORDS = /discount|premium|cheap|upside|\bgap\b/i;
/** Betting words and retired product nouns. */
const BANNED = /\b(stakes?|odds|payouts?|bets?|betting|league|mirror|calls?|plays?)\b/i;

function quote(symbol: string, assetId: string, price: number | null, ageSec = 30): LeagueSymbolView["quote"] {
  return { assetId, symbol, price, source: price === null ? "none" : "jupiter", publishedAt: price === null ? null : new Date(NOW_MS - ageSec * 1000).toISOString(), ageSeconds: ageSec, stale: false, marketOpen: true };
}

function xstock(symbol: string, mint: string, price: number, held = 0): LeagueSymbolView {
  const assetId = `${SOL}/token:${mint}`;
  return { symbol, assetId, quote: quote(symbol, assetId, price), held, source: "xstocks" };
}

function preIpo(symbol: string, price: number | null, over: Partial<LeagueSymbolView> = {}): LeagueSymbolView {
  const mint = PRE_IPO_TOKENS.find((t) => t.symbol === symbol)?.mint ?? `Pre${symbol.padEnd(40, "1")}`;
  const assetId = `${SOL}/token:${mint}`;
  return {
    symbol,
    assetId,
    quote: quote(symbol, assetId, price),
    held: 0,
    source: "prestocks",
    issuerMark: price === null ? null : { price: Math.round(price * 1.25 * 100) / 100, publishedAt: new Date(NOW_MS - 120_000).toISOString() },
    change24h: price === null ? null : 3.2,
    ...over,
  };
}

const EIGHT: LeagueSymbolView[] = PRE_IPO_TOKENS.map((t, i) => preIpo(t.symbol, 100 + i * 10));
const TSLAX = xstock("TSLAx", "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", 360.83);
const NVDAX = xstock("NVDAx", "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", 170.1, 2);

const SPACEX_SPLIT: CorporateActionView = {
  assetId: `${SOL}/token:${SPACEX_MINT}`,
  symbol: "SPACEX",
  source: "prestocks",
  kind: "split",
  multiplierBefore: 1,
  multiplierAfter: 5,
  ratio: 5,
  effectiveAt: "2026-06-10T04:30:00.000Z",
  effective: true,
};

function symbolsResponse(symbols: LeagueSymbolView[], cashUsd: number | null = null): LeagueSymbolsResponse {
  return { symbols, open: true, cashUsd, spread: 0.001 };
}

const WEEK = { id: "l1", seasonId: "s0", weekStart: "2026-09-21T00:00:00.000Z", weekEnd: "2026-09-25T20:00:00.000Z", status: "open" as const, open: true, closesIn: 3 * 86_400_000, opensIn: null };

function leagueResponse(over: Partial<LeagueResponse> = {}): LeagueResponse {
  return { now: NOW, signedIn: false, league: WEEK, me: null, leaderboard: [], quotes: [], lastSettled: null, startingCashUsd: 10_000, spread: 0.001, ...over };
}

function play(key: string, over: Partial<PlayView> = {}): PlayView {
  const row = activePlays().find((p) => p.key === key)!;
  return { key, title: row.title, desc: row.desc, points: row.points, badgeKey: row.badgeKey ?? null, rule: row.rule, status: "locked", completedAt: null, proof: null, completions: 0, comingSoon: false, assetSource: row.assetSource ?? null, ...over };
}

function playsResponse(keys: string[] = [...PRE_IPO_QUEST_KEYS, "scout", "first_position"], signedIn = false): PlaysResponse {
  return {
    season: null,
    signedIn,
    groups: [
      {
        partner: { slug: "dulo", name: "Dulo games", logoUrl: null, blurb: "", links: {} },
        campaigns: [{ id: "c1", title: "Stocks Season", plays: keys.filter((k) => activePlays().some((p) => p.key === k)).map((k) => play(k)) }],
      },
    ],
  };
}

function partnerDetail(actions: CorporateActionView[] = [SPACEX_SPLIT]): PartnerDetail {
  return { partner: { slug: "prestocks", name: "PreStocks", logoUrl: null, blurb: "", links: {}, chainIds: [SOL] }, campaigns: [], totals: { plays: 2, completions: 0 }, corporateActions: actions };
}

function loaded(over: Partial<Record<"symbols" | "league" | "partner" | "plays", { data: unknown; error: string | null; loading: boolean }>> = {}) {
  mocks.queries.clear();
  mocks.queries.set("symbols", over.symbols ?? { data: symbolsResponse([TSLAX, NVDAX, ...EIGHT]), error: null, loading: false });
  mocks.queries.set("league", over.league ?? { data: leagueResponse(), error: null, loading: false });
  mocks.queries.set("partner", over.partner ?? { data: partnerDetail(), error: null, loading: false });
  mocks.queries.set("plays", over.plays ?? { data: playsResponse(), error: null, loading: false });
}

beforeEach(() => {
  mocks.session.session = null;
  loaded();
});

describe("pre-IPO token facts (client-safe copy of the issuer catalogue)", () => {
  it("names the same eight tokens, mints and symbols as lib/assets/prestocks", () => {
    expect(PRE_IPO_TOKENS.map(({ symbol, name, mint }) => ({ symbol, name, mint }))).toEqual(PRESTOCKS_STATIC.map(({ symbol, name, mint }) => ({ symbol, name, mint })));
    expect(PRE_IPO_TOKENS).toHaveLength(8);
    for (const t of PRE_IPO_TOKENS) expect(preIpoLogoUrl(t.symbol)).toBe(`https://www.prestocks.com/logos/${t.symbol.toLowerCase()}.png`);
  });

  it("lists the four pre-IPO quests, all live in the catalogue, in-platform first", () => {
    expect(PRE_IPO_QUEST_KEYS).toEqual(["first_preipo_trade", "preipo_trio", "pre_ipo_position", "held_through_split"]);
    for (const key of PRE_IPO_QUEST_KEYS) {
      const row = activePlays().find((p) => p.key === key);
      expect(row, key).toBeDefined();
      expect(row!.assetSource).toBe("prestocks");
    }
  });

  it("builds the Jupiter link from the mint and reads a mint out of a CAIP-19 id", () => {
    expect(mintOfAssetId(`${SOL}/token:${SPACEX_MINT}`)).toBe(SPACEX_MINT);
    expect(mintOfAssetId("eip155:1/erc20:0xabc")).toBeNull();
    expect(mintOfAssetId("")).toBeNull();
    expect(jupiterOpenUrl(SPACEX_MINT)).toBe(`https://jup.ag/swap?sell=USDC&buy=${SPACEX_MINT}`);
    expect(jupiterOpenUrl(null)).toBeNull();
  });

  it("formats the 24h move signed and never invents one", () => {
    expect(formatChange24h(3.24)).toBe("+3.2%");
    expect(formatChange24h(-0.06)).toBe("−0.1%");
    expect(formatChange24h(0)).toBe("0.0%");
    expect(formatChange24h(null)).toBeNull();
    expect(formatChange24h(undefined)).toBeNull();
    expect(formatChange24h(Number.NaN)).toBeNull();
  });

  it("joins the endpoint's pre-IPO entries with their facts and corporate actions, and drops xStocks", () => {
    const rows = preIpoBoardRows([TSLAX, ...EIGHT], [SPACEX_SPLIT]);
    expect(rows.map((r) => r.symbol)).toEqual(PRE_IPO_TOKENS.map((t) => t.symbol));
    const spacex = rows.find((r) => r.symbol === "SPACEX")!;
    expect(spacex.name).toBe("SpaceX PreStocks");
    expect(spacex.mint).toBe(SPACEX_MINT);
    expect(spacex.action).toEqual(SPACEX_SPLIT);
    expect(rows.filter((r) => r.action !== null)).toHaveLength(1);
    // A token the live API added after this build: named by its symbol, mint read from the id.
    const extra = preIpo("NEWCO", 12, { assetId: `${SOL}/token:Pre11111111111111111111111111111111111111111`, symbol: "NEWCO" });
    const [row] = preIpoBoardRows([extra], null);
    expect(row.name).toBe("NEWCO");
    expect(row.mint).toBe("Pre11111111111111111111111111111111111111111");
    expect(row.jupiterUrl).toContain("buy=Pre1111");
  });

  it("reads the issuer tag with xStocks as the default and fences positions by it", () => {
    expect(symbolSource({})).toBe("xstocks");
    expect(symbolSource({ source: "prestocks" })).toBe("prestocks");
    expect(isPreIpoSymbol(TSLAX)).toBe(false);
    expect(isPreIpoSymbol(EIGHT[0])).toBe(true);
    const set = preIpoSymbolSet([TSLAX, preIpo("NEWCO", 1, { symbol: "newco" })]);
    expect(set.has("SPACEX")).toBe(true);
    expect(set.has("NEWCO")).toBe(true);
    expect(set.has("TSLAX")).toBe(false);
    const positions = [
      { assetId: "a", symbol: "TSLAx", qty: 1, avgPrice: 1, last: 2, quote: TSLAX.quote, valueUsd: 2, costUsd: 1, pnlUsd: 1, pnlPct: 100 },
      { assetId: "b", symbol: "SPACEX", qty: 1, avgPrice: 1, last: 0.5, quote: EIGHT[7].quote, valueUsd: 0.5, costUsd: 1, pnlUsd: -0.5, pnlPct: -50 },
      { assetId: "c", symbol: "OPENAI", qty: 1, avgPrice: 1, last: null, quote: EIGHT[5].quote, valueUsd: 1, costUsd: 1, pnlUsd: null, pnlPct: null },
    ];
    const mine = preIpoPositions(positions, set);
    expect(mine.map((p) => p.symbol)).toEqual(["SPACEX", "OPENAI"]);
    expect(preIpoPnlUsd(mine)).toBe(-0.5);
    expect(preIpoPnlUsd([mine[1]])).toBeNull();
    expect(preIpoPnlUsd([])).toBeNull();
  });
});

describe("the board", () => {
  it("shows every pre-IPO token as a row: logo, name, symbol, DEX price with source and age, issuer mark with its age, 24h move, Jupiter link", () => {
    const h = html(createElement(PreIpoBoard, { symbols: [TSLAX, NVDAX, ...EIGHT], actions: [SPACEX_SPLIT] }));
    expect(h.match(/data-slot="pre-ipo-row"/g)).toHaveLength(8);
    expect(h).not.toContain("TSLAx");
    expect(h).toContain("SpaceX PreStocks");
    expect(h).toContain('data-logo="https://www.prestocks.com/logos/spacex.png"');
    // DEX price: the PriceChip with Jupiter and an age. Issuer mark: its own chip, its own age.
    expect(h).toContain("DEX price");
    expect(h).toContain("Jupiter");
    expect(h).toContain("Issuer mark");
    expect(h.match(/data-slot="issuer-mark"/g)).toHaveLength(8);
    expect(h).toContain("PreStocks");
    expect(h).toContain("24h move");
    expect(h).toContain("+3.2%");
    // The one corporate action on record shows as a small badge on its own card only.
    expect(h.match(/data-slot="corporate-action-badge"/g)).toHaveLength(1);
    // Every card leads out to Jupiter with its mint prefilled, in a new tab; the Token-2022 note prints once above them.
    expect(h.match(/Open in Jupiter/g)).toHaveLength(8);
    expect(h).toContain(`https://jup.ag/swap?sell=USDC&buy=${SPACEX_MINT}`);
    expect(h.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(8);
    expect(h.split(PRE_IPO_TOKEN_2022_NOTE)).toHaveLength(2);
    expect(h.indexOf(PRE_IPO_TOKEN_2022_NOTE)).toBeLessThan(h.indexOf("Open in Jupiter"));
  });

  it("lays the rows out on one grid: glass rows with a column header from md, a card each under md, no horizontal scroll", () => {
    const h = html(createElement(PreIpoBoard, { symbols: EIGHT, actions: [] }));
    // One header row (from md) and eight rows share ROW_GRID, so the columns line up down the board.
    expect(h).toContain('data-slot="pre-ipo-board-header"');
    expect(h.match(new RegExp(`class="${ROW_GRID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"))).toHaveLength(8);
    expect(ROW_GRID).toContain("grid-cols-2");
    expect(ROW_GRID).toMatch(/md:grid-cols-\[minmax\(0,[\d.]+fr\)_minmax\(0,[\d.]+fr\)_minmax\(0,[\d.]+fr\)_auto\]/);
    // Under md every row is its own glass card; from md the list is one glass panel of hairline rows.
    for (const cls of ["max-md:rounded-2xl", "max-md:border", "max-md:bg-card", "md:border-t", "md:border-white/[0.05]"]) expect(ROW).toContain(cls);
    for (const cls of ["md:rounded-2xl", "md:border", "md:bg-card", "md:overflow-hidden"]) expect(LIST).toContain(cls);
    expect(LIST).not.toContain("overflow-x");
    expect(h).not.toMatch(/overflow-x-auto|min-w-\[/);
    // Every cell shrinks (min-w-0), so a 390px phone never scrolls sideways; the cell labels read on the card and hide from md.
    expect(h.match(/md:sr-only/g)).toHaveLength(8 * 3);
    // Every Jupiter link is outline: the page's one ember action is the trade form's submit.
    expect(h.match(/Open in Jupiter/g)).toHaveLength(8);
    expect(h).not.toContain("bg-[linear-gradient(180deg,#ff8a4c");
  });

  it("prints the two prices as two labelled numbers and never a gap, a percentage between them or a security word", () => {
    const [row] = preIpoBoardRows([preIpo("SPACEX", 200)], [SPACEX_SPLIT]);
    const h = html(createElement(PreIpoRow, { row }));
    const t = text(h);
    expect(t).toContain("$200.00");
    expect(t).toContain("$250.00");
    expect(t).not.toMatch(SECURITY_WORDS);
    expect(t).not.toMatch(SIGNAL_WORDS);
    expect(t).not.toMatch(BANNED);
    // The only percentage on a card is Jupiter's 24h move on the DEX price.
    expect(t.match(/%/g)).toHaveLength(1);
    expect(t).toMatch(/\+3\.2% Jupiter/);
    // The issuer mark chip carries no percentage at all (the 24h move sits under the DEX price, before it).
    const mark = h.slice(h.indexOf('data-slot="issuer-mark"'), h.indexOf("Open in Jupiter"));
    expect(mark).not.toContain("%");
    expect(h.indexOf("24h move")).toBeLessThan(h.indexOf('data-slot="issuer-mark"'));
    // The badge names the adjustment, never a price.
    expect(h).toContain("5-for-1 adjustment");
    expect(h).not.toMatch(/\$[\d.]+[^<]*adjustment/);
  });

  it("degrades honestly: no price, no mark, no 24h move, no action", () => {
    const [row] = preIpoBoardRows([preIpo("KALSHI", null)], []);
    const h = html(createElement(PreIpoRow, { row }));
    const t = text(h);
    expect(t).toContain("No price");
    expect(t).toContain("No issuer mark");
    expect(t).toContain("24h move —");
    expect(h).not.toContain('data-slot="corporate-action-badge"');
    expect(h).toContain("Open in Jupiter");
  });

  it("shows an empty state when the endpoint lists no pre-IPO token", () => {
    const h = html(createElement(PreIpoBoard, { symbols: [TSLAX], actions: [] }));
    expect(h).toContain("No pre-IPO tokens listed right now.");
    expect(h).not.toContain("Open in Jupiter");
  });
});

describe("the trade form lists both issuers on /competition and pre-IPO tokens only on /prestocks", () => {
  it("groups the select by issuer: xStocks first, then Pre-IPO tokens", () => {
    const groups = groupSymbols([EIGHT[0], TSLAX, NVDAX, EIGHT[1]]);
    expect(groups.map((g) => g.label)).toEqual(["xStocks", "Pre-IPO tokens"]);
    expect(groups[0].symbols.map((s) => s.symbol)).toEqual(["TSLAx", "NVDAx"]);
    expect(groups[1].symbols.map((s) => s.symbol)).toEqual(["ANDURIL", "ANTHROPIC"]);
    expect(groupSymbols([TSLAX])).toHaveLength(1);
    expect(groupSymbols([])).toEqual([]);
  });

  it("renders two optgroups on the competition form, no pre-IPO line while an xStock is selected", () => {
    const h = html(createElement(TradeForm, { league: WEEK, signedIn: true, serverNow: NOW }));
    expect(h).toContain('<optgroup label="xStocks">');
    expect(h).toContain('<optgroup label="Pre-IPO tokens">');
    expect(h).toContain(">Symbol</label>");
    expect(h).toContain('<option value="TSLAx"');
    expect(h).toContain('<option value="SPACEX"');
    // TSLAx is first, so it is selected: the pre-IPO line stays off.
    expect(h).toContain("Paper buy TSLAx");
    expect(h).not.toContain(PRE_IPO_COMPLIANCE_LINE);
  });

  it("fenced to prestocks it lists the eight only, labels the select Pre-IPO token and prints the pre-IPO line unless the page carries it", () => {
    const h = html(createElement(TradeForm, { league: WEEK, signedIn: true, serverNow: NOW, sources: ["prestocks"], symbolLabel: "Pre-IPO token" }));
    expect(h).not.toContain("<optgroup");
    expect(h).not.toContain("TSLAx");
    expect(h.match(/<option value="/g)).toHaveLength(8);
    expect(h).toContain(">Pre-IPO token</label>");
    expect(h).toContain("Paper buy ANDURIL");
    expect(h).toContain(PRE_IPO_COMPLIANCE_LINE);
    expect(text(h)).not.toMatch(SECURITY_WORDS);
    // /prestocks prints the line once in its header, so its form turns the notice off.
    const quiet = html(createElement(TradeForm, { league: WEEK, signedIn: true, serverNow: NOW, sources: ["prestocks"], symbolLabel: "Pre-IPO token", preIpoNotice: false }));
    expect(quiet).toContain("Paper buy ANDURIL");
    expect(quiet).not.toContain(PRE_IPO_COMPLIANCE_LINE);
  });

  it("with an older payload that carries no source tag, every symbol is an xStock", () => {
    mocks.queries.set("symbols", { data: symbolsResponse([{ ...TSLAX, source: undefined }]), error: null, loading: false });
    const h = html(createElement(TradeForm, { league: WEEK, signedIn: true, serverNow: NOW }));
    expect(h).not.toContain("<optgroup");
    expect(h).toContain(">xStock</label>");
    const fenced = html(createElement(TradeForm, { league: WEEK, signedIn: true, serverNow: NOW, sources: ["prestocks"] }));
    expect(fenced).toContain("No symbols available");
  });
});

describe("/prestocks page", () => {
  it("has the header, the session chip, and both compliance lines visible at the foot, once per page", () => {
    const h = html(createElement(PreStocksView));
    expect(PRE_IPO_PAGE_TITLE).toBe("Pre-IPO tokens, 24/7");
    expect(PRE_IPO_PAGE_DESCRIPTION).toBe("Trade them with virtual cash in this week's competition, complete pre-IPO quests, and see what the mint says.");
    expect(h).toContain(">PreStocks</p>");
    expect(h).toContain(PRE_IPO_PAGE_TITLE);
    expect(h).toContain(PRE_IPO_PAGE_DESCRIPTION);
    // Visible without opening the details: the pair sits at the foot of the page (data-slot="board-compliance").
    const foot = h.slice(h.lastIndexOf("data-slot=\"board-compliance\""));
    expect(foot).toContain(COMPLIANCE_LINE);
    expect(foot).toContain(PRE_IPO_COMPLIANCE_LINE);
    // Once: not under the quests, not under the fenced trade form (preIpoNotice off), not in the details, not anywhere else.
    expect(h.split(PRE_IPO_COMPLIANCE_LINE)).toHaveLength(2);
    expect(h.split(COMPLIANCE_LINE)).toHaveLength(2);
    expect(h).toContain("US market");
  });

  it("keeps one ember action on the page (the trade form's submit) and every other control outline or ghost", () => {
    mocks.session.session = { userId: "u1" };
    loaded({ league: { data: leagueResponse({ signedIn: true }), error: null, loading: false }, plays: { data: playsResponse(undefined, true), error: null, loading: false } });
    const h = html(createElement(PreStocksView));
    const ember = h.match(/bg-\[linear-gradient\(180deg,#ff8a4c/g) ?? [];
    expect(ember).toHaveLength(1);
    const button = h.slice(h.lastIndexOf("<button", h.indexOf("bg-[linear-gradient(180deg,#ff8a4c")), h.indexOf("</button>", h.indexOf("bg-[linear-gradient(180deg,#ff8a4c")));
    expect(button).toContain('type="submit"');
    expect(button).toContain("Paper buy");
    // Signed out, the banner's Connect is outline (the form's own Connect is the action); the source says so.
    const view = repoFile("src/components/prestocks/PreStocksView.tsx");
    expect(view).toMatch(/<SignInBanner[\s\S]{0,300}connectVariant="outline"/);
    expect(view).toContain("preIpoNotice={false}");
    expect(repoFile("src/components/common/SignInBanner.tsx")).toContain("variant={connectVariant}");
    const connect = repoFile("src/components/wallet/ConnectButton.tsx");
    expect(connect.match(/variant=\{variant\}/g)).toHaveLength(2);
  });

  it("puts the trade section before the board under lg (CSS order) while the DOM keeps board, trade, quests, actions", () => {
    const h = html(createElement(PreStocksView));
    const trade = h.match(/<section aria-labelledby="pre-ipo-trade" data-slot="pre-ipo-trade" class="([^"]+)"/);
    expect(trade).not.toBeNull();
    expect(trade![1].split(" ")).toEqual(expect.arrayContaining(["order-first", "lg:order-none"]));
    const board = h.match(/<section aria-labelledby="pre-ipo-board" class="([^"]+)"/);
    expect(board).not.toBeNull();
    expect(board![1]).not.toContain("order-");
    // Inside the trade section the form card leads on a phone and sits in the right column from lg.
    const form = h.match(/<section class="([^"]+)" aria-labelledby="pre-ipo-trade-form"/);
    expect(form).not.toBeNull();
    expect(form![1].split(" ")).toEqual(expect.arrayContaining(["order-first", "lg:order-none", "lg:col-start-2", "border-gradient", "bg-card"]));
    // Section eyebrows in gold.
    for (const eyebrow of ["The board", "Weekly competition (virtual cash)", "Quests"]) {
      expect(h).toContain(`<p class="text-xs font-medium tracking-[0.14em] text-gold uppercase">${eyebrow}</p>`);
    }
  });

  it("renders the four sections in order: board, trade, quests, corporate actions", () => {
    const h = html(createElement(PreStocksView));
    const board = h.indexOf('aria-labelledby="pre-ipo-board"');
    const trade = h.indexOf('aria-labelledby="pre-ipo-trade"');
    const quests = h.indexOf('aria-labelledby="pre-ipo-quests"');
    const actions = h.indexOf('data-slot="corporate-actions"');
    expect(board).toBeGreaterThan(-1);
    expect(trade).toBeGreaterThan(board);
    expect(quests).toBeGreaterThan(trade);
    expect(actions).toBeGreaterThan(quests);
    // Board: eight cards. Quests: the four pre-IPO cards and no other.
    expect(h.match(/data-slot="pre-ipo-row"/g)).toHaveLength(8);
    const questsHtml = h.slice(quests, actions);
    expect(questsHtml.match(/data-play-key="/g)).toHaveLength(4);
    for (const key of PRE_IPO_QUEST_KEYS) expect(questsHtml).toContain(`data-play-key="${key}"`);
    expect(questsHtml).not.toContain('data-play-key="scout"');
    expect(questsHtml).not.toContain('data-play-key="first_position"');
    // The compliance pair lives at the foot of the page, once per page: nothing under the quests.
    expect(questsHtml).not.toContain(COMPLIANCE_LINE);
    expect(questsHtml).not.toContain(PRE_IPO_COMPLIANCE_LINE);
    // Corporate actions: the shared section from the Partner page.
    expect(h).toContain("Corporate actions");
    expect(h).toContain("5-for-1 adjustment");
    // The trade note beside the form.
    expect(h).toContain(PRE_IPO_TRADE_NOTE);
    expect(PRE_IPO_TRADE_NOTE).toBe("Counts on this week's leaderboard alongside your xStock trades. Virtual cash, points only.");
  });

  it("signed out: the sign-in banner and a connect button, no positions table", () => {
    const h = html(createElement(PreStocksView));
    expect(h).toContain("Sign in to trade with $10,000 of virtual cash.");
    expect(h).toContain("Sign in to see your positions.");
    expect(h).not.toContain("Your competition account");
    expect(h).toContain("Connect wallet");
  });

  it("signed in: the caller's pre-IPO positions and P&L for the week, xStock positions left out", () => {
    mocks.session.session = { userId: "u1" };
    const me: LeagueResponse["me"] = {
      id: "a1",
      cashUsd: 9_000,
      equityUsd: 10_050,
      rank: 3,
      delta: 1,
      pnlUsd: 50,
      pnlPct: 0.5,
      positions: [
        { assetId: TSLAX.assetId, symbol: "TSLAx", qty: 1, avgPrice: 350, last: 360.83, quote: TSLAX.quote, valueUsd: 360.83, costUsd: 350, pnlUsd: 10.83, pnlPct: 3.09 },
        { assetId: EIGHT[7].assetId, symbol: "SPACEX", qty: 2, avgPrice: 160, last: 170, quote: EIGHT[7].quote, valueUsd: 340, costUsd: 320, pnlUsd: 20, pnlPct: 6.25 },
      ],
      trades: [],
      isBot: false,
    };
    loaded({ league: { data: leagueResponse({ signedIn: true, me }), error: null, loading: false }, plays: { data: playsResponse(undefined, true), error: null, loading: false } });
    const h = html(createElement(PreStocksView));
    const trade = h.slice(h.indexOf('aria-labelledby="pre-ipo-trade"'), h.indexOf('aria-labelledby="pre-ipo-quests"'));
    expect(trade).toContain("SPACEX");
    expect(trade).not.toContain("TSLAx");
    expect(trade).toContain("+$20.00 this week");
    // The stat strip: cash shared with xStock trades, one pre-IPO position, its P&L, the rank.
    expect(h).toContain("Pre-IPO positions");
    expect(h).toContain("Pre-IPO P&L");
    expect(h).toContain("+$20.00");
    expect(h).toContain("#3");
    expect(h).not.toContain("Sign in to see your positions.");
  });

  it("shows loading skeletons, then error states with a retry, section by section", () => {
    mocks.queries.clear();
    const loading = html(createElement(PreStocksView));
    expect(loading).toContain('aria-label="Loading pre-IPO tokens"');
    expect(loading).not.toContain("Open in Jupiter");
    expect(loading).not.toContain("Couldn't load");

    loaded({
      symbols: { data: null, error: "Board unavailable", loading: false },
      league: { data: null, error: "Competition unavailable", loading: false },
      plays: { data: null, error: "Quests unavailable", loading: false },
      partner: { data: null, error: "Mints unavailable", loading: false },
    });
    const failed = html(createElement(PreStocksView));
    for (const title of ["Couldn't load the board", "Couldn't load the competition", "Couldn't load the quests", "Couldn't read the mints"]) expect(failed).toContain(title);
    expect(failed.match(/Try again/g)).toHaveLength(4);
  });

  it("shows empty states: no Season, no pre-IPO quests seeded, no corporate actions", () => {
    loaded({
      league: { data: leagueResponse({ league: null }), error: null, loading: false },
      plays: { data: playsResponse(["scout"]), error: null, loading: false },
      partner: { data: partnerDetail([]), error: null, loading: false },
    });
    const h = html(createElement(PreStocksView));
    expect(h).toContain("Season 0 is being set up.");
    expect(h).toContain("Pre-IPO quests are being seeded.");
    expect(h).not.toContain('data-slot="corporate-actions"');
    expect(preIpoQuests(null)).toEqual([]);
  });

  it("never calls a pre-IPO token a share or a stock, never frames the mark against the DEX price, never uses a betting word", () => {
    mocks.session.session = { userId: "u1" };
    loaded({ league: { data: leagueResponse({ signedIn: true }), error: null, loading: false } });
    const t = text(html(createElement(PreStocksView)));
    // "xStock(s)" is the Season 0 product noun and never matches \bstock; every other hit would be a pre-IPO token called a security.
    expect(t.replace(/xStocks?/g, "")).not.toMatch(SECURITY_WORDS);
    expect(t).not.toMatch(SIGNAL_WORDS);
    expect(t).not.toMatch(BANNED);
    expect(t).not.toMatch(/dulo\.fun|dum\.fun/i);
    // A quest never instructs a purchase of a real asset: the only "buy" verbs are the paper ones (the form's Buy / Sell side toggle included).
    for (const m of t.matchAll(/\b(buy|buys|buying)\b/gi)) {
      const around = t.slice(Math.max(0, m.index! - 30), m.index! + 40);
      expect(around, around).toMatch(/paper|virtual|Buy Sell/i);
    }
  });
});

describe("nav and landing", () => {
  it("adds Pre-IPO to the desktop nav between Quests and Copy a portfolio and leaves the five mobile tabs alone", () => {
    expect(NAV_ITEMS.map((n) => n.href)).toEqual(["/predictions", "/competition", "/quests", "/prestocks", "/copy", "/leaderboard"]);
    expect(NAV_ITEMS.find((n) => n.href === "/prestocks")?.label).toBe("Pre-IPO");
    expect(MOBILE_TABS.map((t) => t.href)).toEqual(["/predictions", "/competition", "/quests", "/leaderboard", "/profile"]);
  });

  it("the route exists with plain-word metadata and the client view", () => {
    const layout = repoFile("src/app/prestocks/layout.tsx");
    expect(layout).toContain('title: "Pre-IPO tokens"');
    expect(layout).toMatch(/description:\s*"[^"]*pre-IPO tokens[^"]*"/);
    expect(layout.replace(/xStocks?/g, "")).not.toMatch(SECURITY_WORDS);
    expect(repoFile("src/app/prestocks/page.tsx")).toContain("<PreStocksView />");
  });

  it("the landing gains one hook beside the session chip and nothing else on the first screen", () => {
    const landing = repoFile("src/app/page.tsx");
    const hero = landing.slice(landing.indexOf('aria-labelledby="hero-title"'), landing.indexOf("<GameTiles"));
    expect(hero.match(/href="\/prestocks"/g)).toHaveLength(1);
    expect(hero).toContain("Pre-IPO tokens trade 24/7");
    // Same text size as the trust line.
    const hook = hero.slice(hero.indexOf('href="/prestocks"'), hero.indexOf("Pre-IPO tokens trade 24/7"));
    expect(hook).toContain("text-xs text-muted-foreground");
    // Headline, verbs, welcome line and the three tiles are byte-identical.
    expect(landing).toContain("The entertainment layer for{");
    expect(landing).toContain("Predict. Compete. Complete on-chain quests.");
    expect(landing).toContain("{WELCOME_OFFER_LINE}");
    expect(landing).toContain("<GameTiles");
    expect(landing.match(/href="\/prestocks"/g)).toHaveLength(1);
    // The competition copy names both price sets, on the landing and the /competition metadata.
    // The hero paragraph is two sentences now (22 Sep); the Competition tile still names both price sets.
    const flat = landing.replace(/\s+/g, " ");
    expect(flat.match(/real xStock and pre-IPO prices/g)).toHaveLength(1);
    expect(flat).not.toContain("real xStock prices");
    expect(repoFile("src/app/competition/layout.tsx")).toContain("real xStock and pre-IPO prices");
  });
});
