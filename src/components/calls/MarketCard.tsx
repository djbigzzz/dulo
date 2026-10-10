"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "cn";
import type { CallMarketView, CallPositionView, CallSide } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPoints, formatUsd } from "@/components/common/format";
import { formatTrackClock, spokenTrackClock } from "@/components/layout/week-track";
import { PoolBar } from "@/components/calls/PoolBar";
import { PriceTrack } from "@/components/calls/PriceTrack";
import { XStockLogo } from "@/components/common/XStockLogo";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  crowdLead,
  formatSettleDay,
  liveStatus,
  resultLabel,
  sideButtonLabel,
  sideLabel,
  utcStamp,
} from "@/components/calls/calls-format";

export interface MarketCardProps {
  market: CallMarketView;
  /** The viewer's points on this market (0, 1 or 2 entries — one per side). */
  positions: CallPositionView[];
  /** Client clock, ms. Drives the lock countdown and the open -> locked flip. */
  nowMs: number;
  signedIn: boolean;
  /**
   * A side button was pressed. The page decides what happens: the points dialog when signed
   * in, the wallet / sign-in flow when not. Buttons are never rendered disabled.
   */
  onPlace?: (market: CallMarketView, side: CallSide) => void;
  /**
   * Show this segment's own "Locks in 6:01:45" (default true). /predictions turns it off when its
   * page clock already counts down to the same lock: each clock appears once a page.
   */
  showClock?: boolean;
  /** "1 of 3" in the kicker, when the segment is one of a set. */
  index?: number;
  total?: number;
  className?: string;
}

/** A small ruled tag beside the kicker: cream text on a 1px rule, no fill, no hue. */
const TAG = "inline-flex h-[1.375rem] items-center border border-rule-2 px-1.5 text-xs leading-none font-semibold whitespace-nowrap text-foreground";

function Kicker({ market, status, nowMs, index, total }: { market: CallMarketView; status: ReturnType<typeof liveStatus>; nowMs: number; index?: number; total?: number }) {
  const settling = status === "locked" && nowMs >= Date.parse(market.settleAt);
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.84375rem] font-medium text-muted-foreground @3xl/seg:text-sm">
      <XStockLogo symbol={market.symbol} ticker={market.ticker} className="size-[22px] @3xl/seg:size-7" />
      <b className="font-semibold whitespace-nowrap text-foreground">{market.symbol}</b>
      {index !== undefined && total !== undefined && total > 1 ? (
        <>
          <span aria-hidden className="h-3.5 w-px shrink-0 bg-rule-2" />
          <span className="whitespace-nowrap">
            {index + 1} of {total}
          </span>
        </>
      ) : null}
      {status === "settled" ? <span className="stamp">Final</span> : null}
      {status === "void" ? <span className={TAG}>Void</span> : null}
      {status === "locked" ? <span className={TAG}>{settling ? "Settling" : "Entries closed"}</span> : null}
    </div>
  );
}

/** "Locks in 6:01:45" over its UTC stamp: the segment's own clock (the /start tour, a lock the page clock does not show). */
function LockClock({ market, nowMs }: { market: CallMarketView; nowMs: number }) {
  const reduced = useReducedMotion();
  const ms = Date.parse(market.locksAt) - nowMs;
  // The multi-day form ("5d 20:07:38", next week's lock seen from the weekend) is four characters
  // longer: it steps down a size in a phone-width segment and never wraps onto two lines.
  const days = ms >= 48 * 3_600_000;
  return (
    <div className="flex items-end justify-between gap-4 @3xl/seg:flex-col @3xl/seg:items-start @3xl/seg:justify-start @3xl/seg:gap-0">
      {/* min-w-0, and the stamp wraps in a segment under 20rem (a 320px phone): the figure keeps its line. */}
      <div className="min-w-0 @3xl/seg:contents">
        <p className="text-[0.84375rem] leading-none font-medium text-muted-foreground @3xl/seg:text-sm">Locks in</p>
        <p className="mono-meta mt-2 @max-[20rem]/seg:whitespace-normal @3xl/seg:order-last @3xl/seg:mt-3.5">
          <time dateTime={market.locksAt}>{utcStamp(market.locksAt)}</time>
        </p>
      </div>
      <p
        role="timer"
        aria-label={`Locks in ${spokenTrackClock(ms, !reduced)}`}
        className={cn(
          "figure shrink-0 leading-[0.8] whitespace-nowrap @3xl/seg:mt-3",
          days
            ? "text-[1.75rem] @min-[20rem]/seg:text-[2rem] @md/seg:text-[2.5rem] @3xl/seg:text-[3.5rem] @5xl/seg:text-[4rem]"
            : "text-[2.75rem] @3xl/seg:text-[4.5rem] @5xl/seg:text-[5rem]",
        )}
      >
        {formatTrackClock(ms, !reduced)}
      </p>
    </div>
  );
}

/** The settled result: "Result · Yes" in the side's colour, the close, its source and time. */
function Result({ market, status }: { market: CallMarketView; status: ReturnType<typeof liveStatus> }) {
  const word = status === "void" ? "Void" : market.outcome === "yes" ? "Yes" : market.outcome === "no" ? "No" : "Pending";
  const tone = word === "Yes" ? "text-yes" : word === "No" ? "text-no" : "text-muted-foreground";
  return (
    <div className="flex items-end justify-between gap-4 @3xl/seg:flex-col @3xl/seg:items-start @3xl/seg:justify-start @3xl/seg:gap-0">
      <div className="@3xl/seg:contents">
        <p className="text-[0.84375rem] leading-none font-medium text-muted-foreground @3xl/seg:text-sm">Result</p>
        <p className="mono-meta mt-2 whitespace-normal @3xl/seg:order-last @3xl/seg:mt-3.5">
          {status === "void" ? (
            "Refunded: no price within 24 hours of the close"
          ) : (
            <time dateTime={market.settleAt}>Settled {utcStamp(market.settleAt)}</time>
          )}
        </p>
      </div>
      <p className={cn("figure text-[2.75rem] leading-[0.8] font-medium font-stretch-[85%] @3xl/seg:mt-3 @3xl/seg:text-[4.5rem] @5xl/seg:text-[5rem]", tone)}>{word}</p>
    </div>
  );
}

/** "57% say No", the split, and the points in (house bots seed every pool, so it says so). */
function Crowd({ market, done }: { market: CallMarketView; done: boolean }) {
  const lead = crowdLead(market.odds);
  const empty = !(market.odds.total > 0);
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between gap-3 @3xl/seg:mb-3.5 @3xl/seg:block">
      <p className="font-display text-[1.375rem] leading-none @3xl/seg:text-[1.875rem]">
        {lead ? (
          <>
            <b className={cn("mr-1 font-sans text-[1.375rem] font-semibold tracking-[-0.01em] tabular-nums font-stretch-[88%] @3xl/seg:mr-1.5 @3xl/seg:text-[1.875rem]", lead.side === "yes" ? "text-yes" : "text-no")}>
              {lead.pct}
            </b>
            {done ? "said" : "say"} {sideLabel(lead.side)}
          </>
        ) : empty ? (
          "No points in yet"
        ) : (
          "An even split"
        )}
      </p>
        {/* Narrow: the points in sit on the crowd's line, so the Yes / No buttons come up a row. */}
        {empty ? null : (
          <p className="text-right text-[0.8125rem] leading-tight text-muted-foreground tabular-nums @3xl/seg:hidden">{formatPoints(market.odds.total)} points in, incl. bot seed</p>
        )}
      </div>
      <PoolBar odds={market.odds} labels={false} />
      <p className={cn("mt-3 text-[0.84375rem] leading-snug text-pretty text-muted-foreground", !empty && "hidden @3xl/seg:block")}>
        {empty ? "Points only, no cash value." : `${formatPoints(market.odds.total)} points in, incl. bot seed. Points only.`}
      </p>
    </div>
  );
}

function Positions({ positions, done }: { positions: CallPositionView[]; done: boolean }) {
  if (positions.length === 0) return null;
  return (
    <ul className="flex flex-col border-t border-rule">
      {positions.map((p) => (
        <li key={p.side} className="flex min-h-10 items-center justify-between gap-3 border-b border-rule text-sm">
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <span className={cn("size-[7px] shrink-0 rounded-full", p.side === "yes" ? "bg-yes" : "bg-no")} aria-hidden />
            <span className="truncate">
              You · <span className="font-semibold text-foreground">{sideLabel(p.side)}</span> · <span className="tabular-nums">{formatPoints(p.points)}</span> pts
            </span>
          </span>
          {done ? (
            <span
              className={cn(
                "shrink-0 font-semibold tabular-nums",
                p.result === "won" ? "text-yes" : p.result === "lost" ? "text-no" : "text-muted-foreground",
              )}
            >
              {resultLabel(p)}
            </span>
          ) : (
            <span className="shrink-0 text-muted-foreground tabular-nums">
              <span className="font-semibold text-foreground">{formatPoints(p.potentialPayout)}</span> points back
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Yes and No: the side's colour on a rule (green and red mean Yes and No here, and nothing else). */
const SIDE: Record<CallSide, { idle: string; held: string; word: string; hint: string }> = {
  yes: {
    idle: "border-[rgb(58_208_138/0.45)] hover:bg-[rgb(58_208_138/0.08)]",
    held: "border-yes bg-[rgb(58_208_138/0.13)] hover:bg-[rgb(58_208_138/0.18)]",
    word: "text-yes",
    hint: "closes above",
  },
  no: {
    idle: "border-[rgb(255_93_108/0.45)] hover:bg-[rgb(255_93_108/0.08)]",
    held: "border-no bg-[rgb(255_93_108/0.13)] hover:bg-[rgb(255_93_108/0.18)]",
    word: "text-no",
    hint: "closes below",
  },
};

/**
 * One prediction as a Broadcast segment: the kicker (logo, symbol, "1 of 3", the FINAL stamp), the
 * question in the serif, the price track against the line, and beside it (under it on a narrow
 * container) the crowd's split, the viewer's points and the Yes / No buttons. Sized by its own
 * width (`@container/seg`), so it reads the same in the /predictions list and in a /start step.
 */
export function MarketCard({ market, positions, nowMs, signedIn, onPlace, showClock = true, index, total, className }: MarketCardProps) {
  const status = liveStatus(market, nowMs);
  const open = status === "open";
  const done = status === "settled" || status === "void";
  const settling = status === "locked" && nowMs >= Date.parse(market.settleAt);
  const questionId = React.useId();

  return (
    <article data-market-id={market.id} data-status={status} aria-labelledby={questionId} className={cn("@container/seg", className)}>
      <div className="grid @3xl/seg:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)] @5xl/seg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 pt-4 pb-5 @3xl/seg:pt-6 @3xl/seg:pr-10 @3xl/seg:pb-6 @5xl/seg:pr-14">
          <Kicker market={market} status={status} nowMs={nowMs} index={index} total={total} />
          <h3
            id={questionId}
            className="mt-2.5 font-display text-[2rem] leading-[0.98] font-normal tracking-[-0.012em] @[22rem]/seg:text-[2.1875rem] @md/seg:text-[2.375rem] @3xl/seg:mt-4 @3xl/seg:text-[2.875rem] @5xl/seg:text-[3.25rem]"
          >
            Will {market.ticker} close above{" "}
            {/* Narrow: the line and the day on a line of their own, never split. */}
            <span className="block whitespace-nowrap @3xl/seg:inline">
              {formatUsd(market.strike)} on {formatSettleDay(market.settleAt)}?
            </span>
          </h3>
          <PriceTrack market={market} settled={status === "settled" && market.settledPrice !== null} />
        </div>

        <div className="flex min-w-0 flex-col gap-4 border-t border-rule pt-4 pb-5 @3xl/seg:gap-5 @3xl/seg:border-t-0 @3xl/seg:border-l @3xl/seg:pt-6 @3xl/seg:pb-6 @3xl/seg:pl-10">
          {done ? <Result market={market} status={status} /> : open && showClock ? <LockClock market={market} nowMs={nowMs} /> : null}
          {done || (open && showClock) ? <span aria-hidden className="-mb-1 h-px bg-rule @3xl/seg:-mb-0.5" /> : null}
          <Crowd market={market} done={done} />
          <Positions positions={positions} done={done} />

          {open ? (
            <div className="grid grid-cols-2 gap-2">
              {(["yes", "no"] as const).map((side) => {
                const held = positions.some((p) => p.side === side);
                return (
                  <button
                    key={side}
                    type="button"
                    onClick={() => onPlace?.(market, side)}
                    aria-label={`${sideButtonLabel(market.odds, side)}. ${signedIn ? (held ? "Add to your prediction" : "Make a prediction") : "Sign in to make a prediction"}`}
                    className={cn(
                      "flex h-12 min-w-0 items-center justify-between gap-2 border px-3.5 whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px motion-reduce:transition-none",
                      held ? SIDE[side].held : SIDE[side].idle,
                    )}
                  >
                    <span className={cn("flex items-center gap-1.5 text-base font-semibold", SIDE[side].word)}>
                      {held ? <Check className="size-4" aria-hidden /> : null}
                      {sideLabel(side)}
                    </span>
                    <span className="truncate text-[0.8125rem] text-muted-foreground">{held ? "yours" : SIDE[side].hint}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {open && !showClock ? (
            <p className="mono-meta -mt-1">
              <time dateTime={market.locksAt}>Locks {utcStamp(market.locksAt)}</time>
            </p>
          ) : status === "locked" && !settling ? (
            // The kicker already says "Entries closed" (or "Settling"): this line says when it settles.
            <p className="mono-meta">
              <time dateTime={market.settleAt}>Settles {utcStamp(market.settleAt)}</time>
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function MarketCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("@container/seg", className)} aria-hidden>
      <div className="grid @3xl/seg:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)] @5xl/seg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 pt-4 pb-5 @3xl/seg:pt-6 @3xl/seg:pr-10 @3xl/seg:pb-6 @5xl/seg:pr-14">
          <div className="flex items-center gap-3">
            <Skeleton className="size-[22px] rounded-full @3xl/seg:size-7" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="mt-3 h-[1.9rem] w-11/12 @3xl/seg:mt-5 @3xl/seg:h-[2.6rem] @3xl/seg:w-4/5" />
          <Skeleton className="mt-2 h-[1.9rem] w-2/3 @3xl/seg:h-[2.6rem] @3xl/seg:w-1/2" />
          <div className="relative mt-4 h-[84px] @3xl/seg:mt-7 @3xl/seg:h-[108px]">
            <Skeleton className="absolute inset-x-0 top-10 h-2 @3xl/seg:top-[52px] @3xl/seg:h-2.5" />
            <Skeleton className="absolute top-[60px] left-1/3 h-3.5 w-48 @3xl/seg:top-[78px]" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4 border-t border-rule pt-4 pb-5 @3xl/seg:gap-5 @3xl/seg:border-t-0 @3xl/seg:border-l @3xl/seg:pt-6 @3xl/seg:pb-6 @3xl/seg:pl-10">
          <div>
            <Skeleton className="mb-3 h-6 w-36 @3xl/seg:h-7" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="mt-3 h-3.5 w-3/4" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default MarketCard;
