"use client";

import * as React from "react";
import { cn } from "cn";
import type { LeagueAccountView } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { StatStrip, type Stat } from "@/components/common/StatStrip";
import { formatUsd } from "@/components/common/format";
import { formatSignedPct, formatSignedUsd, formatUsdWhole } from "@/components/league/format";

/**
 * The places moved since the last update, as the mockup's small "▲1" / "▼1" (green up, red down).
 * Nothing shows for no move or no previous rank: the board carries no dashes.
 */
export function RankDelta({ delta, className }: { delta: number | null; className?: string }) {
  if (delta === null || delta === 0 || !Number.isFinite(delta)) return null;
  const up = delta > 0;
  return (
    <span
      className={cn("inline-flex items-center text-[0.71875rem] leading-none font-semibold tabular-nums", up ? "text-yes" : "text-no", className)}
      title={`${up ? "Up" : "Down"} ${Math.abs(delta)} since the last update`}
    >
      <span aria-hidden>
        {up ? "▲" : "▼"}
        {Math.abs(delta)}
      </span>
      <span className="sr-only">{`${up ? "up" : "down"} ${Math.abs(delta)}`}</span>
    </span>
  );
}

export interface AccountCardProps {
  /** Null before the first trade. */
  me: LeagueAccountView | null;
  startingCashUsd: number;
  /** "16" or "50+": the players the rank is out of. */
  players?: string;
  className?: string;
}

function tone(n: number): Stat["tone"] {
  return Math.abs(n) < 0.005 ? "default" : n > 0 ? "positive" : "negative";
}

/**
 * The signed-in player's week (virtual cash): rank, equity, cash, P&L and positions as label / value
 * pairs on rules (StatStrip), under a serif section name. No boxes: the board above is the hero.
 */
export function AccountCard({ me, startingCashUsd, players, className }: AccountCardProps) {
  const cash = me?.cashUsd ?? startingCashUsd;
  const equity = me?.equityUsd ?? startingCashUsd;
  const pnlUsd = me?.pnlUsd ?? 0;
  const pnlPct = me?.pnlPct ?? 0;
  const positions = me?.positions.length ?? 0;

  const stats: Stat[] = [
    {
      label: "Your rank",
      value: me?.rank ? `#${me.rank}` : "Not yet",
      hint: me?.rank ? (players ? `of ${players} this week` : "This week") : "Paper trade to get ranked",
    },
    { label: "Virtual equity", value: formatUsd(equity), hint: `${formatSignedPct(pnlPct, 2)} this week`, tone: tone(pnlPct) },
    { label: "Cash", value: formatUsd(cash), hint: "Virtual cash" },
    { label: "P&L", value: formatSignedUsd(pnlUsd), hint: `vs ${formatUsdWhole(startingCashUsd)} start`, tone: tone(pnlUsd) },
    { label: "Positions", value: String(positions), hint: me ? (positions === 1 ? "1 open" : `${positions} open`) : "Place a trade to get ranked" },
  ];

  return (
    <section className={cn("flex flex-col gap-3", className)} aria-labelledby="league-account">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="league-account" className="font-display text-[1.625rem] leading-none font-normal tracking-[-0.01em] sm:text-[1.875rem]">
          Your competition account
        </h2>
        <span className="text-[0.84375rem] font-medium text-muted-foreground">Virtual cash</span>
      </div>
      <StatStrip stats={stats} />
    </section>
  );
}

export function AccountCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)} aria-hidden>
      <Skeleton className="h-7 w-64 max-w-full" />
      <div className="grid grid-cols-2 border-y border-rule sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 py-4 pr-4">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default AccountCard;
