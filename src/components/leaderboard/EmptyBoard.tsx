"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, Bot, Sparkles, Target, Trophy } from "lucide-react";
import { cn } from "cn";
import type { LeagueLeaderboardRow, LeagueResponse } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { displayName, formatDate, formatUsd } from "@/components/common/format";
import { MedalChip, Podium } from "@/components/leaderboard/Podium";
import { MIN_TRADES_FOR_WEEKLY_POINTS } from "@/lib/games/ledger-policy";

/** Nav order: Predictions, Competition, Quests. */
const WAYS = [
  { href: "/predictions", icon: Target, title: "Predictions", line: "Yes or No on Friday's close, for points" },
  { href: "/competition", icon: Trophy, title: "Competition", line: `Virtual cash. Top 10 with ${MIN_TRADES_FOR_WEEKLY_POINTS}+ trades earn up to 1,000 pts` },
  { href: "/quests", icon: Sparkles, title: "Quests", line: "+50 to +500 pts per quest" },
] as const;

const GLASS = "rounded-2xl border border-white/[0.07] bg-card";
const EYEBROW = "text-xs font-medium tracking-[0.14em] text-gold uppercase";

function formatPnl(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

function formatCash(usd: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(usd);
}

function pnlTone(pct: number): string {
  return pct > 0 ? "text-emerald-400" : pct < 0 ? "text-rose-400" : "text-muted-foreground";
}

function BotTag({ row }: { row: LeagueLeaderboardRow }) {
  return row.isBot ? (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.02] px-1.5 text-xs text-muted-foreground/80">
      <Bot className="size-3" aria-hidden />
      house bot
    </span>
  ) : null;
}

/** "Be first on the board": three tappable ways to score. Shown while the Season board is empty. */
export function WaysToScore({ className }: { className?: string }) {
  return (
    <section
      className={cn(
        "border-gradient flex animate-in flex-col gap-8 rounded-3xl bg-card ember-glow p-6 duration-500 fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none sm:p-10",
        className,
      )}
      aria-labelledby="be-first"
    >
      <div className="flex max-w-xl flex-col gap-3">
        <p className={EYEBROW}>Ways to score</p>
        <h2 id="be-first" className="font-display text-4xl leading-[1.05] font-normal">
          Be first on the <span className="text-gradient-ember italic">board</span>
        </h2>
        <p className="text-base leading-relaxed text-muted-foreground">Nobody has scored this Season yet. Any of these puts you at #1.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        {WAYS.map(({ href, icon: Icon, title, line }) => (
          <li key={href} className="min-w-0">
            <Link
              href={href}
              className="group flex h-full items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgb(255_245_230/0.05)] backdrop-blur-sm transition-all duration-300 outline-none hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.05] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:flex-col sm:items-start sm:gap-5 sm:p-5"
            >
              <span className="flex shrink-0 items-center justify-between sm:w-full">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-gold shadow-[inset_0_1px_0_rgb(255_245_230/0.06)]"
                  aria-hidden
                >
                  <Icon className="size-5" />
                </span>
                <ArrowUpRight
                  className="hidden size-4 text-muted-foreground transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground sm:block"
                  aria-hidden
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-base font-semibold tracking-tight">{title}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">{line}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground sm:hidden" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Current weekly competition (virtual cash) top 3 plus, when there is one, last week's settled podium. */
export function LeaguePreview({ data, loading, className }: { data: LeagueResponse | null; loading: boolean; className?: string }) {
  if (loading) {
    return <Skeleton className={cn("h-56 w-full rounded-2xl", className)} aria-hidden />;
  }
  if (!data) return null;
  const top = data.leaderboard.slice(0, 3);
  const settled = data.lastSettled && data.lastSettled.top.length > 0 ? data.lastSettled : null;

  return (
    <div className={cn("grid gap-5", settled && "lg:grid-cols-2", className)}>
      <section className={cn(GLASS, "flex flex-col gap-4 p-5 sm:p-6")} aria-labelledby="league-week">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className={EYEBROW}>Competition (virtual cash)</p>
            <h2 id="league-week" className="text-base font-semibold tracking-tight">
              This week&rsquo;s competition
            </h2>
          </div>
          <Link href="/competition" className={buttonVariants({ variant: "outline", size: "lg", className: "h-9 rounded-full px-3.5" })}>
            Open the competition
            <ArrowRight data-icon="inline-end" aria-hidden />
          </Link>
        </div>
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">No trades yet this week. Start with {formatCash(data.startingCashUsd)} of virtual cash.</p>
        ) : (
          <ol className="-mx-2 flex flex-col">
            {top.map((row, i) => (
              <li key={row.userId} className={cn(i > 0 && "border-t border-white/[0.05]")}>
                <Link
                  href="/competition"
                  className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 transition-colors outline-none hover:bg-white/[0.03] focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <MedalChip rank={row.rank} />
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className={cn("truncate font-medium", row.isBot && "text-muted-foreground")}>{displayName(row.handle, row.address)}</span>
                    <BotTag row={row} />
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className={cn("text-sm font-semibold tracking-tight tabular-nums", pnlTone(row.pnlPct))}>{formatPnl(row.pnlPct)}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{formatUsd(row.equityUsd)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" aria-hidden />
        <p className="text-xs leading-relaxed text-muted-foreground">
          House bots trade for company and never earn points. Real players in the top 10 with {MIN_TRADES_FOR_WEEKLY_POINTS}+ trades on Friday do.
        </p>
      </section>

      {settled ? (
        <section className={cn(GLASS, "flex flex-col gap-4 p-5 sm:p-6")} aria-labelledby="league-last">
          <div className="flex flex-col gap-1">
            <p className={EYEBROW}>Competition closed {formatDate(settled.weekEnd)}</p>
            <h2 id="league-last" className="text-base font-semibold tracking-tight">
              Last week&rsquo;s podium
            </h2>
          </div>
          <Podium
            rows={settled.top}
            size="sm"
            aria-label="Last week's competition podium"
            renderValue={(row) => <span className={pnlTone(row.pnlPct)}>{formatPnl(row.pnlPct)}</span>}
            renderTag={(row) => <BotTag row={row} />}
            className="mt-auto pt-6"
          />
        </section>
      ) : null}
    </div>
  );
}
