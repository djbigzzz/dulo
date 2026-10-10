/**
 * Pure helpers for the Calls UI (client-safe, no React) so the copy and the countdown
 * maths can be unit tested.
 */
import type { CallMarketStatus, CallMarketView, CallOutcome, CallPositionView, CallSide } from "@/lib/api-client";
import type { NewlyCompletedPlay } from "@/lib/games/calls";
import { formatUsd } from "@/components/common/format";

export const QUICK_STAKES = [50, 100, 250] as const;

/** The cron opens next week's board on the first tick after Friday's settle (lib/games/calls ensureWeeklyMarkets). */
export const NEXT_WEEK_MARKETS_COPY = "Next week's predictions open right after Friday's settle.";

/** Calls lock 24 hours before the session close (locksAt = settleAt - 24 h 5 min, settleAt = close + 5 min in lib/games/calls). */
export const CALLS_LOCK_COPY = "Entries close 24 hours before the Friday close; settlement falls due 5 minutes after the close.";

/**
 * Points put into a prediction are debited from the ledger at once, so they leave the spendable
 * balance straight away. Season points skip open predictions (seasonScoreWhere in lib/server/queries)
 * and change only when the market settles: points back, a refund, or the loss counting against them.
 */
export const STAKE_LEAVES_SCORE_COPY =
  "Points you put in leave your balance until Friday's settlement; your Season points change only when it settles.";

/** The zero-capital path to more points: the First Paper Trades quest (3 paper trades with virtual cash, +50). */
export const EARN_FIRST_POINTS_COPY = "Out of points? Paper-trade in the weekly competition with virtual cash: 3 trades complete First Paper Trades (+50)";

/** The amount the prediction dialog opens on, when the balance allows it. */
export const DEFAULT_PREDICTION_POINTS = 100;

/**
 * The dialog's opening amount: 100, or the minimum when the balance is between the minimum and 99,
 * or empty below the minimum. Never the whole balance.
 */
export function defaultPredictionPoints(balance: number, min: number): string {
  if (!Number.isFinite(balance)) return "";
  if (balance >= DEFAULT_PREDICTION_POINTS) return String(DEFAULT_PREDICTION_POINTS);
  return balance >= min ? String(min) : "";
}

/** True when the viewer cannot stake even the minimum (NaN / missing balances count as short). */
export function needsPointsForCall(spendable: number, min: number): boolean {
  return !(spendable >= min);
}

/**
 * Roving-tabindex radio keys for the Yes/No group: any arrow key moves to the other side
 * (two options, so it wraps), Home is Yes, End is No. Null for keys the group ignores.
 */
export function sideForKey(current: CallSide, key: string): CallSide | null {
  switch (key) {
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown":
      return current === "yes" ? "no" : "yes";
    case "Home":
      return "yes";
    case "End":
      return "no";
    default:
      return null;
  }
}

/** Toast copy for a quest the prediction just completed: "Quest complete: First Prediction · +50 pts". */
export function completedPlayToast(play: Pick<NewlyCompletedPlay, "title" | "points">): { title: string; description: string } {
  return {
    title: `Quest complete: ${play.title} · +${play.points.toLocaleString("en-US")} pts`,
    description: "Added to your Season points. Points only, no cash value.",
  };
}

/** `newlyCompleted` from a placement response, read defensively: anything malformed is dropped. */
export function newlyCompletedOf(result: unknown): NewlyCompletedPlay[] {
  if (typeof result !== "object" || result === null) return [];
  const list = (result as { newlyCompleted?: unknown }).newlyCompleted;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (p): p is NewlyCompletedPlay =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as NewlyCompletedPlay).key === "string" &&
      typeof (p as NewlyCompletedPlay).title === "string" &&
      typeof (p as NewlyCompletedPlay).points === "number" &&
      Number.isFinite((p as NewlyCompletedPlay).points),
  );
}

/**
 * "Fri 18 Sep" in the viewer's zone. Assembled from en-US parts so the month is always
 * the three-letter form (en-GB's ICU data spells September "Sept").
 */
export function formatSettleDay(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/** "Will NVDA close above $210.00 on Fri 18 Sep?" */
export function marketQuestion(m: Pick<CallMarketView, "ticker" | "strike" | "settleAt">): string {
  return `Will ${m.ticker} close above ${formatUsd(m.strike)} on ${formatSettleDay(m.settleAt)}?`;
}

/** "3d 4h" | "4h 12m" | "12m 05s" | "0s" — whole units, no negatives. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/**
 * Status as the client sees it right now: the server stamps `status` at response time,
 * but the lock is a clock event, so re-derive "open" -> "locked" from `locksAt` locally.
 */
export function liveStatus(m: Pick<CallMarketView, "status" | "locksAt">, nowMs: number): CallMarketStatus {
  if (m.status !== "open") return m.status;
  return nowMs >= Date.parse(m.locksAt) ? "locked" : "open";
}

/** "Locks in 3d 4h" | "Locked · settling" | "Settled" | "Void" */
export function lockLabel(m: Pick<CallMarketView, "status" | "locksAt" | "settleAt">, nowMs: number): string {
  const status = liveStatus(m, nowMs);
  if (status === "settled") return "Settled";
  if (status === "void") return "Void";
  if (status === "locked") {
    return nowMs >= Date.parse(m.settleAt) ? "Locked · settling" : `Locked · settles in ${formatCountdown(Date.parse(m.settleAt) - nowMs)}`;
  }
  return `Locks in ${formatCountdown(Date.parse(m.locksAt) - nowMs)}`;
}

/** "1.6x" | "—" */
export function formatMultiplier(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return "—";
  return `${x >= 10 ? x.toFixed(0) : x.toFixed(2).replace(/\.?0+$/, "")}x`;
}

/** "62%" — one share as a whole percent. For a Yes / No pair use splitPct, which always sums to 100. */
export function formatPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/**
 * The current split as two whole percents that add up to 100: No is 100 minus the rounded Yes,
 * so a 620 / 180 pool (77.5% / 22.5%) reads "78%" / "22%", never "78%" / "23%".
 */
export function splitPct(odds: Pick<CallMarketView["odds"], "yesProb">): { yes: string; no: string } {
  const yes = Math.round(odds.yesProb * 100);
  return { yes: `${yes}%`, no: `${100 - yes}%` };
}

export function sideLabel(side: CallSide): string {
  return side === "yes" ? "Yes" : "No";
}

/** "Closed above · Yes" / "Closed at or below · No" / "Void · refunded" */
export function outcomeLabel(outcome: CallOutcome | null): string {
  if (outcome === "yes") return "Closed above · Yes";
  if (outcome === "no") return "Closed at or below · No";
  if (outcome === "void") return "Void · refunded";
  return "Pending";
}

/** One line for the user's result on a settled market. */
export function resultLabel(p: Pick<CallPositionView, "result" | "points" | "payout">): string {
  switch (p.result) {
    case "won":
      return p.payout === null ? "Right" : `Right · +${p.payout - p.points} pts`;
    case "lost":
      return `Missed · −${p.points} pts`;
    case "refunded":
      return "Refunded";
    default:
      return "Pending";
  }
}

/** Points-input validation shared by the dialog and the quick chips. */
export function stakeError(
  raw: string,
  spendable: number,
  bounds: { min: number; max: number },
): { points: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { points: null, error: null };
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return { points: null, error: "Whole points only" };
  if (n < bounds.min) return { points: null, error: `At least ${bounds.min} pts` };
  if (n > bounds.max) return { points: null, error: `At most ${bounds.max.toLocaleString("en-US")} pts` };
  if (n > spendable) return { points: null, error: `You have ${spendable.toLocaleString("en-US")} pts to spend` };
  return { points: n, error: null };
}

/** "$1.29 below strike" | "$0.04 above strike" | "at the strike" | null when there is no price. */
export function strikeDistance(price: number | null | undefined, strike: number): string | null {
  if (price === null || price === undefined || !Number.isFinite(price)) return null;
  const diff = price - strike;
  if (Math.abs(diff) < 0.005) return "at the strike";
  const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents.format(Math.abs(diff))} ${diff > 0 ? "above" : "below"} strike`;
}

/** Milliseconds until the soonest lock among markets still open at `nowMs`; null when none are open. */
export function soonestLockMs(markets: Pick<CallMarketView, "status" | "locksAt">[], nowMs: number): number | null {
  let best: number | null = null;
  for (const m of markets) {
    if (liveStatus(m, nowMs) !== "open") continue;
    const ms = Date.parse(m.locksAt) - nowMs;
    if (best === null || ms < best) best = ms;
  }
  return best;
}

/** Side button copy: "Yes 64% · 1.56x", or "Yes 50%" while nobody is on that side. */
export function sideButtonLabel(odds: Pick<CallMarketView["odds"], "yesProb" | "noProb" | "yesMultiplier" | "noMultiplier">, side: CallSide): string {
  const pct = splitPct(odds)[side];
  const mult = side === "yes" ? odds.yesMultiplier : odds.noMultiplier;
  return mult === null ? `${sideLabel(side)} ${pct}` : `${sideLabel(side)} ${pct}, ${formatMultiplier(mult)} points back if correct`;
}

// ---------------------------------------------------------------------------
// Broadcast segments: the price track, the crowd line, UTC stamps and the results by week.
// ---------------------------------------------------------------------------

/** What the strike is: the price when the prediction opened (lib/games/calls STRIKE_LABEL), never an official print. */
export const STRIKE_NOTE = "price when it opened";

/**
 * Where the price sits on a segment's track, as a percent of its width. The line (the strike) is
 * always the middle; the scale is wide enough that the price lands between 20% and 80% (nearer the
 * middle when it is close: at least 0.4% of the strike either side). Null without a usable price.
 */
export function trackPosition(price: number | null | undefined, strike: number): { p: number; gap: number } | null {
  if (price === null || price === undefined || !Number.isFinite(price) || !Number.isFinite(strike) || strike <= 0) return null;
  const gap = price - strike;
  const half = Math.max(Math.abs(gap) / 0.6, strike * 0.004);
  const p = 50 + (gap / half) * 50;
  return { p: Math.min(97, Math.max(3, p)), gap };
}

const CENTS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$0.24 below" | "$5.48 above" | "At the line": where the price stands against the line, to the cent. */
export function gapLabel(gap: number): string {
  if (!Number.isFinite(gap) || Math.abs(gap) < 0.005) return "At the line";
  return `${CENTS.format(Math.abs(gap))} ${gap > 0 ? "above" : "below"}`;
}

/**
 * The side with more points in, for "57% say No". Null for an empty pool or an even split, which
 * the segment says in words instead.
 */
export function crowdLead(odds: Pick<CallMarketView["odds"], "total" | "yesProb">): { side: CallSide; pct: string } | null {
  if (!(odds.total > 0)) return null;
  const yes = Math.round(odds.yesProb * 100);
  if (yes === 50) return null;
  const split = splitPct(odds);
  return yes > 50 ? { side: "yes", pct: split.yes } : { side: "no", pct: split.no };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEK_MS = 7 * 86_400_000;

/** "2 Oct" in UTC. */
function utcDayMonth(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

/** "Thu 8 Oct · 20:00 UTC" ("" for a bad date). The same string on the server and in every zone. */
export function utcStamp(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return `${WEEKDAY[d.getUTCDay()]} ${utcDayMonth(t)} · ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

/** Monday 00:00 UTC of the calendar week containing `ms`. */
function mondayOf(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
}

/** "Week of 28 Sep": the Monday (UTC) of the week a prediction settles in ("" for a bad date). */
export function weekOfLabel(settleAt: string): string {
  const t = Date.parse(settleAt);
  return Number.isFinite(t) ? `Week of ${utcDayMonth(mondayOf(t))}` : "";
}

/** "This week" | "Next week" | "Week of 19 Oct": the heading over the predictions still taking points or settling. */
export function liveWeekHeading(settleAt: string, nowMs: number): string {
  const t = Date.parse(settleAt);
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return "This week";
  const weeks = Math.round((mondayOf(t) - mondayOf(nowMs)) / WEEK_MS);
  if (weeks <= 0) return "This week";
  return weeks === 1 ? "Next week" : weekOfLabel(settleAt);
}

export interface ResultWeek {
  /** Monday 00:00 UTC of the week, ms. */
  monday: number;
  /** "Week of 28 Sep". */
  label: string;
  /** The latest settle instant in the week (ISO), for "Settled Fri 2 Oct · 20:05 UTC". */
  settleAt: string;
  markets: CallMarketView[];
}

export interface PredictionsBoard {
  /** Still taking points (open), then entries closed and waiting for the close (locked): the segments. */
  live: CallMarketView[];
  /** Settled and void predictions, one group per week, newest week first. */
  results: ResultWeek[];
}

/**
 * Splits the board into the live segments and the results by week. Inside a group the order is
 * the server's (sortMarkets: soonest settle first, then by ticker); open ones lead the live list so
 * the predictions that still take points are on top.
 */
export function predictionsBoard(markets: readonly CallMarketView[], nowMs: number): PredictionsBoard {
  const open: CallMarketView[] = [];
  const locked: CallMarketView[] = [];
  const byWeek = new Map<number, ResultWeek>();
  for (const m of markets) {
    const s = liveStatus(m, nowMs);
    if (s === "open") open.push(m);
    else if (s === "locked") locked.push(m);
    else {
      const t = Date.parse(m.settleAt);
      const monday = Number.isFinite(t) ? mondayOf(t) : 0;
      const week = byWeek.get(monday) ?? { monday, label: weekOfLabel(m.settleAt), settleAt: m.settleAt, markets: [] };
      if (Date.parse(m.settleAt) > Date.parse(week.settleAt)) week.settleAt = m.settleAt;
      week.markets.push(m);
      byWeek.set(monday, week);
    }
  }
  const results = [...byWeek.values()].sort((a, b) => b.monday - a.monday);
  return { live: [...open, ...locked], results };
}

/**
 * The page clock: the lock countdown while any prediction takes points; once entries close, the
 * settle time (the week track already counts to Friday's close, so no second countdown); once a
 * week is final and nothing new is open, that week's FINAL stamp. Each clock appears once a page.
 */
export type PredictionsClock =
  | { kind: "lock"; at: number; iso: string }
  | { kind: "settle"; iso: string; settling: boolean }
  | { kind: "final"; week: ResultWeek }
  | { kind: "none" };

export function predictionsClock(board: PredictionsBoard, nowMs: number): PredictionsClock {
  let lock: { at: number; iso: string } | null = null;
  for (const m of board.live) {
    if (liveStatus(m, nowMs) !== "open") continue;
    const at = Date.parse(m.locksAt);
    if (Number.isFinite(at) && (lock === null || at < lock.at)) lock = { at, iso: m.locksAt };
  }
  if (lock) return { kind: "lock", ...lock };
  if (board.live.length > 0) {
    const iso = board.live.map((m) => m.settleAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    return { kind: "settle", iso, settling: nowMs >= Date.parse(iso) };
  }
  if (board.results.length > 0) return { kind: "final", week: board.results[0] };
  return { kind: "none" };
}

/** Where a settled price came from, as a label ("Jupiter", "Pyth"), or null when it is unknown (void). */
export function settleSourceLabel(source: string | null): string | null {
  if (source === "pyth") return "Pyth";
  if (source === "jupiter") return "Jupiter";
  return source ? source : null;
}

/** "64% said Yes" | "An even split" | "No points in", for a settled line. */
export function crowdSaid(odds: Pick<CallMarketView["odds"], "total" | "yesProb">): string {
  const lead = crowdLead(odds);
  if (lead) return `${lead.pct} said ${sideLabel(lead.side)}`;
  return odds.total > 0 ? "An even split" : "No points in";
}

/** "1.74 back per point" | "Nobody on this side yet": what one point gets back on a side at the current split. */
export function backPerPoint(mult: number | null): string {
  if (mult === null || !Number.isFinite(mult)) return "Nobody on this side yet";
  return `${formatMultiplier(mult).replace(/x$/, "")} back per point`;
}
