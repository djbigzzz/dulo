"use client";

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "cn";
import type { LeagueAccountView } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd } from "@/components/common/format";
import { formatSignedPct, formatSignedUsd, formatUsdWhole, pnlClass } from "@/components/league/format";

/** Tiny up / down arrow with the number of places moved since the last update (null = unknown). */
export function RankDelta({ delta, className }: { delta: number | null; className?: string }) {
  if (delta === null) {
    return (
      <span className={cn("inline-flex items-center text-xs text-muted-foreground/50", className)} title="No previous rank yet" aria-label="No previous rank">
        –
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className={cn("inline-flex items-center text-muted-foreground/40", className)} title="Unchanged" aria-label="Unchanged">
        <Minus className="size-3" aria-hidden />
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={cn("inline-flex items-center gap-px text-xs font-medium tabular-nums", up ? "text-emerald-400/90" : "text-rose-400/90", className)}
      title={`${up ? "Up" : "Down"} ${Math.abs(delta)} since the last update`}
      aria-label={`${up ? "up" : "down"} ${Math.abs(delta)}`}
    >
      {up ? <ArrowUp className="size-3" strokeWidth={2.5} aria-hidden /> : <ArrowDown className="size-3" strokeWidth={2.5} aria-hidden />}
      {Math.abs(delta)}
    </span>
  );
}

export interface AccountCardProps {
  /** Null before the first trade. */
  me: LeagueAccountView | null;
  startingCashUsd: number;
  className?: string;
}

const PANEL = "rounded-2xl border border-white/[0.07] bg-card";
const CELL = "-mr-px -mb-px flex min-w-0 flex-col gap-1 border-r border-b border-white/[0.06] px-4 py-4 sm:px-5";

function Stat({ label, value, sub, className }: { label: string; value: string; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={CELL}>
      <span className="truncate text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">{label}</span>
      <span className={cn("truncate text-xl font-semibold tracking-tight tabular-nums sm:text-2xl", className)}>{value}</span>
      {sub ? <span className="truncate text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

/** Cash / P&L / return / positions for the signed-in player (rank and equity live in the page header). */
export function AccountCard({ me, startingCashUsd, className }: AccountCardProps) {
  const cash = me?.cashUsd ?? startingCashUsd;
  const pnlUsd = me?.pnlUsd ?? 0;
  const pnlPct = me?.pnlPct ?? 0;
  const positions = me?.positions.length ?? 0;

  return (
    <section className={cn(PANEL, "overflow-hidden", className)} aria-labelledby="league-account">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
        <h2 id="league-account" className="text-base font-semibold tracking-tight">
          Your competition account
        </h2>
        <span className="text-xs text-muted-foreground">Virtual cash</span>
      </div>
      <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" aria-hidden />
      <div className="grid grid-cols-2 sm:grid-cols-4">
        <Stat label="Cash" value={formatUsd(cash)} />
        <Stat label="P&L" value={formatSignedUsd(pnlUsd)} sub={`vs ${formatUsdWhole(startingCashUsd)} start`} className={pnlClass(pnlUsd)} />
        <Stat label="Return" value={formatSignedPct(pnlPct, 2)} className={pnlClass(pnlPct)} />
        <Stat label="Positions" value={String(positions)} sub={me ? undefined : "Place a trade to get ranked"} />
      </div>
    </section>
  );
}

export function AccountCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(PANEL, "overflow-hidden", className)} aria-hidden>
      <div className="px-4 pt-4 pb-3 sm:px-5">
        <Skeleton className="h-5 w-28" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={CELL}>
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default AccountCard;
