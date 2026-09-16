import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceQuote } from "@/lib/core";

// ---------------------------------------------------------------------------
// In-memory stand-in for the Prisma calls lib/games/calls makes. Only the query
// shapes calls.ts actually uses are implemented; anything else throws loudly.
// $transaction snapshots the state and restores it when the callback throws, so
// "no partial writes" assertions mean something.
// ---------------------------------------------------------------------------

interface MarketRec {
  id: string;
  seasonId: string;
  ticker: string;
  strike: number;
  settleAt: Date;
  settledPrice: number | null;
  outcome: string | null;
  yesPool: number;
  noPool: number;
  source: string | null;
  createdAt: Date;
}
interface PositionRec {
  marketId: string;
  userId: string;
  side: string;
  points: number;
  createdAt: Date;
}
interface EventRec {
  id: string;
  userId: string;
  seasonId: string;
  source: string;
  ref: string;
  delta: number;
  ts: Date;
}

const P2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

function createFakeDb() {
  const state = {
    markets: [] as MarketRec[],
    positions: [] as PositionRec[],
    events: [] as EventRec[],
    /** Season ids, current first. Empty by default: calls.tick then skips ensureWeeklyMarkets. */
    seasons: [] as string[],
    users: [] as Array<{ id: string; handle: string }>,
    /** User ids with an isBot LeagueAccount. Every planned League bot by default. */
    botAccounts: BOT_HANDLES.map((_, i) => botUserId(i)),
    seq: 0,
  };
  const clock = { now: new Date("2026-09-14T12:00:00.000Z") };

  const findMarket = (id: string) => state.markets.find((m) => m.id === id) ?? null;
  const positionsOf = (marketId: string) => state.positions.filter((p) => p.marketId === marketId);
  const hasEvent = (userId: string, seasonId: string, ref: string) =>
    state.events.some((e) => e.userId === userId && e.seasonId === seasonId && e.ref === ref);

  const inList = (v: string, where: string | { in: string[] } | undefined) =>
    where === undefined || (typeof where === "string" ? v === where : where.in.includes(v));

  const db = {
    season: {
      // findCurrentSeasonId: the active Season, else the latest one. Both lookups get the first id.
      findFirst: vi.fn(async () => (state.seasons.length > 0 ? { id: state.seasons[0] } : null)),
    },
    user: {
      upsert: vi.fn(async (args: { where: { id: string }; create: { id: string; handle: string }; update: object }) => {
        const existing = state.users.find((u) => u.id === args.where.id);
        if (existing) return { ...existing };
        state.users.push({ ...args.create });
        return { ...args.create };
      }),
    },
    market: {
      findFirst: vi.fn(async (args: { where: { seasonId: string; ticker: string; settleAt: Date } }) => {
        const w = args.where;
        const m = state.markets.find((x) => x.seasonId === w.seasonId && x.ticker === w.ticker && x.settleAt.getTime() === w.settleAt.getTime());
        return m ? { ...m } : null;
      }),
      findUnique: vi.fn(async (args: { where: { id: string }; include?: { positions?: boolean } }) => {
        const m = findMarket(args.where.id);
        if (!m) return null;
        return args.include?.positions ? { ...m, positions: positionsOf(m.id).map((p) => ({ ...p })) } : { ...m };
      }),
      findMany: vi.fn(async (args: { where: { seasonId?: string; outcome?: null; settleAt?: { lt: Date } } }) => {
        const w = args.where;
        return state.markets
          .filter((m) => (w.seasonId === undefined || m.seasonId === w.seasonId) && (w.outcome === undefined || m.outcome === null))
          .filter((m) => !w.settleAt || m.settleAt.getTime() < w.settleAt.lt.getTime())
          .map((m) => ({ ...m }));
      }),
      create: vi.fn(async (args: { data: { seasonId: string; ticker: string; strike: number; settleAt: Date } }) => {
        const d = args.data;
        // @@unique([seasonId, ticker, settleAt])
        if (state.markets.some((x) => x.seasonId === d.seasonId && x.ticker === d.ticker && x.settleAt.getTime() === d.settleAt.getTime())) {
          throw P2002();
        }
        const m: MarketRec = {
          id: `m${++state.seq}`,
          ...args.data,
          settledPrice: null,
          outcome: null,
          yesPool: 0,
          noPool: 0,
          source: null,
          createdAt: clock.now,
        };
        state.markets.push(m);
        return { ...m };
      }),
      updateMany: vi.fn(async (args: { where: { id: string; outcome?: null }; data: Partial<MarketRec> }) => {
        const m = findMarket(args.where.id);
        if (!m || ("outcome" in args.where && m.outcome !== null)) return { count: 0 };
        Object.assign(m, args.data);
        return { count: 1 };
      }),
      update: vi.fn(async (args: { where: { id: string }; data: { yesPool?: { increment: number }; noPool?: { increment: number } } }) => {
        const m = findMarket(args.where.id);
        if (!m) throw new Error("market missing");
        if (args.data.yesPool) m.yesPool += args.data.yesPool.increment;
        if (args.data.noPool) m.noPool += args.data.noPool.increment;
        return { ...m };
      }),
    },
    leagueAccount: {
      // seedCallStakes: which planned bots have an isBot LeagueAccount.
      findMany: vi.fn(async (args: { where: { isBot: boolean; userId: { in: string[] } } }) =>
        args.where.isBot ? state.botAccounts.filter((u) => inList(u, args.where.userId)).map((userId) => ({ userId })) : [],
      ),
    },
    position: {
      findMany: vi.fn(async (args: { where: { userId?: string | { in: string[] }; marketId?: string | { in: string[] } } }) =>
        state.positions.filter((p) => inList(p.userId, args.where.userId) && inList(p.marketId, args.where.marketId)).map((p) => ({ ...p })),
      ),
      findFirst: vi.fn(async (args: { where: { marketId: string; userId: string } }) => {
        const p = state.positions.find((x) => x.marketId === args.where.marketId && x.userId === args.where.userId);
        return p ? { side: p.side } : null;
      }),
      count: vi.fn(async (args: { where: { marketId: string } }) => positionsOf(args.where.marketId).length),
      upsert: vi.fn(
        async (args: {
          where: { marketId_userId_side: { marketId: string; userId: string; side: string } };
          create: { marketId: string; userId: string; side: string; points: number };
          update: { points: { increment: number } };
        }) => {
          const k = args.where.marketId_userId_side;
          const existing = state.positions.find((p) => p.marketId === k.marketId && p.userId === k.userId && p.side === k.side);
          if (existing) {
            existing.points += args.update.points.increment;
            return { ...existing };
          }
          const created: PositionRec = { ...args.create, createdAt: clock.now };
          state.positions.push(created);
          return { ...created };
        },
      ),
    },
    pointsEvent: {
      aggregate: vi.fn(async (args: { where: { userId: string; seasonId: string } }) => {
        const rows = state.events.filter((e) => e.userId === args.where.userId && e.seasonId === args.where.seasonId);
        return { _sum: { delta: rows.length ? rows.reduce((s, e) => s + e.delta, 0) : null } };
      }),
      count: vi.fn(async (args: { where: { userId: string; seasonId: string; ref: { startsWith: string } } }) =>
        state.events.filter(
          (e) => e.userId === args.where.userId && e.seasonId === args.where.seasonId && e.ref.startsWith(args.where.ref.startsWith),
        ).length,
      ),
      create: vi.fn(async (args: { data: Omit<EventRec, "id" | "ts"> }) => {
        if (hasEvent(args.data.userId, args.data.seasonId, args.data.ref)) throw P2002();
        const e: EventRec = { id: `e${++state.seq}`, ts: clock.now, ...args.data };
        state.events.push(e);
        return { ...e };
      }),
      createMany: vi.fn(async (args: { data: Array<Omit<EventRec, "id" | "ts">>; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const d of args.data) {
          if (hasEvent(d.userId, d.seasonId, d.ref)) {
            if (args.skipDuplicates) continue;
            throw P2002();
          }
          state.events.push({ id: `e${++state.seq}`, ts: clock.now, ...d });
          count += 1;
        }
        return { count };
      }),
      findMany: vi.fn(async (args: { where: { userId: string; seasonId: string; source: string } }) =>
        state.events
          .filter((e) => e.userId === args.where.userId && e.seasonId === args.where.seasonId && e.source === args.where.source)
          .map((e) => ({ ref: e.ref, delta: e.delta })),
      ),
    },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone(state);
      try {
        return await fn(db);
      } catch (e) {
        Object.assign(state, snapshot);
        throw e;
      }
    }),
  };

  /** Seed helpers. */
  const seedMarket = (over: Partial<MarketRec> = {}): MarketRec => {
    const m: MarketRec = {
      id: `m${++state.seq}`,
      seasonId: "season-0",
      ticker: "NVDA",
      strike: 210,
      settleAt: new Date("2026-09-18T20:05:00.000Z"),
      settledPrice: null,
      outcome: null,
      yesPool: 0,
      noPool: 0,
      source: null,
      createdAt: clock.now,
      ...over,
    };
    state.markets.push(m);
    return m;
  };
  const givePoints = (userId: string, delta: number, ref = `play:seed:${userId}:${++state.seq}`, seasonId = "season-0") => {
    state.events.push({ id: `e${++state.seq}`, userId, seasonId, source: "play", ref, delta, ts: clock.now });
  };
  const eventsFor = (userId: string) => state.events.filter((e) => e.userId === userId).map((e) => ({ ref: e.ref, delta: e.delta }));
  const balance = (userId: string) => state.events.filter((e) => e.userId === userId).reduce((s, e) => s + e.delta, 0);

  return { db, state, clock, seedMarket, givePoints, eventsFor, balance };
}

const fake = vi.hoisted(() => ({ current: null as null | ReturnType<typeof createFakeDb> }));

const priceMocks = vi.hoisted(() => ({
  getPriceBySymbol: vi.fn(),
  getPricesBySymbols: vi.fn(),
}));
const pythMocks = vi.hoisted(() => ({
  resolvePythFeedId: vi.fn(),
  fetchPythLatest: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  get db() {
    if (!fake.current) throw new Error("fake db not initialised");
    return fake.current.db;
  },
}));
vi.mock("@/lib/price", () => ({
  getPriceBySymbol: priceMocks.getPriceBySymbol,
  getPricesBySymbols: priceMocks.getPricesBySymbols,
  UnknownAssetError: class UnknownAssetError extends Error {},
}));
vi.mock("@/lib/prices/pyth", () => ({
  resolvePythFeedId: pythMocks.resolvePythFeedId,
  fetchPythLatest: pythMocks.fetchPythLatest,
}));

import { BOT_HANDLES, botUserId } from "@/lib/games/league";
import {
  AlreadyStakedError,
  CallsError,
  LOCK_BEFORE_SETTLE_MS,
  VOID_AFTER_MS,
  calls,
  createMarket,
  ensureWeeklyMarkets,
  fridaySettleAt,
  getCallMarket,
  getCallsBoard,
  marketStatus,
  mondayOpenStrike,
  payoutRef,
  placeCall,
  refundRef,
  seedCallStakes,
  settleMarket,
  sortMarkets,
  stakeRef,
  tick,
} from "@/lib/games/calls";
import { POOL_TILTS, SEED_CALL_TICKERS, planBotStakes, seedGrantRef } from "@/lib/games/calls-seed";

const SETTLE_AT = new Date("2026-09-18T20:05:00.000Z");
const MONDAY = new Date("2026-09-14T12:00:00.000Z");
const AFTER_SETTLE = new Date("2026-09-18T20:10:00.000Z");
const NVDA_FEED = "aa".repeat(32);

function quote(symbol: string, price: number | null, over: Partial<PriceQuote> = {}): PriceQuote {
  return {
    assetId: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:Xs${symbol}`,
    symbol,
    price,
    source: price === null ? "none" : "jupiter",
    publishedAt: price === null ? null : new Date("2026-09-18T20:07:00.000Z"),
    ageSeconds: price === null ? null : 180,
    stale: price === null,
    marketOpen: false,
    ...over,
  } as PriceQuote;
}

let f: ReturnType<typeof createFakeDb>;

beforeEach(() => {
  f = createFakeDb();
  fake.current = f;
  priceMocks.getPriceBySymbol.mockReset();
  priceMocks.getPricesBySymbols.mockReset();
  pythMocks.resolvePythFeedId.mockReset();
  pythMocks.fetchPythLatest.mockReset();
  // Defaults: Pyth unknown, Jupiter quotes nothing, board quotes empty.
  pythMocks.resolvePythFeedId.mockResolvedValue(null);
  pythMocks.fetchPythLatest.mockResolvedValue(new Map());
  priceMocks.getPriceBySymbol.mockResolvedValue(quote("NVDAx", null));
  priceMocks.getPricesBySymbols.mockResolvedValue({ quotes: [], unknown: [] });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("fridaySettleAt", () => {
  it("is the Friday close + 5 min of the current ISO week: 20:05 UTC while EDT holds", () => {
    expect(fridaySettleAt(MONDAY).toISOString()).toBe("2026-09-18T20:05:00.000Z");
    expect(fridaySettleAt(new Date("2026-09-18T19:00:00.000Z")).toISOString()).toBe("2026-09-18T20:05:00.000Z");
  });

  it("rolls to next week once this Friday's settle has passed", () => {
    expect(fridaySettleAt(new Date("2026-09-18T20:05:00.000Z")).toISOString()).toBe("2026-09-25T20:05:00.000Z");
    expect(fridaySettleAt(new Date("2026-09-19T09:00:00.000Z")).toISOString()).toBe("2026-09-25T20:05:00.000Z");
    expect(fridaySettleAt(new Date("2026-09-20T23:59:59.000Z")).toISOString()).toBe("2026-09-25T20:05:00.000Z");
  });

  it("follows the ET clock: 21:05 UTC under EST and 18:05 UTC on an early-close Friday", () => {
    expect(fridaySettleAt(new Date("2026-11-10T12:00:00.000Z")).toISOString()).toBe("2026-11-13T21:05:00.000Z");
    // Fri 27 Nov 2026 (day after Thanksgiving) closes 13:00 ET.
    expect(fridaySettleAt(new Date("2026-11-23T12:00:00.000Z")).toISOString()).toBe("2026-11-27T18:05:00.000Z");
  });
});

describe("mondayOpenStrike", () => {
  it("rounds the live xStock quote to 2 decimals", async () => {
    priceMocks.getPriceBySymbol.mockResolvedValueOnce(quote("NVDAx", 210.456));
    expect(await mondayOpenStrike("NVDA")).toBe(210.46);
    expect(priceMocks.getPriceBySymbol).toHaveBeenCalledWith("NVDAx");
  });

  it("is null when there is no price or the symbol is unknown", async () => {
    priceMocks.getPriceBySymbol.mockResolvedValueOnce(quote("NVDAx", null));
    expect(await mondayOpenStrike("NVDA")).toBeNull();
    priceMocks.getPriceBySymbol.mockRejectedValueOnce(new Error("Unknown asset: NVDAx"));
    expect(await mondayOpenStrike("NVDA")).toBeNull();
  });
});

describe("marketStatus / sortMarkets / refs", () => {
  it("classifies open, locked, settled and void", () => {
    const m = { settleAt: SETTLE_AT, outcome: null as string | null };
    expect(marketStatus(m, MONDAY)).toBe("open");
    expect(marketStatus(m, new Date(SETTLE_AT.getTime() - LOCK_BEFORE_SETTLE_MS - 1))).toBe("open");
    expect(marketStatus(m, new Date(SETTLE_AT.getTime() - LOCK_BEFORE_SETTLE_MS))).toBe("locked");
    expect(marketStatus(m, AFTER_SETTLE)).toBe("locked");
    expect(marketStatus({ ...m, outcome: "yes" }, AFTER_SETTLE)).toBe("settled");
    expect(marketStatus({ ...m, outcome: "void" }, AFTER_SETTLE)).toBe("void");
  });

  it("orders open markets soonest first, then settled newest first", () => {
    const d = (s: string) => new Date(s);
    const out = sortMarkets([
      { outcome: "yes", settleAt: d("2026-09-11T20:05:00Z"), ticker: "TSLA" },
      { outcome: null, settleAt: d("2026-09-25T20:05:00Z"), ticker: "SPY" },
      { outcome: null, settleAt: d("2026-09-18T20:05:00Z"), ticker: "NVDA" },
      { outcome: "no", settleAt: d("2026-09-04T20:05:00Z"), ticker: "NVDA" },
      { outcome: null, settleAt: d("2026-09-18T20:05:00Z"), ticker: "AAPL" },
    ]);
    expect(out.map((m) => `${m.ticker}:${m.settleAt.toISOString().slice(5, 10)}`)).toEqual([
      "AAPL:09-18",
      "NVDA:09-18",
      "SPY:09-25",
      "TSLA:09-11",
      "NVDA:09-04",
    ]);
  });

  it("builds the ledger refs the spec names", () => {
    expect(stakeRef("m1", "u1", "yes")).toBe("call:m1:stake:u1:yes");
    expect(stakeRef("m1", "u1", "yes", 2)).toBe("call:m1:stake:u1:yes:2");
    expect(payoutRef("m1", "u1")).toBe("call:m1:payout:u1");
    expect(refundRef("m1", "u1", "no")).toBe("call:m1:refund:u1:no");
  });
});

// ---------------------------------------------------------------------------
// createMarket
// ---------------------------------------------------------------------------

describe("createMarket", () => {
  it("normalises the ticker and writes the row", async () => {
    const m = await createMarket({ seasonId: "season-0", ticker: " nvda ", strike: 210, settleAt: SETTLE_AT });
    expect(m).toMatchObject({ ticker: "NVDA", strike: 210, yesPool: 0, noPool: 0, outcome: null });
  });

  it("rejects bad input", async () => {
    await expect(createMarket({ seasonId: "s", ticker: "nv da", strike: 1, settleAt: SETTLE_AT })).rejects.toBeInstanceOf(CallsError);
    await expect(createMarket({ seasonId: "s", ticker: "NVDA", strike: 0, settleAt: SETTLE_AT })).rejects.toBeInstanceOf(CallsError);
    await expect(createMarket({ seasonId: "s", ticker: "NVDA", strike: 1, settleAt: new Date("x") })).rejects.toBeInstanceOf(CallsError);
  });
});

// ---------------------------------------------------------------------------
// placeCall
// ---------------------------------------------------------------------------

describe("placeCall", () => {
  it("validates side and points before touching the database", async () => {
    f.seedMarket({ id: "m1" });
    for (const points of [9, 5001, 100.5, Number.NaN]) {
      await expect(placeCall({ userId: "u1", marketId: "m1", side: "yes", points })).rejects.toMatchObject({ status: 400 });
    }
    await expect(placeCall({ userId: "u1", marketId: "m1", side: "maybe" as "yes", points: 100 })).rejects.toMatchObject({ status: 400 });
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it("escrows the stake in the ledger, upserts the position and grows the pool in one transaction", async () => {
    f.seedMarket({ id: "m1" });
    f.givePoints("u1", 500);

    const r = await placeCall({ userId: "u1", marketId: "m1", side: "yes", points: 100 }, MONDAY);
    expect(r.position).toMatchObject({ marketId: "m1", userId: "u1", side: "yes", points: 100 });
    expect(r.market).toMatchObject({ yesPool: 100, noPool: 0 });
    expect(r.odds).toMatchObject({ yesProb: 1, yesMultiplier: 1, noMultiplier: null });
    expect(r.spendablePoints).toBe(400);
    expect(f.eventsFor("u1")).toContainEqual({ ref: "call:m1:stake:u1:yes", delta: -100 });
    expect(f.balance("u1")).toBe(400);
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.db.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("spendable points = Σ ledger, so stakes are subtracted once and never twice", async () => {
    f.seedMarket({ id: "m1" });
    f.seedMarket({ id: "m2", ticker: "TSLA", strike: 360 });
    f.givePoints("u1", 300);
    await placeCall({ userId: "u1", marketId: "m1", side: "yes", points: 100 }, MONDAY);
    await placeCall({ userId: "u1", marketId: "m2", side: "no", points: 150 }, MONDAY);
    // 300 - 100 - 150 = 50 left: a 60-point stake must fail, a 50-point stake must pass.
    await expect(placeCall({ userId: "u1", marketId: "m1", side: "yes", points: 60 }, MONDAY)).rejects.toMatchObject({
      message: "Not enough points: you have 50, this prediction needs 60. Earn more in the weekly competition (virtual cash) or from quests.",
      status: 409,
    });
    const r = await placeCall({ userId: "u1", marketId: "m1", side: "yes", points: 50 }, MONDAY);
    expect(r.spendablePoints).toBe(0);
    expect(f.balance("u1")).toBe(0);
  });

  it("tops up an existing side with a new ledger ref and a bigger position", async () => {
    f.seedMarket({ id: "m1" });
    f.givePoints("u1", 500);
    await placeCall({ userId: "u1", marketId: "m1", side: "yes", points: 100 }, MONDAY);
    const r = await placeCall({ userId: "u1", marketId: "m1", side: "yes", points: 50 }, MONDAY);
    expect(r.position.points).toBe(150);
    expect(r.market.yesPool).toBe(150);
    expect(f.state.positions).toHaveLength(1);
    expect(f.eventsFor("u1").filter((e) => e.ref.startsWith("call:m1:stake:u1:yes"))).toEqual([
      { ref: "call:m1:stake:u1:yes", delta: -100 },
      { ref: "call:m1:stake:u1:yes:2", delta: -50 },
    ]);
    expect(f.balance("u1")).toBe(350);
  });

  it("refuses when points are short and leaves nothing behind", async () => {
    f.seedMarket({ id: "m1" });
    f.givePoints("u1", 50);
    await expect(placeCall({ userId: "u1", marketId: "m1", side: "no", points: 100 }, MONDAY)).rejects.toMatchObject({
      message: "Not enough points: you have 50, this prediction needs 100. Earn more in the weekly competition (virtual cash) or from quests.",
      status: 409,
    });
    expect(f.state.positions).toHaveLength(0);
    expect(f.state.markets[0]).toMatchObject({ yesPool: 0, noPool: 0 });
    expect(f.balance("u1")).toBe(50);
  });

  it("a user with no ledger at all has 0 spendable points, and the 409 says where points come from", async () => {
    f.seedMarket({ id: "m1" });
    await expect(placeCall({ userId: "nobody", marketId: "m1", side: "yes", points: 10 }, MONDAY)).rejects.toMatchObject({
      message: "Not enough points: you have 0, this prediction needs 10. Earn more in the weekly competition (virtual cash) or from quests.",
    });
    f.givePoints("rich", 9000);
    await placeCall({ userId: "rich", marketId: "m1", side: "yes", points: 5000 }, MONDAY);
    await placeCall({ userId: "rich", marketId: "m1", side: "no", points: 3000 }, MONDAY);
    await expect(placeCall({ userId: "rich", marketId: "m1", side: "no", points: 1500 }, MONDAY)).rejects.toMatchObject({
      message: "Not enough points: you have 1,000, this prediction needs 1,500. Earn more in the weekly competition (virtual cash) or from quests.",
    });
  });

  it("locks 5 minutes before settleAt and stays locked after it", async () => {
    f.seedMarket({ id: "m1", settleAt: SETTLE_AT });
    f.givePoints("u1", 500);
    const lastOpen = new Date(SETTLE_AT.getTime() - LOCK_BEFORE_SETTLE_MS - 1000);
    const lockEdge = new Date(SETTLE_AT.getTime() - LOCK_BEFORE_SETTLE_MS);
    await expect(placeCall({ userId: "u1", marketId: "m1", side: "yes", points: 10 }, lastOpen)).resolves.toBeTruthy();
    await expect(placeCall({ userId: "u1", marketId: "m1", side: "yes", points: 10 }, lockEdge)).rejects.toMatchObject({
      message: "Prediction locked",
      status: 409,
    });
    await expect(placeCall({ userId: "u1", marketId: "m1", side: "yes", points: 10 }, AFTER_SETTLE)).rejects.toMatchObject({
      message: "Prediction locked",
    });
    expect(f.balance("u1")).toBe(490);
  });

  it("refuses a settled market and an unknown one", async () => {
    f.seedMarket({ id: "m1", outcome: "yes", settledPrice: 215, source: "jupiter" });
    f.givePoints("u1", 500);
    await expect(placeCall({ userId: "u1", marketId: "m1", side: "yes", points: 10 }, MONDAY)).rejects.toMatchObject({
      message: "Prediction settled",
      status: 409,
    });
    await expect(placeCall({ userId: "u1", marketId: "nope", side: "yes", points: 10 }, MONDAY)).rejects.toMatchObject({ status: 404 });
  });

  it("allows one user to hold both sides of a market", async () => {
    f.seedMarket({ id: "m1" });
    f.givePoints("u1", 500);
    await placeCall({ userId: "u1", marketId: "m1", side: "yes", points: 100 }, MONDAY);
    const r = await placeCall({ userId: "u1", marketId: "m1", side: "no", points: 200 }, MONDAY);
    expect(r.market).toMatchObject({ yesPool: 100, noPool: 200 });
    expect(f.state.positions.map((p) => [p.side, p.points])).toEqual([
      ["yes", 100],
      ["no", 200],
    ]);
    expect(f.balance("u1")).toBe(200);
  });

  it("firstStakeOnly refuses a user who already holds either side, re-read inside the transaction", async () => {
    f.seedMarket({ id: "m1" });
    f.givePoints("bot", 500);
    await placeCall({ userId: "bot", marketId: "m1", side: "no", points: 100 }, MONDAY, f.db as never, { firstStakeOnly: true });

    const second = placeCall({ userId: "bot", marketId: "m1", side: "yes", points: 100 }, MONDAY, f.db as never, { firstStakeOnly: true });
    await expect(second).rejects.toBeInstanceOf(AlreadyStakedError);
    await expect(
      placeCall({ userId: "bot", marketId: "m1", side: "no", points: 50 }, MONDAY, f.db as never, { firstStakeOnly: true }),
    ).rejects.toMatchObject({ status: 409, message: "Already holds a Position on this market" });
    expect(f.state.positions).toHaveLength(1);
    expect(f.state.markets[0]).toMatchObject({ yesPool: 0, noPool: 100 });
    expect(f.balance("bot")).toBe(400);
    // The check runs after the row lock, not before it.
    const lock = f.db.$executeRaw.mock.invocationCallOrder.at(-1)!;
    const recheck = f.db.position.findFirst.mock.invocationCallOrder.at(-1)!;
    expect(recheck).toBeGreaterThan(lock);

    // Without the flag a real user may still top up and hold both sides.
    await expect(placeCall({ userId: "bot", marketId: "m1", side: "yes", points: 100 }, MONDAY)).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// settleMarket / tick
// ---------------------------------------------------------------------------

async function stake(userId: string, marketId: string, side: "yes" | "no", points: number) {
  f.givePoints(userId, points, `play:fund:${userId}:${marketId}:${side}`);
  await placeCall({ userId, marketId, side, points }, MONDAY);
}

describe("settleMarket", () => {
  it("does nothing before settleAt or when already settled", async () => {
    const m = f.seedMarket({ id: "m1" });
    expect(await settleMarket(m, new Date(SETTLE_AT))).toMatchObject({ status: "not_due" });
    expect(await settleMarket({ ...m, outcome: "no" }, AFTER_SETTLE)).toMatchObject({ status: "already_settled" });
    expect(priceMocks.getPriceBySymbol).not.toHaveBeenCalled();
  });

  it("settles Yes from a fresh Jupiter quote above the strike and conserves the pool exactly", async () => {
    f.seedMarket({ id: "m1", strike: 210 });
    await stake("a", "m1", "yes", 100);
    await stake("b", "m1", "yes", 50);
    await stake("c", "m1", "no", 150);
    priceMocks.getPriceBySymbol.mockResolvedValue(quote("NVDAx", 215.5));

    const r = await settleMarket(f.state.markets[0], AFTER_SETTLE);
    expect(r).toMatchObject({ status: "settled", outcome: "yes", settledPrice: 215.5, source: "jupiter", paid: 300, positions: 3, refunded: false });
    expect(f.state.markets[0]).toMatchObject({ outcome: "yes", settledPrice: 215.5, source: "jupiter", yesPool: 150, noPool: 150 });
    expect(f.eventsFor("a")).toContainEqual({ ref: "call:m1:payout:a", delta: 200 });
    expect(f.eventsFor("b")).toContainEqual({ ref: "call:m1:payout:b", delta: 100 });
    expect(f.eventsFor("c").some((e) => e.ref.startsWith("call:m1:payout"))).toBe(false);
    // Net: a +100, b +50, c -150 -> the pool moved, nothing was created.
    expect(f.balance("a") + f.balance("b") + f.balance("c")).toBe(300);
    expect(f.balance("a")).toBe(200);
    expect(f.balance("b")).toBe(100);
    expect(f.balance("c")).toBe(0);
  });

  it("settles No when the price is at or below the strike", async () => {
    f.seedMarket({ id: "m1", strike: 210 });
    await stake("a", "m1", "yes", 300);
    await stake("b", "m1", "no", 100);
    priceMocks.getPriceBySymbol.mockResolvedValue(quote("NVDAx", 210));
    const r = await settleMarket(f.state.markets[0], AFTER_SETTLE);
    expect(r).toMatchObject({ status: "settled", outcome: "no", paid: 400 });
    expect(f.eventsFor("b")).toContainEqual({ ref: "call:m1:payout:b", delta: 400 });
    expect(f.balance("a")).toBe(0);
    expect(f.balance("b")).toBe(400);
  });

  it("rounds payouts with largest remainder so Σ payouts === pool", async () => {
    f.seedMarket({ id: "m1", strike: 210 });
    for (const u of ["a", "b", "c"]) await stake(u, "m1", "yes", 100);
    await stake("d", "m1", "no", 100);
    priceMocks.getPriceBySymbol.mockResolvedValue(quote("NVDAx", 300));
    const r = await settleMarket(f.state.markets[0], AFTER_SETTLE);
    expect(r.paid).toBe(400);
    const payouts = ["a", "b", "c"].map((u) => f.eventsFor(u).find((e) => e.ref === `call:m1:payout:${u}`)?.delta);
    expect(payouts.sort()).toEqual([133, 133, 134]);
  });

  it("refunds a one-sided market even though the price resolved", async () => {
    f.seedMarket({ id: "m1", strike: 210 });
    await stake("a", "m1", "yes", 100);
    await stake("b", "m1", "yes", 250);
    priceMocks.getPriceBySymbol.mockResolvedValue(quote("NVDAx", 100)); // Yes loses...
    const r = await settleMarket(f.state.markets[0], AFTER_SETTLE);
    expect(r).toMatchObject({ status: "settled", outcome: "no", refunded: true, paid: 350 });
    expect(f.eventsFor("a")).toContainEqual({ ref: "call:m1:refund:a:yes", delta: 100 });
    expect(f.eventsFor("b")).toContainEqual({ ref: "call:m1:refund:b:yes", delta: 250 });
    expect(f.balance("a")).toBe(100);
    expect(f.balance("b")).toBe(250);
  });

  it("waits for a price before the 24h cap, then voids and refunds both sides", async () => {
    f.seedMarket({ id: "m1", strike: 210 });
    await stake("a", "m1", "yes", 100);
    await stake("a", "m1", "no", 40);
    await stake("b", "m1", "no", 60);
    // No usable price: Pyth unknown, Jupiter quote missing.
    const waiting = await settleMarket(f.state.markets[0], new Date(SETTLE_AT.getTime() + VOID_AFTER_MS - 1000));
    expect(waiting).toMatchObject({ status: "waiting_for_price" });
    expect(f.state.markets[0].outcome).toBeNull();
    expect(f.state.events.filter((e) => e.ref.includes(":refund:"))).toHaveLength(0);

    const voided = await settleMarket(f.state.markets[0], new Date(SETTLE_AT.getTime() + VOID_AFTER_MS));
    expect(voided).toMatchObject({ status: "voided", outcome: "void", settledPrice: null, source: null, paid: 200, refunded: true });
    expect(f.state.markets[0]).toMatchObject({ outcome: "void", settledPrice: null, source: null });
    expect(f.eventsFor("a")).toContainEqual({ ref: "call:m1:refund:a:yes", delta: 100 });
    expect(f.eventsFor("a")).toContainEqual({ ref: "call:m1:refund:a:no", delta: 40 });
    expect(f.eventsFor("b")).toContainEqual({ ref: "call:m1:refund:b:no", delta: 60 });
    expect(f.balance("a")).toBe(140);
    expect(f.balance("b")).toBe(60);
  });

  it("a stale Jupiter quote does not settle", async () => {
    f.seedMarket({ id: "m1", strike: 210 });
    await stake("a", "m1", "yes", 100);
    await stake("b", "m1", "no", 100);
    priceMocks.getPriceBySymbol.mockResolvedValue(quote("NVDAx", 250, { stale: true, ageSeconds: 7 * 3600 }));
    expect(await settleMarket(f.state.markets[0], AFTER_SETTLE)).toMatchObject({ status: "waiting_for_price" });
    expect(f.state.markets[0].outcome).toBeNull();
  });

  it("is idempotent: a second settle pays nothing more", async () => {
    f.seedMarket({ id: "m1", strike: 210 });
    await stake("a", "m1", "yes", 100);
    await stake("b", "m1", "no", 100);
    priceMocks.getPriceBySymbol.mockResolvedValue(quote("NVDAx", 250));
    const first = await settleMarket(f.state.markets[0], AFTER_SETTLE);
    expect(first.status).toBe("settled");
    const eventsAfterFirst = f.state.events.length;

    // Once with the fresh row, once with a stale copy that still says outcome null.
    expect(await settleMarket(f.state.markets[0], AFTER_SETTLE)).toMatchObject({ status: "already_settled" });
    expect(await settleMarket({ ...f.state.markets[0], outcome: null }, AFTER_SETTLE)).toMatchObject({ status: "already_settled" });
    expect(f.state.events.length).toBe(eventsAfterFirst);
    expect(f.balance("a")).toBe(200);
    expect(f.balance("b")).toBe(0);
    expect((await tick(AFTER_SETTLE)).settled).toEqual([]); // not due any more
  });

  it("prefers a Pyth publish at/after settleAt and records source pyth", async () => {
    f.seedMarket({ id: "m1", strike: 210 });
    await stake("a", "m1", "yes", 100);
    await stake("b", "m1", "no", 100);
    pythMocks.resolvePythFeedId.mockResolvedValue(NVDA_FEED);
    pythMocks.fetchPythLatest.mockResolvedValue(
      new Map([[NVDA_FEED, { feedId: NVDA_FEED, price: 212.34, conf: 0.05, publishedAt: new Date("2026-09-18T20:05:30.000Z") }]]),
    );
    priceMocks.getPriceBySymbol.mockResolvedValue(quote("NVDAx", 100)); // would say No; must not be consulted
    const r = await settleMarket(f.state.markets[0], AFTER_SETTLE);
    expect(r).toMatchObject({ status: "settled", outcome: "yes", settledPrice: 212.34, source: "pyth" });
    expect(pythMocks.resolvePythFeedId).toHaveBeenCalledWith("NVDA");
    expect(pythMocks.fetchPythLatest).toHaveBeenCalledWith([NVDA_FEED]);
    expect(priceMocks.getPriceBySymbol).not.toHaveBeenCalled();
    expect(f.state.markets[0].source).toBe("pyth");
  });

  it("falls back to Jupiter when Pyth's latest publish is older than settleAt (or Hermes is down)", async () => {
    f.seedMarket({ id: "m1", strike: 210 });
    await stake("a", "m1", "yes", 100);
    await stake("b", "m1", "no", 100);
    pythMocks.resolvePythFeedId.mockResolvedValue(NVDA_FEED);
    pythMocks.fetchPythLatest.mockResolvedValue(
      new Map([[NVDA_FEED, { feedId: NVDA_FEED, price: 250, conf: 0.05, publishedAt: new Date("2026-09-18T20:04:59.000Z") }]]),
    );
    priceMocks.getPriceBySymbol.mockResolvedValue(quote("NVDAx", 205.1));
    const r = await settleMarket(f.state.markets[0], AFTER_SETTLE);
    expect(r).toMatchObject({ status: "settled", outcome: "no", settledPrice: 205.1, source: "jupiter" });
    expect(priceMocks.getPriceBySymbol).toHaveBeenCalledWith("NVDAx");

    // Hermes throwing (401 without PYTH_API_KEY surfaces as an empty map, but be safe) also falls through.
    f.seedMarket({ id: "m2", ticker: "TSLA", strike: 360 });
    await stake("a", "m2", "yes", 100);
    await stake("b", "m2", "no", 100);
    pythMocks.fetchPythLatest.mockRejectedValueOnce(new Error("HTTP 401"));
    priceMocks.getPriceBySymbol.mockResolvedValue(quote("TSLAx", 370));
    const r2 = await settleMarket(f.state.markets[1], AFTER_SETTLE);
    expect(r2).toMatchObject({ status: "settled", outcome: "yes", source: "jupiter" });
  });
});

describe("tick / GameModule", () => {
  it("settles every due market, skips the rest and isolates a failure", async () => {
    f.seedMarket({ id: "due1", ticker: "NVDA", strike: 210 });
    f.seedMarket({ id: "due2", ticker: "TSLA", strike: 360 });
    f.seedMarket({ id: "later", ticker: "SPY", strike: 760, settleAt: new Date("2026-09-25T20:05:00.000Z") });
    f.seedMarket({ id: "done", ticker: "AAPL", strike: 1, outcome: "yes" });
    await stake("a", "due1", "yes", 100);
    await stake("b", "due1", "no", 100);
    await stake("a", "due2", "no", 100);
    await stake("b", "due2", "yes", 100);
    priceMocks.getPriceBySymbol.mockImplementation(async (symbol: string) => quote(symbol, symbol === "NVDAx" ? 300 : 300));
    // Make the first transaction blow up so we can see the second market still settles.
    f.db.$transaction.mockRejectedValueOnce(new Error("connection reset"));

    const results = await tick(AFTER_SETTLE);
    expect(results.ensured).toBeNull(); // no Season in this fake: nothing to ensure
    expect(results.settled.map((r) => [r.marketId, r.status])).toEqual([["due2", "settled"]]);
    expect(f.state.markets.find((m) => m.id === "due1")?.outcome).toBeNull();
    expect(f.state.markets.find((m) => m.id === "due2")?.outcome).toBe("no");
    expect(f.state.markets.find((m) => m.id === "later")?.outcome).toBeNull();

    // The next tick repairs the one that failed.
    const again = await tick(AFTER_SETTLE);
    expect(again.settled.map((r) => [r.marketId, r.status])).toEqual([["due1", "settled"]]);
    expect(calls.key).toBe("calls");
    await expect(calls.tick(AFTER_SETTLE)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ensureWeeklyMarkets / seedCallStakes (REVIEW H5, M10)
// ---------------------------------------------------------------------------

const FRI_AFTER_SETTLE = new Date("2026-09-18T20:06:00.000Z");
const FRI_LOCKED = new Date("2026-09-18T20:02:00.000Z");
const SATURDAY = new Date("2026-09-19T10:00:00.000Z");
const NEXT_SETTLE_AT = new Date("2026-09-25T20:05:00.000Z");
const LIVE_STRIKES: Record<string, number | null> = { NVDAx: 180.123, TSLAx: 402.5, SPYx: 661.07 };

function quoteLiveStrikes(overrides: Record<string, number | null> = {}) {
  const prices = { ...LIVE_STRIKES, ...overrides };
  priceMocks.getPriceBySymbol.mockImplementation(async (symbol: string) => quote(symbol, prices[symbol] ?? null));
}

/** Σ Position.points per side for one market, read from the fake's rows. */
function positionPools(marketId: string) {
  const rows = f.state.positions.filter((p) => p.marketId === marketId);
  const side = (s: string) => rows.filter((p) => p.side === s).reduce((t, p) => t + p.points, 0);
  return { yes: side("yes"), no: side("no") };
}

function silenceLogs() {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
}

describe("ensureWeeklyMarkets", () => {
  silenceLogs();

  for (const [label, now] of [
    ["right after Friday's settle", FRI_AFTER_SETTLE],
    ["on Saturday", SATURDAY],
  ] as const) {
    it(`opens NVDA, TSLA and SPY for next Friday ${label}, with the bots' stakes`, async () => {
      quoteLiveStrikes();
      const r = await ensureWeeklyMarkets("season-0", now);

      expect(r).toMatchObject({ seasonId: "season-0", locked: false, noQuote: [] });
      expect(r.settleAt.toISOString()).toBe(NEXT_SETTLE_AT.toISOString());
      expect(r.markets.map((m) => [m.ticker, m.action, m.strike])).toEqual([
        ["NVDA", "created", 180.12],
        ["TSLA", "created", 402.5],
        ["SPY", "created", 661.07],
      ]);
      expect(f.state.markets.map((m) => [m.ticker, m.seasonId, m.settleAt.toISOString(), m.strike])).toEqual([
        ["NVDA", "season-0", "2026-09-25T20:05:00.000Z", 180.12],
        ["TSLA", "season-0", "2026-09-25T20:05:00.000Z", 402.5],
        ["SPY", "season-0", "2026-09-25T20:05:00.000Z", 661.07],
      ]);
      for (const m of r.markets) {
        const plan = planBotStakes(m.ticker);
        expect(m.stakes).toMatchObject({ marketId: m.marketId, placed: plan.length, skipped: 0, failed: [] });
        expect(m.stakes.yesPool).toBe(POOL_TILTS[m.ticker].yes);
        expect(m.stakes.noPool).toBe(POOL_TILTS[m.ticker].no);
      }
    });
  }

  it("creates nothing inside the lock window before this Friday's settle", async () => {
    quoteLiveStrikes();
    const r = await ensureWeeklyMarkets("season-0", FRI_LOCKED);
    expect(r).toMatchObject({ locked: true, markets: [], noQuote: [] });
    expect(r.settleAt.toISOString()).toBe(SETTLE_AT.toISOString());
    expect(f.state.markets).toHaveLength(0);
    expect(f.state.events).toHaveLength(0);
    expect(priceMocks.getPriceBySymbol).not.toHaveBeenCalled();
    expect(f.db.market.findFirst).not.toHaveBeenCalled();
  });

  it("is a no-op the second time: no new markets, no new stakes, the strike is kept", async () => {
    quoteLiveStrikes();
    const first = await ensureWeeklyMarkets("season-0", MONDAY);
    expect(first.settleAt.toISOString()).toBe(SETTLE_AT.toISOString());
    const before = structuredClone({ markets: f.state.markets, positions: f.state.positions, events: f.state.events });

    quoteLiveStrikes({ NVDAx: 999, TSLAx: 999, SPYx: 999 }); // prices moved: strikes must not follow
    const second = await ensureWeeklyMarkets("season-0", new Date(MONDAY.getTime() + 5 * 60_000));

    expect(second.markets.map((m) => [m.ticker, m.action, m.marketId, m.strike])).toEqual(
      first.markets.map((m) => [m.ticker, "existing", m.marketId, m.strike]),
    );
    for (const m of second.markets) {
      expect(m.stakes).toMatchObject({ placed: 0, skipped: planBotStakes(m.ticker).length, failed: [], yesPool: null, noPool: null });
    }
    expect({ markets: f.state.markets, positions: f.state.positions, events: f.state.events }).toEqual(before);
    expect(f.db.market.create).toHaveBeenCalledTimes(3);
  });

  it("skips a ticker with no strike quote into noQuote and creates nothing for it", async () => {
    quoteLiveStrikes({ TSLAx: null });
    const r = await ensureWeeklyMarkets("season-0", MONDAY);
    expect(r.noQuote).toEqual(["TSLA"]);
    expect(r.markets.map((m) => m.ticker)).toEqual(["NVDA", "SPY"]);
    expect(f.state.markets.map((m) => m.ticker)).toEqual(["NVDA", "SPY"]);

    // The next tick retries once a quote is back.
    quoteLiveStrikes();
    const retry = await ensureWeeklyMarkets("season-0", MONDAY);
    expect(retry.noQuote).toEqual([]);
    expect(retry.markets.map((m) => [m.ticker, m.action])).toEqual([
      ["NVDA", "existing"],
      ["TSLA", "created"],
      ["SPY", "existing"],
    ]);
  });

  it("reads back the row when a concurrent tick wins the create race (P2002)", async () => {
    quoteLiveStrikes();
    // The other tick inserts NVDA between our findFirst and our create, at its own strike.
    f.db.market.create.mockImplementationOnce(async () => {
      f.seedMarket({ id: "raced", ticker: "NVDA", strike: 177.77, settleAt: SETTLE_AT });
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    });

    const r = await ensureWeeklyMarkets("season-0", MONDAY);

    expect(r.markets[0]).toMatchObject({ ticker: "NVDA", marketId: "raced", action: "existing", strike: 177.77 });
    expect(f.state.markets.filter((m) => m.ticker === "NVDA")).toHaveLength(1);
    expect(r.markets[0].stakes.placed).toBe(planBotStakes("NVDA").length);
    expect(r.markets.map((m) => m.action)).toEqual(["existing", "created", "created"]);
  });

  it("rethrows any other create failure", async () => {
    quoteLiveStrikes();
    f.db.market.create.mockRejectedValueOnce(new Error("connection reset"));
    await expect(ensureWeeklyMarkets("season-0", MONDAY)).rejects.toThrow("connection reset");
  });
});

describe("seedCallStakes", () => {
  silenceLogs();

  it("tilts the pools exactly as POOL_TILTS, and the pools equal the sum of the positions", async () => {
    for (const ticker of SEED_CALL_TICKERS) {
      const market = f.seedMarket({ id: `m-${ticker}`, ticker });
      const r = await seedCallStakes(market, MONDAY);
      const stored = f.state.markets.find((m) => m.id === market.id)!;
      expect(r).toMatchObject({ marketId: market.id, placed: planBotStakes(ticker).length, skipped: 0, failed: [] });
      expect({ yes: stored.yesPool, no: stored.noPool }).toEqual(positionPools(market.id));
      expect({ yes: stored.yesPool, no: stored.noPool }).toEqual(POOL_TILTS[ticker]);
      expect({ yes: r.yesPool, no: r.noPool }).toEqual(POOL_TILTS[ticker]);
    }
  });

  it("funds each bot with one admin grant for exactly its stake, so every bot nets to zero", async () => {
    const market = f.seedMarket({ id: "m1", ticker: "TSLA" });
    const plan = planBotStakes("TSLA");
    await seedCallStakes(market, MONDAY);

    for (const s of plan) {
      expect(f.eventsFor(s.userId)).toEqual([
        { ref: seedGrantRef("m1", s.userId), delta: s.points },
        { ref: stakeRef("m1", s.userId, s.side), delta: -s.points },
      ]);
      expect(f.state.events.find((e) => e.ref === seedGrantRef("m1", s.userId))?.source).toBe("admin");
      expect(f.balance(s.userId)).toBe(0);
      expect(f.state.positions.filter((p) => p.userId === s.userId)).toEqual([expect.objectContaining({ side: s.side, points: s.points })]);
    }
    // Bot Users come from the League seed; staking never creates one.
    expect(f.db.user.upsert).not.toHaveBeenCalled();
    expect(f.state.users).toEqual([]);
  });

  it("skips planned bots with no isBot LeagueAccount instead of creating Users for them", async () => {
    const market = f.seedMarket({ id: "m1", ticker: "NVDA" });
    const plan = planBotStakes("NVDA");
    const [missing, ...seeded] = plan;
    f.state.botAccounts = f.state.botAccounts.filter((u) => u !== missing.userId);

    const r = await seedCallStakes(market, MONDAY);

    expect(r).toMatchObject({ placed: seeded.length, skipped: 1, failed: [], missingBots: [missing.userId] });
    expect(f.eventsFor(missing.userId)).toEqual([]);
    expect(f.state.positions.some((p) => p.userId === missing.userId)).toBe(false);
    expect(f.db.user.upsert).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);

    // Once the League seeds that bot, the next tick places its stake and the tilt is whole.
    f.state.botAccounts.push(missing.userId);
    const healed = await seedCallStakes(f.state.markets[0], MONDAY);
    expect(healed).toMatchObject({ placed: 1, skipped: seeded.length, failed: [], missingBots: [] });
    expect(positionPools("m1")).toEqual(POOL_TILTS.NVDA);
  });

  it("an overlapping tick with a stale pre-read cannot double-stake a bot (locked re-check)", async () => {
    const market = f.seedMarket({ id: "m1", ticker: "TSLA" });
    const plan = planBotStakes("TSLA");
    await seedCallStakes(market, MONDAY);
    const before = structuredClone({ positions: f.state.positions, events: f.state.events, market: f.state.markets[0] });

    // The second tick read "nobody holds a Position" before the first tick's stakes committed.
    f.db.position.findMany.mockResolvedValueOnce([]);
    const overlap = await seedCallStakes(f.state.markets[0], MONDAY);

    expect(overlap).toMatchObject({ placed: 0, skipped: plan.length, failed: [], missingBots: [], yesPool: null, noPool: null });
    expect({ positions: f.state.positions, events: f.state.events, market: f.state.markets[0] }).toEqual(before);
    for (const s of plan) expect(f.balance(s.userId)).toBe(0);
    expect({ yes: f.state.markets[0].yesPool, no: f.state.markets[0].noPool }).toEqual(POOL_TILTS.TSLA);
  });

  it("skips bots that already hold a Position on the market", async () => {
    const market = f.seedMarket({ id: "m1", ticker: "NVDA" });
    const plan = planBotStakes("NVDA");
    const [held] = plan;
    f.givePoints(held.userId, 50);
    await placeCall({ userId: held.userId, marketId: "m1", side: held.side === "yes" ? "no" : "yes", points: 50 }, MONDAY);

    const r = await seedCallStakes(market, MONDAY);

    expect(r).toMatchObject({ placed: plan.length - 1, skipped: 1, failed: [] });
    expect(f.eventsFor(held.userId).some((e) => e.ref.startsWith("admin:seed:"))).toBe(false);
    expect(f.state.positions.filter((p) => p.userId === held.userId)).toHaveLength(1);
    const stored = f.state.markets[0];
    expect({ yes: stored.yesPool, no: stored.noPool }).toEqual(positionPools("m1"));
  });

  it("places nothing on a locked or a settled market", async () => {
    const locked = f.seedMarket({ id: "locked", ticker: "NVDA" });
    const settled = f.seedMarket({ id: "settled", ticker: "SPY", outcome: "yes", settledPrice: 700, source: "jupiter" });
    const planned = (t: string) => planBotStakes(t).length;

    expect(await seedCallStakes(locked, FRI_LOCKED)).toEqual({
      marketId: "locked",
      placed: 0,
      skipped: planned("NVDA"),
      failed: [],
      missingBots: [],
      yesPool: null,
      noPool: null,
    });
    expect(await seedCallStakes(settled, MONDAY)).toEqual({
      marketId: "settled",
      placed: 0,
      skipped: planned("SPY"),
      failed: [],
      missingBots: [],
      yesPool: null,
      noPool: null,
    });
    expect(f.state.events).toHaveLength(0);
    expect(f.state.positions).toHaveLength(0);
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it("one bot's failure does not stop the rest, and the next run heals it", async () => {
    const market = f.seedMarket({ id: "m1", ticker: "SPY" });
    const plan = planBotStakes("SPY");
    f.db.$executeRaw.mockRejectedValueOnce(new Error("deadlock detected")); // the first bot's row lock

    const r = await seedCallStakes(market, MONDAY);

    expect(r.failed).toEqual([plan[0].userId]);
    expect(r.placed).toBe(plan.length - 1);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(f.state.positions.some((p) => p.userId === plan[0].userId)).toBe(false);
    const expected = { ...POOL_TILTS.SPY };
    expected[plan[0].side] -= plan[0].points;
    expect({ yes: f.state.markets[0].yesPool, no: f.state.markets[0].noPool }).toEqual(expected);

    // The grant stayed (it ran before the failed placement); the retry reuses it and nets to zero.
    const retry = await seedCallStakes(f.state.markets[0], MONDAY);
    expect(retry).toMatchObject({ placed: 1, skipped: plan.length - 1, failed: [] });
    expect(f.balance(plan[0].userId)).toBe(0);
    expect(f.state.events.filter((e) => e.ref === seedGrantRef("m1", plan[0].userId))).toHaveLength(1);
    expect({ yes: f.state.markets[0].yesPool, no: f.state.markets[0].noPool }).toEqual(POOL_TILTS.SPY);
    expect(positionPools("m1")).toEqual(POOL_TILTS.SPY);
  });
});

describe("tick with weekly markets", () => {
  silenceLogs();

  it("opens next week's markets and settles this week's in the same tick", async () => {
    f.state.seasons.push("season-0");
    f.seedMarket({ id: "due", ticker: "NVDA", strike: 210 });
    await stake("a", "due", "yes", 100);
    await stake("b", "due", "no", 100);
    quoteLiveStrikes({ NVDAx: 250 });

    const r = await tick(FRI_AFTER_SETTLE);

    expect(r.settled.map((x) => [x.marketId, x.status, x.outcome])).toEqual([["due", "settled", "yes"]]);
    expect(r.ensured).toMatchObject({ seasonId: "season-0", locked: false, noQuote: [] });
    expect(r.ensured?.settleAt.toISOString()).toBe(NEXT_SETTLE_AT.toISOString());
    expect(r.ensured?.markets.map((m) => [m.ticker, m.action])).toEqual([
      ["NVDA", "created"],
      ["TSLA", "created"],
      ["SPY", "created"],
    ]);
  });

  it("an ensure failure still settles due markets, then rethrows", async () => {
    f.state.seasons.push("season-0");
    f.seedMarket({ id: "due", ticker: "NVDA", strike: 210 });
    await stake("a", "due", "yes", 100);
    await stake("b", "due", "no", 100);
    quoteLiveStrikes({ NVDAx: 250 });
    f.db.market.findFirst.mockRejectedValueOnce(new Error("db blip"));

    await expect(tick(FRI_AFTER_SETTLE)).rejects.toThrow("db blip");

    expect(f.state.markets.find((m) => m.id === "due")).toMatchObject({ outcome: "yes", settledPrice: 250 });
    expect(f.eventsFor("a")).toContainEqual({ ref: "call:due:payout:a", delta: 200 });
    expect(f.state.markets).toHaveLength(1); // nothing was opened this tick
    // The GameModule surfaces the failure so the cron reports calls as not ok.
    f.db.market.findFirst.mockRejectedValueOnce(new Error("db blip"));
    await expect(calls.tick(FRI_AFTER_SETTLE)).rejects.toThrow("db blip");
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe("getCallsBoard / getCallMarket", () => {
  it("lists markets with quotes and odds; me is null when signed out", async () => {
    f.seedMarket({ id: "m1", ticker: "NVDA", strike: 210, yesPool: 300, noPool: 100 });
    f.seedMarket({ id: "m2", ticker: "TSLA", strike: 360 });
    priceMocks.getPricesBySymbols.mockResolvedValue({ quotes: [quote("NVDAx", 214.2)], unknown: ["TSLAx"] });

    const board = await getCallsBoard("season-0", null, MONDAY);
    expect(priceMocks.getPricesBySymbols).toHaveBeenCalledWith(["NVDAx", "TSLAx"]);
    expect(board.me).toBeNull();
    expect(board.markets).toHaveLength(2);
    const nvda = board.markets[0];
    expect(nvda).toMatchObject({
      id: "m1",
      ticker: "NVDA",
      symbol: "NVDAx",
      strike: 210,
      settleAt: "2026-09-18T20:05:00.000Z",
      locksAt: "2026-09-18T20:00:00.000Z",
      status: "open",
      yesPool: 300,
      noPool: 100,
      settledPrice: null,
      outcome: null,
      source: null,
    });
    expect(nvda.odds).toMatchObject({ total: 400, yesProb: 0.75, noMultiplier: 4 });
    expect(nvda.quote).toMatchObject({ symbol: "NVDAx", price: 214.2, source: "jupiter", publishedAt: "2026-09-18T20:07:00.000Z", stale: false });
    expect(board.markets[1].quote).toBeNull();
  });

  it("returns nothing without a Season", async () => {
    f.seedMarket({ id: "m1" });
    expect(await getCallsBoard(null, "u1", MONDAY)).toEqual({ markets: [], me: null });
  });

  it("personalises: spendable points, pending payouts and settled results from the ledger", async () => {
    f.seedMarket({ id: "open", ticker: "NVDA", strike: 210 });
    f.seedMarket({ id: "won", ticker: "TSLA", strike: 360, settleAt: new Date("2026-09-11T20:05:00.000Z") });
    f.seedMarket({ id: "lost", ticker: "SPY", strike: 760, settleAt: new Date("2026-09-11T20:05:00.000Z") });
    f.seedMarket({ id: "void", ticker: "AAPL", strike: 1, settleAt: new Date("2026-09-04T20:05:00.000Z") });
    f.givePoints("u1", 1000);
    f.givePoints("u2", 1000);
    await placeCall({ userId: "u1", marketId: "open", side: "yes", points: 100 }, MONDAY);
    await placeCall({ userId: "u2", marketId: "open", side: "no", points: 300 }, MONDAY);
    const earlier = new Date("2026-09-01T12:00:00.000Z"); // those markets settled before MONDAY
    for (const id of ["won", "lost", "void"]) {
      await placeCall({ userId: "u1", marketId: id, side: "yes", points: 100 }, earlier);
      await placeCall({ userId: "u2", marketId: id, side: "no", points: 100 }, earlier);
    }
    priceMocks.getPriceBySymbol.mockImplementation(async (symbol: string) => quote(symbol, symbol === "TSLAx" ? 400 : 1));
    await settleMarket(f.state.markets.find((m) => m.id === "won")!, AFTER_SETTLE);
    await settleMarket(f.state.markets.find((m) => m.id === "lost")!, AFTER_SETTLE);
    priceMocks.getPriceBySymbol.mockResolvedValue(quote("AAPLx", null));
    await settleMarket(f.state.markets.find((m) => m.id === "void")!, new Date("2026-09-06T20:05:00.000Z"));

    const board = await getCallsBoard("season-0", "u1", MONDAY);
    // Settled markets share a settleAt, so the ticker tie-break puts SPY ("lost") before TSLA ("won").
    expect(board.markets.map((m) => [m.id, m.status])).toEqual([
      ["open", "open"],
      ["lost", "settled"],
      ["won", "settled"],
      ["void", "void"],
    ]);
    // 1000 - 4×100 staked + 200 payout + 100 refund = 900
    expect(board.me?.spendablePoints).toBe(900);
    const byMarket = new Map(board.me?.positions.map((p) => [p.marketId, p]));
    expect(byMarket.get("open")).toMatchObject({ side: "yes", points: 100, potentialPayout: 400, result: "pending", payout: null });
    expect(byMarket.get("won")).toMatchObject({ result: "won", payout: 200, potentialPayout: 200 });
    expect(byMarket.get("lost")).toMatchObject({ result: "lost", payout: 0 });
    expect(byMarket.get("void")).toMatchObject({ result: "refunded", payout: 100 });

    const one = await getCallMarket("open", "u1", MONDAY);
    expect(one?.market).toMatchObject({ id: "open", positionsCount: 2, yesPool: 100, noPool: 300 });
    expect(one?.me?.positions).toHaveLength(1);
    expect(await getCallMarket("missing", "u1", MONDAY)).toBeNull();
  });
});
