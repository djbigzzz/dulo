"use client";

import Link from "next/link";
import { Copy } from "lucide-react";
import { cn } from "cn";
import type { MirrorIndexRow } from "@/lib/api-client";
import { isConcentrated } from "@/lib/mirror/allocation";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressChip } from "@/components/common/AddressChip";
import { formatPoints, formatUsd } from "@/components/common/format";
import { BotMarker, RankBadge } from "@/components/league/LeagueLeaderboard";

export interface TargetListProps {
  rows: MirrorIndexRow[];
  /** "points" shows Season points, "equity" shows League equity. */
  metric: "points" | "equity";
  chainId?: string;
  className?: string;
}

const ITEM = "flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-card px-3.5 py-3 sm:gap-4 sm:px-5";

/** One glass row per leader: medal / rank, name, headline number and an outline Copy button to /copy/[wallet]. */
export function TargetList({ rows, metric, chainId, className }: TargetListProps) {
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {rows.map((row) => {
        const name = row.handle ?? row.address;
        const value = metric === "points" ? `${formatPoints(row.points ?? 0)} pts` : row.equityUsd !== null ? formatUsd(row.equityUsd) : "—";
        return (
          <li
            key={`${row.address}-${row.rank}`}
            className={cn(
              ITEM,
              "transition-all duration-300 hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.04] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
              row.rank === 1 && "bg-gradient-to-r from-gold/[0.07] to-transparent",
            )}
          >
            <RankBadge rank={row.rank} className="size-8" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                {row.handle ? <span className="truncate text-sm font-medium sm:text-base">{row.handle}</span> : <AddressChip address={row.address} chainId={chainId} copy={false} />}
                {row.isBot ? <BotMarker /> : null}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {/* Phones: the headline number moves under the name so long handles keep their room. */}
                <span className="font-semibold text-foreground/90 tabular-nums sm:hidden">{value} </span>
                {metric === "points" ? "Season points" : isConcentrated(row.topWeight) ? "Paper equity · one stock over 40%" : "Paper equity"}
              </span>
            </div>
            <span className="hidden shrink-0 text-right text-base font-semibold tracking-tight tabular-nums sm:block">{value}</span>
            <Link
              href={`/copy/${encodeURIComponent(row.address)}`}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-9 shrink-0 rounded-xl px-3 font-medium sm:ml-2 sm:h-10 sm:px-4")}
              aria-label={`Copy the portfolio of ${name}`}
            >
              <Copy data-icon="inline-start" aria-hidden />
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
    <ul className={cn("flex flex-col gap-2", className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className={ITEM}>
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-10 w-24 rounded-xl" />
        </li>
      ))}
    </ul>
  );
}

export default TargetList;
