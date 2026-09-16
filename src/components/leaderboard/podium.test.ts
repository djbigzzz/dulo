import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// rankLeaderboard is pure; its module also holds DB-backed queries, so the client and prices are stubbed.
vi.mock("@/lib/server/db", () => ({ db: {} }));
vi.mock("@/lib/price", () => ({
  getPrices: vi.fn(),
  getPriceBySymbol: vi.fn(),
  getPricesBySymbols: vi.fn(),
  UnknownAssetError: class UnknownAssetError extends Error {},
}));

import { rankLeaderboard } from "@/lib/server/queries";
import { medalTier, podiumSlots } from "@/components/leaderboard/podium-slots";

/** A Season board ranked the way the API ranks it (competition ranking, "1224"). */
function board(points: number[]) {
  return rankLeaderboard(points.map((p, i) => ({ userId: `u${i + 1}`, handle: null, address: null, points: p })));
}

const view = (rows: ReturnType<typeof board>) =>
  podiumSlots(rows).map((s) => [s.slot, s.row?.userId ?? null, s.tier, s.label, s.spokenLabel]);

describe("Podium ties (15 Sep review M-P)", () => {
  it("[350, 350, 100]: both players tied on rank 1 get the gold tier and '=1st'; slots stay 2-1-3", () => {
    expect(board([350, 350, 100]).map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(view(board([350, 350, 100]))).toEqual([
      [2, "u2", 1, "=1st", "Tied 1st"],
      [1, "u1", 1, "=1st", "Tied 1st"],
      [3, "u3", 3, "3rd", "3rd"],
    ]);
  });

  it("[100, 50, 50]: the two players tied on rank 2 are both silver '=2nd'", () => {
    expect(board([100, 50, 50]).map((r) => r.rank)).toEqual([1, 2, 2]);
    expect(view(board([100, 50, 50]))).toEqual([
      [2, "u2", 2, "=2nd", "Tied 2nd"],
      [1, "u1", 1, "1st", "1st"],
      [3, "u3", 2, "=2nd", "Tied 2nd"],
    ]);
  });

  it("without ties the tiers match the slots", () => {
    expect(view(board([300, 200, 100]))).toEqual([
      [2, "u2", 2, "2nd", "2nd"],
      [1, "u1", 1, "1st", "1st"],
      [3, "u3", 3, "3rd", "3rd"],
    ]);
  });

  it("a three-way tie is gold across the podium; missing spots stay empty", () => {
    expect(view(board([50, 50, 50])).map((s) => s[3])).toEqual(["=1st", "=1st", "=1st"]);
    expect(view(board([100]))).toEqual([
      [2, null, 2, "2nd", "2nd"],
      [1, "u1", 1, "1st", "1st"],
      [3, null, 3, "3rd", "3rd"],
    ]);
  });

  it("medalTier clamps to the podium", () => {
    expect([0, 1, 2, 3, 7, Number.NaN].map(medalTier)).toEqual([1, 1, 2, 3, 3, 3]);
  });

  it("Podium renders medal, crown and chip from the tier, not from the slot", () => {
    const src = readFileSync(path.join(__dirname, "Podium.tsx"), "utf8");
    expect(src).toContain("podiumSlots(rows)");
    expect(src).toContain("MEDAL[tier]");
    expect(src).toContain("tier === 1 ? <Crown");
    expect(src).not.toMatch(/positions\s*:/);
  });
});
