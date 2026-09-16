/**
 * US equity regular-session calendar (NYSE / Nasdaq) for 2026, with a short 2027
 * runway so the calendar does not fall off a cliff at year end.
 *
 * Regular session: 09:30–16:00 America/New_York, Monday–Friday, minus holidays.
 * Early-close days end at 13:00 ET.
 *
 * All wall-clock maths is done with Intl.DateTimeFormat in the America/New_York
 * zone, so DST (EDT = UTC-4 from 8 Mar 2026, EST = UTC-5 from 1 Nov 2026) is
 * handled by the runtime's tz database and not by us. No external tz library.
 */

/** NYSE full-day closures, ISO calendar dates in America/New_York. */
export const US_MARKET_HOLIDAYS_2026: string[] = [
  "2026-01-01", // New Year's Day
  "2026-01-19", // Martin Luther King Jr. Day
  "2026-02-16", // Presidents' Day
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed; 4 July is a Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving Day
  "2026-12-25", // Christmas Day
  // 2027 runway
  "2027-01-01", // New Year's Day
  "2027-01-18", // Martin Luther King Jr. Day
];

/** Days the regular session closes at 13:00 ET instead of 16:00 ET. */
export const US_EARLY_CLOSES_2026: string[] = [
  "2026-11-27", // Day after Thanksgiving
  "2026-12-24", // Christmas Eve
];

export const MARKET_TZ = "America/New_York";

/** Minutes after midnight (ET) for the session boundaries. */
export const SESSION_OPEN_MINUTES = 9 * 60 + 30; // 09:30
export const SESSION_CLOSE_MINUTES = 16 * 60; // 16:00
export const EARLY_CLOSE_MINUTES = 13 * 60; // 13:00

const HOLIDAYS = new Set(US_MARKET_HOLIDAYS_2026);
const EARLY_CLOSES = new Set(US_EARLY_CLOSES_2026);

/** ET wall-clock components for an instant. */
export interface EasternWallClock {
  /** ISO calendar date in ET, e.g. "2026-03-10". */
  dateKey: string;
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Minutes after midnight ET. */
  minutesOfDay: number;
}

const ET_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Format a calendar date as an ISO date key. */
export function isoDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Weekday (0 = Sunday) of a calendar date. Independent of time zone. */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Convert an instant into its America/New_York wall-clock representation. */
export function toEasternWallClock(at: Date): EasternWallClock {
  if (Number.isNaN(at.getTime())) throw new RangeError("toEasternWallClock: invalid Date");
  const parts = ET_FORMAT.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    if (!p) throw new Error(`toEasternWallClock: missing ${type} part`);
    return Number(p.value);
  };
  const year = get("year");
  const month = get("month");
  const day = get("day");
  // Some ICU builds emit "24" for midnight even with hourCycle h23; normalise.
  const hour = get("hour") % 24;
  const minute = get("minute");
  const second = get("second");
  return {
    dateKey: isoDateKey(year, month, day),
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: weekdayOf(year, month, day),
    minutesOfDay: hour * 60 + minute,
  };
}

/**
 * The UTC instant corresponding to an ET wall-clock time on a calendar date.
 * Iterates twice so the offset is correct on either side of a DST transition
 * (session times never fall inside the 02:00 transition window, so this converges).
 */
export function easternWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const w = toEasternWallClock(new Date(guess));
    const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    const offsetMs = wallAsUtc - guess; // ET minus UTC (negative for the Americas)
    guess = target - offsetMs;
  }
  return new Date(guess);
}

/** Is this ET calendar date a full trading day (weekday, not a holiday)? */
export function isTradingDay(dateKey: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) throw new RangeError(`isTradingDay: expected YYYY-MM-DD, got ${dateKey}`);
  const wd = weekdayOf(Number(m[1]), Number(m[2]), Number(m[3]));
  if (wd === 0 || wd === 6) return false;
  return !HOLIDAYS.has(dateKey);
}

export function isEarlyClose(dateKey: string): boolean {
  return EARLY_CLOSES.has(dateKey);
}

/** Session close in minutes after midnight ET for a calendar date (13:00 on early-close days). */
export function sessionCloseMinutes(dateKey: string): number {
  return isEarlyClose(dateKey) ? EARLY_CLOSE_MINUTES : SESSION_CLOSE_MINUTES;
}

/** True when the US equity regular session is open at the instant `at`. */
export function isMarketOpen(at: Date): boolean {
  const w = toEasternWallClock(at);
  if (!isTradingDay(w.dateKey)) return false;
  return w.minutesOfDay >= SESSION_OPEN_MINUTES && w.minutesOfDay < sessionCloseMinutes(w.dateKey);
}

function addCalendarDay(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const MAX_LOOKAHEAD_DAYS = 45;

/**
 * The next instant strictly after `at` at which the regular session opens (09:30 ET
 * on the next trading day). If `at` is inside a session this returns the *following*
 * session's open, not the current one.
 */
export function nextMarketOpen(at: Date): Date {
  const w = toEasternWallClock(at);
  let { year, month, day } = w;
  for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
    const key = isoDateKey(year, month, day);
    if (isTradingDay(key)) {
      const open = easternWallClockToUtc(year, month, day, 9, 30);
      if (open.getTime() > at.getTime()) return open;
    }
    ({ year, month, day } = addCalendarDay(year, month, day));
  }
  throw new Error(`nextMarketOpen: no trading day within ${MAX_LOOKAHEAD_DAYS} days of ${at.toISOString()}`);
}

/**
 * The next instant strictly after `at` at which the regular session closes
 * (16:00 ET, or 13:00 ET on early-close days). If `at` is inside a session this is
 * the current session's close.
 */
export function nextMarketClose(at: Date): Date {
  const w = toEasternWallClock(at);
  let { year, month, day } = w;
  for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
    const key = isoDateKey(year, month, day);
    if (isTradingDay(key)) {
      const closeMin = sessionCloseMinutes(key);
      const close = easternWallClockToUtc(year, month, day, Math.floor(closeMin / 60), closeMin % 60);
      if (close.getTime() > at.getTime()) return close;
    }
    ({ year, month, day } = addCalendarDay(year, month, day));
  }
  throw new Error(`nextMarketClose: no trading day within ${MAX_LOOKAHEAD_DAYS} days of ${at.toISOString()}`);
}
