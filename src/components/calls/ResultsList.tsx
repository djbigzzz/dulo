"use client";

import * as React from "react";
import { cn } from "cn";
import type { CallPositionView } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { formatPoints, formatUsd } from "@/components/common/format";
import { XStockLogo } from "@/components/common/XStockLogo";
import { crowdSaid, resultLabel, settleSourceLabel, sideLabel, utcStamp, type ResultWeek } from "@/components/calls/calls-format";

export interface ResultsListProps {
  weeks: ResultWeek[];
  /** The viewer's points by market id (empty when signed out). */
  positions: ReadonlyMap<string, CallPositionView[]>;
  /** Weeks shown before "Show earlier weeks". */
  initialWeeks?: number;
  className?: string;
}

/**
 * Settled weeks, newest first: a week line ("Week of 28 Sep", the FINAL stamp, the settle time in
 * mono), then one ruled line per prediction: the question in short, the Friday close with its
 * source, the crowd's split, the viewer's result and the result itself in Yes green or No red.
 */
export function ResultsList({ weeks, positions, initialWeeks = 2, className }: ResultsListProps) {
  const [all, setAll] = React.useState(false);
  const shown = all ? weeks : weeks.slice(0, initialWeeks);
  const hidden = weeks.length - shown.length;
  return (
    <div className={cn("@container/res flex flex-col gap-8", className)}>
      {shown.map((week) => (
        <section key={week.monday} aria-label={`${week.label}, final`}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-rule-2 pb-3">
            <h3 className="flex items-center gap-3 text-base leading-none font-semibold text-foreground">
              {week.label}
              <span className="stamp">Final</span>
            </h3>
            <p className="mono-meta">
              <time dateTime={week.settleAt}>Settled {utcStamp(week.settleAt)}</time>
            </p>
          </div>
          <ul>
            {week.markets.map((m) => {
              const mine = positions.get(m.id) ?? [];
              const word = m.status === "void" || m.outcome === "void" ? "Void" : m.outcome === "yes" ? "Yes" : m.outcome === "no" ? "No" : "Pending";
              const tone = word === "Yes" ? "text-yes" : word === "No" ? "text-no" : "text-muted-foreground";
              const source = settleSourceLabel(m.source);
              return (
                <li
                  key={m.id}
                  data-market-id={m.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-rule py-3 @3xl/res:min-h-14 @3xl/res:grid-cols-[minmax(0,1.25fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_5rem] @3xl/res:gap-x-6 @3xl/res:py-2.5"
                >
                  <p className="flex min-w-0 items-center gap-3 text-[0.9375rem]">
                    <XStockLogo symbol={m.symbol} ticker={m.ticker} size={24} className="size-6 text-[0.5rem]" />
                    <span className="min-w-0 truncate text-muted-foreground">
                      <b className="mr-1 font-semibold text-foreground">{m.ticker}</b>above {formatUsd(m.strike)}
                    </span>
                  </p>
                  <p className={cn("figure row-span-2 text-right text-[1.75rem] leading-none font-medium font-stretch-[85%] @3xl/res:col-start-4 @3xl/res:row-span-1 @3xl/res:row-start-1", tone)}>
                    {word}
                  </p>
                  <div className="flex min-w-0 flex-col gap-0.5 pl-9 @3xl/res:contents">
                    {/* Mono for the price and its source only; the void line is words. */}
                    {m.settledPrice !== null ? (
                      <p className="mono-meta whitespace-normal">
                        <span className="font-medium text-foreground">Closed {formatUsd(m.settledPrice)}</span>
                        {source ? ` · ${source}` : ""}
                      </p>
                    ) : (
                      <p className="text-[0.84375rem] leading-snug text-muted-foreground">No price within 24 hours, points refunded</p>
                    )}
                    <p className="text-[0.84375rem] leading-snug text-muted-foreground tabular-nums">
                      {crowdSaid(m.odds)}
                      <span className="hidden @3xl/res:inline">{m.odds.total > 0 ? ` · ${formatPoints(m.odds.total)} points in, incl. bot seed` : ""}</span>
                    </p>
                  </div>
                  {mine.length > 0 ? (
                    <ul className="col-span-2 flex flex-col gap-0.5 pl-9 @3xl/res:col-span-1 @3xl/res:col-start-3 @3xl/res:row-start-2 @3xl/res:pl-0">
                      {mine.map((p) => (
                        <li key={p.side} className="flex items-baseline gap-2 text-[0.84375rem] text-muted-foreground tabular-nums">
                          <span>
                            You · <span className="font-semibold text-foreground">{sideLabel(p.side)}</span> · {formatPoints(p.points)} pts
                          </span>
                          <span className={cn("font-semibold", p.result === "won" ? "text-yes" : p.result === "lost" ? "text-no" : "text-muted-foreground")}>{resultLabel(p)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {hidden > 0 ? (
        <Button variant="link" className="self-start text-[0.9375rem]" onClick={() => setAll(true)}>
          Show {hidden} earlier {hidden === 1 ? "week" : "weeks"}
          <span aria-hidden>↓</span>
        </Button>
      ) : null}
    </div>
  );
}

export default ResultsList;
