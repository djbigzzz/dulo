"use client";

import * as React from "react";
import { cn } from "cn";
import type { CallMarketView } from "@/lib/api-client";
import { PriceChip } from "@/components/common/PriceChip";
import { formatUsd } from "@/components/common/format";
import { STRIKE_NOTE, gapLabel, settleSourceLabel, trackPosition, utcStamp } from "@/components/calls/calls-format";

export interface PriceTrackProps {
  market: CallMarketView;
  /** Draw the settled close instead of the live price (a FINAL segment). */
  settled?: boolean;
  className?: string;
}

/**
 * The price track: No on the left, Yes on the right, the line it has to beat (the strike) in the
 * middle, the price as a dot with its gap to the line bracketed above it and its source and age
 * under it (PriceChip). Final: the settled close, its source and time. Sized by the segment's
 * container (`@container/seg`): the tall version, with the strike labelled, from 48rem; the compact
 * one under it (a phone, the /start step, the dialog).
 */
export function PriceTrack({ market, settled = false, className }: PriceTrackProps) {
  const price = settled ? market.settledPrice : (market.quote?.price ?? null);
  const pos = trackPosition(price, market.strike);
  const below = pos !== null && pos.gap < 0;
  const at = pos ? `${pos.p.toFixed(2)}%` : "50%";
  const source = settleSourceLabel(market.source);
  const summary =
    pos === null
      ? `No live price. The line is ${formatUsd(market.strike)}, the ${STRIKE_NOTE}.`
      : `${settled ? `Closed at ${formatUsd(price)}` : `${market.symbol} is at ${formatUsd(price)}`}, ${gapLabel(pos.gap).toLowerCase()}${
          Math.abs(pos.gap) >= 0.005 ? " the line" : ""
        } of ${formatUsd(market.strike)}.`;

  return (
    <div
      data-slot="price-track"
      className={cn("relative mt-4 h-[84px] @3xl/seg:mt-7 @3xl/seg:h-[108px]", className)}
      style={{ "--p": at } as React.CSSProperties}
    >
      <span className="sr-only">{summary}</span>
      {/* No below the line, Yes above it. */}
      <div aria-hidden className="absolute inset-x-0 top-10 flex h-2 @3xl/seg:top-[52px] @3xl/seg:h-2.5">
        <i className="block h-full w-1/2 bg-[linear-gradient(90deg,rgb(255_93_108/0.04),rgb(255_93_108/0.13)_70%,rgb(255_93_108/0.28))] shadow-[inset_0_-2px_0_rgb(255_93_108/0.75)]" />
        <i className="block h-full flex-1 bg-[linear-gradient(90deg,rgb(58_208_138/0.28),rgb(58_208_138/0.13)_30%,rgb(58_208_138/0.04))] shadow-[inset_0_-2px_0_rgb(58_208_138/0.75)]" />
      </div>
      <p aria-hidden className="absolute top-3.5 left-0 text-sm leading-[1.15] font-semibold text-no @3xl/seg:top-1 @3xl/seg:text-base">
        No
        <span className="hidden text-[0.8125rem] leading-[1.3] font-normal text-muted-foreground @3xl/seg:block">closes below</span>
      </p>
      <p aria-hidden className="absolute top-3.5 right-0 text-right text-sm leading-[1.15] font-semibold text-yes @3xl/seg:top-1 @3xl/seg:text-base">
        Yes
        <span className="hidden text-[0.8125rem] leading-[1.3] font-normal text-muted-foreground @3xl/seg:block">closes above</span>
      </p>
      {/* The line it has to beat, labelled on the side away from the price. */}
      <span aria-hidden className="absolute top-1 left-1/2 h-[52px] w-0.5 -translate-x-px bg-paper @3xl/seg:top-0 @3xl/seg:h-[74px]" />
      <p aria-hidden className={cn("absolute -top-0.5 left-1/2 hidden whitespace-nowrap @3xl/seg:block", below || pos === null ? "pl-3" : "-translate-x-full pr-3 text-right")}>
        <span className="block text-xl leading-none font-semibold tabular-nums font-stretch-[92%]">{formatUsd(market.strike)}</span>
        <span className="mt-[5px] block text-[0.8125rem] leading-none text-muted-foreground">{STRIKE_NOTE}</span>
      </p>
      {pos ? (
        <>
          {Math.abs(pos.gap) >= 0.005 ? (
            <div
              aria-hidden
              className="absolute top-[22px] h-2.5 border border-b-0 border-mute @3xl/seg:top-[30px] @3xl/seg:h-3"
              style={below ? { left: "var(--p)", width: "calc(50% - var(--p))" } : { left: "50%", width: "calc(var(--p) - 50%)" }}
            >
              <span
                className={cn(
                  "absolute bottom-[13px] text-[0.78125rem] leading-none font-semibold whitespace-nowrap text-foreground @3xl/seg:bottom-4 @3xl/seg:text-sm",
                  // Centred over a wide bracket; over a narrow one it keeps clear of the line, on the price's side.
                  below ? "right-2" : "left-2",
                  Math.abs(pos.p - 50) >= 18 && (below ? "@3xl/seg:right-auto @3xl/seg:left-1/2 @3xl/seg:-translate-x-1/2" : "@3xl/seg:left-1/2 @3xl/seg:-translate-x-1/2"),
                )}
              >
                {gapLabel(pos.gap)}
              </span>
            </div>
          ) : (
            <span aria-hidden className="absolute top-[22px] left-1/2 ml-2 text-[0.78125rem] leading-none font-semibold text-foreground @3xl/seg:top-[30px] @3xl/seg:text-sm">
              {gapLabel(pos.gap)}
            </span>
          )}
          <span
            aria-hidden
            className="absolute top-11 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper shadow-[0_0_0_4px_rgb(243_240_232/0.14)] transition-[left] duration-500 motion-reduce:transition-none @3xl/seg:top-[57px] @3xl/seg:size-[22px] @3xl/seg:shadow-[0_0_0_5px_rgb(243_240_232/0.14),inset_0_0_0_1px_var(--ink)]"
            style={{ left: "var(--p)" }}
          />
        </>
      ) : null}
      {/* Its source and age: the anchor slides along the track with the dot, so it never leaves it. */}
      <div className="absolute top-[60px] max-w-full whitespace-nowrap @3xl/seg:top-[78px]" style={{ left: "var(--p)", transform: "translateX(calc(-1 * var(--p)))" }}>
        {settled ? (
          <span className="mono-meta">
            <span className="font-medium text-foreground">Closed {formatUsd(market.settledPrice)}</span>
            {source ? ` · ${source}` : ""}
            <span className="hidden @md/seg:inline"> · {utcStamp(market.settleAt)}</span>
          </span>
        ) : market.quote ? (
          <PriceChip quote={market.quote} symbol={market.symbol} className="flex-nowrap" />
        ) : (
          <span className="text-[0.8125rem] text-muted-foreground">No live price right now</span>
        )}
      </div>
    </div>
  );
}

export default PriceTrack;
