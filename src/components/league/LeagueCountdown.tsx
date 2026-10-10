"use client";

import * as React from "react";
import { cn } from "cn";
import type { LeagueView } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { formatTrackClock, spokenTrackClock } from "@/components/layout/week-track";
import { countdownTarget, formatUtcDayDotTime, isPreWeek } from "@/components/league/format";

// The pure helpers live in format.ts (testable without React); re-exported for callers.
export { countdownTarget, nextOpenIso } from "@/components/league/format";

/**
 * Milliseconds until `targetIso`, ticking every `tickMs` (a second by default). The server clock
 * (`serverNowIso`, captured when the response arrived) corrects a skewed device clock.
 */
export function useCountdown(targetIso: string | null, serverNowIso: string | null, tickMs = 1000): number | null {
  const offset = React.useMemo(() => {
    if (!serverNowIso) return 0;
    const t = Date.parse(serverNowIso);
    return Number.isFinite(t) ? t - Date.now() : 0;
    // The offset is only meaningful for the response it came with.
  }, [serverNowIso]);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!targetIso) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [targetIso, tickMs]);
  if (!targetIso) return null;
  const target = Date.parse(targetIso);
  if (!Number.isFinite(target)) return null;
  return Math.max(0, target - (now + offset));
}


const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "3d 13:10:52" set like a chronograph: tabular digits, the unit and separators in the dim grey so
 * they stay quiet inside any coloured parent.
 */
export function Chronograph({ ms, className }: { ms: number; className?: string }) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sep = <span className="px-[0.06em] font-normal text-dim">:</span>;
  const label = `${days > 0 ? `${days} days ` : ""}${h} hours ${m} minutes ${s} seconds`;
  return (
    <span className={cn("inline-flex items-baseline tabular-nums", className)} aria-label={label} role="img">
      {days > 0 ? (
        <>
          <span>{days}</span>
          <span className="mr-[0.3em] ml-[0.06em] text-[0.62em] font-medium text-muted-foreground">d</span>
        </>
      ) : null}
      <span>{pad(h)}</span>
      {sep}
      <span>{pad(m)}</span>
      {sep}
      <span>{pad(s)}</span>
    </span>
  );
}

/** Live chronograph for a stat; "—" when there is nothing to count down to. */
export function LeagueCountdownValue({ league, serverNow }: { league: LeagueView; serverNow: string }) {
  const remaining = useCountdown(countdownTarget(league), serverNow);
  return <span aria-live="off">{remaining === null ? "—" : <Chronograph ms={remaining} />}</span>;
}

/** The clock's words: the close while the week runs, next week's close over the weekend, the reopening while a week settles. */
export function leagueClockLabel(league: Pick<LeagueView, "open" | "weekStart">, serverNow: string | null): string {
  if (!league.open) return "Next week opens in";
  return isPreWeek(league, serverNow) ? "Next week closes in" : "Closes in";
}

/**
 * The competition page's own clock (the mockup's "Closes in 30:01:45"): the words and the UTC time
 * in mono on the left, the countdown in Archivo's narrow scoreboard cut. The week track under the
 * header counts to the predictions lock, so this is the page's one close clock. Reduced motion:
 * no seconds, one tick a minute.
 */
export function LeagueClock({ league, serverNow, className }: { league: LeagueView; serverNow: string; className?: string }) {
  const target = countdownTarget(league);
  const reduced = useReducedMotion();
  const remaining = useCountdown(target, serverNow, reduced ? 60_000 : 1000);
  if (!target || remaining === null) return null;
  const words = leagueClockLabel(league, serverNow);
  return (
    <div
      data-slot="league-clock"
      className={cn("flex w-full items-center justify-between gap-x-[18px] sm:w-auto sm:items-end sm:justify-end sm:text-right", className)}
    >
      <p className="flex flex-col gap-1 text-[0.8125rem] leading-[1.35] font-medium text-muted-foreground sm:gap-0.5 sm:text-sm">
        <span>{words}</span>
        <span className="mono-meta">{formatUtcDayDotTime(target)}</span>
      </p>
      <p className="figure text-[2.5rem] leading-[0.8] font-normal text-foreground lg:text-[4.125rem]">
        <span aria-hidden>{formatTrackClock(remaining, !reduced)}</span>
        <span className="sr-only">{`${words} ${spokenTrackClock(remaining, !reduced)}`}</span>
      </p>
    </div>
  );
}

/** The clock's box while the week loads, so the title row does not move when it lands. */
export function LeagueClockSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex w-full items-center justify-between gap-x-[18px] sm:w-auto sm:items-end", className)} aria-hidden>
      <div className="flex flex-col gap-1.5 sm:items-end">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-3.5 w-36" />
      </div>
      <Skeleton className="h-8 w-40 lg:h-[3.3rem] lg:w-64" />
    </div>
  );
}

export default LeagueCountdownValue;
