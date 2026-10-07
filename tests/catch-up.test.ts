import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/cron/catch-up: the boards run the games step themselves when a settlement or a weekly
// rollover is overdue, at most one check a minute per instance and one run at a time.

const mocks = vi.hoisted(() => ({
  marketCount: vi.fn(),
  leagueCount: vi.fn(),
  runTick: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({ db: { market: { count: mocks.marketCount }, league: { count: mocks.leagueCount } } }));
vi.mock("@/lib/cron/tick", () => ({ runTick: mocks.runTick }));

import { CHECK_INTERVAL_MS, catchUpGames, gamesDue, resetCatchUp } from "@/lib/cron/catch-up";

const NOW = new Date("2026-10-09T20:20:00.000Z");

/** unsettled, upcoming, endedOpen, thisWeek */
function counts(unsettled: number, upcoming: number, endedOpen: number, thisWeek: number) {
  mocks.marketCount.mockReset().mockImplementation(async ({ where }) => ("outcome" in where ? unsettled : upcoming));
  mocks.leagueCount.mockReset().mockImplementation(async ({ where }) => ("status" in where ? endedOpen : thisWeek));
}

describe("games catch-up", () => {
  beforeEach(() => {
    resetCatchUp();
    mocks.runTick.mockReset().mockResolvedValue({ ranAt: NOW.toISOString(), steps: [{ name: "games", ok: true, took: 1 }] });
  });

  it("is idle when nothing is overdue", async () => {
    counts(0, 3, 0, 1);
    expect(await gamesDue(NOW)).toEqual({ due: false, reasons: [] });
    expect(await catchUpGames(NOW)).toBe("idle");
    expect(mocks.runTick).not.toHaveBeenCalled();
  });

  it("runs only the games step when a market is past its settle time", async () => {
    counts(3, 0, 1, 0);
    const due = await gamesDue(NOW);
    expect(due.reasons).toEqual(["market past settle", "no upcoming market", "ended week still open", "no league for this week"]);
    expect(await catchUpGames(NOW)).toBe("ran");
    expect(mocks.runTick).toHaveBeenCalledWith(expect.any(Date), { steps: ["games"] });
  });

  it("checks at most once a minute per instance", async () => {
    counts(1, 3, 0, 1);
    expect(await catchUpGames(NOW)).toBe("ran");
    expect(await catchUpGames(new Date(NOW.getTime() + CHECK_INTERVAL_MS - 1))).toBe("throttled");
    expect(await catchUpGames(new Date(NOW.getTime() + CHECK_INTERVAL_MS))).toBe("ran");
    expect(mocks.runTick).toHaveBeenCalledTimes(2);
  });

  it("never throws: a failing count or tick reports failed", async () => {
    mocks.marketCount.mockReset().mockRejectedValue(new Error("db down"));
    mocks.leagueCount.mockReset().mockResolvedValue(1);
    expect(await catchUpGames(NOW)).toBe("failed");
  });

  it("the public boards schedule it after the response", async () => {
    const { readFileSync } = await import("node:fs");
    for (const route of ["src/app/api/v1/calls/route.ts", "src/app/api/v1/league/route.ts"]) {
      expect(readFileSync(route, "utf8")).toContain("after(() => catchUpGames())");
    }
  });
});
