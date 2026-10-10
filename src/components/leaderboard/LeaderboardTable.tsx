"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "cn";
import type { LeaderboardRow } from "@/lib/api-client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { explorerUrl, formatPoints, truncateAddress } from "@/components/common/format";

export interface LeaderboardTableProps {
  rows: LeaderboardRow[];
  /** Highlights the signed-in user's row when present. */
  meUserId?: string | null;
  /** CAIP-2 chain id used for the explorer link on addresses. */
  chainId?: string;
  /** The table's accessible name. */
  label?: string;
  className?: string;
}

function HeaderRow() {
  return (
    <TableRow className="border-rule hover:bg-transparent">
      <TableHead className="w-14 pl-2 sm:w-16 sm:pl-3">#</TableHead>
      <TableHead>Player</TableHead>
      <TableHead className="hidden w-40 sm:table-cell">
        <span className="sr-only">Copy</span>
      </TableHead>
      <TableHead className="w-28 pr-2 text-right sm:w-36 sm:pr-3">Season points</TableHead>
    </TableRow>
  );
}

/**
 * The Season standings below the seats: rank, player, a quiet way to copy the wallet's portfolio and
 * the Season points, one 46px row each on 1px rules (the weekly standings' timing tower without the
 * zero line: Season points have no starting line). The signed-in player's row is lit: a faint fill
 * and a cream rule on the left. House bots never appear here (REAL_USER_WHERE on the server).
 */
export function LeaderboardTable({ rows, meUserId, chainId, label = "Season standings", className }: LeaderboardTableProps) {
  return (
    <div className={cn("border-b border-rule", className)}>
      <Table aria-label={label}>
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

function PlayerName({ row, chainId, lit }: { row: LeaderboardRow; chainId?: string; lit: boolean }) {
  const cls = cn("truncate text-[0.96875rem]", lit ? "font-semibold text-foreground" : "font-medium text-foreground");
  if (row.handle) return <span className={cls}>{row.handle}</span>;
  if (row.address) {
    const href = chainId ? explorerUrl(chainId, row.address) : null;
    const short = truncateAddress(row.address);
    return href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={row.address}
        aria-label={`${short}, open in the explorer (new tab)`}
        className={cn(cls, "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus)]")}
      >
        {short}
      </a>
    ) : (
      <span className={cls} title={row.address}>
        {short}
      </span>
    );
  }
  return <span className="truncate text-muted-foreground">Anonymous</span>;
}

export function LeaderboardTableRow({ row, isMe, chainId, pinned = false }: { row: LeaderboardRow; isMe: boolean; chainId?: string; pinned?: boolean }) {
  return (
    <TableRow
      data-state={isMe ? "selected" : undefined}
      data-user-id={row.userId}
      className={cn(
        "group/row relative h-[2.875rem]",
        isMe && "bg-white/[0.045] data-[state=selected]:bg-white/[0.045] [&>td:first-child]:shadow-[inset_2px_0_0_var(--foreground)]",
        pinned && "border-0",
      )}
    >
      <TableCell className="pl-2 sm:pl-3">
        <span className={cn("figure text-[1.375rem] leading-none", row.rank === 1 || isMe ? "text-foreground" : "text-muted-foreground")}>
          <span className="sr-only">Rank </span>
          {row.rank}
        </span>
      </TableCell>
      <TableCell className="max-w-[52vw] sm:max-w-none">
        <span className="flex min-w-0 items-center gap-2">
          <PlayerName row={row} chainId={chainId} lit={isMe} />
          {isMe ? <Badge className="h-5 px-1.5 text-xs font-semibold">You</Badge> : null}
          {/* Phones: the copy column folds into the player cell. */}
          {row.address && !isMe ? (
            <Link
              href={`/copy/${encodeURIComponent(row.address)}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto shrink-0 sm:hidden")}
              aria-label={`Copy the portfolio of ${row.handle ?? row.address}`}
            >
              Copy
            </Link>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        {row.address && !isMe ? (
          <Link
            href={`/copy/${encodeURIComponent(row.address)}`}
            className={cn(buttonVariants({ variant: "link" }), "text-[0.84375rem] text-muted-foreground hover:text-foreground")}
            aria-label={`Copy the portfolio of ${row.handle ?? row.address}`}
            title="See this wallet's allocation and open prefilled Jupiter swaps"
          >
            Copy portfolio
            <ArrowRight className="size-3.5 transition-transform group-hover/row:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
          </Link>
        ) : null}
      </TableCell>
      <TableCell className="pr-2 text-right sm:pr-3">
        <span className={cn("text-[1.0625rem] font-semibold tabular-nums font-stretch-[85%]", row.rank === 1 || isMe ? "text-foreground" : "text-foreground/85")}>
          {formatPoints(row.points)}
        </span>
      </TableCell>
    </TableRow>
  );
}

export function LeaderboardTableSkeleton({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("border-b border-rule", className)} aria-hidden>
      <Table>
        <TableHeader>
          <HeaderRow />
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRow key={i} className="h-[2.875rem] hover:bg-transparent">
              <TableCell className="pl-2 sm:pl-3">
                <Skeleton className="h-5 w-4" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-28" />
              </TableCell>
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="pr-2 sm:pr-3">
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
