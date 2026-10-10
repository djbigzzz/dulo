"use client";

import Link from "next/link";
import { cn } from "cn";
import type { MirrorIndexRow } from "@/lib/api-client";
import { isConcentrated } from "@/lib/mirror/allocation";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPoints, formatUsd, truncateAddress } from "@/components/common/format";
import { BotMarker } from "@/components/league/LeagueLeaderboard";

export interface TargetListProps {
  rows: MirrorIndexRow[];
  /** "points" shows Season points, "equity" shows League equity. */
  metric: "points" | "equity";
  chainId?: string;
  className?: string;
}

/** Rank · player · the headline number · Copy, one row on 1px rules (the standings' row). */
export const COPY_ROW = "grid min-h-14 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-rule py-2 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto_auto] sm:gap-x-5";

/**
 * One row per wallet to copy: the rank as a scoreboard numeral, the name (a house bot dimmed, its
 * mark and the words "house bot" beside it), the headline number in the condensed cut, and a quiet
 * Copy button to /copy/[wallet].
 */
export function TargetList({ rows, metric, className }: TargetListProps) {
  return (
    <ul className={cn("border-b border-rule", className)}>
      {rows.map((row) => {
        const name = row.handle ?? row.address;
        const value = metric === "points" ? formatPoints(row.points ?? 0) : row.equityUsd !== null ? formatUsd(row.equityUsd) : "No equity yet";
        const caption = metric === "points" ? "Season points" : isConcentrated(row.topWeight) ? "Paper equity · one stock over 40%" : "Paper equity";
        return (
          <li key={`${row.address}-${row.rank}`} data-bot={row.isBot ? "" : undefined} className={COPY_ROW}>
            <span className={cn("figure text-[1.375rem] leading-none", row.rank === 1 && !row.isBot ? "text-foreground" : "text-muted-foreground")}>
              <span className="sr-only">Rank </span>
              {row.rank}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn("truncate text-[0.96875rem]", row.isBot ? "text-muted-foreground" : "font-semibold text-foreground")} title={row.address}>
                  {row.handle ?? truncateAddress(row.address)}
                </span>
                {row.isBot ? <BotMarker /> : null}
              </span>
              <span className="truncate text-[0.8125rem] text-muted-foreground">
                {/* Phones: the headline number moves under the name so long handles keep their room. */}
                <span className="font-semibold text-foreground tabular-nums sm:hidden">{value} </span>
                {caption}
              </span>
            </span>
            <span className={cn("hidden text-right text-[1.0625rem] font-semibold tabular-nums font-stretch-[85%] sm:block", row.isBot ? "text-foreground/80" : "text-foreground")}>
              {value}
            </span>
            <Link
              href={`/copy/${encodeURIComponent(row.address)}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 px-3.5 sm:h-8")}
              aria-label={`Copy the portfolio of ${name}`}
            >
              Copy
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function TargetListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <ul className={cn("border-b border-rule", className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className={COPY_ROW}>
          <Skeleton className="h-5 w-4" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="hidden h-5 w-20 sm:block" />
          <Skeleton className="h-8 w-16" />
        </li>
      ))}
    </ul>
  );
}

export default TargetList;
