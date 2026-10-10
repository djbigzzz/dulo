"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "cn";
import type { LeagueLeaderboardRow, LeagueResponse } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { displayName, formatDate, formatUsd } from "@/components/common/format";
import { BotMarker } from "@/components/league/LeagueLeaderboard";
import { MIN_TRADES_FOR_WEEKLY_POINTS } from "@/lib/games/ledger-policy";

/** Nav order: Predictions, Competition, Quests. Each lane names its game, what scores, and the one way in. */
const WAYS = [
  { href: "/predictions", title: "Predictions", line: "Yes or No on Friday's close, for points", cta: "Make a prediction" },
  {
    href: "/competition",
    title: "Competition",
    line: `Virtual cash. Top 10 with ${MIN_TRADES_FOR_WEEKLY_POINTS}+ paper trades earn up to 1,000 points`,
    cta: "Start with $10,000 virtual cash",
  },
  { href: "/quests", title: "Quests", line: "+50 to +500 points per quest", cta: "See quests" },
] as const;

const LANE_TITLE = "font-display text-[1.875rem] leading-none font-normal tracking-[-0.012em] sm:text-[2.25rem]";

function formatPnl(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

function formatCash(usd: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(usd);
}

function pnlTone(pct: number): string {
  return pct > 0 ? "text-yes" : pct < 0 ? "text-no" : "text-muted-foreground";
}

/**
 * "Be first on the board": the three games as lanes on 1px rules (the landing's "This week"
 * lanes, without the timeline), each with its serif name, what scores and one way in. Shown while
 * the Season board is empty.
 */
export function WaysToScore({ className }: { className?: string }) {
  return (
    <section className={cn("flex flex-col gap-5", className)} aria-labelledby="be-first">
      <div className="flex flex-col gap-2">
        <h2 id="be-first" className="font-display text-[2.25rem] leading-none font-normal tracking-[-0.012em] sm:text-[2.875rem]">
          Be first on the board
        </h2>
        <p className="text-base leading-relaxed text-muted-foreground">Nobody has scored this Season yet. Any of these puts you in the first seat.</p>
      </div>
      <ul className="border-b border-rule">
        {WAYS.map(({ href, title, line, cta }) => (
          <li key={href} className="grid gap-x-8 gap-y-2 border-t border-rule py-5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] sm:items-center">
            <h3 className={LANE_TITLE}>{title}</h3>
            <p className="text-[0.9375rem] leading-snug text-muted-foreground">{line}</p>
            <Link href={href} className={cn(buttonVariants({ variant: "link" }), "w-fit text-[0.9375rem]")}>
              {cta}
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One competition row: rank, player (house bots dimmed and labelled), return and equity. */
function CompetitionRow({ row }: { row: LeagueLeaderboardRow }) {
  return (
    <li className="grid h-12 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-rule">
      <span className={cn("figure text-[1.375rem] leading-none", row.rank === 1 ? "text-foreground" : "text-muted-foreground")}>
        <span className="sr-only">Rank </span>
        {row.rank}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("truncate text-[0.96875rem]", row.isBot ? "text-muted-foreground" : "font-semibold text-foreground")}>
          {displayName(row.handle, row.address)}
        </span>
        {row.isBot ? <BotMarker /> : null}
      </span>
      <span className="flex shrink-0 items-baseline gap-3">
        <span className="hidden text-sm text-dim tabular-nums sm:inline">{formatUsd(row.equityUsd)}</span>
        <span className={cn("text-base font-semibold tabular-nums font-stretch-[85%]", pnlTone(row.pnlPct))}>{formatPnl(row.pnlPct)}</span>
      </span>
    </li>
  );
}

/** Current weekly competition (virtual cash) top 3 plus, when there is one, last week's FINAL. */
export function LeaguePreview({ data, loading, className }: { data: LeagueResponse | null; loading: boolean; className?: string }) {
  if (loading) {
    return <Skeleton className={cn("h-56 w-full", className)} aria-hidden />;
  }
  if (!data) return null;
  const top = data.leaderboard.slice(0, 3);
  const settled = data.lastSettled && data.lastSettled.top.length > 0 ? data.lastSettled : null;

  return (
    <div className={cn("grid gap-10", settled && "lg:grid-cols-2 lg:gap-12", className)}>
      <section className="flex flex-col gap-3" aria-labelledby="league-week">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <h2 id="league-week" className="text-[1.25rem] leading-tight font-semibold tracking-[-0.01em]">
            This week&rsquo;s competition (virtual cash)
          </h2>
          <Link href="/competition" className={cn(buttonVariants({ variant: "link" }), "text-[0.9375rem]")}>
            Open the competition
            <ArrowRight data-icon="inline-end" aria-hidden />
          </Link>
        </div>
        {top.length === 0 ? (
          <p className="border-y border-rule py-4 text-[0.9375rem] text-muted-foreground">
            No trades yet this week. Start with {formatCash(data.startingCashUsd)} of virtual cash.
          </p>
        ) : (
          <ol className="border-b border-rule" aria-label="This week's top three">
            {top.map((row) => (
              <CompetitionRow key={row.userId} row={row} />
            ))}
          </ol>
        )}
        <p className="text-[0.84375rem] leading-relaxed text-muted-foreground">
          House bots trade for company and never earn points. Real players in the top 10 with {MIN_TRADES_FOR_WEEKLY_POINTS}+ paper trades on
          Friday do.
        </p>
      </section>

      {settled ? (
        <section className="flex flex-col gap-3" aria-labelledby="league-last">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <h2 id="league-last" className="text-[1.25rem] leading-tight font-semibold tracking-[-0.01em]">
              Last week&rsquo;s finish
            </h2>
            <span className="stamp">Final · {formatDate(settled.weekEnd)}</span>
          </div>
          <ol className="border-b border-rule" aria-label="Last week's competition podium">
            {settled.top.slice(0, 3).map((row) => (
              <CompetitionRow key={row.userId} row={row} />
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
