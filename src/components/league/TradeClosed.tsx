"use client";

import { cn } from "cn";
import type { LeagueSettledView, LeagueView } from "@/lib/api-client";
import { BotMarker, RankBadge, ReturnPill } from "@/components/league/LeagueLeaderboard";
import { Chronograph, nextOpenIso, useCountdown } from "@/components/league/LeagueCountdown";
import { WEEKEND_TRADES_COPY, formatLocalDayTime, formatUtcDayMonth } from "@/components/league/format";
import { explorerUrl, truncateAddress } from "@/components/common/format";

export interface TradeClosedProps {
  league: LeagueView;
  serverNow: string;
  lastSettled: LeagueSettledView | null;
  chainId?: string;
  /**
   * The words "house bot" beside each bot's mark (touch screens never show its title). Default true;
   * /competition passes false, because its standings' legend already says which players are bots.
   */
  botWords?: boolean;
  className?: string;
}

/**
 * Trade panel for a competition week that is settled. The competition never pauses on weekends
 * (C6), so this only shows while a week settles: next week's competition takes trades from its close.
 * Broadcast: a serif line, the countdown in the narrow scoreboard cut, the podium as rows on rules.
 */
export function TradeClosed({ league, serverNow, lastSettled, chainId, botWords = true, className }: TradeClosedProps) {
  const reopens = nextOpenIso(league);
  const remaining = useCountdown(reopens, serverNow);
  const podium = lastSettled?.top.slice(0, 3) ?? [];

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div className="flex flex-col gap-1.5">
        <p className="font-display text-[1.625rem] leading-[1.05] font-normal">This competition week is settled</p>
        <p className="text-sm text-pretty text-muted-foreground">
          {WEEKEND_TRADES_COPY}.{" "}
          {remaining !== null && remaining > 0 && reopens ? <>It takes trades from {formatLocalDayTime(reopens)} your time.</> : "Refresh in a moment to trade."}
        </p>
      </div>

      {remaining !== null && remaining > 0 ? (
        <div className="flex items-end justify-between gap-3 border-y border-rule py-3">
          <span className="text-sm font-medium text-muted-foreground">Next week in</span>
          <Chronograph ms={remaining} className="figure text-[2.25rem] leading-[0.8]" />
        </div>
      ) : null}

      {podium.length > 0 && lastSettled ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center justify-between gap-3 text-sm font-medium text-muted-foreground">
            Week of {formatUtcDayMonth(lastSettled.weekStart)} podium
            <span className="stamp">Final</span>
          </p>
          <ol className="flex flex-col border-b border-rule">
            {podium.map((row) => {
              const href = row.address && chainId ? explorerUrl(chainId, row.address) : null;
              return (
                <li key={row.userId} className="flex h-10 items-center gap-2.5 border-t border-rule">
                  <RankBadge rank={row.rank} />
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-[0.9375rem]">
                    {row.handle ? (
                      <span className={cn("truncate", row.isBot ? "text-muted-foreground" : "font-semibold")}>{row.handle}</span>
                    ) : row.address ? (
                      href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="truncate font-semibold underline-offset-4 hover:underline" title={row.address}>
                          {truncateAddress(row.address)}
                        </a>
                      ) : (
                        <span className="truncate font-semibold">{truncateAddress(row.address)}</span>
                      )
                    ) : (
                      <span className="text-muted-foreground">Anonymous</span>
                    )}
                    {row.isBot ? <BotMarker words={botWords} /> : null}
                  </span>
                  <ReturnPill pct={row.pnlPct} />
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

export default TradeClosed;
