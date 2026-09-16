"use client";

import * as React from "react";
import { useSession } from "@/hooks/useSession";
import { ArrowLeftRight, Sprout, Trophy } from "lucide-react";
import { api, leagueApi, type LeagueResponse, type PlaysResponse } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/PageHeader";
import { StatStrip, type Stat } from "@/components/common/StatStrip";
import { SignInBanner } from "@/components/common/SignInBanner";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { useApiQuery } from "@/components/common/useApiQuery";
import { MarketSessionChip } from "@/components/common/MarketSessionChip";
import { formatPoints, formatUsd } from "@/components/common/format";
import { AccountCard } from "@/components/league/AccountCard";
import { LeagueCountdownValue, countdownTarget } from "@/components/league/LeagueCountdown";
import { LeagueLeaderboard, LeagueLeaderboardSkeleton } from "@/components/league/LeagueLeaderboard";
import { PositionsTable, RecentTrades } from "@/components/league/PositionsTable";
import { ScoutChip } from "@/components/league/ScoutChip";
import { TradeClosed } from "@/components/league/TradeClosed";
import { TradeForm } from "@/components/league/TradeForm";
import { YouVsBots } from "@/components/league/YouVsBots";
import {
  LEAGUE_MIN_TRADE_USD,
  LEAGUE_TOP_PRIZE_POINTS,
  WEEKEND_TRADES_COPY,
  formatLocalDayTime,
  formatSignedPct,
  formatUsdWhole,
  formatUtcDayMonth,
  isPreWeek,
} from "@/components/league/format";
import { findScoutPlay, scoutProgress } from "@/components/league/scout";
import { MIN_TRADES_FOR_WEEKLY_POINTS } from "@/lib/games/ledger-policy";

/** Equity moves with prices; re-read the board every minute while the tab is visible. */
const REFRESH_MS = 60_000;
const CHAIN_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
/** GET /league returns the top 50; a full page means there may be more players. */
const BOARD_LIMIT = 50;

function SectionTitle({ id, children, hint }: { id: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 id={id} className="text-lg font-semibold tracking-tight">
        {children}
      </h2>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function buildStats(data: LeagueResponse): Stat[] {
  const league = data.league;
  if (!league) return [];
  const target = countdownTarget(league);
  const players = data.leaderboard.length;
  const bots = data.leaderboard.filter((r) => r.isBot).length;
  const playersLabel = players >= BOARD_LIMIT ? `${BOARD_LIMIT}+` : String(players);

  const clock: Stat = {
    label: league.open ? "Closes in" : "Next week in",
    value: <LeagueCountdownValue league={league} serverNow={data.now} />,
    hint: target ? formatLocalDayTime(target) : undefined,
    tone: "ember",
  };
  const prize: Stat = { label: "Points for 1st", value: `${formatPoints(LEAGUE_TOP_PRIZE_POINTS)} pts`, hint: `Top 10 with ${MIN_TRADES_FOR_WEEKLY_POINTS}+ trades earn points` };

  if (!data.signedIn) {
    return [
      clock,
      { label: "Players", value: playersLabel, hint: bots > 0 ? `${bots} of them house bots` : undefined },
      prize,
      { label: "Starting cash", value: formatUsdWhole(data.startingCashUsd), hint: "Virtual cash, resets weekly" },
    ];
  }

  const me = data.me;
  const equity = me?.equityUsd ?? data.startingCashUsd;
  const pnl = me?.pnlPct ?? 0;
  return [
    clock,
    {
      label: "Your rank",
      value: me?.rank ? `#${me.rank}` : "—",
      hint: me?.rank ? `of ${playersLabel} players` : "Paper trade to get ranked",
    },
    {
      label: "Virtual equity",
      value: formatUsd(equity),
      hint: `${formatSignedPct(pnl, 2)} this week`,
      tone: Math.abs(pnl) < 0.005 ? "default" : pnl > 0 ? "positive" : "negative",
    },
    prize,
  ];
}

const RULES = (
  <ul className="flex list-disc flex-col gap-1.5 pl-5">
    <li>Each competition week closes Friday 20:00 UTC. Everyone starts with $10,000 of virtual cash.</li>
    <li>The competition never pauses. {WEEKEND_TRADES_COPY}.</li>
    <li>Trades fill at the live quote with a 0.1% spread. Nothing is bought on-chain. The smallest trade is {formatUsdWhole(LEAGUE_MIN_TRADE_USD)}.</li>
    <li>When a quote is stale (markets closed, weekends) you can still trade; every price shows its source and age.</li>
    <li>Three paper trades complete the First Paper Trades quest.</li>
    <li>
      The top 10 by virtual portfolio value on Friday earn points (1,000 for first, down to 100 for tenth) if they made at least{" "}
      {MIN_TRADES_FOR_WEEKLY_POINTS} trades that week.
    </li>
    <li>House bots keep the board busy. They are ranked but never earn points, and a place held by a house bot gives its points to no one.</li>
    <li>Points only, no cash value.</li>
  </ul>
);

export default function LeaguePage() {
  const { session, refresh: refreshSession } = useSession();
  const sessionKey = session?.userId ?? "";
  const q = useApiQuery((signal) => leagueApi.overview({ signal }), sessionKey);
  const { refetch } = q;
  // Scout progress comes from the quests board (PlayProgress); only fetched when signed in.
  const plays = useApiQuery<PlaysResponse | null>(() => (sessionKey ? api.plays() : Promise.resolve(null)), sessionKey, { refetchOnFocus: false });
  const refetchPlays = plays.refetch;

  const [sheetOpen, setSheetOpen] = React.useState(false);
  // Bumped after every successful load so the trade form re-reads held quantities and cash.
  const [refreshKey, setRefreshKey] = React.useState(0);
  React.useEffect(() => {
    if (q.data) setRefreshKey((k) => k + 1);
  }, [q.data]);

  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refetch();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refetch]);

  const data: LeagueResponse | null = q.data;
  const league = data?.league ?? null;
  const signedIn = data?.signedIn ?? false;
  const startingCash = formatUsdWhole(data?.startingCashUsd ?? 10_000);
  const scout = signedIn ? scoutProgress(findScoutPlay(plays.data), data?.me?.trades.length ?? 0) : null;

  const onPlaced = React.useCallback(() => {
    refetch();
    refetchPlays();
    // A trade can complete a quest inline: the header balance and Season points come from /auth/me.
    void refreshSession();
    setSheetOpen(false);
  }, [refetch, refetchPlays, refreshSession]);

  const closed = Boolean(league && !league.open);
  const weekend = Boolean(data && league && league.open && isPreWeek(league, data.now));
  const tradePanel =
    data && league && closed ? (
      <TradeClosed league={league} serverNow={data.now} lastSettled={data.lastSettled} chainId={CHAIN_ID} />
    ) : (
      <TradeForm league={league} signedIn={signedIn} serverNow={data?.now ?? null} refreshKey={`${sessionKey}:${refreshKey}`} onPlaced={onPlaced} />
    );
  const tradeDescription = closed
    ? `This week is settling. ${WEEKEND_TRADES_COPY}.`
    : weekend
      ? `${WEEKEND_TRADES_COPY}. Virtual fills at the live quote, 0.1% spread.`
      : "Virtual fills at the live quote, 0.1% spread.";

  return (
    // No bottom padding needed for the Trade button: it is sticky in this column, so it rests below the last section.
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Season 0"
        title="Weekly competition (virtual cash)"
        suffix={league ? `· Week of ${formatUtcDayMonth(league.weekStart)}` : undefined}
        description={`Paper trade xStocks with ${startingCash} of virtual cash at real prices. Not real money, and nothing is bought on-chain. Top 10 with ${MIN_TRADES_FOR_WEEKLY_POINTS}+ trades on Friday earn points.`}
        stats={data && league ? <StatStrip stats={buildStats(data)} /> : q.loading ? <Skeleton className="h-[84px] w-full rounded-2xl" /> : undefined}
        details={RULES}
        className="mb-0"
      />

      {/* The session chip says whether the US market is open; the line says why the board never stops. */}
      <div className="-mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <MarketSessionChip />
        <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
          Wall Street is closed outside market hours. Solana is not, so you can trade on paper at any hour and every price carries its source and age.
        </p>
      </div>

      <SignInBanner title={`Sign in to trade with ${startingCash} of virtual cash.`} />

      {q.loading ? (
        <LeagueSkeleton />
      ) : q.error ? (
        <ErrorState title="Couldn't load the competition" message={q.error} onRetry={q.refetch} />
      ) : !data || !league ? (
        <EmptyState
          icon={<Sprout aria-hidden />}
          title="Season 0 is being set up."
          description="The competition opens as soon as the Season starts. Check back in a moment."
        />
      ) : (
        <>
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-w-0 flex-col gap-8 animate-in fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
              {signedIn ? (
                <>
                  {scout ? (
                    <div className="-mb-4 flex lg:hidden">
                      <ScoutChip progress={scout} />
                    </div>
                  ) : null}
                  <AccountCard me={data.me} startingCashUsd={data.startingCashUsd} />
                  {/* Derived from the board above: renders nothing until this account has traded this week. */}
                  <YouVsBots me={data.me} rows={data.leaderboard} className="-mt-4" />
                  <section className="flex flex-col gap-3" aria-labelledby="league-positions">
                    <SectionTitle id="league-positions" hint={data.me?.positions.length ? "Valued at the last price" : undefined}>
                      Positions
                    </SectionTitle>
                    <PositionsTable positions={data.me?.positions ?? []} />
                  </section>
                </>
              ) : null}

              <section className="flex flex-col gap-3" aria-labelledby="league-board">
                <SectionTitle id="league-board" hint={data.leaderboard.length > 0 ? "Ranked by return this week" : undefined}>
                  Leaderboard
                </SectionTitle>
                {data.leaderboard.length === 0 ? (
                  <EmptyState
                    icon={<Trophy aria-hidden />}
                    title="Nobody has traded this week yet."
                    description="Place the first trade and you are #1 until someone beats you."
                  />
                ) : (
                  <LeagueLeaderboard rows={data.leaderboard} chainId={CHAIN_ID} />
                )}
              </section>

              {data.me && data.me.trades.length > 0 ? (
                <section className="flex flex-col gap-3" aria-labelledby="league-trades">
                  <SectionTitle id="league-trades" hint="Three paper trades complete the First Paper Trades quest">
                    Your trades
                  </SectionTitle>
                  <RecentTrades trades={data.me.trades} />
                </section>
              ) : null}

              {data.lastSettled && data.lastSettled.top.length > 0 ? (
                <section className="flex flex-col gap-3" aria-labelledby="league-last">
                  <SectionTitle id="league-last" hint={`Final top 10. Only real players with ${MIN_TRADES_FOR_WEEKLY_POINTS}+ trades earn points.`}>
                    Week of {formatUtcDayMonth(data.lastSettled.weekStart)}
                  </SectionTitle>
                  <LeagueLeaderboard rows={data.lastSettled.top} chainId={CHAIN_ID} showDelta={false} />
                </section>
              ) : null}
            </div>

            {/* Sticky lives on the aside: .border-gradient sets position: relative on the panel itself. */}
            <aside className="sticky top-20 hidden lg:block">
              <section className="rounded-2xl border-gradient bg-card p-5" aria-labelledby="league-trade">
                <div className="mb-5 flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <h2 id="league-trade" className="text-lg font-semibold tracking-tight">
                      Paper trade
                    </h2>
                    <ScoutChip progress={scout} />
                  </div>
                  <p className="text-sm text-muted-foreground">{tradeDescription}</p>
                </div>
                {tradePanel}
              </section>
            </aside>
          </div>

          {/*
            Phones and tablets: a floating Trade button opens a bottom sheet. It is sticky, not fixed: it floats
            1rem above the tab bar while the page scrolls, then comes to rest in its own slot under the last
            section, so it never covers the final leaderboard row or the footer links. Only as wide as the pill
            (self-end), so rows beside it stay tappable.
          */}
          <div data-slot="league-trade-fab" className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-40 self-end lg:hidden">
            <Button
              size="lg"
              className="h-11 rounded-full px-4 text-base font-semibold shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_12px_32px_-8px_rgb(255_106_42/0.6),0_4px_12px_rgb(0_0_0/0.5)] md:h-12 md:px-5"
              onClick={() => setSheetOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
            >
              <ArrowLeftRight data-icon="inline-start" aria-hidden />
              Paper trade
            </Button>
          </div>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent
              side="bottom"
              className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-3xl border-white/[0.08] bg-popover pb-[env(safe-area-inset-bottom,0px)] shadow-[inset_0_1px_0_rgb(255_245_230/0.06),0_-24px_64px_rgb(0_0_0/0.6)] data-[side=bottom]:border-t"
            >
              <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/15" aria-hidden />
              <SheetHeader className="px-5 pt-3 pr-12 pb-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <SheetTitle className="text-lg font-semibold tracking-tight">Paper trade</SheetTitle>
                  <ScoutChip progress={scout} />
                </div>
                <SheetDescription>{tradeDescription}</SheetDescription>
              </SheetHeader>
              <div className="h-px shrink-0 bg-gradient-to-r from-transparent via-white/10 to-transparent" aria-hidden />
              <div className="px-5 pt-5 pb-4">{sheetOpen ? tradePanel : null}</div>
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
}

function LeagueSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]" aria-hidden>
      <div className="flex min-w-0 flex-col gap-3">
        <Skeleton className="h-5 w-32" />
        <LeagueLeaderboardSkeleton />
      </div>
      <div className="hidden lg:block">
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    </div>
  );
}
