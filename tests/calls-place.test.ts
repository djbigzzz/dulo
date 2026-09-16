import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/v1/calls/place and its inline Play evaluation (15 Sep review M-F). The cron module,
// the DB, the session and the Calls domain are mocked; next/server keeps its real exports
// except after(), which is a spy.
const mocks = vi.hoisted(() => {
  class CallsError extends Error {
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    CallsError,
    after: vi.fn(),
    evaluateUser: vi.fn(),
    findCurrentSeason: vi.fn(),
    loadInternalEvents: vi.fn(),
    db: { play: { findMany: vi.fn() } },
    requireSession: vi.fn(),
    placeCall: vi.fn(),
    getCallMarket: vi.fn(),
    ensureStarterPoints: vi.fn(),
  };
});

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/cron/evaluate", () => ({
  evaluateUser: mocks.evaluateUser,
  findCurrentSeason: mocks.findCurrentSeason,
  loadInternalEvents: mocks.loadInternalEvents,
}));
vi.mock("@/lib/server/db", () => ({ db: mocks.db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/games/starter", () => ({ ensureStarterPoints: mocks.ensureStarterPoints }));
vi.mock("@/lib/games/calls", () => ({
  CallsError: mocks.CallsError,
  MIN_CALL_POINTS: 10,
  MAX_CALL_POINTS: 5000,
  placeCall: mocks.placeCall,
  getCallMarket: mocks.getCallMarket,
}));

import {
  INLINE_EVALUATE_TIMEOUT_MS,
  evaluateAfterPlacement,
  evaluateCallPlays,
  isCallPlayRule,
} from "@/app/api/v1/calls/place/inline-evaluate";
import { POST } from "@/app/api/v1/calls/place/route";

const NOW = new Date("2026-09-15T14:00:00.000Z");
const SEASON = { id: "season-0" };
const ORACLE = { key: "oracle", title: "First Prediction", points: 50, badgeKey: null, rule: { type: "internal_event", event: "call_placed", count: 1 } };
const SCOUT = { key: "scout", title: "First Paper Trades", points: 50, badgeKey: null, rule: { type: "internal_event", event: "league_trade", count: 3 } };
const FIRST = { key: "first_position", title: "First Position", points: 100, badgeKey: "first_position", rule: { type: "hold_any", minUsd: 5 } };
const GAME_DAYS = { key: "game_days", title: "Three Game Days", points: 150, badgeKey: null, rule: { type: "internal_event", event: "game_action", count: 3 } };

function outcome(key: string, newlyCompleted: boolean) {
  return { key, status: newlyCompleted ? "complete" : "in_progress", newlyCompleted, awarded: newlyCompleted, badge: false };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.findCurrentSeason.mockResolvedValue(SEASON);
  mocks.db.play.findMany.mockResolvedValue([FIRST, SCOUT, ORACLE]);
  mocks.loadInternalEvents.mockResolvedValue([]);
  mocks.evaluateUser.mockResolvedValue({ plays: [] });
});

describe("isCallPlayRule", () => {
  it("is true only for a valid internal_event call_placed or game_action rule", () => {
    expect(isCallPlayRule(ORACLE.rule)).toBe(true);
    // A new prediction also emits game_action (lib/cron/evaluate), so Three Game Days completes inline.
    expect(isCallPlayRule(GAME_DAYS.rule)).toBe(true);
    expect(isCallPlayRule({ type: "internal_event", event: "mirror_executed", count: 1 })).toBe(false);
    expect(isCallPlayRule(SCOUT.rule)).toBe(false);
    expect(isCallPlayRule(FIRST.rule)).toBe(false);
    expect(isCallPlayRule({ type: "internal_event" })).toBe(false);
    expect(isCallPlayRule(null)).toBe(false);
  });
});

describe("evaluateCallPlays", () => {
  it("evaluates only the call_placed Plays on a DB-only context and returns what completed", async () => {
    const later = { type: "call_placed", userId: "u1", ref: "m2", ts: new Date("2026-09-15T13:59:00.000Z"), meta: {} };
    const earlier = { type: "league_trade", userId: "u1", ref: "t1", ts: new Date("2026-09-14T10:00:00.000Z"), meta: {} };
    mocks.loadInternalEvents.mockResolvedValue([later, earlier]);
    mocks.evaluateUser.mockResolvedValue({ plays: [outcome("oracle", true)] });

    const done = await evaluateCallPlays("u1", NOW);

    expect(done).toEqual([{ key: "oracle", title: "First Prediction", points: 50 }]);
    expect(mocks.db.play.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true, campaign: { seasonId: "season-0" } } }));
    expect(mocks.evaluateUser).toHaveBeenCalledTimes(1);
    const [userId, now, ctx, opts] = mocks.evaluateUser.mock.calls[0];
    expect(userId).toBe("u1");
    expect(now).toBe(NOW);
    expect(opts).toEqual({ season: SEASON, plays: [ORACLE] });
    // No snapshots, no catalogue, no calendar: nothing but the user's events, oldest first.
    expect(ctx).toMatchObject({ now: NOW, snapshots: [], earnings: {}, events: [earlier, later] });
    expect(ctx.sectorOf("anything")).toBeNull();
    expect(ctx.underlyingOf("anything")).toBeNull();
  });

  it("returns nothing when the Play was already complete", async () => {
    mocks.evaluateUser.mockResolvedValue({ plays: [outcome("oracle", false)] });
    expect(await evaluateCallPlays("u1", NOW)).toEqual([]);
  });

  it("returns only the quests whose points this run awarded (no toast for an award another run already wrote)", async () => {
    mocks.db.play.findMany.mockResolvedValue([ORACLE, GAME_DAYS, SCOUT]);
    mocks.evaluateUser.mockResolvedValue({
      plays: [
        { ...outcome("oracle", true), awarded: false }, // completed now, but the PointsEvent already existed (P2002)
        outcome("game_days", true),
      ],
    });
    expect(await evaluateCallPlays("u1", NOW)).toEqual([{ key: "game_days", title: "Three Game Days", points: 150 }]);
    expect(mocks.evaluateUser.mock.calls[0][3].plays).toEqual([ORACLE, GAME_DAYS]);
  });

  it("does no evaluation work without a Season or without a call_placed Play", async () => {
    mocks.findCurrentSeason.mockResolvedValueOnce(null);
    expect(await evaluateCallPlays("u1", NOW)).toEqual([]);
    expect(mocks.db.play.findMany).not.toHaveBeenCalled();

    mocks.db.play.findMany.mockResolvedValueOnce([FIRST, SCOUT]);
    expect(await evaluateCallPlays("u1", NOW)).toEqual([]);
    expect(mocks.loadInternalEvents).not.toHaveBeenCalled();
    expect(mocks.evaluateUser).not.toHaveBeenCalled();
  });
});

describe("evaluateAfterPlacement", () => {
  const ORACLE_DONE = [{ key: "oracle", title: "First Prediction", points: 50 }];

  it("waits a short, bounded time by default", () => {
    expect(INLINE_EVALUATE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(INLINE_EVALUATE_TIMEOUT_MS).toBeLessThanOrEqual(3000);
  });

  it("returns the completed Plays when the run finishes before the deadline", async () => {
    const schedule = vi.fn();
    const run = vi.fn().mockResolvedValue(ORACLE_DONE);
    expect(await evaluateAfterPlacement("u1", { run, schedule, clock: () => NOW })).toEqual(ORACLE_DONE);
    expect(run).toHaveBeenCalledWith("u1", NOW);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("answers empty when the run is too slow and lets the same run finish in after()", async () => {
    const slow = deferred<typeof ORACLE_DONE>();
    const run = vi.fn().mockReturnValue(slow.promise);
    const schedule = vi.fn();

    expect(await evaluateAfterPlacement("u1", { run, schedule, timeoutMs: 5 })).toEqual([]);
    expect(schedule).toHaveBeenCalledTimes(1);

    const task: () => Promise<void> = schedule.mock.calls[0][0];
    const finished = task();
    slow.resolve(ORACLE_DONE);
    await expect(finished).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1); // not re-run: the original evaluation completed
  });

  it("a late failure after the deadline is logged inside after(), never unhandled", async () => {
    const slow = deferred<typeof ORACLE_DONE>();
    const schedule = vi.fn();
    expect(await evaluateAfterPlacement("u1", { run: () => slow.promise, schedule, timeoutMs: 5 })).toEqual([]);
    slow.reject(new Error("pool timeout"));
    await expect(schedule.mock.calls[0][0]()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("pool timeout"));
  });

  it("answers empty when the run fails and retries it once in after()", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("connection reset")).mockResolvedValueOnce(ORACLE_DONE);
    const schedule = vi.fn();

    expect(await evaluateAfterPlacement("u1", { run, schedule })).toEqual([]);
    expect(schedule).toHaveBeenCalledTimes(1);
    await schedule.mock.calls[0][0]();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never throws: a synchronous throw, a failing retry or an unavailable after() all answer empty", async () => {
    const boom = () => {
      throw new Error("sync");
    };
    const schedule = vi.fn();
    expect(await evaluateAfterPlacement("u1", { run: boom, schedule })).toEqual([]);
    await expect(schedule.mock.calls[0][0]()).resolves.toBeUndefined();

    const noAfter = () => {
      throw new Error("after() was called outside a request scope");
    };
    expect(await evaluateAfterPlacement("u1", { run: () => Promise.reject(new Error("x")), schedule: noAfter })).toEqual([]);
  });

  it("schedules through next/server after() by default", async () => {
    expect(await evaluateAfterPlacement("u1", { run: () => Promise.reject(new Error("x")) })).toEqual([]);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/v1/calls/place", () => {
  const POSITION = { marketId: "m1", side: "yes", points: 100, potentialPayout: 180, result: "pending", payout: null, createdAt: NOW.toISOString() };
  const MARKET = { id: "m1", ticker: "NVDA", strike: 210 };

  function request(body: unknown) {
    return new Request("http://localhost:3000/api/v1/calls/place", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    mocks.ensureStarterPoints.mockResolvedValue({ granted: false, seasonId: "season-0", reason: "already_granted" });
    mocks.requireSession.mockResolvedValue({ userId: "u1" });
    mocks.placeCall.mockResolvedValue({ position: { ...POSITION, userId: "u1", createdAt: NOW }, market: MARKET, spendablePoints: 400 });
    mocks.getCallMarket.mockResolvedValue({ market: MARKET, me: { spendablePoints: 450, positions: [POSITION] } });
  });

  it("returns Oracle in newlyCompleted and the balance read after the award", async () => {
    mocks.db.play.findMany.mockResolvedValue([ORACLE]);
    mocks.evaluateUser.mockResolvedValue({ plays: [outcome("oracle", true)] });

    const res = await POST(request({ marketId: "m1", side: "yes", points: 100 }), undefined);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      data: { position: POSITION, market: MARKET, spendablePoints: 450, newlyCompleted: [{ key: "oracle", title: "First Prediction", points: 50 }] },
    });
    expect(mocks.placeCall).toHaveBeenCalledWith({ userId: "u1", marketId: "m1", side: "yes", points: 100 }, expect.any(Date));
    // The board view is read after the evaluation, so the +50 is already in spendable points.
    expect(mocks.evaluateUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.getCallMarket.mock.invocationCallOrder[0]);
  });

  it("ensures the caller's starter points before placeCall runs", async () => {
    mocks.ensureStarterPoints.mockResolvedValue({ granted: true, seasonId: "season-0" });
    const res = await POST(request({ marketId: "m1", side: "yes", points: 100 }), undefined);
    expect(res.status).toBe(200);
    expect(mocks.ensureStarterPoints).toHaveBeenCalledTimes(1);
    expect(mocks.ensureStarterPoints).toHaveBeenCalledWith("u1", expect.any(Date));
    expect(mocks.ensureStarterPoints.mock.invocationCallOrder[0]).toBeLessThan(mocks.placeCall.mock.invocationCallOrder[0]);
    // Same clock for the grant and the placement.
    expect(mocks.ensureStarterPoints.mock.calls[0][1]).toBe(mocks.placeCall.mock.calls[0][1]);
  });

  it("still places the prediction when the starter grant fails", async () => {
    mocks.ensureStarterPoints.mockRejectedValue(new Error("pool timeout"));
    const res = await POST(request({ marketId: "m1", side: "yes", points: 100 }), undefined);
    expect(res.status).toBe(200);
    expect(mocks.placeCall).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("pool timeout"));
  });

  it("refuses a house bot session with a 403: no grant, no placement, no evaluation", async () => {
    mocks.requireSession.mockResolvedValue({ userId: "bot-league-7" });
    const res = await POST(request({ marketId: "m1", side: "yes", points: 100 }), undefined);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "House bot accounts cannot make predictions" });
    expect(mocks.ensureStarterPoints).not.toHaveBeenCalled();
    expect(mocks.placeCall).not.toHaveBeenCalled();
    expect(mocks.evaluateUser).not.toHaveBeenCalled();
  });

  it("still places the Call when the evaluation fails", async () => {
    mocks.findCurrentSeason.mockRejectedValue(new Error("db blip"));
    const res = await POST(request({ marketId: "m1", side: "yes", points: 100 }), undefined);
    expect(res.status).toBe(200);
    expect((await res.json()).data.newlyCompleted).toEqual([]);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("passes the explanatory 409 through and evaluates nothing", async () => {
    const msg = "Not enough points: you have 0, this prediction needs 10. Earn more in the weekly competition (virtual cash) or from quests.";
    mocks.placeCall.mockRejectedValue(new mocks.CallsError(msg, 409));

    const res = await POST(request({ marketId: "m1", side: "no", points: 10 }), undefined);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: msg });
    expect(mocks.findCurrentSeason).not.toHaveBeenCalled();
    expect(mocks.evaluateUser).not.toHaveBeenCalled();
  });
});
