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
  stakeError,
  strikeDistance,
} from "@/components/calls/calls-format";

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

  it("says predictions lock at the Friday close (locksAt = settleAt - 5 min, settleAt = close + 5 min), everywhere on /predictions", () => {
    expect(CALLS_LOCK_COPY).toBe("Predictions lock at the Friday close; settlement runs 5 minutes later.");
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

  it("labels the side buttons with share and multiplier", () => {
    const odds = { yesProb: 0.64, noProb: 0.36, yesMultiplier: 1.5625, noMultiplier: 2.7777777 };
    expect(sideButtonLabel(odds, "yes")).toBe("Yes 64% · 1.56x");
    expect(sideButtonLabel(odds, "no")).toBe("No 36% · 2.78x");
    expect(sideButtonLabel({ yesProb: 0.5, noProb: 0.5, yesMultiplier: null, noMultiplier: null }, "yes")).toBe("Yes 50%");
  });
});
