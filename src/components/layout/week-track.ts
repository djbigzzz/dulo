/**
 * The week track's model (pure, client-safe, no React): where Monday to Friday sit on the track,
 * where the predictions lock and the competition close fall, where "now" is, and which clock the
 * readout counts down to. Everything comes from the two shared reads (WeekData.tsx) and the clock;
 * nothing here knows a date or a session hour of its own.
 */
import type { CallMarketView, CallsResponse, LeagueView } from "@/lib/api-client";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

/** Share of the track for Monday 00:00 to Saturday 00:00 UTC; the last 12% is the weekend tail. */
export const WEEKDAYS_SHARE = 0.88;

/** Monday 00:00 UTC of the calendar week containing `ms`. */
export function mondayUtc(ms: number): number {
  const d = new Date(ms);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday);
}

/** Position of instant `t` on the track of the week starting `monday`, 0..1 (clamped). */
export function trackX(t: number, monday: number): number {
  const days = (t - monday) / DAY_MS;
  if (!Number.isFinite(days) || days <= 0) return 0;
  if (days <= 5) return (days / 5) * WEEKDAYS_SHARE;
  return Math.min(1, WEEKDAYS_SHARE + ((days - 5) / 2) * (1 - WEEKDAYS_SHARE));
}

/** Where each day's tick and label sit: Mon..Fri at their midnight, the weekend at Saturday 00:00. */
export const TRACK_DAYS = [
  { long: "Mon", short: "M", x: 0 },
  { long: "Tue", short: "T", x: WEEKDAYS_SHARE / 5 },
  { long: "Wed", short: "W", x: (2 * WEEKDAYS_SHARE) / 5 },
  { long: "Thu", short: "T", x: (3 * WEEKDAYS_SHARE) / 5 },
  { long: "Fri", short: "F", x: (4 * WEEKDAYS_SHARE) / 5 },
  { long: "Sat–Sun", short: "S·S", x: WEEKDAYS_SHARE },
] as const;

/**
 * Where a day's label sits so the gold "now" marker never covers it: at its tick (the default),
 * just after the marker, or just before it. A weekday label moves after the marker for the first
 * 40% of its day (the label's own width at every size; Tuesday 02:00 UTC would otherwise sit under
 * the diamond). The weekend's "Sat–Sun" fills most of its short tail, so once the marker is in the
 * tail the label rides beside it: after it in the tail's first half, before it in the second.
 */
export type DayLabelPlace = "tick" | "after-now" | "before-now";

export function dayLabelPlace(index: number, nowX: number | null): DayLabelPlace {
  const day = TRACK_DAYS[index];
  if (!day || nowX === null || !Number.isFinite(nowX) || nowX < day.x) return "tick";
  if (index < 5) return nowX - day.x < 0.4 * (WEEKDAYS_SHARE / 5) ? "after-now" : "tick";
  return nowX - day.x < (1 - WEEKDAYS_SHARE) / 2 ? "after-now" : "before-now";
}

export interface WeekTrackModel {
  /** Monday 00:00 UTC of the week on the track (on the weekend, the week that just closed). */
  monday: number;
  nowMs: number;
  /** This week's predictions lock (earliest locksAt of the markets settling this week), or null. */
  lockAt: number | null;
  /** The competition's Friday close (the League's weekEnd), or null. */
  closeAt: number | null;
  /** True once Friday's close has passed: the track replays the week as final. */
  weekend: boolean;
  /** Monday 00:00 UTC of the week after the one on the track. */
  nextMonday: number;
  /** When the next League opens, if the API ever counts down to it (LeagueView.opensIn); else null. */
  opensAt: number | null;
  /** 1-based week of the Season, null when the Season is unknown or has not started. */
  seasonWeek: number | null;
}

export interface WeekTrackInput {
  /** The client clock, already corrected by the server's `now`. */
  nowMs: number;
  league?: Pick<LeagueView, "weekStart" | "weekEnd" | "opensIn"> | null;
  /** The league response's `now`, which `opensIn` is measured from. */
  leagueNow?: string | null;
  calls?: { markets: Pick<CallMarketView, "locksAt" | "settleAt">[]; season?: CallsResponse["season"] } | null;
}

const parse = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

export function weekTrackModel({ nowMs, league, leagueNow, calls }: WeekTrackInput): WeekTrackModel {
  const monday = mondayUtc(nowMs);
  const nextMonday = monday + WEEK_MS;

  // From Friday's close to Monday the API's League is already next week's (it takes the weekend's
  // trades), so its window is moved back one week to land on the week on the track.
  let closeAt: number | null = null;
  const weekStart = parse(league?.weekStart);
  const weekEnd = parse(league?.weekEnd);
  if (weekStart !== null && weekEnd !== null) {
    const shift = Math.round((mondayUtc(weekStart) - monday) / WEEK_MS) * WEEK_MS;
    const end = weekEnd - shift;
    if (end >= monday && end < nextMonday) closeAt = end;
  }

  let lockAt: number | null = null;
  let settleMax: number | null = null;
  for (const m of calls?.markets ?? []) {
    const settle = parse(m.settleAt);
    const lock = parse(m.locksAt);
    if (settle === null || settle < monday || settle >= nextMonday) continue;
    if (lock !== null && (lockAt === null || lock < lockAt)) lockAt = lock;
    if (settleMax === null || settle > settleMax) settleMax = settle;
  }

  const end = closeAt ?? settleMax;
  const weekend = end !== null && nowMs >= end;

  const leagueNowMs = parse(leagueNow);
  const opensAt = league?.opensIn != null && leagueNowMs !== null && Number.isFinite(league.opensIn) ? leagueNowMs + league.opensIn : null;

  const seasonStart = parse(calls?.season?.startsAt);
  let seasonWeek: number | null = null;
  if (seasonStart !== null) {
    const n = Math.floor((monday - mondayUtc(seasonStart)) / WEEK_MS) + 1;
    seasonWeek = n >= 1 ? n : null;
  }

  return { monday, nowMs, lockAt, closeAt, weekend, nextMonday, opensAt, seasonWeek };
}

/** Which clock a page wants on the track: the one it does not already show large. */
export type ReadoutFocus = "lock" | "close" | "next";

/**
 * Each clock appears once per page. The landing, /predictions and the tour carry the lock in their
 * own hero, so their track counts to Friday's close; /competition's page clock is the close, so its
 * track counts to the lock. Everywhere else the track counts to whichever comes next.
 */
export function readoutFocusFor(pathname: string | null | undefined): ReadoutFocus {
  if (!pathname) return "next";
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  if (pathname === "/" || under("/predictions") || under("/start")) return "close";
  if (under("/competition")) return "lock";
  return "next";
}

export type ReadoutKind = "lock" | "close" | "opens" | "next-week" | "none";

export interface Readout {
  kind: ReadoutKind;
  /** The instant counted down to ("lock" | "close" | "opens") or shown ("next-week"); null for "none". */
  at: number | null;
}

export function weekReadout(m: WeekTrackModel, focus: ReadoutFocus): Readout {
  if (m.weekend) return m.opensAt !== null && m.opensAt > m.nowMs ? { kind: "opens", at: m.opensAt } : { kind: "next-week", at: m.nextMonday };
  const lock = m.lockAt !== null && m.lockAt > m.nowMs ? m.lockAt : null;
  const close = m.closeAt !== null && m.closeAt > m.nowMs ? m.closeAt : null;
  const asLock = lock !== null ? ({ kind: "lock", at: lock } as const) : null;
  const asClose = close !== null ? ({ kind: "close", at: close } as const) : null;
  const pick =
    focus === "lock" ? (asLock ?? asClose) : focus === "close" ? (asClose ?? asLock) : lock !== null && (close === null || lock <= close) ? asLock : asClose;
  return pick ?? { kind: "none", at: null };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The readout clock. With seconds: "6:01:45", "30:01:45" (total hours up to two days, the way the
 * mockup counts to Friday), then "4d 20:01:45". Without seconds (reduced motion, one tick a
 * minute): "30h 01m", "4d 20h 01m". Never negative.
 */
export function formatTrackClock(ms: number, seconds = true): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const days = Math.floor(total / 86_400);
  const hours = Math.floor(total / 3600);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (seconds) return hours >= 48 ? `${days}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${hours}:${pad(m)}:${pad(s)}`;
  return hours >= 48 ? `${days}d ${h}h ${pad(m)}m` : `${hours}h ${pad(m)}m`;
}

/** The clock in words, for its accessible name: "30 hours 1 minute 45 seconds". */
export function spokenTrackClock(ms: number, seconds = true): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const hours = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const parts = [hours > 0 ? unit(hours, "hour") : null, unit(m, "minute"), seconds ? unit(s, "second") : null];
  return parts.filter(Boolean).join(" ");
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu 20:00" in UTC. */
export function utcDayTime(ms: number): string {
  const d = new Date(ms);
  return `${WEEKDAY[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "Thursday 20:00 UTC", for the track's accessible name. */
export function spokenUtcDayTime(ms: number): string {
  const d = new Date(ms);
  return `${WEEKDAY_LONG[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "5 Oct" in UTC. */
export function utcDayMonth(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}

/** Left block: "Week of 5 Oct" over "Season 0 · week 4" (or "Final · week 3" once Friday has closed). */
export function weekLabels(m: WeekTrackModel): { title: string; sub: string } {
  const week = m.seasonWeek !== null ? ` · week ${m.seasonWeek}` : "";
  return { title: `Week of ${utcDayMonth(m.monday)}`, sub: `${m.weekend ? "Final" : "Season 0"}${week}` };
}

/** The track's accessible name: the week, its two markers in UTC and where "now" is. */
export function weekTrackLabel(m: WeekTrackModel): string {
  const head = `Week of ${utcDayMonth(m.monday)}${m.weekend ? ", final" : ""}`;
  const parts: string[] = [];
  if (m.lockAt !== null) parts.push(`predictions ${m.weekend || m.nowMs >= m.lockAt ? "locked" : "lock"} ${spokenUtcDayTime(m.lockAt)}`);
  if (m.closeAt !== null) parts.push(`the virtual-cash competition ${m.weekend ? "closed" : "closes"} ${spokenUtcDayTime(m.closeAt)}`);
  return parts.length > 0 ? `${head}: ${parts.join("; ")}.` : `${head}.`;
}

/** Readout labels: the desktop sentence and the phone's short form. */
export const READOUT_LABEL: Record<Exclude<ReadoutKind, "none">, { long: string; short: string }> = {
  lock: { long: "Predictions lock in", short: "Lock in" },
  close: { long: "Friday close in", short: "Close in" },
  opens: { long: "Next week opens in", short: "Opens in" },
  "next-week": { long: "Next week starts", short: "Next week, UTC" },
};
