"use client";

import { Briefcase } from "lucide-react";
import { cn } from "cn";
import type { LeaguePositionView, LeagueTradeView } from "@/lib/api-client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { PriceChip, priceSourceLabel } from "@/components/common/PriceChip";
import { formatDateTime, formatUsd } from "@/components/common/format";
import { formatQty, formatSignedPct, formatSignedUsd, pnlClass } from "@/components/league/format";
import { LEAGUE_PANEL } from "@/components/league/LeagueLeaderboard";

export interface PositionsTableProps {
  positions: LeaguePositionView[];
  /** The empty state's sentence. The /prestocks page names pre-IPO tokens instead of xStocks. */
  emptyDescription?: string;
  className?: string;
}

/** Symbol / Qty / Avg / Last (price chip) / Value / P&L. The Table wraps itself in overflow-x-auto. */
export function PositionsTable({ positions, emptyDescription = "Open Paper trade and paper-buy any xStock with your virtual cash.", className }: PositionsTableProps) {
  if (positions.length === 0) {
    return <EmptyState icon={<Briefcase aria-hidden />} title="No positions yet." description={emptyDescription} className={className} />;
  }
  return (
    <div className={cn(LEAGUE_PANEL, className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-white/[0.02] hover:bg-white/[0.02]">
            <TableHead className="pl-4 sm:pl-5">Symbol</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead>Last</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="pr-4 sm:pr-5 text-right">P&amp;L</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((p) => (
            <TableRow key={p.assetId} className="h-14 hover:bg-white/[0.035]">
              <TableCell className="pl-4 text-sm font-semibold sm:pl-5">{p.symbol}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatQty(p.qty)}</TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">{formatUsd(p.avgPrice)}</TableCell>
              <TableCell>
                <PriceChip quote={p.quote} className="flex-nowrap whitespace-nowrap" />
              </TableCell>
              <TableCell className="text-right font-semibold tracking-tight tabular-nums" title={p.last === null ? "Valued at your average price (no live price)" : undefined}>
                {formatUsd(p.valueUsd)}
                {p.last === null ? <span className="ml-1 text-xs text-muted-foreground">at cost</span> : null}
              </TableCell>
              <TableCell className={cn("pr-4 text-right font-semibold tabular-nums sm:pr-5", pnlClass(p.pnlUsd))}>
                {p.pnlUsd === null ? "—" : (
                  <>
                    {formatSignedUsd(p.pnlUsd)}
                    <span className="ml-1.5 text-xs font-medium opacity-75">({formatSignedPct(p.pnlPct)})</span>
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function PositionsTableSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn(LEAGUE_PANEL, className)} aria-hidden>
      <Table>
        <TableHeader>
          <TableRow className="bg-white/[0.02] hover:bg-white/[0.02]">
            <TableHead className="pl-4 sm:pl-5">Symbol</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead>Last</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="pr-4 sm:pr-5 text-right">P&amp;L</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              <TableCell className="pl-4 sm:pl-5"><Skeleton className="h-4 w-12" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-4 w-10" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-4 w-14" /></TableCell>
              <TableCell><Skeleton className="h-6 w-40 rounded-full" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-4 w-16" /></TableCell>
              <TableCell className="pr-4 sm:pr-5"><Skeleton className="ml-auto h-4 w-20" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** The caller's last trades, newest first. */
export function RecentTrades({ trades, className }: { trades: LeagueTradeView[]; className?: string }) {
  if (trades.length === 0) return null;
  return (
    <div className={cn(LEAGUE_PANEL, className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-white/[0.02] hover:bg-white/[0.02]">
            <TableHead className="pl-4 sm:pl-5">When</TableHead>
            <TableHead>Side</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Fill</TableHead>
            <TableHead className="pr-4 sm:pr-5">Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((t) => (
            <TableRow key={t.id} className="h-12 hover:bg-white/[0.035]">
              <TableCell className="pl-4 sm:pl-5 text-muted-foreground">{formatDateTime(t.ts)}</TableCell>
              <TableCell>
                <span className={cn("inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-semibold capitalize", t.side === "buy" ? "border-emerald-400/15 bg-emerald-400/10 text-emerald-400" : "border-rose-400/15 bg-rose-400/10 text-rose-400")}>
                  {t.side}
                </span>
              </TableCell>
              <TableCell className="text-sm font-semibold">{t.symbol}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatQty(t.qty)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatUsd(t.price)}</TableCell>
              <TableCell className="pr-4 sm:pr-5 text-muted-foreground">{sourceLabel(t.priceSource)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function sourceLabel(source: string): string {
  if (source === "pyth" || source === "jupiter" || source === "cache" || source === "none") return priceSourceLabel(source);
  return source;
}

export default PositionsTable;
