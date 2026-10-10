"use client";

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import type { LeagueLeaderboardRow, LeagueSettledView } from "@/lib/api-client";
import { explorerUrl, truncateAddress } from "@/components/common/format";
import { BotMarker, ReturnPill } from "@/components/league/LeagueLeaderboard";
import { formatUtcDayMonth, formatUtcWeekday } from "@/components/league/format";

const WEEK_MS = 7 * 86_400_000;

/** "Last week" when the settled week is the one before `weekStart`, else "Week of 28 Sep". */
export function settledWeekTitle(settled: Pick<LeagueSettledView, "weekStart">, currentWeekStart: string | null | undefined): string {
  const a = Date.parse(settled.weekStart);
  const b = currentWeekStart ? Date.parse(currentWeekStart) : Number.NaN;
  if (Number.isFinite(a) && Number.isFinite(b) && b - a === WEEK_MS) return "Last week";
  return `Week of ${formatUtcDayMonth(settled.weekStart)}`;
}

function Row({ row, chainId }: { row: LeagueLeaderboardRow; chainId?: string }) {
  const href = !row.handle && row.address && chainId ? explorerUrl(chainId, row.address) : null;
  return (
    <li className="grid h-10 grid-cols-[34px_minmax(0,1fr)_auto] items-center border-t border-rule">
      <span className={cn("text-lg leading-none font-medium tabular-nums font-stretch-[72%]", row.isBot ? "text-muted-foreground" : "text-foreground")}>
        <span className="sr-only">Rank </span>
        {row.rank}
      </span>
      <span className="flex min-w-0 items-center gap-2 text-[0.9375rem] leading-none">
        {row.handle ? (
          <span className={cn("truncate", row.isBot ? "text-muted-foreground" : "font-semibold text-foreground")}>{row.handle}</span>
        ) : row.address ? (
          href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" title={row.address} className="truncate font-semibold underline-offset-4 hover:underline">
              {truncateAddress(row.address)}
            </a>
          ) : (
            <span className="truncate font-semibold">{truncateAddress(row.address)}</span>
          )
        ) : (
          <span className="text-muted-foreground">Anonymous</span>
        )}
        {row.isBot ? <BotMarker words={false} /> : null}
      </span>
      <ReturnPill pct={row.pnlPct} className="text-base" />
    </li>
  );
}

/**
 * The last settled week (the mockup's "Last week" under the trade panel): a serif title, the FINAL
 * stamp with Friday's date, the podium on rules, and the rest of the final top 10 folded behind one
 * disclosure. The points rule says once who earned from it.
 */
export function LastWeek({
  settled,
  currentWeekStart,
  chainId,
  pointsNote,
  className,
}: {
  settled: LeagueSettledView;
  currentWeekStart?: string | null;
  chainId?: string;
  pointsNote?: React.ReactNode;
  className?: string;
}) {
  const podium = settled.top.slice(0, 3);
  const rest = settled.top.slice(3, 10);
  const title = settledWeekTitle(settled, currentWeekStart);
  return (
    <section aria-labelledby="league-last" data-slot="league-last-week" className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between gap-3 pb-3">
        <h2 id="league-last" className="font-display text-2xl leading-none font-normal">
          {title}
        </h2>
        <span className="stamp">Final · {formatUtcWeekday(settled.weekEnd)}</span>
      </div>
      <ol className="flex flex-col">
        {podium.map((row) => (
          <Row key={row.userId} row={row} chainId={chainId} />
        ))}
      </ol>
      {rest.length > 0 ? (
        <details className="group border-t border-rule [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset">
            The final top {settled.top.slice(0, 10).length}
            <ChevronDownIcon className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
          </summary>
          <ol start={4} className="flex flex-col">
            {rest.map((row) => (
              <Row key={row.userId} row={row} chainId={chainId} />
            ))}
          </ol>
        </details>
      ) : null}
      {pointsNote ? <p className="border-t border-rule pt-3 text-[0.8125rem] leading-snug text-muted-foreground">{pointsNote}</p> : null}
    </section>
  );
}

export default LastWeek;
