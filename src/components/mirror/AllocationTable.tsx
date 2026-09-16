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
 * A warm, harmonious palette derived from ember / gold / neutral (legs are sorted by weight, so
 * the largest positions get the strongest colours). Emerald / rose stay reserved for gains and
 * losses. Legs past the palette reuse it.
 */
const SWATCHES = ["#ff6a2a", "#d8b46a", "rgb(244 241 234 / 0.7)", "#a9a299", "#7c6f60", "#ff9452", "#b88a3e", "#5a5048"];

function swatch(i: number): string {
  return SWATCHES[i % SWATCHES.length];
}

const PANEL = "flex flex-col gap-5 rounded-2xl border border-white/[0.07] bg-card p-5 sm:p-6";
const WELL = "border border-white/[0.06] bg-black/25 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]";

/** Refined stacked bar of the target's weights plus a legend (symbol, weight, value, live price). */
export function AllocationTable({ legs, quotes, totalUsd, className }: AllocationTableProps) {
  return (
    <div className={cn(PANEL, className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">Total</span>
          <span className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{formatUsd(totalUsd)}</span>
        </div>
        <span className="text-xs text-muted-foreground sm:pb-1">
          {legs.length} {legs.length === 1 ? "stock" : "stocks"} · positions worth $1+
        </span>
      </div>

      <div
        className={cn(WELL, "flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full")}
        role="img"
        aria-label={`Allocation: ${legs.map((l) => `${l.symbol} ${formatWeight(l.weight)}`).join(", ")}`}
      >
        {legs.map((leg, i) => (
          <div
            key={leg.assetId}
            className="h-full min-w-[3px] shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]"
            style={{ width: `${Math.max(0.5, leg.weight * 100)}%`, backgroundColor: swatch(i) }}
            title={`${leg.symbol} ${formatWeight(leg.weight)}`}
          />
        ))}
      </div>

      <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" aria-hidden />

      <ul className="flex flex-col">
        {legs.map((leg, i) => {
          const q = quotes.get(leg.assetId) ?? null;
          return (
            <li key={leg.assetId} className="flex items-center gap-3 border-t border-white/[0.05] py-3 first:border-t-0 first:pt-0 last:pb-0">
              <span className="size-2.5 shrink-0 rounded-full ring-2 ring-white/[0.04]" style={{ backgroundColor: swatch(i) }} aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                <span className="text-sm font-semibold sm:text-base">{leg.symbol}</span>
                <PriceChip quote={q ?? { price: null, source: "none", stale: true }} className="max-w-full" />
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="text-lg font-semibold tracking-tight tabular-nums">{formatWeight(leg.weight)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{formatUsd(leg.usd)}</span>
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
    <div className={cn(PANEL, className)} aria-hidden>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-8 w-36" />
      </div>
      <Skeleton className="h-2.5 w-full rounded-full" />
      <div className="flex flex-col gap-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-2.5 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-40 rounded-full" />
            </div>
            <Skeleton className="h-6 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default AllocationTable;
