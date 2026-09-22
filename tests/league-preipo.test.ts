import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetId, AssetInfo, PriceQuote } from "@/lib/core";

/**
 * 22 Sep (founder decision): pre-IPO tokens are tradable in the virtual-cash competition. The same
 * $10,000 weekly account, the same lib/price quote (Jupiter only: no Pyth feed exists), the same
 * weekly leaderboard. House bots keep trading xStocks only. The symbols endpoint lists the eight
 * pre-IPO symbols beside the xStocks, each tagged with its source, and carries the issuer mark and
 * the Jupiter 24h change for a pre-IPO entry when they are available.
 */

const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const TSLAX_ID = `${SOL}/token:XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` as AssetId;
const SPACEX_MINT = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const SPACEX_ID = `${SOL}/token:${SPACEX_MINT}` as AssetId;
const OPENAI_MINT = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const OPENAI_ID = `${SOL}/token:${OPENAI_MINT}` as AssetId;

const MON = new Date("2026-09-21T12:00:00.000Z");
const WEEK_START = new Date("2026-09-21T00:00:00.000Z");
const WEEK_END = new Date("2026-09-25T20:00:00.000Z");
const AFTER_CLOSE = new Date("2026-09-25T20:05:00.000Z");
const OPEN_LEAGUE = { id: "L1", seasonId: "season-0", weekStart: WEEK_START, weekEnd: WEEK_END, status: "open" };

/** DEX prices observed on Jupiter Price v3, 22 Sep 2026 (tests/fixtures/prestocks-jupiter-2026-09-22.json), to the cent. */
const SPACEX_PRICE = 117.83;

function quote(assetId: AssetId, symbol: string, price: number | null, source: PriceQuote["source"] = "jupiter"): PriceQuote {
  return { assetId, symbol, price, source, publishedAt: new Date("2026-09-21T11:59:00.000Z"), ageSeconds: 60, stale: false, marketOpen: false };
}

const mocks = vi.hoisted(() => ({
  db: {
    season: { findFirst: vi.fn() },
    play: { findMany: vi.fn() },
    league: { upsert: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn() },
    leagueAccount: { upsert: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), create: vi.fn(), count: vi.fn() },
    leagueTrade: { create: vi.fn(), createMany: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    pointsEvent: { createMany: vi.fn() },
    user: { upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    wallet: { upsert: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  getPriceBySymbol: vi.fn(),
  getPrices: vi.fn(),
  getPricesBySymbols: vi.fn(),
  evaluateUser: vi.fn(),
  getPreStocksMarks: vi.fn(),
  listPreStocks: vi.fn(),
  fetchJupiterPrices: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({ db: mocks.db }));
vi.mock("@/lib/cron/evaluate", () => ({ evaluateUser: mocks.evaluateUser }));
vi.mock("@/lib/server/queries", () => ({ pickDisplayWallet: <T,>(wallets: T[]): T | null => wallets[0] ?? null }));
vi.mock("@/lib/price", () => ({
  getPriceBySymbol: mocks.getPriceBySymbol,
  getPrices: mocks.getPrices,
  getPricesBySymbols: mocks.getPricesBySymbols,
  UnknownAssetError: class UnknownAssetError extends Error {
    constructor(public readonly ref: string) {
      super(`Unknown asset: ${ref}`);
      this.name = "UnknownAssetError";
    }
  },
}));
vi.mock("@/lib/assets/prestocks", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/assets/prestocks")>();
  return { ...mod, getPreStocksMarks: mocks.getPreStocksMarks, prestocks: { ...mod.prestocks, listAssets: mocks.listPreStocks } };
});
vi.mock("@/lib/prices/jupiter", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/prices/jupiter")>();
  return { ...mod, fetchJupiterPrices: mocks.fetchJupiterPrices };
});

import { UnknownAssetError } from "@/lib/price";
import { ApiError } from "@/lib/server/api";
import { PRESTOCKS_STATIC } from "@/lib/assets/prestocks";
import { SOLANA_MAINNET, solanaTokenAssetId } from "@/lib/core";
import { SEASON0_ASSET_SOURCE } from "@/lib/plays/catalogue";
import {
  BOT_ASSET_SOURCE,
  BOT_HANDLES,
  LEAGUE_ASSET_SOURCES,
  RANK_POINTS,
  SPREAD,
  STARTING_CASH_USD,
  TRADABLE_SYMBOLS,
  botQuotes,
  fillPrice,
  placeTrade,
  planBotTrades,
  recomputeEquity,
  resetLeagueMemory,
  rollover,
  seedBots,
} from "@/lib/games/league";
import { getLeagueSymbols, resetLeagueSymbolsCache } from "@/lib/games/league-views";
import type { LeagueSymbolView } from "@/lib/api-client";

const ACCOUNT = { id: "acct_1", leagueId: "L1", userId: "u_me", cashUsd: "10000", positions: {}, equityUsd: "10000", rank: null, isBot: false };
const PRE_IPO_SYMBOLS = PRESTOCKS_STATIC.map((e) => e.symbol);

/** AssetInfo rows for the static PreStocks catalogue (what prestocks.listAssets serves offline). */
function preIpoAssets(): AssetInfo[] {
  return PRESTOCKS_STATIC.map((e) => ({
    assetId: solanaTokenAssetId(e.mint, SOLANA_MAINNET),
    chainId: SOLANA_MAINNET,
    symbol: e.symbol,
    underlying: e.symbol,
    name: e.name,
    decimals: 9,
    sector: null,
    logoUrl: null,
    pythFeedId: null,
    multiplier: 1,
  }));
}

/** lib/price stand-in: xStocks by "<TICKER>x", pre-IPO by the static list, every quote from Jupiter. */
function quoteFor(symbol: string): PriceQuote | null {
  const up = symbol.trim().toUpperCase();
  const pre = PRESTOCKS_STATIC.find((e) => e.symbol === up);
  if (pre) return quote(solanaTokenAssetId(pre.mint, SOLANA_MAINNET), pre.symbol, pre.symbol === "SPACEX" ? SPACEX_PRICE : 50);
  if (up === "TSLAX") return quote(TSLAX_ID, "TSLAx", 100);
  if (up.endsWith("X")) return quote(`${SOL}/token:X${up}` as AssetId, `${up.slice(0, -1)}x`, 100);
  return null;
}

function setDefaults() {
  mocks.db.season.findFirst.mockResolvedValue({ id: "season-0" });
  mocks.db.league.upsert.mockResolvedValue(OPEN_LEAGUE);
  mocks.db.league.findMany.mockResolvedValue([]);
  mocks.db.league.findFirst.mockResolvedValue(null);
  mocks.db.league.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.league.findUniqueOrThrow.mockResolvedValue(OPEN_LEAGUE);
  mocks.db.leagueAccount.upsert.mockResolvedValue(ACCOUNT);
  mocks.db.leagueAccount.findUniqueOrThrow.mockResolvedValue(ACCOUNT);
  mocks.db.leagueAccount.findMany.mockResolvedValue([]);
  mocks.db.leagueAccount.findUnique.mockResolvedValue(null);
  mocks.db.leagueAccount.count.mockResolvedValue(BOT_HANDLES.length);
  mocks.db.leagueAccount.create.mockResolvedValue({ id: "bot_acct" });
  mocks.db.leagueAccount.update.mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({ ...ACCOUNT, ...args.data, id: args.where.id }));
  mocks.db.leagueTrade.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "trade_1", ...args.data }));
  mocks.db.leagueTrade.createMany.mockResolvedValue({ count: 0 });
  mocks.db.leagueTrade.findMany.mockResolvedValue([]);
  mocks.db.pointsEvent.createMany.mockResolvedValue({ count: 1 });
  mocks.db.user.upsert.mockResolvedValue({});
  mocks.db.user.findMany.mockResolvedValue([]);
  mocks.db.wallet.upsert.mockResolvedValue({});
  mocks.db.wallet.findMany.mockResolvedValue([]);
  mocks.db.$queryRaw.mockResolvedValue([]);
  mocks.db.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? arg(mocks.db) : Promise.all(arg as Promise<unknown>[])));
  mocks.getPriceBySymbol.mockImplementation(async (symbol: string, options?: { source?: string; sources?: readonly string[] }) => {
    const q = quoteFor(symbol);
    if (!q) throw new UnknownAssetError(symbol);
    const source = PRE_IPO_SYMBOLS.includes(q.symbol) ? "prestocks" : "xstocks";
    const fence = new Set([...(options?.sources ?? []), ...(options?.source ? [options.source] : [])]);
    if (fence.size > 0 && !fence.has(source)) throw new UnknownAssetError(symbol);
    return q;
  });
  mocks.getPrices.mockResolvedValue(new Map());
  mocks.getPricesBySymbols.mockImplementation(async (symbols: readonly string[], options?: { source?: string }) => {
    const quotes: PriceQuote[] = [];
    const unknown: string[] = [];
    for (const s of symbols) {
      const q = quoteFor(s);
      const source = q && PRE_IPO_SYMBOLS.includes(q.symbol) ? "prestocks" : "xstocks";
      if (q && (!options?.source || options.source === source)) quotes.push(q);
      else unknown.push(s);
    }
    return { quotes, unknown };
  });
  mocks.evaluateUser.mockResolvedValue({ plays: [] });
  mocks.listPreStocks.mockResolvedValue(preIpoAssets());
  mocks.getPreStocksMarks.mockResolvedValue(new Map());
  mocks.fetchJupiterPrices.mockResolvedValue(new Map());
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  resetLeagueMemory();
  resetLeagueSymbolsCache();
  setDefaults();
});

async function expectApiError(p: Promise<unknown>, status: number, message?: RegExp | string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(status);
  if (message !== undefined) expect((err as ApiError).message).toMatch(message);
}

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

describe("competition allowlist", () => {
  it("is xStocks and PreStocks, frozen, and the bots' source is xStocks alone", () => {
    expect(LEAGUE_ASSET_SOURCES).toEqual(["xstocks", "prestocks"]);
    expect(Object.isFrozen(LEAGUE_ASSET_SOURCES)).toBe(true);
    expect(LEAGUE_ASSET_SOURCES[0]).toBe(SEASON0_ASSET_SOURCE);
    expect(BOT_ASSET_SOURCE).toBe("xstocks");
  });

  it("a SPACEX paper trade fills at the Jupiter quote plus spread and lands in positions", async () => {
    const r = await placeTrade({ userId: "u_me", symbol: "spacex", side: "buy", qty: 2 }, MON);
    expect(mocks.getPriceBySymbol).toHaveBeenCalledWith("spacex", { sources: LEAGUE_ASSET_SOURCES });
    expect(r.quote).toMatchObject({ assetId: SPACEX_ID, symbol: "SPACEX", price: SPACEX_PRICE, source: "jupiter" });
    expect(r.fill).toBe(fillPrice(SPACEX_PRICE, "buy"));
    expect(r.fill).toBeCloseTo(SPACEX_PRICE * (1 + SPREAD), 6);
    expect(r.trade).toMatchObject({ symbol: "SPACEX", side: "buy", priceSource: "jupiter", qty: "2.00000000", price: r.fill.toFixed(6) });
    const written = mocks.db.leagueAccount.update.mock.calls[0][0].data as { cashUsd: string; positions: Record<string, unknown> };
    expect(written.positions).toEqual({ [SPACEX_ID]: { symbol: "SPACEX", qty: 2, avgPrice: r.fill } });
    expect(Number(written.cashUsd)).toBeCloseTo(STARTING_CASH_USD - 2 * r.fill, 4);
    expect(r.account.positions).toEqual(written.positions);
  });

  it("an xStock still fills through the same allowlist, and a sell of a pre-IPO position works like any other", async () => {
    await placeTrade({ userId: "u_me", symbol: "TSLAx", side: "buy", qty: 1 }, MON);
    expect(mocks.getPriceBySymbol).toHaveBeenLastCalledWith("TSLAx", { sources: LEAGUE_ASSET_SOURCES });
    expect(mocks.db.leagueTrade.create.mock.calls[0][0].data).toMatchObject({ symbol: "TSLAx" });

    const held = { ...ACCOUNT, cashUsd: "9000", positions: { [SPACEX_ID]: { symbol: "SPACEX", qty: 5, avgPrice: 110 } } };
    mocks.db.leagueAccount.findUniqueOrThrow.mockResolvedValue(held);
    const r = await placeTrade({ userId: "u_me", symbol: "SPACEX", side: "sell", qty: 2 }, MON);
    expect(r.fill).toBe(fillPrice(SPACEX_PRICE, "sell"));
    const written = mocks.db.leagueAccount.update.mock.calls[1][0].data as { positions: Record<string, unknown> };
    expect(written.positions).toEqual({ [SPACEX_ID]: { symbol: "SPACEX", qty: 3, avgPrice: 110 } });
  });

  it("a symbol no registered source knows is still refused with 400 and nothing is written", async () => {
    // (quoteFor treats any "<TICKER>x" as an xStock, so the unknowns here end in something else.)
    for (const symbol of ["T-OPENAI", "BTC", "NOPE"]) {
      await expectApiError(placeTrade({ userId: "u_me", symbol, side: "buy", qty: 1 }, MON), 400, new RegExp(`Unknown xStock or pre-IPO token: ${symbol}`));
    }
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    expect(mocks.db.leagueTrade.create).not.toHaveBeenCalled();
    // The fence itself: a source outside the allowlist answers unknown too (mirrors lib/price).
    mocks.getPriceBySymbol.mockImplementation(async (symbol: string, options?: { sources?: readonly string[] }) => {
      if (!options?.sources?.includes("tessera")) throw new UnknownAssetError(symbol);
      return quote(`${SOL}/token:oPAi` as AssetId, "T-OPENAI", 1);
    });
    await expectApiError(placeTrade({ userId: "u_me", symbol: "T-OPENAI", side: "buy", qty: 1 }, MON), 400, /Unknown xStock or pre-IPO token/);
  });
});

// ---------------------------------------------------------------------------
// Bots stay xStocks-only
// ---------------------------------------------------------------------------

describe("house bots trade xStocks only", () => {
  it("TRADABLE_SYMBOLS holds no pre-IPO symbol and every entry is an xStock", () => {
    for (const s of TRADABLE_SYMBOLS) {
      expect(PRE_IPO_SYMBOLS, s).not.toContain(s.toUpperCase());
      expect(s, s).toMatch(/^[A-Z.]+x$/);
    }
  });

  it("botQuotes fences its lookup to xStocks and keeps only the tradable list, even when a pre-IPO quote comes back", async () => {
    mocks.getPricesBySymbols.mockImplementation(async (symbols: readonly string[]) => ({
      quotes: [...symbols.map((s) => quoteFor(s)).filter((q): q is PriceQuote => q !== null), quote(SPACEX_ID, "SPACEX", SPACEX_PRICE)],
      unknown: [],
    }));
    const quotes = await botQuotes();
    expect(mocks.getPricesBySymbols).toHaveBeenCalledWith(TRADABLE_SYMBOLS, { source: BOT_ASSET_SOURCE });
    expect(quotes.map((q) => q.symbol).sort()).toEqual([...TRADABLE_SYMBOLS].sort());
    expect(quotes.some((q) => PRE_IPO_SYMBOLS.includes(q.symbol.toUpperCase()))).toBe(false);
  });

  it("no bot ever plans or seeds a pre-IPO trade", async () => {
    const quotes = await botQuotes();
    for (const handle of BOT_HANDLES) {
      const plan = planBotTrades(handle, quotes, WEEK_START, MON);
      expect(plan.trades.length).toBeGreaterThan(0);
      for (const t of plan.trades) {
        expect(TRADABLE_SYMBOLS, `${handle} ${t.symbol}`).toContain(t.symbol);
        expect(PRE_IPO_SYMBOLS, `${handle} ${t.symbol}`).not.toContain(t.symbol.toUpperCase());
      }
      for (const p of Object.values(plan.positions)) expect(PRE_IPO_SYMBOLS).not.toContain(p.symbol.toUpperCase());
    }

    const seeded = await seedBots(mocks.db as never, "L1", MON);
    expect(seeded).toHaveLength(BOT_HANDLES.length);
    const written = mocks.db.leagueTrade.createMany.mock.calls.flatMap((c) => (c[0] as { data: Array<{ symbol: string }> }).data);
    expect(written.length).toBeGreaterThan(0);
    for (const t of written) expect(PRE_IPO_SYMBOLS, t.symbol).not.toContain(t.symbol.toUpperCase());
  });
});

// ---------------------------------------------------------------------------
// Weekly ranking includes pre-IPO P&L
// ---------------------------------------------------------------------------

describe("weekly ranking", () => {
  const A = { id: "a", userId: "u_a", cashUsd: "0", positions: { [SPACEX_ID]: { symbol: "SPACEX", qty: 100, avgPrice: 100 } }, rank: null };
  const B = { id: "b", userId: "u_b", cashUsd: "10000", positions: {}, rank: null };
  const C = { id: "c", userId: "u_c", cashUsd: "5000", positions: { [TSLAX_ID]: { symbol: "TSLAx", qty: 50, avgPrice: 100 } }, rank: null };

  it("recomputeEquity prices a pre-IPO position from lib/price and ranks it with the xStocks", async () => {
    mocks.db.leagueAccount.findMany.mockResolvedValue([A, B, C]);
    mocks.getPrices.mockResolvedValue(new Map([[SPACEX_ID, quote(SPACEX_ID, "SPACEX", 120)], [TSLAX_ID, quote(TSLAX_ID, "TSLAx", 90)]]));
    const r = await recomputeEquity("L1", mocks.db as never, MON);
    expect(mocks.getPrices).toHaveBeenCalledWith(expect.arrayContaining([SPACEX_ID, TSLAX_ID]));
    expect(r.unpriced).toEqual([]);
    expect(r.rows.map((row) => [row.userId, row.equityUsd, row.rank])).toEqual([
      ["u_a", 12_000, 1],
      ["u_b", 10_000, 2],
      ["u_c", 9_500, 3],
    ]);
  });

  it("a pre-IPO position with no quote is valued at cost and reported, never dropped", async () => {
    mocks.db.leagueAccount.findMany.mockResolvedValue([A, B]);
    mocks.getPrices.mockResolvedValue(new Map([[SPACEX_ID, quote(SPACEX_ID, "SPACEX", null, "none")]]));
    const r = await recomputeEquity("L1", mocks.db as never, MON);
    expect(r.unpriced).toEqual(["SPACEX"]);
    expect(r.rows.map((row) => [row.userId, row.equityUsd, row.rank])).toEqual([
      ["u_a", 10_000, 1],
      ["u_b", 10_000, 2],
    ]);
  });

  it("the Friday rollover pays the pre-IPO leader like any other real account with three trades", async () => {
    mocks.db.league.findMany.mockResolvedValue([OPEN_LEAGUE]);
    mocks.db.leagueAccount.findMany
      .mockResolvedValueOnce([A, B])
      .mockResolvedValueOnce([
        { userId: "u_a", rank: 1, isBot: false, _count: { trades: 3 } },
        { userId: "u_b", rank: 2, isBot: false, _count: { trades: 3 } },
      ]);
    mocks.getPrices.mockResolvedValue(new Map([[SPACEX_ID, quote(SPACEX_ID, "SPACEX", 120)]]));
    mocks.db.league.upsert.mockResolvedValue({ ...OPEN_LEAGUE, id: "L2" });
    const r = await rollover(AFTER_CLOSE, mocks.db as never);
    expect(r.settled).toHaveLength(1);
    expect(r.settled[0].awarded).toBe(2);
    const awards = mocks.db.pointsEvent.createMany.mock.calls[0][0].data as Array<{ userId: string; delta: number; ref: string }>;
    expect(awards).toEqual([
      { userId: "u_a", seasonId: "season-0", source: "league", ref: "league:L1:rank:1", delta: RANK_POINTS[0] },
      { userId: "u_b", seasonId: "season-0", source: "league", ref: "league:L1:rank:2", delta: RANK_POINTS[1] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/league/symbols
// ---------------------------------------------------------------------------

describe("getLeagueSymbols", () => {
  const bySymbol = (list: LeagueSymbolView[]) => new Map(list.map((s) => [s.symbol, s]));

  it("lists every tradable xStock and the eight pre-IPO symbols, each tagged with its source", async () => {
    const r = await getLeagueSymbols(null, MON);
    const symbols = r.symbols.map((s) => s.symbol);
    for (const s of TRADABLE_SYMBOLS) expect(symbols).toContain(s);
    for (const s of PRE_IPO_SYMBOLS) expect(symbols).toContain(s);
    expect(new Set(symbols).size).toBe(symbols.length);
    // xStocks first, in the tradable order; the pre-IPO group after them.
    expect(symbols.slice(0, TRADABLE_SYMBOLS.length)).toEqual([...TRADABLE_SYMBOLS]);
    const m = bySymbol(r.symbols);
    expect(m.get("TSLAx")).toMatchObject({ source: "xstocks", assetId: TSLAX_ID, held: 0 });
    expect(m.get("TSLAx")).not.toHaveProperty("issuerMark");
    expect(m.get("TSLAx")).not.toHaveProperty("change24h");
    expect(m.get("SPACEX")).toMatchObject({ source: "prestocks", assetId: SPACEX_ID, held: 0, issuerMark: null, change24h: null });
    expect(m.get("SPACEX")!.quote).toMatchObject({ price: SPACEX_PRICE, source: "jupiter" });
    // No fence on the quote lookup: a held symbol of either source is quoted.
    const [asked, options] = mocks.getPricesBySymbols.mock.calls[0];
    expect(asked).toEqual(expect.arrayContaining([...TRADABLE_SYMBOLS, ...PRE_IPO_SYMBOLS]));
    expect(options).toBeUndefined();
    expect(r).toMatchObject({ open: true, cashUsd: null, spread: SPREAD });
  });

  it("carries the issuer mark and the Jupiter 24h change on a pre-IPO entry when they are available", async () => {
    const fetchedAt = new Date("2026-09-21T11:50:00.000Z");
    mocks.getPreStocksMarks.mockResolvedValue(
      new Map([
        ["SPACEX", { symbol: "SPACEX", markPrice: 125, tokenPrice: 117.83, fetchedAt }],
        ["OPENAI", { symbol: "OPENAI", markPrice: null, tokenPrice: 40, fetchedAt }],
      ]),
    );
    mocks.fetchJupiterPrices.mockResolvedValue(
      new Map([
        [SPACEX_MINT, { usdPrice: 117.83, priceChange24h: -2.5059152775257623 }],
        [OPENAI_MINT, { usdPrice: 40, priceChange24h: Number.NaN }],
      ]),
    );
    const m = bySymbol((await getLeagueSymbols(null, MON)).symbols);
    expect(m.get("SPACEX")).toMatchObject({ source: "prestocks", issuerMark: { price: 125, publishedAt: fetchedAt.toISOString() }, change24h: -2.5059152775257623 });
    // A mark the issuer did not give, or a change Jupiter did not give, is null: never invented.
    expect(m.get("OPENAI")).toMatchObject({ source: "prestocks", issuerMark: null, change24h: null });
    expect(m.get("KALSHI")).toMatchObject({ source: "prestocks", issuerMark: null, change24h: null });
    expect(m.get("TSLAx")).not.toHaveProperty("issuerMark");
    expect(mocks.fetchJupiterPrices).toHaveBeenCalledTimes(1);
    expect(mocks.fetchJupiterPrices.mock.calls[0][0]).toEqual(expect.arrayContaining([SPACEX_MINT, OPENAI_MINT]));
    expect((mocks.fetchJupiterPrices.mock.calls[0][0] as string[]).length).toBe(PRE_IPO_SYMBOLS.length);
  });

  it("caches the mark and change reads for a minute, and never throws when either upstream fails", async () => {
    mocks.getPreStocksMarks.mockRejectedValue(new Error("prestocks down"));
    mocks.fetchJupiterPrices.mockRejectedValue(new Error("jupiter 429"));
    const first = await getLeagueSymbols(null, MON);
    expect(bySymbol(first.symbols).get("SPACEX")).toMatchObject({ source: "prestocks", issuerMark: null, change24h: null });
    expect(first.symbols).toHaveLength(TRADABLE_SYMBOLS.length + PRE_IPO_SYMBOLS.length);

    resetLeagueSymbolsCache();
    mocks.getPreStocksMarks.mockResolvedValue(new Map([["SPACEX", { symbol: "SPACEX", markPrice: 125, tokenPrice: 117.83, fetchedAt: MON }]]));
    mocks.fetchJupiterPrices.mockResolvedValue(new Map([[SPACEX_MINT, { usdPrice: 117.83, priceChange24h: 1.5 }]]));
    await getLeagueSymbols(null, MON);
    await getLeagueSymbols(null, new Date(MON.getTime() + 30_000));
    expect(mocks.getPreStocksMarks).toHaveBeenCalledTimes(2); // once failed, once cached for the second read
    expect(mocks.fetchJupiterPrices).toHaveBeenCalledTimes(2);
    const later = await getLeagueSymbols(null, new Date(MON.getTime() + 61_000));
    expect(mocks.getPreStocksMarks).toHaveBeenCalledTimes(3);
    expect(bySymbol(later.symbols).get("SPACEX")).toMatchObject({ issuerMark: { price: 125 }, change24h: 1.5 });
  });

  it("a signed-in caller's held pre-IPO position shows its quantity, and a held symbol outside both lists is still quoted", async () => {
    mocks.db.leagueAccount.findUnique.mockResolvedValue({
      cashUsd: "8000",
      positions: { [SPACEX_ID]: { symbol: "SPACEX", qty: 3.5, avgPrice: 110 }, [OPENAI_ID]: { symbol: "OPENAI", qty: 1, avgPrice: 40 }, [`${SOL}/token:XPLTRX`]: { symbol: "PLTRx", qty: 2, avgPrice: 100 } },
    });
    const r = await getLeagueSymbols("u_me", MON);
    const m = bySymbol(r.symbols);
    expect(m.get("SPACEX")).toMatchObject({ held: 3.5, source: "prestocks" });
    expect(m.get("OPENAI")).toMatchObject({ held: 1, source: "prestocks" });
    expect(TRADABLE_SYMBOLS).not.toContain("PLTRx");
    expect(m.get("PLTRx")).toMatchObject({ held: 2, source: "xstocks" });
    expect(m.get("PLTRx")).not.toHaveProperty("issuerMark");
    expect(m.get("TSLAx")).toMatchObject({ held: 0 });
    expect(r.cashUsd).toBe(8000);
  });

  it("copies nothing that frames the issuer mark against the DEX price", async () => {
    mocks.getPreStocksMarks.mockResolvedValue(new Map([["SPACEX", { symbol: "SPACEX", markPrice: 125, tokenPrice: 117.83, fetchedAt: MON }]]));
    const text = JSON.stringify(await getLeagueSymbols(null, MON));
    expect(text).not.toMatch(/discount|premium|cheap|upside|gap/i);
  });
});
