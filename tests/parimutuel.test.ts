import { describe, expect, it } from "vitest";
import {
  largestRemainderSplit,
  odds,
  otherSide,
  payout,
  potentialPayout,
  settle,
  type Outcome,
  type PositionInput,
} from "@/lib/games/parimutuel";

function pos(userId: string, side: "yes" | "no", points: number): PositionInput {
  return { userId, side, points };
}

/** Deterministic pseudo-random stakes so the invariant checks cover odd pool shapes. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("odds", () => {
  it("returns implied probabilities and multipliers from the pools", () => {
    const o = odds(300, 100);
    expect(o.total).toBe(400);
    expect(o.yesProb).toBeCloseTo(0.75);
    expect(o.noProb).toBeCloseTo(0.25);
    expect(o.yesMultiplier).toBeCloseTo(4 / 3);
    expect(o.noMultiplier).toBe(4);
  });

  it("treats an empty market as 50/50 with no multipliers", () => {
    expect(odds(0, 0)).toEqual({ yesPool: 0, noPool: 0, total: 0, yesProb: 0.5, noProb: 0.5, yesMultiplier: null, noMultiplier: null });
  });

  it("a one-sided market has multiplier 1 on the staked side and none on the empty side", () => {
    const o = odds(250, 0);
    expect(o.yesProb).toBe(1);
    expect(o.noProb).toBe(0);
    expect(o.yesMultiplier).toBe(1);
    expect(o.noMultiplier).toBeNull();
  });

  it("rejects negative or fractional pools", () => {
    expect(() => odds(-1, 0)).toThrow(RangeError);
    expect(() => odds(1.5, 0)).toThrow(RangeError);
    expect(() => odds(0, Number.NaN)).toThrow(RangeError);
  });
});

describe("payout / potentialPayout", () => {
  it("payout = stake × total / sidePool for a stake already in the pool", () => {
    expect(payout(100, "yes", 300, 100)).toBeCloseTo(400 / 3);
    expect(payout(100, "no", 300, 100)).toBe(400);
    expect(payout(0, "yes", 300, 100)).toBe(0);
  });

  it("refunds the stake when the other pool is empty", () => {
    expect(payout(100, "yes", 100, 0)).toBe(100);
    expect(payout(40, "no", 0, 40)).toBe(40);
  });

  it("refuses a stake larger than its pool (inconsistent rows)", () => {
    expect(() => payout(200, "yes", 100, 100)).toThrow(RangeError);
  });

  it("potentialPayout adds the new stake to its side before paying out (floored)", () => {
    // 100 on Yes into 300/100: Yes becomes 400, total 500 -> 100 × 500 / 400 = 125
    expect(potentialPayout(100, "yes", 300, 100)).toBe(125);
    // 100 on No into 300/100: No becomes 200, total 500 -> 100 × 500 / 200 = 250
    expect(potentialPayout(100, "no", 300, 100)).toBe(250);
    // First stake into an empty market is a refund at best.
    expect(potentialPayout(50, "yes", 0, 0)).toBe(50);
    expect(potentialPayout(0, "yes", 300, 100)).toBe(0);
    // 10 on Yes into 5/0 : total 15, 10 × 15 / 15 = 10 -> refund-equivalent, no counterparty
    expect(potentialPayout(10, "yes", 5, 0)).toBe(10);
  });

  it("otherSide flips", () => {
    expect(otherSide("yes")).toBe("no");
    expect(otherSide("no")).toBe("yes");
  });
});

describe("largestRemainderSplit", () => {
  it("floors then hands the leftover points to the largest remainders", () => {
    // 400 across equal thirds: 133.33 each -> 133,133,133 + 1 leftover to the first (all tied)
    expect(largestRemainderSplit(400, [100, 100, 100])).toEqual([134, 133, 133]);
    // 10 across 1:2:3 -> 1.67, 3.33, 5 -> floors 1,3,5 (=9), leftover 1 -> largest remainder is .67
    expect(largestRemainderSplit(10, [1, 2, 3])).toEqual([2, 3, 5]);
  });

  it("breaks remainder ties by larger weight, then position", () => {
    // 7 across 2:2:1 -> 2.8, 2.8, 1.4 -> floors 2,2,1 (=5), leftover 2 -> both .8s
    expect(largestRemainderSplit(7, [2, 2, 1])).toEqual([3, 3, 1]);
    // 5 across 1:3 -> 1.25, 3.75 -> 1,3 (=4) leftover 1 -> .75 wins
    expect(largestRemainderSplit(5, [1, 3])).toEqual([1, 4]);
  });

  it("always sums to the total and never gives less than the floor", () => {
    const rnd = lcg(42);
    for (let round = 0; round < 200; round++) {
      const n = 1 + Math.floor(rnd() * 12);
      const weights = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 5000));
      const total = Math.floor(rnd() * 100_000);
      const split = largestRemainderSplit(total, weights);
      const weightSum = weights.reduce((a, b) => a + b, 0);
      expect(split.reduce((a, b) => a + b, 0)).toBe(total);
      split.forEach((s, i) => {
        const exact = (total * weights[i]) / weightSum;
        expect(s).toBeGreaterThanOrEqual(Math.floor(exact));
        expect(s).toBeLessThanOrEqual(Math.floor(exact) + 1);
      });
    }
  });

  it("handles empty and degenerate inputs", () => {
    expect(largestRemainderSplit(100, [])).toEqual([]);
    expect(largestRemainderSplit(0, [1, 2])).toEqual([0, 0]);
    expect(() => largestRemainderSplit(10, [0, 0])).toThrow(RangeError);
    expect(() => largestRemainderSplit(-1, [1])).toThrow(RangeError);
  });
});

describe("settle", () => {
  it("pays the losing pool pro rata to the winners on top of their stakes", () => {
    const s = settle([pos("a", "yes", 100), pos("b", "yes", 50), pos("c", "no", 150)], "yes");
    expect(s).toMatchObject({ outcome: "yes", yesPool: 150, noPool: 150, total: 300, refunded: false, paid: 300 });
    expect(s.positions).toEqual([
      { userId: "a", side: "yes", points: 100, payout: 200, result: "won" },
      { userId: "b", side: "yes", points: 50, payout: 100, result: "won" },
      { userId: "c", side: "no", points: 150, payout: 0, result: "lost" },
    ]);
  });

  it("settles No the same way", () => {
    const s = settle([pos("a", "yes", 300), pos("b", "no", 100)], "no");
    expect(s.positions.find((p) => p.userId === "b")).toMatchObject({ payout: 400, result: "won" });
    expect(s.positions.find((p) => p.userId === "a")).toMatchObject({ payout: 0, result: "lost" });
    expect(s.paid).toBe(400);
  });

  it("rounds with largest remainder so the total paid equals the pool exactly", () => {
    const s = settle([pos("a", "yes", 100), pos("b", "yes", 100), pos("c", "yes", 100), pos("d", "no", 100)], "yes");
    expect(s.positions.map((p) => p.payout)).toEqual([134, 133, 133, 0]);
    expect(s.paid).toBe(400);
  });

  it("void refunds every stake, both sides", () => {
    const s = settle([pos("a", "yes", 100), pos("b", "no", 60), pos("a", "no", 40)], "void");
    expect(s.refunded).toBe(true);
    expect(s.paid).toBe(200);
    expect(s.positions.every((p) => p.result === "refunded" && p.payout === p.points)).toBe(true);
  });

  it("refunds a one-sided market whichever way the price went (no counterparty)", () => {
    const onlyYes = [pos("a", "yes", 100), pos("b", "yes", 250)];
    for (const outcome of ["yes", "no"] as Outcome[]) {
      const s = settle(onlyYes, outcome);
      expect(s.refunded).toBe(true);
      expect(s.paid).toBe(350);
      expect(s.positions.map((p) => [p.payout, p.result])).toEqual([
        [100, "refunded"],
        [250, "refunded"],
      ]);
    }
  });

  it("handles empty pools and no positions", () => {
    const s = settle([], "yes");
    expect(s).toMatchObject({ total: 0, paid: 0, refunded: true, positions: [] });
  });

  it("lets a user hold both sides: the winning side pays, the losing side is lost", () => {
    const s = settle([pos("a", "yes", 100), pos("a", "no", 100), pos("b", "no", 200)], "yes");
    const aYes = s.positions.find((p) => p.userId === "a" && p.side === "yes");
    const aNo = s.positions.find((p) => p.userId === "a" && p.side === "no");
    expect(aYes).toMatchObject({ payout: 400, result: "won" });
    expect(aNo).toMatchObject({ payout: 0, result: "lost" });
    expect(s.paid).toBe(400);
  });

  it("conserves the pool exactly across random markets", () => {
    const rnd = lcg(7);
    for (let round = 0; round < 300; round++) {
      const n = 1 + Math.floor(rnd() * 10);
      const positions = Array.from({ length: n }, (_, i) =>
        pos(`u${i % 6}`, rnd() < 0.5 ? "yes" : "no", 10 + Math.floor(rnd() * 4991)),
      );
      const outcome: Outcome = (["yes", "no", "void"] as const)[Math.floor(rnd() * 3)];
      const s = settle(positions, outcome);
      const total = positions.reduce((a, p) => a + p.points, 0);
      expect(s.total).toBe(total);
      expect(s.paid).toBe(total);
      expect(s.positions.reduce((a, p) => a + p.payout, 0)).toBe(total);
      for (const p of s.positions) {
        expect(Number.isInteger(p.payout)).toBe(true);
        if (p.result === "won") expect(p.payout).toBeGreaterThanOrEqual(p.points);
        if (p.result === "lost") expect(p.payout).toBe(0);
        if (p.result === "refunded") expect(p.payout).toBe(p.points);
      }
    }
  });

  it("rejects bad sides, outcomes and stakes", () => {
    expect(() => settle([{ userId: "a", side: "maybe" as "yes", points: 10 }], "yes")).toThrow(RangeError);
    expect(() => settle([pos("a", "yes", -5)], "yes")).toThrow(RangeError);
    expect(() => settle([pos("a", "yes", 5)], "later" as Outcome)).toThrow(RangeError);
  });
});
