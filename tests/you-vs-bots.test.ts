import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LeagueAccountView } from "@/lib/api-client";
import { YouVsBots, botComparison, botComparisonLabel, median, type BotRow } from "@/components/league/YouVsBots";
import { seasonProgress } from "@/components/common/SeasonArc";

// ---------------------------------------------------------------------------
// You versus the house bots (competition board, virtual cash)
// ---------------------------------------------------------------------------

const bot = (pnlPct: number): BotRow => ({ pnlPct, isBot: true });
const human = (pnlPct: number): BotRow => ({ pnlPct, isBot: false });
const me = (pnlPct: number) => ({ pnlPct });

/**
 * 15 seeded house bots, the count lib/games/league seeds. Tuned so a player on +2.4% produces the
 * decided example line: "You +2.4% · house bots median +0.8% · ahead of 11 of 15 bots".
 */
const FIFTEEN = [-4.2, -3.1, -2.05, -1.4, -0.6, 0.1, 0.4, 0.8, 1.2, 1.9, 2.3, 3.3, 4.1, 5.5, 7.2].map(bot);

describe("botComparison — the player against the house bots on the board", () => {
  it("returns the player's return, the house bots' median and how many they are ahead of", () => {
    const c = botComparison({ me: me(2.4), trades: 3, rows: FIFTEEN });
    expect(c).toEqual({ youPct: 2.4, medianPct: 0.8, ahead: 11, bots: 15 });
  });

  it("counts only house bots, never the humans on the board", () => {
    const rows = [...FIFTEEN, human(99), human(-99)];
    const c = botComparison({ me: me(2.4), trades: 1, rows });
    expect(c?.bots).toBe(15);
    expect(c?.ahead).toBe(11);
    expect(c?.medianPct).toBe(0.8);
  });

  it("averages the middle two when the bot count is even", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
    const c = botComparison({ me: me(5), trades: 1, rows: [bot(1), bot(2), bot(3), bot(4)] });
    expect(c).toEqual({ youPct: 5, medianPct: 2.5, ahead: 4, bots: 4 });
  });

  it("does not count a tie as ahead, and compares at the 2 decimals the board's pills show", () => {
    // 1.004 and 1.0 both render as +1.00%: neither may be reported as beaten.
    const c = botComparison({ me: me(1.0), trades: 1, rows: [bot(1.0), bot(1.004), bot(0.994), bot(2)] });
    expect(c?.ahead).toBe(1);
    expect(c?.bots).toBe(4);
  });

  it("drops an unusable return from both the median and the divisor", () => {
    const rows = [bot(1), bot(3), bot(Number.NaN), bot(Number.POSITIVE_INFINITY)];
    const c = botComparison({ me: me(5), trades: 1, rows });
    expect(c).toEqual({ youPct: 5, medianPct: 2, ahead: 2, bots: 2 });
  });

  it("renders nothing without an account, without a trade this week, or with an unusable return", () => {
    expect(botComparison({ me: null, trades: 3, rows: FIFTEEN })).toBeNull();
    expect(botComparison({ me: undefined, trades: 3, rows: FIFTEEN })).toBeNull();
    expect(botComparison({ me: me(2.4), trades: 0, rows: FIFTEEN })).toBeNull();
    expect(botComparison({ me: me(2.4), trades: Number.NaN, rows: FIFTEEN })).toBeNull();
    expect(botComparison({ me: me(Number.NaN), trades: 3, rows: FIFTEEN })).toBeNull();
  });

  it("renders nothing when there are no house bots to compare against", () => {
    expect(botComparison({ me: me(2.4), trades: 3, rows: [] })).toBeNull();
    expect(botComparison({ me: me(2.4), trades: 3, rows: [human(1), human(2)] })).toBeNull();
    expect(botComparison({ me: me(2.4), trades: 3, rows: [bot(Number.NaN)] })).toBeNull();
  });

  it("a flat week is still a comparison, and being last is reported as ahead of none", () => {
    expect(botComparison({ me: me(0), trades: 1, rows: FIFTEEN })).toMatchObject({ youPct: 0, ahead: 5 });
    expect(botComparison({ me: me(-99), trades: 1, rows: FIFTEEN })).toMatchObject({ ahead: 0, bots: 15 });
  });

  it("labels the seeded accounts as house bots and never as 'the house'", () => {
    const label = botComparisonLabel(botComparison({ me: me(2.4), trades: 3, rows: FIFTEEN })!);
    expect(label).toContain("house bots");
    expect(label).not.toMatch(/\bthe house\b/i);
    expect(label).toContain("+2.40%");
    expect(label).toContain("+0.80%");
    expect(label).toContain("ahead of 11");
    // Points only: the comparison never mentions money, a prize or a return in cash.
    expect(label).not.toMatch(/\$|profit|earn|prize|payout/i);
  });

  /**
   * The tooltip is not what a judge screenshots. A bare "ahead of 11 of 15" sits directly under the
   * account card and above a leaderboard whose own "Players" stat is a different number, so it reads
   * as 11 of 15 people — house-bot data in a form that can be taken for human. The visible run
   * carries the noun itself.
   */
  it("prints the noun in the visible line, so the count cannot be read as people", () => {
    const player = { pnlPct: 2.4, trades: [{}] } as unknown as LeagueAccountView;
    const html = renderToStaticMarkup(createElement(YouVsBots, { me: player, rows: FIFTEEN }));
    const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    expect(text).toContain("house bots median");
    expect(text).toContain("ahead of 11 of 15 bots");
  });
});

// ---------------------------------------------------------------------------
// Season progress arc
// ---------------------------------------------------------------------------

const SEASON_0 = { startsAt: "2026-09-14T00:00:00.000Z", endsAt: "2026-12-31T23:59:59.000Z" };

describe("seasonProgress — day N of M from the Season's own window", () => {
  it("counts the start date as day 1 and includes the end date in the total", () => {
    const p = seasonProgress(SEASON_0, "2026-09-16T09:00:00.000Z");
    expect(p).toMatchObject({ day: 3, totalDays: 109, endsLabel: "31 Dec", started: true, ended: false });
    expect(seasonProgress(SEASON_0, "2026-09-14T00:00:00.000Z")?.day).toBe(1);
    expect(seasonProgress(SEASON_0, "2026-12-31T12:00:00.000Z")?.day).toBe(109);
  });

  it("is computed in UTC, so a late-evening local clock does not skip a day", () => {
    expect(seasonProgress(SEASON_0, "2026-09-16T23:59:59.000Z")?.day).toBe(3);
    expect(seasonProgress(SEASON_0, "2026-09-17T00:00:00.000Z")?.day).toBe(4);
  });

  it("clamps before the first day and after the last one, and reports which it is", () => {
    expect(seasonProgress(SEASON_0, "2026-09-01T00:00:00.000Z")).toMatchObject({ day: 1, started: false, ended: false });
    expect(seasonProgress(SEASON_0, "2027-02-01T00:00:00.000Z")).toMatchObject({ day: 109, totalDays: 109, started: true, ended: true });
  });

  it("keeps the fill inside 0..1", () => {
    for (const now of ["2026-09-01T00:00:00.000Z", "2026-09-16T09:00:00.000Z", "2027-02-01T00:00:00.000Z"]) {
      const p = seasonProgress(SEASON_0, now)!;
      expect(p.elapsed).toBeGreaterThan(0);
      expect(p.elapsed).toBeLessThanOrEqual(1);
    }
    expect(seasonProgress(SEASON_0, "2026-12-31T12:00:00.000Z")?.elapsed).toBe(1);
  });

  it("handles a one-day Season", () => {
    const p = seasonProgress({ startsAt: "2026-09-16T00:00:00.000Z", endsAt: "2026-09-16T23:59:59.000Z" }, "2026-09-16T10:00:00.000Z");
    expect(p).toMatchObject({ day: 1, totalDays: 1, elapsed: 1 });
  });

  it("returns null for a missing, unparseable or reversed window", () => {
    expect(seasonProgress(null, "2026-09-16T09:00:00.000Z")).toBeNull();
    expect(seasonProgress(undefined, "2026-09-16T09:00:00.000Z")).toBeNull();
    expect(seasonProgress({ startsAt: "nonsense", endsAt: "2026-12-31T00:00:00.000Z" }, "2026-09-16T09:00:00.000Z")).toBeNull();
    expect(seasonProgress({ startsAt: "2026-09-14T00:00:00.000Z", endsAt: "oops" }, "2026-09-16T09:00:00.000Z")).toBeNull();
    expect(seasonProgress(SEASON_0, "not a date")).toBeNull();
    expect(seasonProgress({ startsAt: "2026-12-31T00:00:00.000Z", endsAt: "2026-09-14T00:00:00.000Z" }, "2026-09-16T09:00:00.000Z")).toBeNull();
  });
});
