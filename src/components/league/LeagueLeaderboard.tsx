"use client";

import { Bot } from "lucide-react";
import { cn } from "cn";
import type { LeagueLeaderboardRow } from "@/lib/api-client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressChip } from "@/components/common/AddressChip";
import { formatUsd } from "@/components/common/format";
import { RankDelta } from "@/components/league/AccountCard";
import { formatSignedPct } from "@/components/league/format";

export interface LeagueLeaderboardProps {
  rows: LeagueLeaderboardRow[];
  /** CAIP-2 chain id for the explorer link on addresses. */
  chainId?: string;
  /** Hide the delta column (settled weeks). */
  showDelta?: boolean;
  className?: string;
}

/** Equity is the widest column and the least decisive one (Return ranks the board): hidden below `sm` so the table fits a 375 px phone. */
const EQUITY_COL = "hidden sm:table-cell";

/** Glass panel shared by every League table. */
export const LEAGUE_PANEL = "overflow-hidden rounded-2xl border border-white/[0.07] bg-card";

/** Metallic gold / silver / bronze chips for the podium (DESIGN.md), a plain muted number below it. */
const MEDAL: Record<number, string> = {
  1: "border-[#e6c27a]/55 bg-[linear-gradient(160deg,rgb(246_227_180/0.42)_0%,rgb(216_180_106/0.22)_45%,rgb(150_110_45/0.28)_100%)] text-[#fbe9bf] shadow-[inset_0_1px_0_rgb(255_244_214/0.45),0_0_16px_-4px_rgb(216_180_106/0.6)]",
  2: "border-zinc-300/35 bg-[linear-gradient(160deg,rgb(228_228_231/0.3)_0%,rgb(161_161_170/0.14)_50%,rgb(113_113_122/0.2)_100%)] text-zinc-200 shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]",
  3: "border-[#d49a6a]/45 bg-[linear-gradient(160deg,rgb(232_180_136/0.32)_0%,rgb(212_154_106/0.16)_50%,rgb(140_90_50/0.24)_100%)] text-[#e9b48a] shadow-[inset_0_1px_0_rgb(255_225_200/0.3)]",
};

export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  const medal = MEDAL[rank];
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs tabular-nums",
        medal ? cn("border font-semibold", medal) : "font-medium text-muted-foreground",
        className,
      )}
      aria-label={`Rank ${rank}`}
    >
      {rank}
    </span>
  );
}

/**
 * Marker for seeded bot accounts: the icon, plus the visible words "house bot" from 400px (touch
 * screens never show a title tooltip). Below 400px the name keeps the room and the icon keeps its label.
 */
export function BotMarker({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 text-muted-foreground/60", className)}
      title="House bot, never earns points"
      role="img"
      aria-label="House bot, never earns points"
    >
      <Bot className="size-3.5" aria-hidden />
      <span className="hidden text-xs whitespace-nowrap text-muted-foreground min-[400px]:inline">house bot</span>
    </span>
  );
}

/** Refined emerald / rose pill for a signed return. */
export function ReturnPill({ pct, digits = 2, className }: { pct: number | null; digits?: number; className?: string }) {
  const flat = pct === null || !Number.isFinite(pct) || Math.abs(pct) < 0.005;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2 text-xs font-semibold tabular-nums",
        flat
          ? "border-white/[0.06] bg-white/[0.03] text-muted-foreground"
          : pct > 0
            ? "border-emerald-400/15 bg-emerald-400/10 text-emerald-400"
            : "border-rose-400/15 bg-rose-400/10 text-rose-400",
        className,
      )}
    >
      {formatSignedPct(pct, digits)}
    </span>
  );
}

function BoardHeader() {
  return (
    <TableHeader>
      <TableRow className="bg-white/[0.02] hover:bg-white/[0.02]">
        <TableHead className="w-24 pl-4 tracking-[0.14em] sm:pl-5">Rank</TableHead>
        <TableHead className="tracking-[0.14em]">Player</TableHead>
        <TableHead className={cn(EQUITY_COL, "text-right tracking-[0.14em]")}>Equity</TableHead>
        <TableHead className="pr-4 text-right tracking-[0.14em] sm:pr-5">Return</TableHead>
      </TableRow>
    </TableHeader>
  );
}

/** Rank (+ delta) / Player / Equity (sm and up) / Return. */
export function LeagueLeaderboard({ rows, chainId, showDelta = true, className }: LeagueLeaderboardProps) {
  return (
    <div className={cn(LEAGUE_PANEL, className)}>
      <Table>
        <BoardHeader />
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.userId}
              data-user-id={row.userId}
              aria-current={row.isMe ? "true" : undefined}
              className={cn(
                "h-14 hover:bg-white/[0.035]",
                row.rank === 1 && "bg-gradient-to-r from-gold/[0.07] to-transparent",
                row.isMe && "bg-white/[0.03]",
              )}
            >
              <TableCell
                className={cn(
                  "relative pl-4 sm:pl-5",
                  row.isMe &&
                    "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-gradient-to-b before:from-[#ff9452] before:to-[#e2471a] before:shadow-[0_0_12px_rgb(255_106_42/0.6)]",
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <RankBadge rank={row.rank} />
                  {showDelta ? <RankDelta delta={row.delta} className="w-6" /> : null}
                </span>
              </TableCell>
              <TableCell className="max-w-[40vw] sm:max-w-none">
                <span className="flex min-w-0 items-center gap-1.5">
                  {row.handle ? (
                    <span className={cn("truncate text-sm font-medium", row.isBot && "text-foreground/85")}>{row.handle}</span>
                  ) : row.address ? (
                    <AddressChip address={row.address} chainId={chainId} explorer={Boolean(chainId)} copy={false} />
                  ) : (
                    <span className="text-muted-foreground">Anonymous</span>
                  )}
                  {row.isBot ? <BotMarker /> : null}
                  {row.isMe ? (
                    <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-ember/25 bg-ember/[0.08] px-1.5 text-xs font-semibold text-[#ff9452]">You</span>
                  ) : null}
                </span>
              </TableCell>
              <TableCell className={cn(EQUITY_COL, "text-right font-semibold tracking-tight tabular-nums")}>{formatUsd(row.equityUsd)}</TableCell>
              <TableCell className="pr-4 text-right sm:pr-5">
                <ReturnPill pct={row.pnlPct} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function LeagueLeaderboardSkeleton({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn(LEAGUE_PANEL, className)} aria-hidden>
      <Table>
        <BoardHeader />
        <TableBody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRow key={i} className="h-14 hover:bg-transparent">
              <TableCell className="pl-4 sm:pl-5"><Skeleton className="size-7 rounded-full" /></TableCell>
              <TableCell><Skeleton className="h-4 w-32 rounded-md" /></TableCell>
              <TableCell className={EQUITY_COL}><Skeleton className="ml-auto h-4 w-20" /></TableCell>
              <TableCell className="pr-4 sm:pr-5"><Skeleton className="ml-auto h-6 w-16 rounded-full" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default LeagueLeaderboard;
