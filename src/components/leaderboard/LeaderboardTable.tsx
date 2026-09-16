"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "cn";
import type { LeaderboardRow } from "@/lib/api-client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressChip } from "@/components/common/AddressChip";
import { formatPoints } from "@/components/common/format";
import { MedalChip } from "@/components/leaderboard/Podium";

export interface LeaderboardTableProps {
  rows: LeaderboardRow[];
  /** Highlights the signed-in user's row when present. */
  meUserId?: string | null;
  /** CAIP-2 chain id used for the explorer link on addresses. */
  chainId?: string;
  className?: string;
}

const PANEL = "overflow-hidden rounded-2xl border border-white/[0.07] bg-card";

function HeaderRow() {
  return (
    <TableRow className="bg-white/[0.02] hover:bg-white/[0.02]">
      <TableHead className="h-11 w-16 pl-4 sm:pl-5">Rank</TableHead>
      <TableHead className="h-11">Player</TableHead>
      <TableHead className="h-11 pr-4 text-right sm:pr-5">Points</TableHead>
    </TableRow>
  );
}

/** Rank / Player / Points. The shadcn Table already wraps itself in an overflow-x-auto container. */
export function LeaderboardTable({ rows, meUserId, chainId, className }: LeaderboardTableProps) {
  return (
    <div className={cn(PANEL, className)}>
      <Table>
        <TableHeader>
          <HeaderRow />
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <LeaderboardTableRow key={row.userId} row={row} isMe={Boolean(meUserId && row.userId === meUserId)} chainId={chainId} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function LeaderboardTableRow({
  row,
  isMe,
  chainId,
  pinned = false,
}: {
  row: LeaderboardRow;
  isMe: boolean;
  chainId?: string;
  pinned?: boolean;
}) {
  return (
    <TableRow
      data-state={isMe ? "selected" : undefined}
      data-user-id={row.userId}
      className={cn(
        "group/row h-14",
        isMe &&
          "bg-[linear-gradient(90deg,rgb(255_106_42/0.10),rgb(255_106_42/0.02)_45%,transparent)] shadow-[inset_2px_0_0_var(--ember)] hover:bg-[linear-gradient(90deg,rgb(255_106_42/0.14),rgb(255_106_42/0.03)_45%,transparent)] data-[state=selected]:bg-transparent",
        pinned && "border-0",
      )}
    >
      <TableCell className="pl-4 sm:pl-5">
        <MedalChip rank={row.rank} className={cn(isMe && row.rank > 3 && "text-ember")} />
      </TableCell>
      <TableCell className="max-w-[52vw] sm:max-w-none">
        <span className="flex min-w-0 items-center gap-2">
          {row.handle ? (
            <span className={cn("truncate font-medium", row.rank <= 3 && "font-semibold")}>{row.handle}</span>
          ) : row.address ? (
            <AddressChip address={row.address} chainId={chainId} explorer={Boolean(chainId)} copy={false} />
          ) : (
            <span className="text-muted-foreground">Anonymous</span>
          )}
          {isMe ? <span className="shrink-0 rounded-full border border-ember/30 bg-ember/10 px-2 py-0.5 text-xs font-medium text-ember">You</span> : null}
          {row.address && !isMe ? (
            <Link
              href={`/copy/${encodeURIComponent(row.address)}`}
              className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-3 text-xs font-medium text-muted-foreground shadow-[inset_0_1px_0_rgb(255_245_230/0.06)] transition-all hover:border-white/15 hover:bg-white/[0.07] hover:text-foreground focus-visible:border-ring focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-label={`Copy the portfolio of ${row.handle ?? row.address}`}
              title="See this wallet's allocation and open prefilled Jupiter swaps"
            >
              Copy
              <ArrowUpRight className="size-3 transition-transform group-hover/row:translate-x-px group-hover/row:-translate-y-px" aria-hidden />
            </Link>
          ) : null}
        </span>
      </TableCell>
      <TableCell
        className={cn(
          "pr-4 text-right font-semibold tracking-tight tabular-nums sm:pr-5",
          row.rank <= 3 ? "text-base" : "text-sm",
          row.rank === 1 && "text-gold",
          isMe && "text-ember",
        )}
      >
        {formatPoints(row.points)}
      </TableCell>
    </TableRow>
  );
}

export function LeaderboardTableSkeleton({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn(PANEL, className)} aria-hidden>
      <Table>
        <TableHeader>
          <HeaderRow />
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRow key={i} className="h-14 hover:bg-transparent">
              <TableCell className="pl-4 sm:pl-5">
                <Skeleton className="size-7 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-6 w-28 rounded-md" />
              </TableCell>
              <TableCell className="pr-4 sm:pr-5">
                <Skeleton className="ml-auto h-4 w-12" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default LeaderboardTable;
