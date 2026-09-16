"use client";

import { Lock } from "lucide-react";
import { cn } from "cn";
import type { LeagueSettledView, LeagueView } from "@/lib/api-client";
import { AddressChip } from "@/components/common/AddressChip";
import { BotMarker, RankBadge, ReturnPill } from "@/components/league/LeagueLeaderboard";
import { Chronograph, nextOpenIso, useCountdown } from "@/components/league/LeagueCountdown";
import { WEEKEND_TRADES_COPY, formatLocalDayTime, formatUtcDayMonth } from "@/components/league/format";

export interface TradeClosedProps {
  league: LeagueView;
  serverNow: string;
  lastSettled: LeagueSettledView | null;
  chainId?: string;
  className?: string;
}

/**
 * Trade panel for a League week that is settled. The League never pauses on weekends (C6), so
 * this only shows while a week settles: next week's League takes trades from its close.
 */
export function TradeClosed({ league, serverNow, lastSettled, chainId, className }: TradeClosedProps) {
  const reopens = nextOpenIso(league);
  const remaining = useCountdown(reopens, serverNow);
  const podium = lastSettled?.top.slice(0, 3) ?? [];

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div className="flex items-start gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-gold shadow-[inset_0_1px_0_rgb(255_245_230/0.06)]"
          aria-hidden
        >
          <Lock className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-base font-semibold tracking-tight">This competition week is settled</p>
          <p className="text-sm text-muted-foreground">
            {WEEKEND_TRADES_COPY}.{" "}
            {remaining !== null && remaining > 0 && reopens ? <>It takes trades from {formatLocalDayTime(reopens)} your time.</> : "Refresh in a moment to trade."}
          </p>
        </div>
      </div>

      {remaining !== null && remaining > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/25 px-4 py-3 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]">
          <span className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">Next week in</span>
          <Chronograph ms={remaining} className="text-lg font-semibold tracking-tight" />
        </div>
      ) : null}

      {podium.length > 0 && lastSettled ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-medium tracking-[0.14em] text-gold uppercase">Week of {formatUtcDayMonth(lastSettled.weekStart)} podium</p>
          <ol className="flex flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-black/20 shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)]">
            {podium.map((row, i) => (
              <li
                key={row.userId}
                className={cn(
                  "flex h-12 items-center gap-2.5 px-3",
                  i > 0 && "border-t border-white/[0.05]",
                  row.rank === 1 && "bg-gradient-to-r from-gold/[0.07] to-transparent",
                )}
              >
                <RankBadge rank={row.rank} />
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  {row.handle ? (
                    <span className="truncate text-sm font-medium">{row.handle}</span>
                  ) : row.address ? (
                    <AddressChip address={row.address} chainId={chainId} copy={false} />
                  ) : (
                    <span className="text-sm text-muted-foreground">Anonymous</span>
                  )}
                  {row.isBot ? <BotMarker /> : null}
                </span>
                <ReturnPill pct={row.pnlPct} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

export default TradeClosed;
