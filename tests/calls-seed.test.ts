import { describe, expect, it, vi } from "vitest";

// calls-seed imports lib/games/league for the bot roster; keep its server deps inert.
vi.mock("@/lib/server/db", () => ({ db: {} }));
vi.mock("@/lib/price", () => ({
  getPriceBySymbol: vi.fn(),
  getPrices: vi.fn(),
  getPricesBySymbols: vi.fn(),
  UnknownAssetError: class UnknownAssetError extends Error {},
}));

import {
  DEFAULT_POOL_TILT,
  MAX_BOTS_PER_SIDE,
  POOL_TILTS,
  SEED_CALL_TICKERS,
  planBotStakes,
  poolTilt,
  seedGrantRef,
  splitStake,
} from "@/lib/games/calls-seed";
import { MAX_CALL_POINTS, MIN_CALL_POINTS } from "@/lib/games/calls-limits";
import { BOT_HANDLES, botUserId } from "@/lib/games/league";

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

describe("SEED_CALL_TICKERS / POOL_TILTS", () => {
  it("keeps NVDA, TSLA and SPY open with the review's tilts", () => {
    expect([...SEED_CALL_TICKERS]).toEqual(["NVDA", "TSLA", "SPY"]);
    expect(POOL_TILTS).toEqual({ NVDA: { yes: 320, no: 180 }, TSLA: { yes: 150, no: 350 }, SPY: { yes: 400, no: 250 } });
    expect(poolTilt("nvda")).toEqual({ yes: 320, no: 180 });
    expect(poolTilt("AAPL")).toEqual(DEFAULT_POOL_TILT);
  });
});

describe("splitStake", () => {
  // Every total a pool tilt could reasonably use, densely at the small end where shares are tight.
  const totals = [...Array.from({ length: 600 }, (_, i) => MIN_CALL_POINTS + i), 999, 1000, 2500, 4999, 5000];
  const seeds = [0, 1, 7, 0xdeadbeef, 0xffffffff, 123_456_789];

  it("sums exactly to the total with every share inside MIN..MAX", () => {
    for (const total of totals) {
      for (const seed of seeds) {
        const shares = splitStake(total, seed);
        expect(sum(shares), `${total}/${seed}`).toBe(total);
        expect(shares.length).toBeGreaterThanOrEqual(1);
        expect(shares.length).toBeLessThanOrEqual(MAX_BOTS_PER_SIDE);
        for (const s of shares) {
          expect(Number.isInteger(s)).toBe(true);
          expect(s).toBeGreaterThanOrEqual(MIN_CALL_POINTS);
          expect(s).toBeLessThanOrEqual(MAX_CALL_POINTS);
        }
      }
    }
  });

  it("throws rather than return a share above MAX_CALL_POINTS for a total no bot set can carry", () => {
    // 5 bots x MAX with unequal weights cannot hold 25 000; the plan must never exceed a real stake cap.
    expect(() => splitStake(25_000, 1)).toThrow(RangeError);
  });

  it("is deterministic for a seed", () => {
    for (const seed of seeds) expect(splitStake(400, seed)).toEqual(splitStake(400, seed));
  });

  it("throws below MIN_CALL_POINTS or for a non-integer total", () => {
    expect(() => splitStake(MIN_CALL_POINTS - 1, 1)).toThrow(RangeError);
    expect(() => splitStake(0, 1)).toThrow(RangeError);
    expect(() => splitStake(-50, 1)).toThrow(RangeError);
    expect(() => splitStake(100.5, 1)).toThrow(RangeError);
    expect(() => splitStake(Number.NaN, 1)).toThrow(RangeError);
  });
});

describe("planBotStakes", () => {
  const botIds = new Set(BOT_HANDLES.map((_, i) => botUserId(i)));

  it("puts exactly POOL_TILTS on each side of every standard ticker", () => {
    for (const ticker of SEED_CALL_TICKERS) {
      const plan = planBotStakes(ticker);
      const tilt = POOL_TILTS[ticker];
      expect(sum(plan.filter((s) => s.side === "yes").map((s) => s.points)), ticker).toBe(tilt.yes);
      expect(sum(plan.filter((s) => s.side === "no").map((s) => s.points)), ticker).toBe(tilt.no);
      for (const s of plan) {
        expect(s.points).toBeGreaterThanOrEqual(MIN_CALL_POINTS);
        expect(s.points).toBeLessThanOrEqual(MAX_CALL_POINTS);
      }
    }
  });

  it("uses disjoint Yes and No bots, each bot at most once per market", () => {
    for (const ticker of SEED_CALL_TICKERS) {
      const plan = planBotStakes(ticker);
      const yes = new Set(plan.filter((s) => s.side === "yes").map((s) => s.userId));
      const no = new Set(plan.filter((s) => s.side === "no").map((s) => s.userId));
      expect([...yes].filter((u) => no.has(u)), ticker).toEqual([]);
      expect(new Set(plan.map((s) => s.userId)).size).toBe(plan.length);
    }
  });

  it("is deterministic, case-insensitive in the ticker, and accepts an explicit tilt", () => {
    for (const ticker of SEED_CALL_TICKERS) {
      expect(planBotStakes(ticker)).toEqual(planBotStakes(ticker));
      expect(planBotStakes(ticker.toLowerCase())).toEqual(planBotStakes(ticker));
    }
    const custom = planBotStakes("AAPL", { yes: 10, no: 90 });
    expect(custom.filter((s) => s.side === "yes").map((s) => s.points)).toEqual([10]);
    expect(sum(custom.filter((s) => s.side === "no").map((s) => s.points))).toBe(90);
  });

  it("only stakes real League bots, with the handle that belongs to the id", () => {
    for (const ticker of [...SEED_CALL_TICKERS, "AAPL"]) {
      for (const s of planBotStakes(ticker)) {
        expect(botIds.has(s.userId), s.userId).toBe(true);
        expect(botUserId(BOT_HANDLES.indexOf(s.handle))).toBe(s.userId);
      }
    }
  });
});

describe("seedGrantRef", () => {
  it("is admin:seed:<marketId>:<userId>", () => {
    expect(seedGrantRef("m1", "bot-league-3")).toBe("admin:seed:m1:bot-league-3");
  });
});
