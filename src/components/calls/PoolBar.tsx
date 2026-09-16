"use client";

import { cn } from "cn";
import type { CallOdds } from "@/lib/api-client";
import { formatPoints } from "@/components/common/format";
import { formatMultiplier, formatPct } from "@/components/calls/calls-format";

export interface PoolBarProps {
  odds: CallOdds;
  /** Highlight the side the viewer holds (or is about to stake). */
  highlight?: "yes" | "no" | null;
  /** Show the share and multiplier above the bar. Cards turn this off because their side buttons carry it. */
  labels?: boolean;
  className?: string;
}

/**
 * Yes/No pool split: a 10px inset well holding an emerald (Yes) and a rose (No) gradient
 * segment with a 2px gap, pool sizes under it. An empty market renders a neutral 50/50.
 */
export function PoolBar({ odds, highlight = null, labels = true, className }: PoolBarProps) {
  const yesPct = Math.round(odds.yesProb * 100);
  const empty = odds.total === 0;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {labels ? (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className={cn("flex items-baseline gap-1.5", highlight === "yes" ? "font-semibold text-emerald-400" : "text-foreground")}>
            <span className="font-medium">Yes</span>
            <span className="tabular-nums">{formatPct(odds.yesProb)}</span>
            <span className="text-xs font-normal text-muted-foreground">{formatMultiplier(odds.yesMultiplier)}</span>
          </span>
          <span className={cn("flex items-baseline gap-1.5", highlight === "no" ? "font-semibold text-rose-400" : "text-foreground")}>
            <span className="text-xs font-normal text-muted-foreground">{formatMultiplier(odds.noMultiplier)}</span>
            <span className="tabular-nums">{formatPct(odds.noProb)}</span>
            <span className="font-medium">No</span>
          </span>
        </div>
      ) : null}
      <div
        role="img"
        aria-label={`Yes pool ${formatPoints(odds.yesPool)} points (${formatPct(odds.yesProb)}), No pool ${formatPoints(odds.noPool)} points (${formatPct(odds.noProb)})`}
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full border border-white/[0.06] bg-black/25 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width,opacity] duration-300",
            empty
              ? "bg-white/[0.08]"
              : "bg-[linear-gradient(90deg,#059669_0%,#34d399_100%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]",
            highlight === "no" && !empty && "opacity-40",
          )}
          style={{ width: `${empty ? 50 : yesPct}%` }}
        />
        <div
          className={cn(
            "h-full flex-1 rounded-full transition-opacity duration-300",
            empty
              ? "bg-white/[0.05]"
              : "bg-[linear-gradient(90deg,#fb7185_0%,#e11d48_100%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]",
            highlight === "yes" && !empty && "opacity-40",
          )}
        />
      </div>
      {/* The middle line wraps (centred) on phones rather than cutting off the house-bot label. */}
      <div className="flex items-start justify-between gap-2 text-xs tabular-nums text-muted-foreground">
        <span className="inline-flex shrink-0 items-center gap-1.5 leading-4">
          <span className="size-1.5 rounded-full bg-emerald-400/80" aria-hidden />
          {formatPoints(odds.yesPool)} pts
        </span>
        <span className="min-w-0 text-center leading-4 text-balance">
          {empty ? "No points in yet" : `${formatPoints(odds.total)} pts in the pool, house-bot seed included`}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 leading-4">
          {formatPoints(odds.noPool)} pts
          <span className="size-1.5 rounded-full bg-rose-400/80" aria-hidden />
        </span>
      </div>
    </div>
  );
}

export default PoolBar;
