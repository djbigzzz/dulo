import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CALLS_LOCK_COPY,
  EARN_FIRST_POINTS_COPY,
  NEXT_WEEK_MARKETS_COPY,
  STAKE_LEAVES_SCORE_COPY,
  DEFAULT_PREDICTION_POINTS,
  completedPlayToast,
  defaultPredictionPoints,
  formatCountdown,
  formatMultiplier,
  formatPct,
  liveStatus,
  lockLabel,
  marketQuestion,
  needsPointsForCall,
  newlyCompletedOf,
  outcomeLabel,
  resultLabel,
  sideButtonLabel,
  sideForKey,
  soonestLockMs,
  splitPct,
  stakeError,
  strikeDistance,
  STRIKE_NOTE,
  backPerPoint,
  crowdLead,
  crowdSaid,
  gapLabel,
  liveWeekHeading,
  predictionsBoard,
  predictionsClock,
  settleSourceLabel,
  trackPosition,
  utcStamp,
  weekOfLabel,
} from "@/components/calls/calls-format";
import type { CallMarketView } from "@/lib/api-client";

describe("calls-format — first-session copy and helpers (15 Sep review M-F)", () => {
  it("carries the agreed copy: no 'Monday', the First Paper Trades path and the balance line", () => {
    expect(NEXT_WEEK_MARKETS_COPY).toBe("Next week's predictions open right after Friday's settle.");
    expect(NEXT_WEEK_MARKETS_COPY).not.toMatch(/monday/i);
    expect(EARN_FIRST_POINTS_COPY).toBe("Out of points? Paper-trade in the weekly competition with virtual cash: 3 trades complete First Paper Trades (+50)");
    expect(STAKE_LEAVES_SCORE_COPY).toBe(
      "Points you put in leave your balance until Friday's settlement; your Season points change only when it settles.",
    );
  });

  it("says the balance and the Season points move at different times, with no betting words", () => {
    // Balance: the debit lands at once. Season points: only at settlement (open predictions are skipped).
    expect(STAKE_LEAVES_SCORE_COPY).toMatch(/leave your balance/);
    expect(STAKE_LEAVES_SCORE_COPY).toMatch(/Season points change only when it settles/);
    for (const banned of ["stake", "odds", "payout", "bet", "score"]) {
      expect(STAKE_LEAVES_SCORE_COPY.toLowerCase().split(/[^a-z]+/), banned).not.toContain(banned);
    }
  });

  it("says entries close 24 hours before the Friday close (locksAt = settleAt - 24 h 5 min, settleAt = close + 5 min), everywhere on /predictions", () => {
    expect(CALLS_LOCK_COPY).toBe("Entries close 24 hours before the Friday close; settlement falls due 5 minutes after the close.");
    const page = readFileSync(path.join(process.cwd(), "src/app/predictions/page.tsx"), "utf8");
    expect(page).not.toMatch(/lock 5 minutes before/i);
    expect(page.match(/CALLS_LOCK_COPY/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("opens the dialog on 100 points, or the minimum below 100, and never on the whole balance", () => {
    expect(DEFAULT_PREDICTION_POINTS).toBe(100);
    expect(defaultPredictionPoints(1000, 10)).toBe("100");
    expect(defaultPredictionPoints(5000, 10)).toBe("100");
    expect(defaultPredictionPoints(100, 10)).toBe("100");
    expect(defaultPredictionPoints(99, 10)).toBe("10");
    expect(defaultPredictionPoints(10, 10)).toBe("10");
    expect(defaultPredictionPoints(9, 10)).toBe("");
    expect(defaultPredictionPoints(0, 10)).toBe("");
    expect(defaultPredictionPoints(-5, 10)).toBe("");
    expect(defaultPredictionPoints(Number.NaN, 10)).toBe("");
    // Whatever the balance, the default is a valid amount the balance covers, and it is never all of it
    // unless the balance is exactly 100 or exactly the minimum.
    for (const balance of [10, 11, 55, 99, 100, 101, 250, 825, 1000, 4999, 5000, 12_000]) {
      const raw = defaultPredictionPoints(balance, 10);
      const { points, error } = stakeError(raw, balance, { min: 10, max: 5000 });
      expect(error, String(balance)).toBeNull();
      expect(points, String(balance)).not.toBeNull();
      expect(points! <= balance, String(balance)).toBe(true);
      if (balance !== 100 && balance !== 10) expect(points, String(balance)).not.toBe(balance);
    }
  });

  it("needs points below the minimum stake, including a missing balance", () => {
    expect(needsPointsForCall(0, 10)).toBe(true);
    expect(needsPointsForCall(9, 10)).toBe(true);
    expect(needsPointsForCall(10, 10)).toBe(false);
    expect(needsPointsForCall(5000, 10)).toBe(false);
    expect(needsPointsForCall(Number.NaN, 10)).toBe(true);
  });

  it("moves the Yes/No radio with arrow keys (wrapping), Home and End, and ignores other keys", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      expect(sideForKey("yes", key), key).toBe("no");
      expect(sideForKey("no", key), key).toBe("yes");
    }
    expect(sideForKey("no", "Home")).toBe("yes");
    expect(sideForKey("yes", "End")).toBe("no");
    expect(sideForKey("yes", "Enter")).toBeNull();
    expect(sideForKey("yes", " ")).toBeNull();
    expect(sideForKey("yes", "Tab")).toBeNull();
  });

  it("toasts a quest the prediction completed", () => {
    expect(completedPlayToast({ title: "First Prediction", points: 50 })).toEqual({
      title: "Quest complete: First Prediction · +50 pts",
      description: "Added to your Season points. Points only, no cash value.",
    });
    expect(completedPlayToast({ title: "Big", points: 1500 }).title).toBe("Quest complete: Big · +1,500 pts");
  });

  it("reads newlyCompleted defensively from a placement response", () => {
    const oracle = { key: "oracle", title: "First Prediction", points: 50 };
    expect(newlyCompletedOf({ newlyCompleted: [oracle] })).toEqual([oracle]);
    expect(newlyCompletedOf({ newlyCompleted: [oracle, { key: "x" }, null, { key: "y", title: "Y", points: Number.NaN }] })).toEqual([oracle]);
    expect(newlyCompletedOf({ position: {} })).toEqual([]);
    expect(newlyCompletedOf({ newlyCompleted: "oracle" })).toEqual([]);
    expect(newlyCompletedOf(null)).toEqual([]);
  });
});

const SETTLE = "2026-09-18T20:05:00.000Z";
const LOCKS = "2026-09-18T20:00:00.000Z";

describe("calls-format", () => {
  it("phrases the market question from the template", () => {
    expect(marketQuestion({ ticker: "NVDA", strike: 210, settleAt: SETTLE })).toBe("Will NVDA close above $210.00 on Fri 18 Sep?");
    expect(marketQuestion({ ticker: "SPY", strike: 760.5, settleAt: SETTLE })).toBe("Will SPY close above $760.50 on Fri 18 Sep?");
  });

  it("formats countdowns in whole units and never below zero", () => {
    expect(formatCountdown(3 * 86400_000 + 4 * 3600_000 + 59_000)).toBe("3d 4h");
    expect(formatCountdown(4 * 3600_000 + 12 * 60_000)).toBe("4h 12m");
    expect(formatCountdown(12 * 60_000 + 5_000)).toBe("12m 05s");
    expect(formatCountdown(42_000)).toBe("42s");
    expect(formatCountdown(-5_000)).toBe("0s");
  });

  it("re-derives the lock from the clock and labels it", () => {
    const m = { status: "open" as const, locksAt: LOCKS, settleAt: SETTLE };
    const beforeLock = Date.parse(LOCKS) - 90_000;
    expect(liveStatus(m, beforeLock)).toBe("open");
    expect(lockLabel(m, beforeLock)).toBe("Locks in 1m 30s");
    expect(liveStatus(m, Date.parse(LOCKS))).toBe("locked");
    expect(lockLabel(m, Date.parse(LOCKS) + 60_000)).toBe("Locked · settles in 4m 00s");
    expect(lockLabel(m, Date.parse(SETTLE) + 1)).toBe("Locked · settling");
    expect(lockLabel({ ...m, status: "settled" }, 0)).toBe("Settled");
    expect(lockLabel({ ...m, status: "void" }, 0)).toBe("Void");
    // A server-stamped locked/settled status is never downgraded by the local clock.
    expect(liveStatus({ ...m, status: "locked" }, 0)).toBe("locked");
  });

  it("formats multipliers and percentages", () => {
    expect(formatMultiplier(null)).toBe("—");
    expect(formatMultiplier(1)).toBe("1x");
    expect(formatMultiplier(4 / 3)).toBe("1.33x");
    expect(formatMultiplier(2.5)).toBe("2.5x");
    expect(formatMultiplier(12.7)).toBe("13x");
    expect(formatPct(0.625)).toBe("63%");
    expect(formatPct(0.5)).toBe("50%");
  });

  it("splits Yes / No into whole percents that always add up to 100", () => {
    // 620 / 180 (77.5% / 22.5%): rounding each side alone would print 78% and 23%.
    expect(splitPct({ yesProb: 620 / 800 })).toEqual({ yes: "78%", no: "22%" });
    // 3 : 5 (37.5% / 62.5%): rounding each side alone would print 38% and 63%.
    expect(splitPct({ yesProb: 3 / 8 })).toEqual({ yes: "38%", no: "62%" });
    expect(splitPct({ yesProb: 0.5 })).toEqual({ yes: "50%", no: "50%" });
    for (let yes = 0; yes <= 1000; yes += 7) {
      const { yes: y, no: n } = splitPct({ yesProb: yes / 1000 });
      expect(parseInt(y, 10) + parseInt(n, 10)).toBe(100);
    }
    expect(sideButtonLabel({ yesProb: 0.775, noProb: 0.225, yesMultiplier: null, noMultiplier: null }, "no")).toBe("No 22%");
  });

  it("labels outcomes and results", () => {
    expect(outcomeLabel("yes")).toBe("Closed above · Yes");
    expect(outcomeLabel("no")).toBe("Closed at or below · No");
    expect(outcomeLabel("void")).toBe("Void · refunded");
    expect(outcomeLabel(null)).toBe("Pending");
    expect(resultLabel({ result: "won", points: 100, payout: 160 })).toBe("Right · +60 pts");
    expect(resultLabel({ result: "won", points: 100, payout: null })).toBe("Right");
    expect(resultLabel({ result: "lost", points: 100, payout: 0 })).toBe("Missed · −100 pts");
    expect(resultLabel({ result: "refunded", points: 100, payout: 100 })).toBe("Refunded");
    expect(resultLabel({ result: "pending", points: 100, payout: null })).toBe("Pending");
  });

  it("validates the stake input against bounds and balance", () => {
    const b = { min: 10, max: 5000 };
    expect(stakeError("", 500, b)).toEqual({ points: null, error: null });
    expect(stakeError("100", 500, b)).toEqual({ points: 100, error: null });
    expect(stakeError("10.5", 500, b)).toMatchObject({ points: null, error: "Whole points only" });
    expect(stakeError("5", 500, b)).toMatchObject({ points: null, error: "At least 10 pts" });
    expect(stakeError("6000", 9000, b)).toMatchObject({ points: null, error: "At most 5,000 pts" });
    expect(stakeError("600", 500, b)).toMatchObject({ points: null, error: "You have 500 pts to spend" });
    expect(stakeError("abc", 500, b)).toMatchObject({ points: null, error: "Whole points only" });
  });

  it("describes the distance to the strike", () => {
    expect(strikeDistance(212, 213.29)).toBe("$1.29 below strike");
    expect(strikeDistance(759.43, 759.39)).toBe("$0.04 above strike");
    expect(strikeDistance(100.001, 100)).toBe("at the strike");
    expect(strikeDistance(null, 100)).toBeNull();
  });

  it("finds the soonest lock among open markets", () => {
    const now = Date.parse(LOCKS) - 60_000;
    const later = new Date(Date.parse(LOCKS) + 3_600_000).toISOString();
    expect(soonestLockMs([{ status: "open", locksAt: later }, { status: "open", locksAt: LOCKS }], now)).toBe(60_000);
    expect(soonestLockMs([{ status: "settled", locksAt: LOCKS }], now)).toBeNull();
    expect(soonestLockMs([{ status: "open", locksAt: LOCKS }], Date.parse(LOCKS))).toBeNull();
  });

  it("labels the side buttons with the share, and the points back only in words for screen readers", () => {
    const odds = { yesProb: 0.64, noProb: 0.36, yesMultiplier: 1.5625, noMultiplier: 2.7777777 };
    expect(sideButtonLabel(odds, "yes")).toBe("Yes 64%, 1.56x points back if correct");
    expect(sideButtonLabel(odds, "no")).toBe("No 36%, 2.78x points back if correct");
    expect(sideButtonLabel({ yesProb: 0.5, noProb: 0.5, yesMultiplier: null, noMultiplier: null }, "yes")).toBe("Yes 50%");
  });
});

/** A market as GET /api/v1/calls returns it, with only what the Broadcast helpers read filled in. */
function market(over: Partial<CallMarketView> & Pick<CallMarketView, "id" | "settleAt">): CallMarketView {
  const settle = Date.parse(over.settleAt);
  return {
    ticker: "NVDA",
    symbol: "NVDAx",
    strike: 234.25,
    locksAt: new Date(settle - 24 * 3_600_000 - 5 * 60_000).toISOString(),
    status: "open",
    yesPool: 320,
    noPool: 430,
    odds: { yesPool: 320, noPool: 430, total: 750, yesProb: 320 / 750, noProb: 430 / 750, yesMultiplier: 750 / 320, noMultiplier: 750 / 430 },
    settledPrice: null,
    outcome: null,
    source: null,
    quote: null,
    ...over,
  };
}

// The week of 5 Oct 2026: entries close Thu 8 Oct 20:00 UTC, the close is Fri 9 Oct 20:00, the settle 20:05.
const THIS_SETTLE = "2026-10-09T20:05:00.000Z";
const LAST_SETTLE = "2026-10-02T20:05:00.000Z";
const THU_MORNING = Date.parse("2026-10-08T13:58:00.000Z");

describe("calls-format — Broadcast segments", () => {
  it("puts the line in the middle of the track and the price between 20% and 80% of it", () => {
    const below = trackPosition(234.01, 234.25);
    expect(below?.gap).toBeCloseTo(-0.24, 6);
    expect(below?.p).toBeGreaterThan(30);
    expect(below?.p).toBeLessThan(50);
    expect(trackPosition(234.25, 234.25)?.p).toBe(50);
    // A big move lands at 80%, not off the end.
    expect(trackPosition(120, 100)?.p).toBeCloseTo(80, 6);
    expect(trackPosition(80, 100)?.p).toBeCloseTo(20, 6);
    // Nothing to draw without a usable price or line.
    expect(trackPosition(null, 100)).toBeNull();
    expect(trackPosition(undefined, 100)).toBeNull();
    expect(trackPosition(Number.NaN, 100)).toBeNull();
    expect(trackPosition(100, 0)).toBeNull();
  });

  it("says the gap to the line to the cent, in plain words", () => {
    expect(gapLabel(-0.24)).toBe("$0.24 below");
    expect(gapLabel(5.48)).toBe("$5.48 above");
    expect(gapLabel(1234.5)).toBe("$1,234.50 above");
    expect(gapLabel(0.004)).toBe("At the line");
    expect(gapLabel(Number.NaN)).toBe("At the line");
    // The strike is the quote when the market opened, never an official close.
    expect(STRIKE_NOTE).toBe("price when it opened");
  });

  it("names the side with more points in, and says an even or empty split in words", () => {
    expect(crowdLead({ total: 750, yesProb: 320 / 750 })).toEqual({ side: "no", pct: "57%" });
    expect(crowdLead({ total: 650, yesProb: 0.62 })).toEqual({ side: "yes", pct: "62%" });
    expect(crowdLead({ total: 500, yesProb: 0.5 })).toBeNull();
    expect(crowdLead({ total: 0, yesProb: 0.5 })).toBeNull();
    expect(crowdSaid({ total: 500, yesProb: 0.64 })).toBe("64% said Yes");
    expect(crowdSaid({ total: 500, yesProb: 0.5 })).toBe("An even split");
    expect(crowdSaid({ total: 0, yesProb: 0.5 })).toBe("No points in");
  });

  it("stamps times in UTC, the same string in every zone", () => {
    expect(utcStamp("2026-10-08T20:00:00.000Z")).toBe("Thu 8 Oct · 20:00 UTC");
    expect(utcStamp(LAST_SETTLE)).toBe("Fri 2 Oct · 20:05 UTC");
    expect(utcStamp("not a date")).toBe("");
    expect(utcStamp(null)).toBe("");
    expect(weekOfLabel(LAST_SETTLE)).toBe("Week of 28 Sep");
    expect(weekOfLabel(THIS_SETTLE)).toBe("Week of 5 Oct");
  });

  it("heads the live segments by the week they settle in", () => {
    expect(liveWeekHeading(THIS_SETTLE, THU_MORNING)).toBe("This week");
    // Saturday: next week's three are already open.
    expect(liveWeekHeading("2026-10-16T20:05:00.000Z", Date.parse("2026-10-10T11:00:00.000Z"))).toBe("Next week");
    expect(liveWeekHeading("2026-10-23T20:05:00.000Z", THU_MORNING)).toBe("Week of 19 Oct");
    expect(liveWeekHeading("bad", THU_MORNING)).toBe("This week");
  });

  it("splits the board into live segments (open first) and settled weeks (newest first)", () => {
    const open = market({ id: "spy", ticker: "SPY", settleAt: THIS_SETTLE });
    const early = market({ id: "nvda", settleAt: THIS_SETTLE, locksAt: "2026-10-08T10:00:00.000Z" });
    const lastYes = market({ id: "l1", settleAt: LAST_SETTLE, status: "settled", outcome: "yes", settledPrice: 234.25, source: "jupiter" });
    const lastVoid = market({ id: "l2", settleAt: "2026-10-02T20:09:00.000Z", status: "void", outcome: "void" });
    const older = market({ id: "o1", settleAt: "2026-09-25T20:05:00.000Z", status: "settled", outcome: "no" });
    const board = predictionsBoard([early, open, older, lastYes, lastVoid], THU_MORNING);
    // nvda's lock has passed on the client clock: it follows the one still taking points.
    expect(board.live.map((m) => m.id)).toEqual(["spy", "nvda"]);
    expect(board.results.map((w) => w.label)).toEqual(["Week of 28 Sep", "Week of 21 Sep"]);
    expect(board.results[0].markets.map((m) => m.id)).toEqual(["l1", "l2"]);
    // The week's settle stamp is its latest settle.
    expect(board.results[0].settleAt).toBe("2026-10-02T20:09:00.000Z");
  });

  it("shows one page clock: the lock, then the settle, then the FINAL week", () => {
    const a = market({ id: "a", settleAt: THIS_SETTLE });
    const b = market({ id: "b", settleAt: THIS_SETTLE, locksAt: "2026-10-08T19:00:00.000Z" });
    const last = market({ id: "l", settleAt: LAST_SETTLE, status: "settled", outcome: "yes" });

    const open = predictionsClock(predictionsBoard([a, b, last], THU_MORNING), THU_MORNING);
    expect(open).toEqual({ kind: "lock", at: Date.parse("2026-10-08T19:00:00.000Z"), iso: "2026-10-08T19:00:00.000Z" });

    const friday = Date.parse("2026-10-09T09:12:00.000Z");
    expect(predictionsClock(predictionsBoard([a, b, last], friday), friday)).toEqual({ kind: "settle", iso: THIS_SETTLE, settling: false });
    const after = Date.parse(THIS_SETTLE) + 60_000;
    expect(predictionsClock(predictionsBoard([a, b], after), after)).toMatchObject({ kind: "settle", settling: true });

    const weekend = predictionsClock(predictionsBoard([last], friday), friday);
    expect(weekend.kind).toBe("final");
    expect(weekend.kind === "final" && weekend.week.label).toBe("Week of 28 Sep");
    expect(predictionsClock(predictionsBoard([], friday), friday)).toEqual({ kind: "none" });
  });

  it("names the settle source and what one point gets back, with no betting words", () => {
    expect(settleSourceLabel("pyth")).toBe("Pyth");
    expect(settleSourceLabel("jupiter")).toBe("Jupiter");
    expect(settleSourceLabel(null)).toBeNull();
    expect(backPerPoint(750 / 430)).toBe("1.74 back per point");
    expect(backPerPoint(2)).toBe("2 back per point");
    expect(backPerPoint(null)).toBe("Nobody on this side yet");
    for (const line of [backPerPoint(1.5), crowdSaid({ total: 1, yesProb: 1 }), gapLabel(1), STRIKE_NOTE]) {
      expect(line).not.toMatch(/\b(stake|odds|payout|bet)\b/i);
    }
  });
});
