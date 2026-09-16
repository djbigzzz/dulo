/** League-specific formatters. Client-safe, no React. */

const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

/** "2.5" / "0.000123" — up to 6 decimals, trailing zeros dropped. */
export function formatQty(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return qtyFmt.format(n);
}

const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$10,000" — whole dollars, for copy about the starting balance. */
export function formatUsdWhole(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

/** "+$120.50" / "−$30.00" / "$0.00". */
export function formatSignedUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 0.005) return usd2.format(0);
  return `${n > 0 ? "+" : "−"}${usd2.format(Math.abs(n))}`;
}

/** "+1.2%" / "−0.4%" / "0.0%". */
export function formatSignedPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toFixed(digits);
  if (Number(abs) === 0) return `${(0).toFixed(digits)}%`;
  return `${n > 0 ? "+" : "−"}${abs}%`;
}

/** Tailwind text colour for a signed number. */
export function pnlClass(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || Math.abs(n) < 0.005) return "text-muted-foreground";
  return n > 0 ? "text-emerald-400" : "text-rose-400";
}

/** "4d 07:14:52" or "07:14:52" — never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hms = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return days > 0 ? `${days}d ${hms}` : hms;
}

/** "Mon 14 Sep" in UTC. */
export function formatUtcDay(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

/** "Fri 18 Sep, 20:00 UTC". */
export function formatUtcDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(d);
  return `${day}, ${time} UTC`;
}

/** "14 Sep" in UTC (the League week label). */
export function formatUtcDayMonth(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d).replace("Sept", "Sep");
}

/** "Fri 18 Sep, 21:00" in the viewer's own time zone. */
export function formatLocalDayTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${day.replace("Sept", "Sep")}, ${time}`;
}

/**
 * Points for a first-place finish. Mirrors RANK_POINTS[0] in src/lib/games/league.ts
 * (server-only module, so it cannot be imported into client components).
 */
export const LEAGUE_TOP_PRIZE_POINTS = 1000;

/** Smallest League trade (USD notional). Mirrors MIN_TRADE_USD in src/lib/games/league.ts. */
export const LEAGUE_MIN_TRADE_USD = 10;

/** The competition never pauses (C6). One sentence, used on /competition, the trade form and the settled panel. */
export const WEEKEND_TRADES_COPY = "Weekend trades count toward next week's competition";

/** True before the League week has started (Friday 20:00 UTC -> Monday): trades still count, toward this upcoming week. */
export function isPreWeek(league: { weekStart: string }, nowIso: string | null | undefined): boolean {
  const start = Date.parse(league.weekStart);
  const now = nowIso ? Date.parse(nowIso) : Number.NaN;
  return Number.isFinite(start) && Number.isFinite(now) && now < start;
}

/**
 * When trades are accepted again (ISO), null while they are. Only a settled League refuses
 * trades now, and the next League takes them from the instant this week closes (weekEnd).
 */
export function nextOpenIso(league: { open: boolean; weekEnd: string }): string | null {
  return league.open ? null : league.weekEnd;
}

/** The instant the headline countdown runs to: the Friday close while open, the next League's first trade otherwise. */
export function countdownTarget(league: { open: boolean; weekEnd: string }): string | null {
  return league.open ? league.weekEnd : nextOpenIso(league);
}

/**
 * Client mirror of the server's minimum-notional rule: below LEAGUE_MIN_TRADE_USD and not a
 * sell of the whole position. False while the cost is unknown.
 */
export function isBelowMinTrade(t: { side: "buy" | "sell"; qty: number | null; cost: number | null; held: number }): boolean {
  if (t.qty === null || t.cost === null) return false;
  if (t.cost + 1e-6 >= LEAGUE_MIN_TRADE_USD) return false;
  if (t.side === "sell" && t.held > 1e-9 && t.qty + 1e-9 >= t.held) return false;
  return true;
}
