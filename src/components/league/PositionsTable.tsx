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
import { preIpoToken } from "@/components/prestocks/tokens";

export interface PositionsTableProps {
  positions: LeaguePositionView[];
  /** The empty state's sentence. The /prestocks page names pre-IPO tokens instead of xStocks. */
  emptyDescription?: string;
  className?: string;
}

/** The header row: plain dim heads on a rule, no fill (Broadcast tables are rows on rules). */
const HEAD_ROW = "hover:bg-transparent";
const FIRST = "pl-0";
const LAST = "pr-0 text-right";

/** Symbol / Qty / Avg / Last (price chip) / Value / P&L. The Table wraps itself in overflow-x-auto. */
export function PositionsTable({ positions, emptyDescription = "Open Paper trade and paper-buy any xStock with your virtual cash.", className }: PositionsTableProps) {
  if (positions.length === 0) {
    return <EmptyState icon={<Briefcase aria-hidden />} title="No positions yet." description={emptyDescription} className={className} />;
  }
  return (
    <div className={cn(LEAGUE_PANEL, className)}>
      <Table>
        <TableHeader>
          <TableRow className={HEAD_ROW}>
            <TableHead className={FIRST}>Symbol</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Avg</TableHead>
            <TableHead>Last</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className={LAST}>P&amp;L</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((p) => (
            <TableRow key={p.assetId}>
              <TableCell className={cn(FIRST, "text-[0.9375rem] font-semibold")}>{p.symbol}</TableCell>
              <TableCell className="text-right tabular-nums">{formatQty(p.qty)}</TableCell>
              <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">{formatUsd(p.avgPrice)}</TableCell>
              <TableCell>
                {/* A pre-IPO token quotes around the clock: no US-session tag on it. */}
                <PriceChip quote={p.quote} className="flex-nowrap whitespace-nowrap" session={preIpoToken(p.symbol) === null} />
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums" title={p.last === null ? "Valued at your average price (no live price)" : undefined}>
                {formatUsd(p.valueUsd)}
                {p.last === null ? <span className="ml-1 text-xs font-normal text-muted-foreground">at cost</span> : null}
              </TableCell>
              <TableCell className={cn(LAST, "font-semibold tabular-nums font-stretch-[85%]", pnlClass(p.pnlUsd))}>
                {p.pnlUsd === null ? (
                  "—"
                ) : (
                  <>
                    {formatSignedUsd(p.pnlUsd)}
                    <span className="ml-1.5 text-xs font-medium">({formatSignedPct(p.pnlPct)})</span>
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
          <TableRow className={HEAD_ROW}>
            <TableHead className={FIRST}>Symbol</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Avg</TableHead>
            <TableHead>Last</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className={LAST}>P&amp;L</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              <TableCell className={FIRST}>
                <Skeleton className="h-4 w-12" />
              </TableCell>
              <TableCell>
                <Skeleton className="ml-auto h-4 w-10" />
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <Skeleton className="ml-auto h-4 w-14" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-40" />
              </TableCell>
              <TableCell>
                <Skeleton className="ml-auto h-4 w-16" />
              </TableCell>
              <TableCell className={LAST}>
                <Skeleton className="ml-auto h-4 w-20" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** The caller's last trades, newest first. Buy and sell are words, not colours (green and red mean gain and loss). */
export function RecentTrades({ trades, className }: { trades: LeagueTradeView[]; className?: string }) {
  if (trades.length === 0) return null;
  return (
    <div className={cn(LEAGUE_PANEL, className)}>
      <Table>
        <TableHeader>
          <TableRow className={HEAD_ROW}>
            <TableHead className={FIRST}>When</TableHead>
            <TableHead>Side</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Fill</TableHead>
            <TableHead className="pr-0">Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((t) => (
            <TableRow key={t.id}>
              <TableCell className={cn(FIRST, "font-mono text-[0.8125rem] text-muted-foreground")}>{formatDateTime(t.ts)}</TableCell>
              <TableCell className={cn("font-semibold capitalize", t.side === "buy" ? "text-foreground" : "text-muted-foreground")}>{t.side}</TableCell>
              <TableCell className="text-[0.9375rem] font-semibold">{t.symbol}</TableCell>
              <TableCell className="text-right tabular-nums">{formatQty(t.qty)}</TableCell>
              <TableCell className="text-right font-mono text-[0.8125rem] font-medium tabular-nums">{formatUsd(t.price)}</TableCell>
              <TableCell className="pr-0 font-mono text-[0.8125rem] text-muted-foreground">{sourceLabel(t.priceSource)}</TableCell>
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
