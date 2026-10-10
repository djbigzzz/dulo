"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { useWeekData } from "@/components/layout/WeekData";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  DAY_MS,
  READOUT_LABEL,
  TRACK_DAYS,
  WEEKDAYS_SHARE,
  dayLabelPlace,
  formatTrackClock,
  readoutFocusFor,
  spokenTrackClock,
  trackX,
  utcDayTime,
  weekLabels,
  weekReadout,
  weekTrackLabel,
  weekTrackModel,
  type ReadoutFocus,
  type WeekTrackModel,
} from "@/components/layout/week-track";

/**
 * The week track: one thin Monday-to-Friday band under the header on every page (docs/DESIGN.md
 * "Week track"). Mon..Fri ticks and a dashed weekend tail, the predictions LOCK and the
 * competition CLOSE as cream pins, the gold "now" marker, and one countdown on the right (the clock
 * the page does not already show large, see readoutFocusFor). From Friday's close to Monday it
 * replays the week as FINAL and says when the next one starts.
 *
 * Data: the shell's shared reads (WeekData.tsx), so it adds no request to a page that already reads
 * /league or /calls. Until both settle it draws the ticks it already knows, in the same box, so
 * nothing below it moves; a failed read leaves the ticks and says the times are unavailable.
 * Reduced motion: no marker transitions, and the clock drops its seconds and ticks once a minute.
 */

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;


/** The client clock, corrected by the server's `now` once a response carries one; null until mounted. */
function useTrackClock(serverNow: string | null, tickMs: number): number | null {
  const offset = React.useMemo(() => {
    const t = serverNow ? Date.parse(serverNow) : Number.NaN;
    return Number.isFinite(t) ? t - Date.now() : 0;
    // The offset is only meaningful for the response it came with.
  }, [serverNow]);
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);
  return now === null ? null : now + offset;
}

/** A placeholder line with the exact box of the text it stands for. */
function Hold({ className }: { className?: string }) {
  return <span className={cn("block animate-pulse rounded-sm bg-ink-4 motion-reduce:animate-none", className)} aria-hidden />;
}

function Track({ model }: { model: WeekTrackModel | null }) {
  const now = model?.nowMs ?? null;
  const at = (t: number) => (model ? trackX(t, model.monday) : 0);
  return (
    <div className="relative h-full min-w-0" role="img" aria-label={model ? weekTrackLabel(model) : "This week"}>
      {/* The weekdays' base line, then the weekend tail, dashed. */}
      <span className="absolute top-[29px] left-0 h-0.5 bg-ink-4 lg:top-[33px]" style={{ width: pct(WEEKDAYS_SHARE) }} />
      <span
        className="absolute top-[29px] right-0 h-0.5 bg-[repeating-linear-gradient(90deg,var(--ink-4)_0_3px,transparent_3px_6px)] lg:top-[33px]"
        style={{ left: pct(WEEKDAYS_SHARE) }}
      />
      {TRACK_DAYS.map((d, i) => {
        const past = model !== null && now !== null && (i < 5 ? model.monday + i * DAY_MS <= now : at(now) >= WEEKDAYS_SHARE);
        // The label steps aside when the now marker would cover it (dayLabelPlace); the tick stays put.
        const place = model && now !== null ? dayLabelPlace(i, at(now)) : "tick";
        return (
          <React.Fragment key={d.long}>
            <span className="absolute top-6 h-3 w-px bg-rule-2 lg:top-7" style={{ left: pct(d.x) }} />
            <span
              data-place={place}
              className={cn(
                "absolute top-[9px] text-[11.5px] leading-none font-medium whitespace-nowrap lg:top-3 lg:text-xs",
                place === "tick" && "translate-x-[5px] lg:translate-x-1.5",
                place === "after-now" && "translate-x-[9px] lg:translate-x-2.5",
                place === "before-now" && "-translate-x-[calc(100%+9px)] lg:-translate-x-[calc(100%+10px)]",
                past ? "text-muted-foreground" : "text-dim",
              )}
              style={{ left: pct(place === "tick" || now === null ? d.x : at(now)) }}
            >
              <span className="hidden lg:inline">{d.long}</span>
              <span className="lg:hidden">{d.short}</span>
            </span>
          </React.Fragment>
        );
      })}
      {model && now !== null ? (
        <>
          {/* Elapsed: Monday to now. */}
          <span
            className="absolute top-7 left-0 h-1 bg-[rgb(243_240_232/0.42)] transition-[width] duration-700 motion-reduce:transition-none lg:top-8"
            style={{ width: pct(at(now)) }}
          />
          {model.lockAt !== null ? <Pin x={at(model.lockAt)} label="Lock" time={utcDayTime(model.lockAt)} /> : null}
          {model.closeAt !== null ? <Pin x={at(model.closeAt)} label="Close" time={utcDayTime(model.closeAt)} /> : null}
          {model.weekend && model.closeAt !== null ? (
            <span className="stamp absolute top-[25px] hidden -translate-x-[calc(100%+8px)] lg:inline-block" style={{ left: pct(at(model.closeAt)) }}>
              Final
            </span>
          ) : null}
          {/* Now: the screen's second and last use of gold (the first is its one primary button). */}
          <span
            data-slot="week-now"
            className="absolute top-4 h-6 w-[3px] -translate-x-[1.5px] bg-signal transition-[left] duration-700 before:absolute before:-top-[5px] before:left-1/2 before:size-[9px] before:-translate-x-1/2 before:rotate-45 before:bg-signal motion-reduce:transition-none lg:top-[18px] lg:h-[26px]"
            style={{ left: pct(at(now)) }}
          />
        </>
      ) : null}
    </div>
  );
}

function Pin({ x, label, time }: { x: number; label: string; time: string }) {
  return (
    <>
      <span className="absolute top-[21px] h-[18px] w-0.5 -translate-x-px bg-paper lg:top-6 lg:h-5" style={{ left: pct(x) }} />
      <span className="label-caps absolute top-[45px] hidden translate-x-[7px] whitespace-nowrap text-foreground lg:inline" style={{ left: pct(x) }}>
        {label}
        <span className="ml-[5px] hidden font-mono text-[11px] font-normal tracking-normal normal-case text-muted-foreground xl:inline">{time}</span>
      </span>
    </>
  );
}

export interface WeekTrackProps {
  /** Which clock the readout counts to. Default: by route (readoutFocusFor). */
  focus?: ReadoutFocus;
  className?: string;
}

export function WeekTrack({ focus: focusProp, className }: WeekTrackProps) {
  const pathname = usePathname();
  const focus = focusProp ?? readoutFocusFor(pathname);
  const week = useWeekData();
  const league = week?.league ?? null;
  const calls = week?.calls ?? null;
  const reduced = useReducedMotion();
  const nowMs = useTrackClock(league?.data?.now ?? calls?.data?.now ?? null, reduced ? 60_000 : 1_000);

  const model =
    nowMs === null
      ? null
      : weekTrackModel({ nowMs, league: league?.data?.league ?? null, leagueNow: league?.data?.now ?? null, calls: calls?.data ?? null });
  const pending = week !== null && (week.league.loading || week.calls.loading);
  const failed = !pending && !league?.data && !calls?.data;
  const readout = model ? weekReadout(model, focus) : null;
  const labels = model ? weekLabels(model) : null;

  let right: React.ReactNode;
  if (readout && readout.kind !== "none" && readout.at !== null) {
    const words = READOUT_LABEL[readout.kind];
    const fixed = readout.kind === "next-week";
    const value = fixed ? `${utcDayTime(readout.at)} UTC` : formatTrackClock(readout.at - (nowMs ?? 0), !reduced);
    const spoken = fixed ? `${words.long} ${value}` : `${words.long} ${spokenTrackClock(readout.at - (nowMs ?? 0), !reduced)}`;
    right = (
      <>
        <span className="text-[11.5px] leading-none font-medium text-muted-foreground lg:text-[12.5px]" aria-hidden>
          <span className="hidden lg:inline">{words.long}</span>
          <span className="lg:hidden">{words.short}</span>
        </span>
        <span className="font-mono text-lg leading-none font-medium tracking-[-0.03em] text-foreground tabular-nums lg:text-[1.3125rem]" aria-hidden>
          {fixed ? (
            <>
              {/* On a phone the zone moves into the label ("Next week, UTC"), so the track keeps its width. */}
              {utcDayTime(readout.at)}
              <span className="hidden lg:inline"> UTC</span>
            </>
          ) : (
            value
          )}
        </span>
        <span className="sr-only">{spoken}</span>
      </>
    );
  } else if (model && failed) {
    right = (
      <>
        <span className="text-[11.5px] leading-none font-medium text-muted-foreground lg:text-[12.5px]">This week&apos;s times</span>
        <span className="text-sm leading-[1.125rem] font-medium text-muted-foreground lg:leading-[1.3125rem]">unavailable</span>
      </>
    );
  } else if (!model || pending) {
    right = (
      <>
        <Hold className="h-[11.5px] w-14 lg:h-[12.5px] lg:w-24" />
        <Hold className="h-[18px] w-24 lg:h-[21px] lg:w-28" />
      </>
    );
  }

  return (
    // A named region: it sits between <header> and <main>, so landmark navigation would skip it (and
    // its lock and close countdowns, on most pages shown nowhere else) without one.
    <div data-slot="week-track" role="region" aria-label="This week" className={cn("border-b border-rule bg-ink-2", className)}>
      <div className="page-wrap grid h-[50px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[18px] lg:h-[60px] lg:grid-cols-[136px_minmax(0,1fr)_200px] lg:gap-x-8 xl:grid-cols-[136px_minmax(0,1fr)_262px]">
        <div className="hidden min-w-0 flex-col gap-[5px] lg:flex">
          {labels ? (
            <>
              <b className="truncate text-sm leading-none font-semibold text-foreground">{labels.title}</b>
              <span className="truncate text-[12.5px] leading-none font-medium text-muted-foreground">{labels.sub}</span>
            </>
          ) : (
            <>
              <Hold className="h-3.5 w-24" />
              <Hold className="h-[12.5px] w-28" />
            </>
          )}
        </div>
        <Track model={model} />
        <div className="flex min-w-[6.5rem] flex-col items-end justify-center gap-1 text-right" aria-live="off">
          {right}
        </div>
      </div>
    </div>
  );
}

export default WeekTrack;
