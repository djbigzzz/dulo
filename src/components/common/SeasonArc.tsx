"use client";

/**
 * Season progress: a slim bar beside the header's Season chip, reading
 * "Stocks Season · day 3 of 109 · ends 31 Dec".
 *
 * Day numbers are inclusive and computed in UTC from the Season's own startsAt / endsAt, the way
 * every Season window in the app is (lib/server/queries seasonPhase): the start date is day 1 and
 * the end date is day `totalDays`, so the last day reads "day 109 of 109" rather than overflowing.
 *
 * It says when the Season ends and nothing more. Points do not reset, expire or convert at a
 * Season end, so this never hints that they do.
 */

import { cn } from "cn";
import { api, type SeasonView } from "@/lib/api-client";
import { useApiQuery } from "@/components/common/useApiQuery";

const DAY_MS = 86_400_000;

/** Midnight UTC of the day an instant falls on. */
function utcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** "31 Dec" in UTC. */
function utcDayMonth(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(ms)).replace("Sept", "Sep");
}

export interface SeasonProgress {
  /** 1-based day of the Season, clamped into [1, totalDays]. */
  day: number;
  /** Days from the start date to the end date, both included. */
  totalDays: number;
  /** day / totalDays, 0..1 — the bar's fill. */
  elapsed: number;
  /** "31 Dec" */
  endsLabel: string;
  /** The Season's first day has arrived. */
  started: boolean;
  /** The end instant has passed. */
  ended: boolean;
}

/** Null when the window is missing or unusable; never throws on bad input. */
export function seasonProgress(
  season: { startsAt: string; endsAt: string } | null | undefined,
  now: string | number | Date = Date.now(),
): SeasonProgress | null {
  if (!season) return null;
  const start = Date.parse(season.startsAt);
  const end = Date.parse(season.endsAt);
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(nowMs)) return null;

  const startDay = utcMidnight(start);
  const endDay = utcMidnight(end);
  if (endDay < startDay) return null;

  const totalDays = Math.round((endDay - startDay) / DAY_MS) + 1;
  const rawDay = Math.round((utcMidnight(nowMs) - startDay) / DAY_MS) + 1;
  const day = Math.min(totalDays, Math.max(1, rawDay));

  return {
    day,
    totalDays,
    elapsed: day / totalDays,
    endsLabel: utcDayMonth(end),
    started: rawDay >= 1,
    ended: nowMs > end,
  };
}

export interface SeasonArcProps {
  season: SeasonView | null | undefined;
  /** Server clock (ISO) so the day number does not drift with a wrong device clock. */
  now?: string | null;
  className?: string;
}

/** Presentational: the bar plus "day N of M · ends 31 Dec". Renders nothing without a usable window. */
export function SeasonArc({ season, now, className }: SeasonArcProps) {
  const p = seasonProgress(season, now ?? Date.now());
  if (!season || !p) return null;

  const label = `${season.name} · day ${p.day} of ${p.totalDays} · ends ${p.endsLabel}`;
  return (
    <span className={cn("items-center gap-2 text-xs text-muted-foreground tabular-nums", className)} title={label}>
      <span className="block h-1 w-14 shrink-0 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden>
        <span
          className="block h-full rounded-full bg-gold/70 transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${(p.elapsed * 100).toFixed(1)}%` }}
        />
      </span>
      <span className="whitespace-nowrap">
        day {p.day} of {p.totalDays}
      </span>
      <span className="whitespace-nowrap">· ends {p.endsLabel}</span>
    </span>
  );
}

/**
 * Header form: reads the Season itself (GET /api/v1/season carries the window and the server
 * clock). One quiet request per load — no focus or session refetch, since a Season window only
 * changes once a day — and it renders nothing at all if that request fails or is offline.
 */
export function SeasonArcLive({ className }: { className?: string }) {
  const q = useApiQuery(() => api.season(), "season-arc", { refetchOnFocus: false, refetchOnSessionChange: false, awaitSession: false });
  if (!q.data?.season) return null;
  return <SeasonArc season={q.data.season} now={q.data.now} className={className} />;
}

export default SeasonArc;
