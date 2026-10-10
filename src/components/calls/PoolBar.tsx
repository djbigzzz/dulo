"use client";

import { cn } from "cn";
import type { CallOdds } from "@/lib/api-client";
import { formatPoints } from "@/components/common/format";
import { splitPct } from "@/components/calls/calls-format";

export interface PoolBarProps {
  odds: CallOdds;
  /** Highlight the side the viewer holds (or is about to put points on): the other side's bar dims. */
  highlight?: "yes" | "no" | null;
  /** Show the points on each side under the split. Off where the line beside it already says the total. */
  labels?: boolean;
  className?: string;
}

/**
 * The Broadcast split, both sides always named: "43 Yes ▬▬▬▬|▬▬▬▬▬ No 57", a green (Yes) and a red
 * (No) bar with a 3px gap and a hairline at the halfway mark, the whole percents always adding up
 * to 100 (splitPct). An empty pool draws two neutral bars and says so.
 */
export function PoolBar({ odds, highlight = null, labels = true, className }: PoolBarProps) {
  const yesPct = Math.round(odds.yesProb * 100);
  const split = splitPct(odds);
  const empty = !(odds.total > 0);
  const width = empty ? 50 : yesPct;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        role="img"
        aria-label={
          empty
            ? "No points in yet"
            : `Yes ${split.yes} (${formatPoints(odds.yesPool)} points), No ${split.no} (${formatPoints(odds.noPool)} points)`
        }
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 text-[0.9375rem] leading-none font-semibold tabular-nums font-stretch-[88%]"
      >
        <span aria-hidden className={cn("whitespace-nowrap", empty ? "text-muted-foreground" : "text-yes")}>
          {empty ? "Yes" : `${yesPct} Yes`}
        </span>
        <span aria-hidden className="relative flex h-1.5 gap-[3px]">
          <i
            className={cn(
              "block h-full transition-[width,opacity] duration-300 motion-reduce:transition-none",
              empty ? "bg-ink-4" : "bg-yes",
              highlight === "no" && !empty && "opacity-40",
            )}
            style={{ width: `calc(${width}% - 1.5px)` }}
          />
          <i className={cn("block h-full flex-1 transition-opacity duration-300 motion-reduce:transition-none", empty ? "bg-ink-4" : "bg-no", highlight === "yes" && !empty && "opacity-40")} />
          <span className="absolute -top-1 -bottom-1 left-1/2 w-px bg-rule-2" />
        </span>
        <span aria-hidden className={cn("whitespace-nowrap", empty ? "text-muted-foreground" : "text-no")}>
          {empty ? "No" : `No ${100 - yesPct}`}
        </span>
      </div>
      {labels ? (
        <p className="text-[0.8125rem] leading-snug text-pretty text-muted-foreground tabular-nums">
          {empty
            ? "No points in yet."
            : `${formatPoints(odds.yesPool)} on Yes, ${formatPoints(odds.noPool)} on No: ${formatPoints(odds.total)} points in, incl. bot seed.`}
        </p>
      ) : null}
    </div>
  );
}

export default PoolBar;
