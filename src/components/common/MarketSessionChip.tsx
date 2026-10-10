"use client";

import * as React from "react";
import { cn } from "cn";
import {
  EARLY_CLOSE_MINUTES,
  isEarlyClose,
  isMarketOpen,
  nextMarketClose,
  nextMarketOpen,
  toEasternWallClock,
} from "@/lib/prices/calendar";

/**
 * "US market open · closes in 3h 05m" / "US market closed · opens in 14h 22m".
 *
 * Presentation only: every session fact comes from the one US calendar in
 * src/lib/prices/calendar.ts (holidays, early closes, DST), which is already under test in
 * tests/calendar.test.ts. Nothing here knows a date.
 *
 * Markets close; Solana does not. The chip is what makes a stale price legible, so it sits in
 * the header beside the Season chip and is read again by the copy on /predictions and
 * /competition.
 */

/** Minutes are the smallest unit shown, so one tick a minute is enough. */
export const SESSION_TICK_MS = 60_000;

/** Shown until the component mounts (see MarketSessionChip: the shell is statically rendered). */
export const SESSION_PLACEHOLDER = "US market";

export interface MarketSession {
  /** True when the US regular session is open at that instant. */
  open: boolean;
  /** The session this countdown points at ends at 13:00 ET rather than 16:00 ET. */
  earlyClose: boolean;
  /** The instant counted down to: this session's close when open, the next open when closed. */
  at: Date;
  /** Milliseconds to `at`. Never negative. */
  msUntil: number;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "13:00" from minutes after midnight ET. */
function clockOf(minutesOfDay: number): string {
  return `${pad2(Math.floor(minutesOfDay / 60))}:${pad2(minutesOfDay % 60)}`;
}

/** Where the US session stands at `now`, and how long until it turns over. */
export function marketSession(now: Date): MarketSession {
  const open = isMarketOpen(now);
  const at = open ? nextMarketClose(now) : nextMarketOpen(now);
  // Open: today's session. Closed: the session that is about to start, which may be the early one.
  const dateKey = toEasternWallClock(open ? now : at).dateKey;
  return { open, earlyClose: isEarlyClose(dateKey), at, msUntil: Math.max(0, at.getTime() - now.getTime()) };
}

/** "2d 4h" | "3h 05m" | "22m" | "under a minute". Whole units, never negative. */
export function formatSessionCountdown(ms: number): string {
  const minutes = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0;
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${pad2(m)}m`;
  if (m > 0) return `${m}m`;
  return "under a minute";
}

/** "closes in" | "early close in" | "opens in" — the verb between the state and the countdown. */
export function sessionVerb(s: MarketSession): string {
  if (!s.open) return "opens in";
  return s.earlyClose ? "early close in" : "closes in";
}

/** "US market open · closes in 3h 05m" (sm and up). */
export function sessionLabel(s: MarketSession): string {
  return `US market ${s.open ? "open" : "closed"} · ${sessionVerb(s)} ${formatSessionCountdown(s.msUntil)}`;
}

/** "Open · closes in 3h 05m" / "Closed · opens in 14h 22m" (below sm, where the header has no room for "US market"). */
export function sessionShortLabel(s: MarketSession): string {
  return `${s.open ? "Open" : "Closed"} · ${sessionVerb(s)} ${formatSessionCountdown(s.msUntil)}`;
}

/**
 * Tooltip. Times are given in ET, never in the viewer's zone: the same string then renders on the
 * server and on the client, so a server-rendered frame cannot mismatch on hydration.
 */
export function sessionTitle(s: MarketSession): string {
  const w = toEasternWallClock(s.at);
  const clock = `${clockOf(w.minutesOfDay)} ET`;
  const solana = "Solana never closes, so every price carries its source and age.";
  if (s.open) {
    return s.earlyClose
      ? `The US regular session closes early today at ${clock}. ${solana}`
      : `The US regular session closes at ${clock}. ${solana}`;
  }
  const opens = `The US regular session opens ${WEEKDAYS[w.weekday]} at ${clock}`;
  return s.earlyClose
    ? `${opens} and closes early that day at ${clockOf(EARLY_CLOSE_MINUTES)} ET. ${solana}`
    : `${opens}. ${solana}`;
}

/** The calendar throws on an invalid clock; the header must never be the thing that breaks. */
function readSession(ms: number): MarketSession | null {
  try {
    const at = new Date(ms);
    if (!Number.isFinite(at.getTime())) return null;
    return marketSession(at);
  } catch {
    return null;
  }
}

export interface MarketSessionChipProps {
  /**
   * ISO instant for the first frame. Pass one only from a dynamically rendered parent: a
   * statically rendered one would bake its build time into the HTML. Without it the chip shows a
   * stable placeholder until it mounts, so server and first client render always agree.
   */
  nowIso?: string;
  /**
   * The short form below md ("Closed · 2d 12h"), for the header's tight row only. Every page mount
   * keeps the full sentence ("US market closed · opens in 2d 12h") at every width: on a phone a bare
   * "Closed" under the prediction cards would read as if the prediction were closed.
   */
  compact?: boolean;
  className?: string;
}

export function MarketSessionChip({ nowIso, compact = false, className }: MarketSessionChipProps) {
  const [nowMs, setNowMs] = React.useState<number | null>(() => {
    if (!nowIso) return null;
    const t = Date.parse(nowIso);
    return Number.isFinite(t) ? t : null;
  });

  // One interval for the life of the chip: the countdown only shows minutes.
  React.useEffect(() => {
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), SESSION_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const session = nowMs === null ? null : readSession(nowMs);

  // Broadcast status line, not a pill: a still dot (green while the US session is open, dim when
  // it is closed), the state and the countdown in cream, the rest in the muted grey.
  return (
    <span
      data-slot="market-session"
      // aria-live off: a screen reader should not hear the countdown tick over on its own.
      aria-live="off"
      title={session ? sessionTitle(session) : undefined}
      className={cn(
        "inline-flex h-6 items-center gap-2 text-[0.84375rem] leading-none font-medium whitespace-nowrap tabular-nums text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "size-[7px] shrink-0 rounded-full transition-colors duration-300 motion-reduce:transition-none",
          session?.open ? "bg-yes" : "bg-dim",
        )}
        aria-hidden
      />
      {session === null ? (
        <span>{SESSION_PLACEHOLDER}</span>
      ) : (
        <span>
          {/*
            The long sentence needs about 240px and the short form 147px. Every page mount has the
            room for the sentence (measured 10 Oct: 288px at 320); the header's compact chip keeps
            the short form below md.
          */}
          <span className={compact ? "hidden md:inline" : undefined}>US&nbsp;market&nbsp;</span>
          {/* One text run, so a screen reader never hears both the short and the long form. */}
          <span className={cn("font-semibold text-foreground", compact && "capitalize md:normal-case")}>{session.open ? "open" : "closed"}</span>
          <span>&nbsp;·&nbsp;</span>
          <span className={compact ? "hidden md:inline" : undefined}>{sessionVerb(session)}&nbsp;</span>
          <span className="font-semibold text-foreground">{formatSessionCountdown(session.msUntil)}</span>
        </span>
      )}
    </span>
  );
}

export default MarketSessionChip;
