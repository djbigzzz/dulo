"use client";

import { cn } from "cn";
import type { MirrorLegView, PriceQuoteView } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { PriceChip } from "@/components/common/PriceChip";
import { formatUsd } from "@/components/common/format";
import { formatWeight } from "@/components/mirror/mirror-format";

export interface AllocationTableProps {
  legs: MirrorLegView[];
  /** Quotes keyed by assetId (from MirrorResponse.quotes). */
  quotes: ReadonlyMap<string, PriceQuoteView>;
  totalUsd: number;
  className?: string;
}

/**
 * Steps of cream and grey, light and dark alternating so neighbours stay apart (legs are sorted by
 * weight, so the largest positions get the strongest tones). No hue: green and red stay Yes / No and
 * gain / loss, and the focus blue stays the focus. Legs past the palette reuse it.
 */
const SWATCHES = ["#f3f0e8", "#87857e", "#cfccc4", "#5a5954", "#a3a199", "#3d3c39", "#e2dfd7", "#706f69"];

function swatch(i: number): string {
  return SWATCHES[i % SWATCHES.length];
}

/**
 * The target's allocation: the total in the condensed cut, one stacked bar of the weights on the ink
 * well, then one row per holding on 1px rules (swatch, symbol, its live price with source and age,
 * the weight and the value).
 */
export function AllocationTable({ legs, quotes, totalUsd, className }: AllocationTableProps) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div className="flex flex-col gap-1.5">
          <span className="text-[0.84375rem] font-medium text-muted-foreground">Total</span>
          <span className="figure text-[2.75rem] leading-[0.85] text-foreground sm:text-[3.25rem]">{formatUsd(totalUsd)}</span>
        </div>
        <span className="text-[0.84375rem] text-muted-foreground sm:pb-1">
          {legs.length} {legs.length === 1 ? "stock" : "stocks"} · positions worth $1+
        </span>
      </div>

      <div
        className="flex h-2.5 w-full gap-[2px] bg-ink-4"
        role="img"
        aria-label={`Allocation: ${legs.map((l) => `${l.symbol} ${formatWeight(l.weight)}`).join(", ")}`}
      >
        {legs.map((leg, i) => (
          <div
            key={leg.assetId}
            className="h-full min-w-[3px]"
            style={{ width: `${Math.max(0.5, leg.weight * 100)}%`, backgroundColor: swatch(i) }}
            title={`${leg.symbol} ${formatWeight(leg.weight)}`}
          />
        ))}
      </div>

      <ul className="border-b border-rule">
        {legs.map((leg, i) => {
          const q = quotes.get(leg.assetId) ?? null;
          return (
            <li key={leg.assetId} className="flex items-center gap-3 border-t border-rule py-3 sm:gap-4">
              <span className="size-2.5 shrink-0" style={{ backgroundColor: swatch(i) }} aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <span className="text-[0.96875rem] font-semibold">{leg.symbol}</span>
                <PriceChip quote={q ?? { price: null, source: "none", stale: true }} className="max-w-full" />
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[1.25rem] leading-none font-semibold tabular-nums font-stretch-[85%]">{formatWeight(leg.weight)}</span>
                <span className="text-[0.8125rem] text-muted-foreground tabular-nums">{formatUsd(leg.usd)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AllocationTableSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-5", className)} aria-hidden>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-10 w-44" />
      </div>
      <Skeleton className="h-2.5 w-full" />
      <div className="flex flex-col border-b border-rule">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-t border-rule py-3">
            <Skeleton className="size-2.5" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-48" />
            </div>
            <Skeleton className="h-6 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default AllocationTable;
