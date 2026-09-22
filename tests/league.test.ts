import { beforeEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import type { AssetId, PriceQuote } from "@/lib/core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const TSLAX_ID = `${SOL}/token:XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` as AssetId;
const AAPLX_ID = `${SOL}/token:XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` as AssetId;

const MON = new Date("2026-09-14T12:00:00.000Z"); // Monday
const WEEK_START = new Date("2026-09-14T00:00:00.000Z");
const WEEK_END = new Date("2026-09-18T20:00:00.000Z");
const NEXT_WEEK_START = new Date("2026-09-21T00:00:00.000Z");
const SAT = new Date("2026-09-19T10:00:00.000Z");

const OPEN_LEAGUE = { id: "L1", seasonId: "season-0", weekStart: WEEK_START, weekEnd: WEEK_END, status: "open" };
const NEXT_LEAGUE = { id: "L2", seasonId: "season-0", weekStart: NEXT_WEEK_START, weekEnd: new Date("2026-09-25T20:00:00.000Z"), status: "open" };

function quote(assetId: AssetId, symbol: string, price: number | null, source: PriceQuote["source"] = "jupiter"): PriceQuote {
  return { assetId, symbol, price, source, publishedAt: new Date("2026-09-14T11:59:00.000Z"), ageSeconds: 60, stale: false, marketOpen: false };
}

// ---------------------------------------------------------------------------
// Module mocks (hoisted)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  db: {
    season: { findFirst: vi.fn() },
    play: { findMany: vi.fn() },
    league: { upsert: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    leagueAccount: { upsert: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), create: vi.fn(), count: vi.fn() },
    leagueTrade: { create: vi.fn(), createMany: vi.fn(), count: vi.fn() },
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
  requireSession: vi.fn(),
  after: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({ db: mocks.db }));
// POST /api/v1/league/trade: the session and after() are faked.
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.after }));

// league-views: the inline Play evaluation and the display-wallet helper.
vi.mock("@/lib/cron/evaluate", () => ({ evaluateUser: mocks.evaluateUser }));
vi.mock("@/lib/server/queries", () => ({
  pickDisplayWallet: <T,>(wallets: T[]): T | null => wallets[0] ?? null,
}));

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

import { UnknownAssetError } from "@/lib/price";
import { ApiError } from "@/lib/server/api";
import {
  BOT_HANDLES,
  CLOSED_MESSAGE,
  LEAGUE_ASSET_SOURCE,
  MIN_TRADE_MESSAGE,
  MIN_TRADE_USD,
  RANK_POINTS,
  SPREAD,
  STARTING_CASH_USD,
  applyTrade,
  assertMinNotional,
  botUserId,
  botWalletAddress,
  currentWeek,
  ensureLeague,
  fillPrice,
  isTradingOpen,
  lastRecomputedAt,
  normaliseQty,
  parsePositions,
  placeTrade,
  planBotIdentitySync,
  planBotTrades,
  plannedBotIdentities,
  rankAccounts,
  rankDelta,
  recomputeEquity,
  recomputeIfStale,
  resetLeagueMemory,
  rollover,
  seedBots,
  tickLeague,
  valueAccount,
  weekContaining,
  type BotQuote,
} from "@/lib/games/league";
import { INLINE_EVALUATE_TIMEOUT_MS, LEAGUE_TRADE_EVENTS, evaluateLeaguePlays, isLeagueTradeRule, toLeagueView } from "@/lib/games/league-views";
import { MIN_TRADES_FOR_WEEKLY_POINTS } from "@/lib/games/ledger-policy";
import { POST as tradeRoute } from "@/app/api/v1/league/trade/route";
import {
  LEAGUE_MIN_TRADE_USD,
  WEEKEND_TRADES_COPY,
  countdownTarget,
  isBelowMinTrade,
  isPreWeek,
  nextOpenIso,
} from "@/components/league/format";
import { completedPlayTitle, findScoutPlay, scoutProgress } from "@/components/league/scout";
import type { PlayView, PlaysResponse } from "@/lib/api-client";

const ACCOUNT = { id: "acct_1", leagueId: "L1", userId: "u_me", cashUsd: "10000", positions: {}, equityUsd: "10000", rank: null, isBot: false };

function setDefaults() {
  mocks.db.season.findFirst.mockResolvedValue({ id: "season-0" });
  mocks.db.league.upsert.mockResolvedValue(OPEN_LEAGUE);
  mocks.db.league.findMany.mockResolvedValue([]);
  mocks.db.league.update.mockResolvedValue({});
  // The rollover claim: this tick flips the week from open to settled.
  mocks.db.league.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.leagueAccount.upsert.mockResolvedValue(ACCOUNT);
  mocks.db.leagueAccount.findUniqueOrThrow.mockResolvedValue(ACCOUNT);
  mocks.db.leagueAccount.findMany.mockResolvedValue([]);
  mocks.db.leagueAccount.count.mockResolvedValue(BOT_HANDLES.length); // the bots are already in
  mocks.db.leagueAccount.update.mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({ ...ACCOUNT, ...args.data, id: args.where.id }));
  mocks.db.leagueTrade.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "trade_1", ...args.data }));
  mocks.db.pointsEvent.createMany.mockResolvedValue({ count: 1 });
  mocks.db.$queryRaw.mockResolvedValue([]);
  mocks.db.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? arg(mocks.db) : Promise.all(arg as Promise<unknown>[])));
  mocks.getPriceBySymbol.mockResolvedValue(quote(TSLAX_ID, "TSLAx", 100));
  mocks.getPrices.mockResolvedValue(new Map());
  mocks.getPricesBySymbols.mockResolvedValue({ quotes: [], unknown: [] });
  mocks.db.play.findMany.mockResolvedValue([]);
  mocks.evaluateUser.mockResolvedValue({ plays: [] });
  // Bot identity sync: no bot Users yet, so nothing to converge.
  mocks.db.user.findMany.mockResolvedValue([]);
  mocks.db.wallet.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  resetLeagueMemory();
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
// Week windows
// ---------------------------------------------------------------------------

describe("week windows", () => {
  it("is Monday 00:00 UTC -> Friday 20:00 UTC and started on a Monday", () => {
    expect(weekContaining(MON)).toEqual({ weekStart: WEEK_START, weekEnd: WEEK_END });
    expect(currentWeek(MON)).toEqual({ weekStart: WEEK_START, weekEnd: WEEK_END, started: true });
  });

  it("is still this week one millisecond before Friday 20:00 UTC and rolls to next week at 20:00:00", () => {
    expect(currentWeek(new Date("2026-09-18T19:59:59.999Z"))).toEqual({ weekStart: WEEK_START, weekEnd: WEEK_END, started: true });
    const atClose = currentWeek(WEEK_END);
    expect(atClose.started).toBe(false);
    expect(atClose.weekStart).toEqual(NEXT_WEEK_START);
    expect(atClose.weekEnd).toEqual(new Date("2026-09-25T20:00:00.000Z"));
  });

  it("points a Saturday and a Sunday at the upcoming Monday, which starts at 00:00:00", () => {
    expect(currentWeek(SAT)).toMatchObject({ weekStart: NEXT_WEEK_START, started: false });
    expect(currentWeek(new Date("2026-09-20T23:59:59.999Z"))).toMatchObject({ weekStart: NEXT_WEEK_START, started: false });
    expect(currentWeek(NEXT_WEEK_START)).toMatchObject({ weekStart: NEXT_WEEK_START, started: true });
  });

  // C6 / REVIEW M-H: the League never pauses; weekend trades count toward next week's League.
  it("isTradingOpen needs an open status and a week that has not ended, with no lower bound", () => {
    expect(isTradingOpen(OPEN_LEAGUE, MON)).toBe(true);
    expect(isTradingOpen(OPEN_LEAGUE, WEEK_END)).toBe(false);
    expect(isTradingOpen({ ...OPEN_LEAGUE, status: "settled" }, MON)).toBe(false);
    expect(isTradingOpen(NEXT_LEAGUE, WEEK_END)).toBe(true); // from the Friday close itself
    expect(isTradingOpen(NEXT_LEAGUE, SAT)).toBe(true); // weekend: next week's League takes the trade
    expect(isTradingOpen(NEXT_LEAGUE, new Date("2026-09-20T23:59:59.999Z"))).toBe(true);
    // The League currentWeek(now) returns is always one that accepts trades.
    for (const at of [MON, SAT, WEEK_END, NEXT_WEEK_START]) {
      const w = currentWeek(at);
      expect(isTradingOpen({ ...w, status: "open" }, at), at.toISOString()).toBe(true);
    }
  });

  it("the closed message no longer promises Monday", () => {
    expect(CLOSED_MESSAGE).toContain(WEEKEND_TRADES_COPY);
    expect(CLOSED_MESSAGE).not.toMatch(/Monday/);
  });

  it("ensureLeague upserts by (seasonId, weekStart) and never rewrites status", async () => {
    await ensureLeague("season-0", SAT);
    const args = mocks.db.league.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ seasonId_weekStart: { seasonId: "season-0", weekStart: NEXT_WEEK_START } });
    expect(args.create).toMatchObject({ seasonId: "season-0", weekStart: NEXT_WEEK_START, status: "open" });
    expect(args.update).toEqual({ weekEnd: new Date("2026-09-25T20:00:00.000Z") });
    expect(args.update).not.toHaveProperty("status");
  });
});

// ---------------------------------------------------------------------------
// Spread + trade math
// ---------------------------------------------------------------------------

describe("spread", () => {
  it("is 0.1% against the trader on both sides", () => {
    expect(SPREAD).toBe(0.001);
    expect(fillPrice(100, "buy")).toBe(100.1);
    expect(fillPrice(100, "sell")).toBe(99.9);
    expect(fillPrice(359.6743635440341, "buy")).toBe(360.034038);
  });
});

describe("normaliseQty", () => {
  it("rejects non-positive, non-finite and non-number quantities", async () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1", null, undefined]) {
      expect(() => normaliseQty(bad)).toThrow(ApiError);
    }
    expect(() => normaliseQty(1e-9)).toThrow(/at least/);
  });

  it("rounds to 6 decimals", () => {
    expect(normaliseQty(1.2345678)).toBe(1.234568);
    expect(normaliseQty(2)).toBe(2);
  });
});

describe("applyTrade", () => {
  const fresh = { cashUsd: 10_000, positions: {} };

  it("buys with a volume-weighted average price and deducts cash", () => {
    const one = applyTrade(fresh, { assetId: TSLAX_ID, symbol: "TSLAx", side: "buy", qty: 10, fill: 100 });
    expect(one.cashUsd).toBe(9000);
    expect(one.positions[TSLAX_ID]).toEqual({ symbol: "TSLAx", qty: 10, avgPrice: 100 });
    const two = applyTrade(one, { assetId: TSLAX_ID, symbol: "TSLAx", side: "buy", qty: 10, fill: 200 });
    expect(two.cashUsd).toBe(7000);
    expect(two.positions[TSLAX_ID]).toEqual({ symbol: "TSLAx", qty: 20, avgPrice: 150 });
    expect(fresh.positions).toEqual({}); // input untouched
  });

  it("refuses a buy that costs more than the cash on hand", () => {
    expect(() => applyTrade(fresh, { assetId: TSLAX_ID, symbol: "TSLAx", side: "buy", qty: 101, fill: 100 })).toThrow(/Not enough cash/);
    expect(() => applyTrade(fresh, { assetId: TSLAX_ID, symbol: "TSLAx", side: "buy", qty: 100, fill: 100 })).not.toThrow();
  });

  it("sells only what is held, keeps avgPrice on partial sells and removes emptied positions", () => {
    const held = applyTrade(fresh, { assetId: TSLAX_ID, symbol: "TSLAx", side: "buy", qty: 10, fill: 100 });
    expect(() => applyTrade(held, { assetId: TSLAX_ID, symbol: "TSLAx", side: "sell", qty: 10.5, fill: 100 })).toThrow(/Not enough TSLAx/);
    expect(() => applyTrade(held, { assetId: AAPLX_ID, symbol: "AAPLx", side: "sell", qty: 1, fill: 100 })).toThrow(/Not enough AAPLx: you hold 0/);
    const part = applyTrade(held, { assetId: TSLAX_ID, symbol: "TSLAx", side: "sell", qty: 4, fill: 120 });
    expect(part.cashUsd).toBe(9480);
    expect(part.positions[TSLAX_ID]).toEqual({ symbol: "TSLAx", qty: 6, avgPrice: 100 });
    const all = applyTrade(part, { assetId: TSLAX_ID, symbol: "TSLAx", side: "sell", qty: 6, fill: 120 });
    expect(all.cashUsd).toBe(10200);
    expect(all.positions).toEqual({});
  });

  it("assertMinNotional: $10 floor, whole-position sells exempt, mirrored by the trade form", () => {
    expect(MIN_TRADE_USD).toBe(10);
    expect(LEAGUE_MIN_TRADE_USD).toBe(MIN_TRADE_USD);
    const held = { cashUsd: 1000, positions: { [TSLAX_ID]: { symbol: "TSLAx", qty: 0.05, avgPrice: 100 } } };
    expect(() => assertMinNotional(fresh, { assetId: TSLAX_ID, symbol: "TSLAx", side: "buy", qty: 0.1, fill: 100 })).not.toThrow(); // exactly $10
    expect(() => assertMinNotional(fresh, { assetId: TSLAX_ID, symbol: "TSLAx", side: "buy", qty: 0.099, fill: 100 })).toThrow(MIN_TRADE_MESSAGE);
    expect(() => assertMinNotional(held, { assetId: TSLAX_ID, symbol: "TSLAx", side: "sell", qty: 0.05, fill: 100 })).not.toThrow(); // closes it
    expect(() => assertMinNotional(held, { assetId: TSLAX_ID, symbol: "TSLAx", side: "sell", qty: 0.02, fill: 100 })).toThrow(MIN_TRADE_MESSAGE);
    expect(() => assertMinNotional(fresh, { assetId: AAPLX_ID, symbol: "AAPLx", side: "sell", qty: 0.01, fill: 100 })).toThrow(MIN_TRADE_MESSAGE); // nothing held

    expect(isBelowMinTrade({ side: "buy", qty: 0.05, cost: 5, held: 0 })).toBe(true);
    expect(isBelowMinTrade({ side: "buy", qty: 0.1, cost: 10, held: 0 })).toBe(false);
    expect(isBelowMinTrade({ side: "sell", qty: 0.05, cost: 5, held: 0.05 })).toBe(false);
    expect(isBelowMinTrade({ side: "sell", qty: 0.02, cost: 2, held: 0.05 })).toBe(true);
    expect(isBelowMinTrade({ side: "buy", qty: null, cost: null, held: 0 })).toBe(false);
  });

  it("parsePositions drops malformed or empty entries", () => {
    expect(parsePositions(null)).toEqual({});
    expect(parsePositions([1])).toEqual({});
    expect(parsePositions({ [TSLAX_ID]: { symbol: "TSLAx", qty: 0, avgPrice: 1 }, [AAPLX_ID]: { qty: 2, avgPrice: "x" }, bad: "no" })).toEqual({
      [AAPLX_ID]: { symbol: AAPLX_ID, qty: 2, avgPrice: 0 },
    });
  });
});

// ---------------------------------------------------------------------------
// placeTrade
// ---------------------------------------------------------------------------

describe("placeTrade", () => {
  it("accepts a Saturday trade into next week's League (weekend trades count toward next week)", async () => {
    mocks.db.league.upsert.mockResolvedValue(NEXT_LEAGUE);
    const r = await placeTrade({ userId: "u_me", symbol: "TSLAx", side: "buy", qty: 1 }, SAT);
    expect(mocks.db.league.upsert.mock.calls[0][0].where).toEqual({ seasonId_weekStart: { seasonId: "season-0", weekStart: NEXT_WEEK_START } });
    expect(r.league.id).toBe("L2");
    expect(mocks.db.leagueAccount.upsert.mock.calls[0][0].where).toEqual({ leagueId_userId: { leagueId: "L2", userId: "u_me" } });
    expect(mocks.db.leagueTrade.create.mock.calls[0][0].data).toMatchObject({ side: "buy", price: "100.100000", ts: SAT });
  });

  it("refuses with 409 when the League's week has already ended, before quoting or writing", async () => {
    mocks.db.league.upsert.mockResolvedValue(OPEN_LEAGUE); // a stale row: its Friday close is behind SAT
    await expectApiError(placeTrade({ userId: "u_me", symbol: "TSLAx", side: "buy", qty: 1 }, SAT), 409, CLOSED_MESSAGE);
    expect(mocks.getPriceBySymbol).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a trade under $10 notional with 400 and writes nothing", async () => {
    // 0.05 TSLAx at 100 + spread = $5.005.
    await expectApiError(placeTrade({ userId: "u_me", symbol: "TSLAx", side: "buy", qty: 0.05 }, MON), 400, MIN_TRADE_MESSAGE);
    expect(mocks.db.leagueTrade.create).not.toHaveBeenCalled();
    expect(mocks.db.leagueAccount.update).not.toHaveBeenCalled();
    // 0.1 TSLAx = $10.01 goes through.
    await placeTrade({ userId: "u_me", symbol: "TSLAx", side: "buy", qty: 0.1 }, MON);
    expect(mocks.db.leagueTrade.create).toHaveBeenCalledTimes(1);
  });

  it("lets a sell under $10 close the whole position, but not leave a remainder", async () => {
    const held = { ...ACCOUNT, cashUsd: "9990", positions: { [TSLAX_ID]: { symbol: "TSLAx", qty: 0.08, avgPrice: 100 } } };
    mocks.db.leagueAccount.upsert.mockResolvedValue(held);
    mocks.db.leagueAccount.findUniqueOrThrow.mockResolvedValue(held);
    await expectApiError(placeTrade({ userId: "u_me", symbol: "TSLAx", side: "sell", qty: 0.04 }, MON), 400, MIN_TRADE_MESSAGE);
    expect(mocks.db.leagueTrade.create).not.toHaveBeenCalled();
    await placeTrade({ userId: "u_me", symbol: "TSLAx", side: "sell", qty: 0.08 }, MON);
    expect(mocks.db.leagueAccount.update.mock.calls[0][0].data).toMatchObject({ positions: {} });
  });

  it("refuses with 409 when the League row is settled", async () => {
    mocks.db.league.upsert.mockResolvedValue({ ...OPEN_LEAGUE, status: "settled" });
    await expectApiError(placeTrade({ userId: "u_me", symbol: "TSLAx", side: "buy", qty: 1 }, MON), 409, CLOSED_MESSAGE);
  });

  it("refuses with 400 when there is no price, and for an unknown symbol", async () => {
    mocks.getPriceBySymbol.mockResolvedValue({ ...quote(TSLAX_ID, "TSLAx", null, "none"), stale: true });
    await expectApiError(placeTrade({ userId: "u_me", symbol: "TSLAx", side: "buy", qty: 1 }, MON), 400, /No price for TSLAx/);
    mocks.getPriceBySymbol.mockRejectedValue(new UnknownAssetError("FOOx"));
    await expectApiError(placeTrade({ userId: "u_me", symbol: "FOOx", side: "buy", qty: 1 }, MON), 400, /Unknown xStock: FOOx/);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("fences the quote to xStocks: a pre-IPO token symbol is refused with 400 and nothing is written", async () => {
    expect(LEAGUE_ASSET_SOURCE).toBe("xstocks");
    // Mirror lib/price: the registry knows SPACEX (PreStocks), so an unfenced lookup would quote it,
    // and the xstocks fence reports it unknown. Any call without the fence fails the test.
    mocks.getPriceBySymbol.mockImplementation(async (symbol: string, options?: { source?: string }) => {
      if (options?.source !== "xstocks") throw new Error(`placeTrade must fence its quote to xstocks, got ${JSON.stringify(options)}`);
      if (symbol.toUpperCase() === "SPACEX") throw new UnknownAssetError(symbol);
      return quote(TSLAX_ID, "TSLAx", 100);
    });

    for (const symbol of ["SPACEX", "spacex"]) {
      await expectApiError(placeTrade({ userId: "u_me", symbol, side: "buy", qty: 1 }, MON), 400, new RegExp(`Unknown xStock: ${symbol}`));
      expect(mocks.getPriceBySymbol).toHaveBeenLastCalledWith(symbol, { source: LEAGUE_ASSET_SOURCE });
    }
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    expect(mocks.db.leagueTrade.create).not.toHaveBeenCalled();
    expect(mocks.db.leagueAccount.upsert).not.toHaveBeenCalled();

    // An xStock still fills through the same fence.
    await placeTrade({ userId: "u_me", symbol: "TSLAx", side: "buy", qty: 1 }, MON);
    expect(mocks.getPriceBySymbol).toHaveBeenLastCalledWith("TSLAx", { source: "xstocks" });
    expect(mocks.db.leagueTrade.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.leagueTrade.create.mock.calls[0][0].data).toMatchObject({ symbol: "TSLAx" });
  });

  it("validates the quantity before touching anything", async () => {
    await expectApiError(placeTrade({ userId: "u_me", symbol: "TSLAx", side: "buy", qty: 0 }, MON), 400);
    expect(mocks.db.season.findFirst).not.toHaveBeenCalled();
  });

  it("buys at the quote plus spread inside one transaction that locks and re-reads the account", async () => {
    mocks.db.leagueAccount.findMany.mockResolvedValue([
      { id: "acct_1", userId: "u_me", cashUsd: "9799.8", positions: { [TSLAX_ID]: { symbol: "TSLAx", qty: 2, avgPrice: 100.1 } }, rank: null },
    ]);
    mocks.getPrices.mockResolvedValue(new Map([[TSLAX_ID, quote(TSLAX_ID, "TSLAx", 100)]]));

    const r = await placeTrade({ userId: "u_me", symbol: "tslax", side: "buy", qty: 2 }, MON);

    expect(mocks.db.$transaction).toHaveBeenCalledTimes(2); // the trade, then the equity batch
    expect(mocks.db.leagueAccount.upsert.mock.calls[0][0].where).toEqual({ leagueId_userId: { leagueId: "L1", userId: "u_me" } });
    expect(mocks.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.db.leagueAccount.findUniqueOrThrow.mock.calls[0][0].where).toEqual({ id: "acct_1" });
    // Lock before the re-read, re-read before the writes.
    const order = [mocks.db.$queryRaw, mocks.db.leagueAccount.findUniqueOrThrow, mocks.db.leagueTrade.create, mocks.db.leagueAccount.update].map(
      (fn) => fn.mock.invocationCallOrder[0],
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const trade = mocks.db.leagueTrade.create.mock.calls[0][0].data;
    expect(trade).toMatchObject({ leagueAccountId: "acct_1", symbol: "TSLAx", side: "buy", qty: "2.00000000", price: "100.100000", priceSource: "jupiter", ts: MON });
    const update = mocks.db.leagueAccount.update.mock.calls[0][0].data;
    expect(update.cashUsd).toBe("9799.800000");
    expect(update.positions).toEqual({ [TSLAX_ID]: { symbol: "TSLAx", qty: 2, avgPrice: 100.1 } });

    expect(r.fill).toBe(100.1);
    expect(r.quote.source).toBe("jupiter");
    expect(r.league.id).toBe("L1");
    expect(r.account.rank).toBe(1);
    expect(r.account.equityUsd).toBe(9999.8); // 9799.8 cash + 2 x 100 at the quote
  });

  it("sells at the quote minus spread and refuses to sell more than held", async () => {
    const held = { ...ACCOUNT, cashUsd: "9799.8", positions: { [TSLAX_ID]: { symbol: "TSLAx", qty: 2, avgPrice: 100.1 } } };
    mocks.db.leagueAccount.upsert.mockResolvedValue(held);
    mocks.db.leagueAccount.findUniqueOrThrow.mockResolvedValue(held);

    await placeTrade({ userId: "u_me", symbol: "TSLAx", side: "sell", qty: 2 }, MON);
    const trade = mocks.db.leagueTrade.create.mock.calls[0][0].data;
    expect(trade).toMatchObject({ side: "sell", qty: "2.00000000", price: "99.900000" });
    expect(mocks.db.leagueAccount.update.mock.calls[0][0].data).toMatchObject({ cashUsd: "9999.600000", positions: {} });

    vi.clearAllMocks();
    setDefaults();
    mocks.db.leagueAccount.upsert.mockResolvedValue(held);
    mocks.db.leagueAccount.findUniqueOrThrow.mockResolvedValue(held);
    await expectApiError(placeTrade({ userId: "u_me", symbol: "TSLAx", side: "sell", qty: 3 }, MON), 400, /Not enough TSLAx/);
    expect(mocks.db.leagueTrade.create).not.toHaveBeenCalled();
    expect(mocks.db.leagueAccount.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Equity + rank
// ---------------------------------------------------------------------------

describe("recomputeEquity", () => {
  const accounts = [
    { id: "a", userId: "u_a", cashUsd: "5000", positions: { [TSLAX_ID]: { symbol: "TSLAx", qty: 10, avgPrice: 400 } }, rank: null },
    { id: "b", userId: "u_b", cashUsd: "11000", positions: {}, rank: null },
    { id: "c", userId: "u_c", cashUsd: "1000", positions: { [AAPLX_ID]: { symbol: "AAPLx", qty: 10, avgPrice: 250 } }, rank: null },
  ];

  it("values every account with one batched getPrices, breaks ties by userId and falls back to avgPrice", async () => {
    mocks.db.leagueAccount.findMany.mockResolvedValue(accounts);
    mocks.getPrices.mockResolvedValue(new Map([[TSLAX_ID, quote(TSLAX_ID, "TSLAx", 600)], [AAPLX_ID, quote(AAPLX_ID, "AAPLx", null, "none")]]));

    const r = await recomputeEquity("L1", undefined, MON);

    expect(mocks.getPrices).toHaveBeenCalledTimes(1);
    expect(new Set(mocks.getPrices.mock.calls[0][0])).toEqual(new Set([TSLAX_ID, AAPLX_ID]));
    expect(r.unpriced).toEqual(["AAPLx"]);
    expect(r.rows.map((x) => [x.accountId, x.equityUsd, x.rank, x.prevRank])).toEqual([
      ["a", 11000, 1, null], // tie with b at 11,000: userId asc wins
      ["b", 11000, 2, null],
      ["c", 3500, 3, null], // 1,000 cash + 10 x 250 avgPrice (no live price)
    ]);
    const writes = mocks.db.leagueAccount.update.mock.calls.map((c) => [c[0].where.id, c[0].data]);
    expect(writes).toEqual([
      ["a", { equityUsd: "11000.000000", rank: 1 }],
      ["b", { equityUsd: "11000.000000", rank: 2 }],
      ["c", { equityUsd: "3500.000000", rank: 3 }],
    ]);
    expect(lastRecomputedAt("L1")).toBe(MON.getTime());
    // Fresh accounts have no previous rank to move from.
    expect(rankDelta("a", 1)).toBeNull();
  });

  it("is idempotent and remembers the previous rank for deltas", async () => {
    mocks.db.leagueAccount.findMany.mockResolvedValue(accounts);
    mocks.getPrices.mockResolvedValue(new Map([[TSLAX_ID, quote(TSLAX_ID, "TSLAx", 600)]]));
    const first = await recomputeEquity("L1");
    const again = await recomputeEquity("L1");
    expect(again.rows.map((x) => [x.accountId, x.rank])).toEqual(first.rows.map((x) => [x.accountId, x.rank]));

    // TSLAx halves: a drops below b. The stored ranks from the last run are the "previous" ones.
    mocks.db.leagueAccount.findMany.mockResolvedValue(accounts.map((a) => ({ ...a, rank: first.rows.find((x) => x.accountId === a.id)?.rank ?? null })));
    mocks.getPrices.mockResolvedValue(new Map([[TSLAX_ID, quote(TSLAX_ID, "TSLAx", 100)]]));
    const moved = await recomputeEquity("L1");
    expect(moved.rows.map((x) => [x.accountId, x.rank, x.prevRank])).toEqual([
      ["b", 1, 2],
      ["a", 2, 1],
      ["c", 3, 3],
    ]);
    expect(rankDelta("b", 1)).toBe(1);
    expect(rankDelta("a", 2)).toBe(-1);
    expect(rankDelta("c", 3)).toBe(0);
  });

  it("recomputeIfStale skips inside the 60s window", async () => {
    mocks.db.leagueAccount.findMany.mockResolvedValue([]);
    expect(await recomputeIfStale("L1", MON)).not.toBeNull();
    expect(await recomputeIfStale("L1", new Date(MON.getTime() + 59_000))).toBeNull();
    expect(await recomputeIfStale("L1", new Date(MON.getTime() + 60_000))).not.toBeNull();
  });

  it("valueAccount and rankAccounts are pure", () => {
    expect(valueAccount(100, { [TSLAX_ID]: { symbol: "TSLAx", qty: 2, avgPrice: 50 } }, new Map([[TSLAX_ID, 75]]))).toEqual({ equityUsd: 250, unpriced: [] });
    expect(valueAccount(100, { [TSLAX_ID]: { symbol: "TSLAx", qty: 2, avgPrice: 50 } }, new Map())).toEqual({ equityUsd: 200, unpriced: ["TSLAx"] });
    expect(rankAccounts([{ accountId: "x", userId: "u2", equityUsd: 5, rank: 3 }, { accountId: "y", userId: "u1", equityUsd: 5, rank: null }]).map((r) => [r.accountId, r.rank, r.prevRank])).toEqual([
      ["y", 1, null],
      ["x", 2, 3],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Rollover
// ---------------------------------------------------------------------------

describe("rollover", () => {
  const closed = { ...OPEN_LEAGUE };
  const trades = (n: number) => ({ _count: { trades: n } });
  const ranked = [
    { userId: "bot-league-1", rank: 1, isBot: true, ...trades(6) },
    { userId: "u_real", rank: 2, isBot: false, ...trades(3) },
    { userId: "bot-league-2", rank: 3, isBot: true, ...trades(4) },
    { userId: "u_other", rank: 4, isBot: false, ...trades(12) },
    { userId: "u_tenth", rank: 10, isBot: false, ...trades(5) },
  ];
  const CLAIM = { where: { id: "L1", status: "open" }, data: { status: "settled" } };

  it("awards the top 10 exactly once, skips bots, settles in the same transaction and ensures next week", async () => {
    const now = new Date("2026-09-18T20:05:00.000Z");
    mocks.db.league.findMany.mockResolvedValueOnce([closed]).mockResolvedValue([]);
    mocks.db.leagueAccount.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(ranked);
    mocks.db.league.upsert.mockResolvedValue(NEXT_LEAGUE);

    const r = await rollover(now);

    expect(r.settled).toEqual([{ leagueId: "L1", awarded: 3, skippedBots: 2, skippedFewTrades: 0, nextLeagueId: "L2" }]);
    expect(mocks.db.league.findMany.mock.calls[0][0].where).toEqual({ status: "open", weekEnd: { lt: now } });
    expect(mocks.db.leagueAccount.findMany.mock.calls[1][0].where).toEqual({ leagueId: "L1", rank: { lte: 10 } });
    // The trade count rides along with the top 10 read.
    expect(mocks.db.leagueAccount.findMany.mock.calls[1][0].select).toEqual({ userId: true, rank: true, isBot: true, _count: { select: { trades: true } } });
    expect(mocks.db.pointsEvent.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.pointsEvent.createMany.mock.calls[0][0]).toEqual({
      data: [
        { userId: "u_real", seasonId: "season-0", source: "league", ref: "league:L1:rank:2", delta: 700 },
        { userId: "u_other", seasonId: "season-0", source: "league", ref: "league:L1:rank:4", delta: 300 },
        { userId: "u_tenth", seasonId: "season-0", source: "league", ref: "league:L1:rank:10", delta: 100 },
      ],
      skipDuplicates: true,
    });
    expect(mocks.db.league.updateMany).toHaveBeenCalledWith(CLAIM);
    expect(mocks.db.league.update).not.toHaveBeenCalled();
    // The claim comes first, then the awards, in one interactive transaction (the recompute batch had no rows).
    expect(mocks.db.league.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.db.pointsEvent.createMany.mock.invocationCallOrder[0]);
    const txCalls = mocks.db.$transaction.mock.calls.filter((c) => typeof c[0] === "function");
    expect(txCalls).toHaveLength(1);
    expect(mocks.db.league.upsert.mock.calls[0][0].where).toEqual({ seasonId_weekStart: { seasonId: "season-0", weekStart: NEXT_WEEK_START } });

    // Second run: nothing is open any more, nothing is awarded again.
    const second = await rollover(new Date(now.getTime() + 300_000));
    expect(second.settled).toEqual([]);
    expect(mocks.db.pointsEvent.createMany).toHaveBeenCalledTimes(1);
  });

  it("leaves an open League alone before Friday 20:00 UTC and writes no points when only bots placed", async () => {
    mocks.db.league.findMany.mockResolvedValue([]);
    expect((await rollover(MON)).settled).toEqual([]);
    expect(mocks.db.pointsEvent.createMany).not.toHaveBeenCalled();

    mocks.db.league.findMany.mockResolvedValueOnce([closed]).mockResolvedValue([]);
    mocks.db.leagueAccount.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(ranked.filter((a) => a.isBot));
    mocks.db.league.upsert.mockResolvedValue(NEXT_LEAGUE);
    const r = await rollover(new Date("2026-09-18T20:05:00.000Z"));
    expect(r.settled[0]).toMatchObject({ awarded: 0, skippedBots: 2, skippedFewTrades: 0 });
    expect(mocks.db.pointsEvent.createMany).not.toHaveBeenCalled();
    expect(mocks.db.league.updateMany).toHaveBeenCalledWith(CLAIM);
  });

  it("a tick that loses the claim writes no points and does not ensure next week", async () => {
    mocks.db.league.findMany.mockResolvedValueOnce([closed]).mockResolvedValue([]);
    mocks.db.leagueAccount.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(ranked);
    // An overlapping tick already flipped L1 to settled.
    mocks.db.league.updateMany.mockResolvedValue({ count: 0 });

    const r = await rollover(new Date("2026-09-18T20:05:00.000Z"));

    expect(r.settled).toEqual([]);
    expect(mocks.db.league.updateMany).toHaveBeenCalledWith(CLAIM);
    expect(mocks.db.pointsEvent.createMany).not.toHaveBeenCalled();
    expect(mocks.db.league.upsert).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/L1 was already settled by another tick/));
  });

  it("pays only real accounts with at least 3 trades that week: a real #1 with 2 trades gets nothing", async () => {
    expect(MIN_TRADES_FOR_WEEKLY_POINTS).toBe(3);
    mocks.db.league.findMany.mockResolvedValueOnce([closed]).mockResolvedValue([]);
    mocks.db.leagueAccount.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { userId: "u_idle", rank: 1, isBot: false, ...trades(2) },
      { userId: "bot-league-1", rank: 2, isBot: true, ...trades(8) },
      { userId: "u_player", rank: 3, isBot: false, ...trades(3) },
      { userId: "u_none", rank: 4, isBot: false, ...trades(0) },
    ]);
    mocks.db.league.upsert.mockResolvedValue(NEXT_LEAGUE);

    const r = await rollover(new Date("2026-09-18T20:05:00.000Z"));

    expect(r.settled).toEqual([{ leagueId: "L1", awarded: 1, skippedBots: 1, skippedFewTrades: 2, nextLeagueId: "L2" }]);
    // Ranks are overall (the bot still holds #2): #1 pays nobody, #3 is paid the #3 amount.
    expect(mocks.db.pointsEvent.createMany.mock.calls[0][0]).toEqual({
      data: [{ userId: "u_player", seasonId: "season-0", source: "league", ref: "league:L1:rank:3", delta: 500 }],
      skipDuplicates: true,
    });
  });

  it("uses the §3.2 point ladder", () => {
    expect(RANK_POINTS).toEqual([1000, 700, 500, 300, 200, 100, 100, 100, 100, 100]);
  });
});

describe("tickLeague", () => {
  it("ensures the current League, recomputes every open one and rolls over", async () => {
    mocks.db.league.findMany.mockResolvedValueOnce([{ id: "L1" }, { id: "L0" }]).mockResolvedValue([]);
    const r = await tickLeague(MON);
    expect(r).toEqual({ seasonId: "season-0", leagueId: "L1", botsSeeded: 0, recomputed: 2, settled: 0 });
    expect(mocks.db.league.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.db.leagueAccount.findMany.mock.calls.map((c) => c[0].where.leagueId)).toEqual(["L1", "L0"]);
  });

  it("skips ensureLeague without a Season", async () => {
    mocks.db.season.findFirst.mockResolvedValue(null);
    const r = await tickLeague(MON);
    expect(r).toEqual({ seasonId: null, leagueId: null, botsSeeded: 0, recomputed: 0, settled: 0 });
    expect(mocks.db.league.upsert).not.toHaveBeenCalled();
    expect(mocks.db.leagueAccount.count).not.toHaveBeenCalled();
  });

  // REVIEW H4: the League the Friday rollover (or a fresh deploy) opens must never be an empty board.
  it("seeds the bots once into an open League that has none and reports botsSeeded", async () => {
    mocks.db.leagueAccount.count.mockResolvedValue(0);
    mocks.db.league.findUniqueOrThrow.mockResolvedValue({ id: "L1", weekStart: WEEK_START });
    mocks.db.leagueAccount.findUnique.mockResolvedValue(null);
    mocks.db.leagueAccount.create.mockResolvedValue({ id: "acct_bot" });
    mocks.db.league.findMany.mockResolvedValueOnce([{ id: "L1" }]).mockResolvedValue([]);

    const r = await tickLeague(MON);

    expect(r).toEqual({ seasonId: "season-0", leagueId: "L1", botsSeeded: BOT_HANDLES.length, recomputed: 1, settled: 0 });
    expect(mocks.db.leagueAccount.count).toHaveBeenCalledTimes(1);
    expect(mocks.db.leagueAccount.count).toHaveBeenCalledWith({ where: { leagueId: "L1", isBot: true } });
    // seedBots ran exactly once, for the ensured League.
    expect(mocks.db.league.findUniqueOrThrow).toHaveBeenCalledTimes(1);
    expect(mocks.db.league.findUniqueOrThrow.mock.calls[0][0].where).toEqual({ id: "L1" });
    expect(mocks.db.leagueAccount.create).toHaveBeenCalledTimes(BOT_HANDLES.length);
    expect(mocks.db.leagueAccount.create.mock.calls.every((c) => c[0].data.leagueId === "L1" && c[0].data.isBot === true)).toBe(true);
    // Seeding happens before the recompute, so the fresh bots are ranked in the same tick.
    const countOrder = mocks.db.leagueAccount.count.mock.invocationCallOrder[0];
    const recomputeOrder = mocks.db.leagueAccount.findMany.mock.invocationCallOrder[0];
    expect(mocks.db.leagueAccount.create.mock.invocationCallOrder.every((o) => o > countOrder && o < recomputeOrder)).toBe(true);
  });

  it("does not seed when the League already has every bot", async () => {
    mocks.db.leagueAccount.count.mockResolvedValue(BOT_HANDLES.length);
    const r = await tickLeague(MON);
    expect(r.botsSeeded).toBe(0);
    expect(mocks.db.leagueAccount.count).toHaveBeenCalledTimes(1);
    expect(mocks.db.league.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mocks.db.leagueAccount.create).not.toHaveBeenCalled();
    expect(mocks.db.user.upsert).not.toHaveBeenCalled();
  });

  // C20: a seed that died halfway (3 of 15 bots in) is finished by the next tick.
  it("tops up a League that has only some of its bots, skipping the ones already in", async () => {
    const present = new Set(["bot-league-1", "bot-league-2", "bot-league-3"]);
    mocks.db.leagueAccount.count.mockResolvedValue(present.size);
    mocks.db.league.findUniqueOrThrow.mockResolvedValue({ id: "L1", weekStart: WEEK_START });
    mocks.db.leagueAccount.findUnique.mockImplementation(async (args: { where: { leagueId_userId: { userId: string } } }) =>
      present.has(args.where.leagueId_userId.userId) ? { id: "acct_old", equityUsd: "10000" } : null,
    );
    mocks.db.leagueTrade.count.mockResolvedValue(4);
    mocks.db.leagueAccount.create.mockResolvedValue({ id: "acct_bot" });

    const r = await tickLeague(MON);

    expect(r.botsSeeded).toBe(BOT_HANDLES.length - present.size);
    expect(mocks.db.leagueAccount.create).toHaveBeenCalledTimes(BOT_HANDLES.length - present.size);
    const createdIds = mocks.db.leagueAccount.create.mock.calls.map((c) => c[0].data.userId as string);
    expect(createdIds.some((id) => present.has(id))).toBe(false);
  });

  it("logs a seedBots failure and still recomputes and rolls over", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.db.leagueAccount.count.mockResolvedValue(0);
    mocks.db.league.findUniqueOrThrow.mockRejectedValue(new Error("pool exhausted"));
    const now = new Date("2026-09-18T20:05:00.000Z"); // Friday after the close: L1 is due, L2 is current
    mocks.db.league.upsert.mockResolvedValue(NEXT_LEAGUE);
    mocks.db.league.findMany
      .mockResolvedValueOnce([{ id: "L2" }, { id: "L1" }]) // open Leagues to recompute
      .mockResolvedValueOnce([OPEN_LEAGUE]) // rollover: L1's week has ended
      .mockResolvedValue([]);
    mocks.db.leagueAccount.findMany.mockResolvedValue([]);

    const r = await tickLeague(now);

    expect(r).toEqual({ seasonId: "season-0", leagueId: "L2", botsSeeded: 0, recomputed: 2, settled: 1 });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toMatch(/seeding bots into L2 failed.*pool exhausted/);
    expect(mocks.db.league.updateMany).toHaveBeenCalledWith({ where: { id: "L1", status: "open" }, data: { status: "settled" } });
  });

  it("does not seed a settled current League", async () => {
    mocks.db.leagueAccount.count.mockResolvedValue(0);
    mocks.db.league.upsert.mockResolvedValue({ ...OPEN_LEAGUE, status: "settled" });
    const r = await tickLeague(MON);
    expect(r).toMatchObject({ leagueId: "L1", botsSeeded: 0 });
    expect(mocks.db.leagueAccount.count).not.toHaveBeenCalled();
    expect(mocks.db.league.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mocks.db.leagueAccount.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

describe("bots", () => {
  const quotes: BotQuote[] = [
    { symbol: "TSLAx", assetId: TSLAX_ID, price: 360, source: "jupiter" },
    { symbol: "AAPLx", assetId: AAPLX_ID, price: 330, source: "jupiter" },
  ];

  it("has 15 distinct handles with deterministic ids and valid, distinct Solana wallets", () => {
    expect(BOT_HANDLES).toHaveLength(15);
    expect(new Set(BOT_HANDLES).size).toBe(15);
    expect(botUserId(0)).toBe("bot-league-1");
    expect(botUserId(14)).toBe("bot-league-15");
    const addresses = BOT_HANDLES.map(botWalletAddress);
    expect(new Set(addresses).size).toBe(15);
    for (const a of addresses) expect(bs58.decode(a)).toHaveLength(32);
    expect(botWalletAddress("value_tilt")).toBe(botWalletAddress("value_tilt"));
  });

  it("uses sober paper-portfolio handles: no meme or options-slang names, stable index -> user id", () => {
    expect(BOT_HANDLES[0]).toBe("balanced_index");
    expect(BOT_HANDLES.indexOf("value_tilt")).toBe(1);
    const degen = /printer|brr|moon|ape|gamma|theta|delta|sigma|squeeze|yolo|degen|lambo|wagmi|rekt|pump|candles|chill|dip/i;
    for (const handle of BOT_HANDLES) {
      expect(handle, handle).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(handle, handle).not.toMatch(degen);
    }
    BOT_HANDLES.forEach((_, i) => expect(botUserId(i)).toBe(`bot-league-${i + 1}`));
  });

  it("plans 3-8 consistent trades per bot, starting with a buy, never in the future", () => {
    for (const handle of BOT_HANDLES) {
      const plan = planBotTrades(handle, quotes, WEEK_START, MON);
      expect(plan.trades.length).toBeGreaterThanOrEqual(3);
      expect(plan.trades.length).toBeLessThanOrEqual(8);
      expect(plan.trades[0].side).toBe("buy");
      // Replaying the trades from a fresh account reproduces the stored cash and positions.
      let state = { cashUsd: STARTING_CASH_USD, positions: {} };
      for (const t of plan.trades) {
        expect(t.price).toBeGreaterThan(0);
        expect(t.qty).toBeGreaterThan(0);
        expect(t.priceSource).toBe("seed:jupiter");
        expect(t.ts.getTime()).toBeLessThanOrEqual(MON.getTime());
        expect(t.ts.getTime()).toBeGreaterThanOrEqual(WEEK_START.getTime());
        state = applyTrade(state, { assetId: t.assetId, symbol: t.symbol, side: t.side, qty: t.qty, fill: t.price });
      }
      expect(state).toEqual({ cashUsd: plan.cashUsd, positions: plan.positions });
      expect(plan.cashUsd).toBeGreaterThanOrEqual(0);
      expect(planBotTrades(handle, quotes, WEEK_START, MON)).toEqual(plan); // deterministic
    }
  });

  it("fills at the quote with jitter mid-week only", () => {
    const priceOf = new Map(quotes.map((q) => [q.assetId, q.price]));
    const jittered = BOT_HANDLES.flatMap((h) => planBotTrades(h, quotes, WEEK_START, MON).trades);
    expect(jittered.some((t) => t.price !== fillPrice(priceOf.get(t.assetId) as number, t.side))).toBe(true);
  });

  // C20: bots seeded at the Friday rollover (before the new week starts) start it at ~$10,000.
  it("seeded before the week starts, fills at the quote with no jitter so every bot starts at ~$10,000", () => {
    const rolloverAt = new Date("2026-09-18T20:05:00.000Z");
    const priceOf = new Map(quotes.map((q) => [q.assetId, q.price]));
    for (const handle of BOT_HANDLES) {
      const plan = planBotTrades(handle, quotes, NEXT_WEEK_START, rolloverAt);
      expect(plan.trades.length).toBeGreaterThanOrEqual(3);
      for (const t of plan.trades) {
        expect(t.price).toBe(fillPrice(priceOf.get(t.assetId) as number, t.side));
        expect(t.ts).toEqual(rolloverAt);
      }
      const equity = valueAccount(plan.cashUsd, plan.positions, new Map(priceOf)).equityUsd;
      expect(equity, handle).toBeLessThanOrEqual(STARTING_CASH_USD);
      expect(equity, handle).toBeGreaterThan(STARTING_CASH_USD * 0.995); // only the 0.1% spread
      // Same PRNG sequence as a mid-week seed: same symbols and sides.
      const midWeek = planBotTrades(handle, quotes, NEXT_WEEK_START, new Date("2026-09-23T12:00:00.000Z"));
      expect(plan.trades.map((t) => [t.symbol, t.side])).toEqual(midWeek.trades.map((t) => [t.symbol, t.side]));
    }
  });

  it("seedBots skips bots that already have an account in the League", async () => {
    mocks.db.league.findUniqueOrThrow.mockResolvedValue({ id: "L1", weekStart: WEEK_START });
    mocks.db.leagueAccount.findUnique.mockResolvedValue({ id: "acct_bot", equityUsd: "10100" });
    mocks.db.leagueTrade.count.mockResolvedValue(4);
    const out = await seedBots(mocks.db as never, "L1", MON);
    expect(out).toHaveLength(15);
    expect(out.every((b) => !b.created && b.trades === 4 && b.equityUsd === 10100)).toBe(true);
    expect(mocks.db.user.upsert).not.toHaveBeenCalled();
    expect(mocks.db.leagueAccount.create).not.toHaveBeenCalled();
  });

  it("seedBots creates user, wallet, account and trades for a new bot, priced by lib/price with a fallback", async () => {
    mocks.db.league.findUniqueOrThrow.mockResolvedValue({ id: "L1", weekStart: WEEK_START });
    mocks.db.leagueAccount.findUnique.mockResolvedValue(null);
    mocks.db.leagueAccount.create.mockResolvedValue({ id: "acct_new" });
    mocks.getPricesBySymbols.mockResolvedValue({ quotes: [quote(TSLAX_ID, "TSLAx", 360), quote(AAPLX_ID, "AAPLx", null, "none")], unknown: [] });

    const out = await seedBots(mocks.db as never, "L1", MON);

    expect(out.filter((b) => b.created)).toHaveLength(15);
    expect(mocks.db.user.upsert).toHaveBeenCalledTimes(15);
    expect(mocks.db.user.upsert.mock.calls[0][0]).toMatchObject({ where: { id: "bot-league-1" }, create: { id: "bot-league-1", handle: "balanced_index" } });
    // The handle of an existing User is converged by syncBotIdentities, never forced by the upsert.
    expect(mocks.db.user.upsert.mock.calls[0][0].update).toEqual({});
    expect(mocks.db.wallet.upsert.mock.calls[0][0].create).toMatchObject({ userId: "bot-league-1", chainId: SOL, address: botWalletAddress("balanced_index"), isPrimary: true });
    expect(mocks.db.leagueAccount.create.mock.calls[0][0].data).toMatchObject({ leagueId: "L1", userId: "bot-league-1", isBot: true });
    const trades = mocks.db.leagueTrade.createMany.mock.calls.flatMap((c) => c[0].data as Array<{ symbol: string; priceSource: string }>);
    expect(trades.length).toBeGreaterThan(0);
    // AAPLx had no price: its fills come from the fallback table and say so.
    const sources = new Set(trades.map((t) => t.priceSource));
    expect([...sources].every((s) => s === "seed:jupiter" || s === "seed:fallback")).toBe(true);
    expect(trades.filter((t) => t.symbol === "AAPLx").every((t) => t.priceSource === "seed:fallback")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bot identity convergence: a renamed BOT_HANDLES entry reaches an existing database
// ---------------------------------------------------------------------------

describe("bot identity convergence", () => {
  const T0 = new Date("2026-09-10T00:00:00.000Z");
  const LATER = new Date("2026-09-12T00:00:00.000Z");
  const wallet = (id: string, address: string, isPrimary = true, createdAt = T0) => ({ id, address, isPrimary, createdAt });
  const planned = plannedBotIdentities();
  const none = { handleOwners: [], addressOwners: [] };

  /** Every bot seeded under an old handle, with the wallet derived from that old handle. */
  const staleUsers = () =>
    planned.map((b, i) => ({ id: b.userId, handle: `old_handle_${i + 1}`, wallets: [wallet(`w${i + 1}`, botWalletAddress(`old_handle_${i + 1}`))] }));
  const convergedUsers = () => planned.map((b, i) => ({ id: b.userId, handle: b.handle, wallets: [wallet(`w${i + 1}`, b.address)] }));

  function mockIdentityDb(users: unknown[], opts: { handleOwners?: unknown[]; addressOwners?: unknown[] } = {}) {
    mocks.db.league.findUniqueOrThrow.mockResolvedValue({ id: "L1", weekStart: WEEK_START });
    mocks.db.leagueAccount.findUnique.mockResolvedValue({ id: "acct_bot", equityUsd: "10100" });
    mocks.db.leagueTrade.count.mockResolvedValue(4);
    mocks.db.user.findMany.mockImplementation(async (args: { where: { id?: unknown } }) => (args.where.id ? users : (opts.handleOwners ?? [])));
    mocks.db.wallet.findMany.mockResolvedValue(opts.addressOwners ?? []);
    mocks.db.user.update.mockImplementation(async (args: { where: { id: string } }) => ({ id: args.where.id }));
    mocks.db.wallet.update.mockImplementation(async (args: { where: { id: string } }) => ({ id: args.where.id }));
  }

  function expectNoLeagueWrites() {
    expect(mocks.db.leagueAccount.create).not.toHaveBeenCalled();
    expect(mocks.db.leagueAccount.update).not.toHaveBeenCalled();
    expect(mocks.db.leagueAccount.upsert).not.toHaveBeenCalled();
    expect(mocks.db.leagueTrade.create).not.toHaveBeenCalled();
    expect(mocks.db.leagueTrade.createMany).not.toHaveBeenCalled();
    expect(mocks.db.user.upsert).not.toHaveBeenCalled();
    expect(mocks.db.wallet.upsert).not.toHaveBeenCalled();
  }

  it("plans bot-league-(n+1) as BOT_HANDLES[n] with the wallet derived from that handle", () => {
    expect(planned).toHaveLength(BOT_HANDLES.length);
    expect(planned[0]).toEqual({ userId: "bot-league-1", handle: "balanced_index", address: botWalletAddress("balanced_index") });
    expect(planned[14]).toEqual({ userId: "bot-league-15", handle: "long_horizon", address: botWalletAddress("long_horizon") });
  });

  it("plans nothing for bots that already match, and leaves bots without a User to the create path", () => {
    expect(planBotIdentitySync(planned, { users: convergedUsers(), ...none })).toEqual({ writes: [], skipped: [] });
    expect(planBotIdentitySync(planned, { users: [], ...none })).toEqual({ writes: [], skipped: [] });
  });

  it("renames a stale bot's handle and re-points its wallet at the new derived address", () => {
    const users = [{ id: "bot-league-1", handle: "gamma_squeeze", wallets: [wallet("w1", botWalletAddress("gamma_squeeze"))] }];
    expect(planBotIdentitySync(planned, { users, ...none })).toEqual({
      writes: [
        { kind: "handle", userId: "bot-league-1", from: "gamma_squeeze", to: "balanced_index" },
        { kind: "wallet_address", userId: "bot-league-1", walletId: "w1", from: botWalletAddress("gamma_squeeze"), to: botWalletAddress("balanced_index") },
      ],
      skipped: [],
    });
  });

  it("never takes a handle or an address held by a real user; the other field still moves", () => {
    const users = [{ id: "bot-league-1", handle: "gamma_squeeze", wallets: [wallet("w1", botWalletAddress("gamma_squeeze"))] }];
    const handleTaken = planBotIdentitySync(planned, { users, handleOwners: [{ id: "u_real", handle: "balanced_index" }], addressOwners: [] });
    expect(handleTaken.writes.map((w) => w.kind)).toEqual(["wallet_address"]);
    expect(handleTaken.skipped).toEqual([{ userId: "bot-league-1", field: "handle", target: "balanced_index", reason: "held by another user" }]);

    const addressTaken = planBotIdentitySync(planned, {
      users,
      handleOwners: [],
      addressOwners: [{ id: "w_real", userId: "u_real", address: botWalletAddress("balanced_index") }],
    });
    expect(addressTaken.writes.map((w) => w.kind)).toEqual(["handle"]);
    expect(addressTaken.skipped).toEqual([
      { userId: "bot-league-1", field: "wallet", target: botWalletAddress("balanced_index"), reason: "held by another user" },
    ]);
  });

  it("resolves a rename chain in any order: a bot waits for the bot vacating its new handle and address", () => {
    const users = [
      { id: "bot-league-1", handle: "gamma_squeeze", wallets: [wallet("w1", botWalletAddress("gamma_squeeze"))] },
      // bot-league-2 still holds bot-league-1's planned handle and address.
      { id: "bot-league-2", handle: "balanced_index", wallets: [wallet("w2", botWalletAddress("balanced_index"))] },
    ];
    const r = planBotIdentitySync(planned, { users, ...none });
    expect(r.skipped).toEqual([]);
    expect(r.writes.map((w) => [w.kind, w.userId])).toEqual([
      ["handle", "bot-league-2"],
      ["wallet_address", "bot-league-2"],
      ["handle", "bot-league-1"],
      ["wallet_address", "bot-league-1"],
    ]);
  });

  it("reports a swap cycle as skipped instead of forcing it", () => {
    const users = [
      { id: "bot-league-1", handle: "value_tilt", wallets: [wallet("w1", botWalletAddress("value_tilt"))] },
      { id: "bot-league-2", handle: "balanced_index", wallets: [wallet("w2", botWalletAddress("balanced_index"))] },
    ];
    const r = planBotIdentitySync(planned, { users, ...none });
    expect(r.writes).toEqual([]);
    expect(r.skipped).toHaveLength(4);
    expect(r.skipped.every((s) => /rename cycle/.test(s.reason))).toBe(true);
  });

  it("makes the wallet at the planned address the only primary one (stale wallets are demoted, not deleted)", () => {
    const stale = botWalletAddress("gamma_squeeze");
    const fresh = botWalletAddress("balanced_index");
    const users = [{ id: "bot-league-1", handle: "balanced_index", wallets: [wallet("w_old", stale, true), wallet("w_new", fresh, false, LATER)] }];
    expect(planBotIdentitySync(planned, { users, ...none }).writes).toEqual([
      { kind: "wallet_primary", userId: "bot-league-1", walletId: "w_new", address: fresh, isPrimary: true },
      { kind: "wallet_primary", userId: "bot-league-1", walletId: "w_old", address: stale, isPrimary: false },
    ]);
  });

  it("creates a wallet for a bot User without one and re-points the oldest wallet when none is primary", () => {
    const users = [
      { id: "bot-league-1", handle: "balanced_index", wallets: [] },
      { id: "bot-league-2", handle: "value_tilt", wallets: [wallet("w_b", botWalletAddress("x_b"), false, LATER), wallet("w_a", botWalletAddress("x_a"), false, T0)] },
    ];
    const r = planBotIdentitySync(planned, { users, ...none });
    expect(r.writes).toEqual([
      { kind: "wallet_create", userId: "bot-league-1", to: botWalletAddress("balanced_index") },
      { kind: "wallet_address", userId: "bot-league-2", walletId: "w_a", from: botWalletAddress("x_a"), to: botWalletAddress("value_tilt") },
    ]);
  });

  it("seedBots converges existing bots' handles and wallets without touching accounts, trades, cash, equity or ranks", async () => {
    mockIdentityDb(staleUsers());

    const out = await seedBots(mocks.db as never, "L1", MON);

    expect(mocks.db.user.update).toHaveBeenCalledTimes(BOT_HANDLES.length);
    expect(mocks.db.user.update.mock.calls[0][0]).toMatchObject({ where: { id: "bot-league-1" }, data: { handle: "balanced_index" } });
    expect(mocks.db.user.update.mock.calls.map((c) => c[0].data.handle)).toEqual([...BOT_HANDLES]);
    expect(mocks.db.wallet.update).toHaveBeenCalledTimes(BOT_HANDLES.length);
    expect(mocks.db.wallet.update.mock.calls[0][0]).toMatchObject({ where: { id: "w1" }, data: { address: botWalletAddress("balanced_index"), isPrimary: true } });
    expect(mocks.db.wallet.update.mock.calls.map((c) => c[0].data.address)).toEqual(planned.map((b) => b.address));
    // Only the identity columns are written.
    for (const c of mocks.db.user.update.mock.calls) expect(Object.keys(c[0].data)).toEqual(["handle"]);
    for (const c of mocks.db.wallet.update.mock.calls) expect(Object.keys(c[0].data).sort()).toEqual(["address", "isPrimary"]);
    expect(mocks.db.wallet.create).not.toHaveBeenCalled();
    expectNoLeagueWrites();

    expect(out.every((b) => !b.created && b.trades === 4 && b.equityUsd === 10100)).toBe(true);
    expect(out[0].identity).toEqual(["handle old_handle_1 → balanced_index", expect.stringMatching(/^wallet \S+ → \S+$/)]);
  });

  it("seedBots is cheap and idempotent once converged: one read, no writes", async () => {
    mockIdentityDb(convergedUsers());

    const out = await seedBots(mocks.db as never, "L1", MON);

    expect(mocks.db.user.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.wallet.findMany).not.toHaveBeenCalled();
    expect(mocks.db.user.update).not.toHaveBeenCalled();
    expect(mocks.db.wallet.update).not.toHaveBeenCalled();
    expect(mocks.db.wallet.create).not.toHaveBeenCalled();
    expectNoLeagueWrites();
    expect(out.every((b) => b.identity.length === 0)).toBe(true);
  });

  it("seedBots skips a wallet address held by a real user and survives a unique-key race on another", async () => {
    mockIdentityDb(staleUsers(), { addressOwners: [{ id: "w_real", userId: "u_real", address: planned[0].address }] });
    mocks.db.wallet.update.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === "w2") throw Object.assign(new Error("Unique constraint failed on the fields: (`chainId`,`address`)"), { code: "P2002" });
      return { id: args.where.id };
    });

    const out = await seedBots(mocks.db as never, "L1", MON);

    const movedWallets = mocks.db.wallet.update.mock.calls.map((c) => c[0].where.id as string);
    expect(movedWallets).not.toContain("w1");
    expect(movedWallets).toContain("w2");
    expect(movedWallets).toHaveLength(BOT_HANDLES.length - 1);
    expect(mocks.db.user.update).toHaveBeenCalledTimes(BOT_HANDLES.length);
    expect(out[0].identity).toEqual(["handle old_handle_1 → balanced_index", "wallet kept (held by another user)"]);
    expect(out[1].identity).toEqual(["handle old_handle_2 → value_tilt", "wallet kept (unique key taken concurrently)"]);
    expect(out[2].identity).toHaveLength(2);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/bot-league-1: wallet not moved .*held by another user/));
    expectNoLeagueWrites();
  });

  it("seedBots rethrows a database error that is not a unique-key clash", async () => {
    mockIdentityDb(staleUsers());
    mocks.db.user.update.mockRejectedValue(new Error("connection reset"));
    await expect(seedBots(mocks.db as never, "L1", MON)).rejects.toThrow("connection reset");
    expect(mocks.db.leagueAccount.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// League views: weekend state (C6) and the inline Play evaluation (C5)
// ---------------------------------------------------------------------------

describe("toLeagueView + countdown helpers (C6)", () => {
  it("a weekend League is open, counts down to its Friday close and has no opensIn", () => {
    const v = toLeagueView(NEXT_LEAGUE, SAT);
    expect(v).toMatchObject({ id: "L2", status: "open", open: true, opensIn: null, closesIn: NEXT_LEAGUE.weekEnd.getTime() - SAT.getTime() });
    expect(isPreWeek(v, SAT.toISOString())).toBe(true);
    expect(isPreWeek(toLeagueView(OPEN_LEAGUE, MON), MON.toISOString())).toBe(false);
    expect(nextOpenIso(v)).toBeNull();
    expect(countdownTarget(v)).toBe(NEXT_LEAGUE.weekEnd.toISOString());
  });

  it("a settled League is closed and the next League takes trades from its close", () => {
    const v = toLeagueView({ ...OPEN_LEAGUE, status: "settled" }, MON);
    expect(v).toMatchObject({ status: "settled", open: false, closesIn: null, opensIn: null });
    expect(nextOpenIso(v)).toBe(WEEK_END.toISOString());
    expect(countdownTarget(v)).toBe(WEEK_END.toISOString());
    expect(isPreWeek(v, null)).toBe(false);
    expect(isPreWeek({ weekStart: "garbage" }, SAT.toISOString())).toBe(false);
  });
});

describe("evaluateLeaguePlays (C5)", () => {
  const SCOUT_ROW = { key: "scout", title: "Scout", points: 50, badgeKey: null, rule: { type: "internal_event", event: "league_trade", count: 3 } };
  const ORACLE_ROW = { key: "oracle", title: "Oracle", points: 50, badgeKey: null, rule: { type: "internal_event", event: "call_placed", count: 1 } };
  const BROKEN_ROW = { key: "broken", title: "Broken", points: 10, badgeKey: null, rule: { type: "nope" } };

  it("isLeagueTradeRule matches internal_event league_trade and game_action rules only", () => {
    expect([...LEAGUE_TRADE_EVENTS].sort()).toEqual(["game_action", "league_trade"]);
    expect(isLeagueTradeRule(SCOUT_ROW.rule)).toBe(true);
    // A paper trade also emits game_action (lib/cron/evaluate), so Three Game Days completes inline.
    expect(isLeagueTradeRule({ type: "internal_event", event: "game_action", count: 3 })).toBe(true);
    expect(isLeagueTradeRule(ORACLE_ROW.rule)).toBe(false);
    expect(isLeagueTradeRule({ type: "internal_event", event: "mirror_executed", count: 1 })).toBe(false);
    expect(isLeagueTradeRule({ type: "hold_any", minUsd: 5 })).toBe(false);
    expect(isLeagueTradeRule(BROKEN_ROW.rule)).toBe(false);
    expect(isLeagueTradeRule(null)).toBe(false);
  });

  it("evaluates only League-trade Plays, DB-only, and returns what this trade completed", async () => {
    mocks.db.play.findMany.mockResolvedValue([SCOUT_ROW, ORACLE_ROW, BROKEN_ROW]);
    mocks.evaluateUser.mockResolvedValue({ plays: [{ key: "scout", status: "complete", newlyCompleted: true, awarded: true, badge: false }] });

    const r = await evaluateLeaguePlays("u_me", MON);

    expect(r).toEqual({ completed: [{ key: "scout", title: "Scout", points: 50 }], timedOut: false, pending: null });
    expect(mocks.db.play.findMany.mock.calls[0][0].where).toEqual({ isActive: true, campaign: { seasonId: "season-0" } });
    expect(mocks.evaluateUser).toHaveBeenCalledTimes(1);
    const [userId, now, ctx, opts] = mocks.evaluateUser.mock.calls[0];
    expect([userId, now, ctx]).toEqual(["u_me", MON, undefined]);
    expect(opts).toMatchObject({ season: { id: "season-0" }, plays: [SCOUT_ROW], historyDays: 0 });
    // No catalogue fetch: internal_event rules never read sectors.
    expect(opts.catalogue.sectorOf(TSLAX_ID)).toBeNull();
    expect(opts.catalogue.underlyingOf(TSLAX_ID)).toBeNull();
    expect(INLINE_EVALUATE_TIMEOUT_MS).toBeLessThanOrEqual(3_000);
  });

  it("reports nothing when the Play was already complete or is still in progress", async () => {
    mocks.db.play.findMany.mockResolvedValue([SCOUT_ROW]);
    mocks.evaluateUser.mockResolvedValue({ plays: [{ key: "scout", status: "complete", newlyCompleted: false, awarded: false, badge: false }] });
    expect((await evaluateLeaguePlays("u_me", MON)).completed).toEqual([]);
    mocks.evaluateUser.mockResolvedValue({ plays: [{ key: "scout", status: "in_progress", newlyCompleted: false, awarded: false, badge: false }] });
    expect((await evaluateLeaguePlays("u_me", MON)).completed).toEqual([]);
  });

  it("reports a completed quest only when this run awarded its points", async () => {
    mocks.db.play.findMany.mockResolvedValue([SCOUT_ROW]);
    // Completed now, but the PointsEvent already existed (P2002): no second toast.
    mocks.evaluateUser.mockResolvedValue({ plays: [{ key: "scout", status: "complete", newlyCompleted: true, awarded: false, badge: false }] });
    expect((await evaluateLeaguePlays("u_me", MON)).completed).toEqual([]);
  });

  it("skips the evaluation without a Season or without a League-trade Play", async () => {
    mocks.db.season.findFirst.mockResolvedValue(null);
    expect(await evaluateLeaguePlays("u_me", MON)).toEqual({ completed: [], timedOut: false, pending: null });
    expect(mocks.db.play.findMany).not.toHaveBeenCalled();

    setDefaults();
    mocks.db.play.findMany.mockResolvedValue([ORACLE_ROW]);
    expect((await evaluateLeaguePlays("u_me", MON)).completed).toEqual([]);
    expect(mocks.evaluateUser).not.toHaveBeenCalled();
  });

  it("never throws: a failure is logged and the trade response carries no Plays", async () => {
    mocks.db.play.findMany.mockResolvedValue([SCOUT_ROW]);
    mocks.evaluateUser.mockRejectedValue(new Error("pool exhausted"));
    expect(await evaluateLeaguePlays("u_me", MON)).toEqual({ completed: [], timedOut: false, pending: null });
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/pool exhausted/));
  });

  it("past its budget answers timedOut and hands back the still-running work for after()", async () => {
    mocks.db.play.findMany.mockResolvedValue([SCOUT_ROW]);
    let finish: (v: unknown) => void = () => undefined;
    mocks.evaluateUser.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    const r = await evaluateLeaguePlays("u_me", MON, 5);

    expect(r.timedOut).toBe(true);
    expect(r.completed).toEqual([]);
    expect(r.pending).toBeInstanceOf(Promise);
    finish({ plays: [{ key: "scout", status: "complete", newlyCompleted: true, awarded: true, badge: false }] });
    await expect(r.pending).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/completed scout after the 5ms budget/));

    // A late failure is swallowed as well: `pending` never rejects.
    let fail: (e: unknown) => void = () => undefined;
    mocks.evaluateUser.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const late = await evaluateLeaguePlays("u_me", MON, 5);
    fail(new Error("late boom"));
    await expect(late.pending).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/late boom/));
  });
});

describe("Scout chip + toast (C5)", () => {
  const LEAGUE_TRADE_RULE = { type: "internal_event", event: "league_trade", count: 3 } as PlayView["rule"];
  const scoutPlay = (over: Partial<PlayView> = {}): PlayView => ({
    key: "scout",
    title: "Scout",
    desc: "",
    points: 50,
    badgeKey: null,
    rule: LEAGUE_TRADE_RULE,
    status: "in_progress",
    completedAt: null,
    proof: null,
    completions: 0,
    comingSoon: false,
    ...over,
  });
  const board = (plays: PlayView[]): PlaysResponse => ({
    season: null,
    signedIn: true,
    groups: [{ partner: {} as never, campaigns: [{ id: "c", title: "Dulo games", plays }] }],
  });

  it("finds the live League-trade Play by its rule, not its key", () => {
    const oracle = scoutPlay({ key: "oracle", title: "Oracle", rule: { type: "internal_event", event: "call_placed", count: 1 } as PlayView["rule"] });
    expect(findScoutPlay(board([oracle, scoutPlay({ key: "house_scout" })]))?.key).toBe("house_scout");
    expect(findScoutPlay(board([oracle, scoutPlay({ comingSoon: true })]))).toBeNull();
    expect(findScoutPlay(null)).toBeNull();
  });

  it("progress follows the stored proof, never below this week's trades, capped at the target", () => {
    expect(scoutProgress(scoutPlay(), 0)).toEqual({ title: "Scout", points: 50, current: 0, target: 3, complete: false });
    expect(scoutProgress(scoutPlay({ proof: { progress: { current: 2, target: 3 } } }), 1)?.current).toBe(2);
    expect(scoutProgress(scoutPlay({ proof: { progress: { current: 1, target: 3 } } }), 2)?.current).toBe(2);
    expect(scoutProgress(scoutPlay(), 20)?.current).toBe(3);
    expect(scoutProgress(scoutPlay({ status: "complete" }), 0)).toMatchObject({ current: 3, target: 3, complete: true });
    expect(scoutProgress(null, 3)).toBeNull();
  });

  it("toasts 'Quest complete: First Paper Trades · +50 pts', the same shape as the predictions toast", () => {
    expect(completedPlayTitle({ key: "scout", title: "First Paper Trades", points: 50 })).toBe("Quest complete: First Paper Trades · +50 pts");
    expect(completedPlayTitle({ key: "big", title: "Big", points: 1000 })).toBe("Quest complete: Big · +1,000 pts");
  });
});

describe("POST /api/v1/league/trade", () => {
  function request(body: unknown) {
    return new Request("http://localhost:3000/api/v1/league/trade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("refuses a house bot session with a 403 and places no trade", async () => {
    mocks.requireSession.mockResolvedValue({ userId: "bot-league-2" });
    const res = await tradeRoute(request({ symbol: "TSLAx", side: "buy", qty: 1 }), undefined);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "House bot accounts cannot trade here" });
    expect(mocks.getPriceBySymbol).not.toHaveBeenCalled();
    expect(mocks.db.leagueTrade.create).not.toHaveBeenCalled();
    expect(mocks.evaluateUser).not.toHaveBeenCalled();
  });
});
