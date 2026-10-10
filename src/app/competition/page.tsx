"use client";

import * as React from "react";
import { useSession } from "@/hooks/useSession";
import { useInView, useScrolledPast } from "@/hooks/useInView";
import { ChevronDownIcon, Sprout } from "lucide-react";
import { cn } from "cn";
import { api, type LeagueLeaderboardRow, type LeagueResponse, type PlaysResponse } from "@/lib/api-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { useApiQuery } from "@/components/common/useApiQuery";
import { useLeagueQuery } from "@/components/layout/WeekData";
import { MarketSessionChip } from "@/components/common/MarketSessionChip";
import { PRE_IPO_COMPLIANCE_LINE } from "@/components/common/compliance";
import { preIpoToken } from "@/components/prestocks/tokens";
import { formatPoints } from "@/components/common/format";
import { AccountCard } from "@/components/league/AccountCard";
import { LeagueClock, LeagueClockSkeleton } from "@/components/league/LeagueCountdown";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { BotGlyph, LeagueLeaderboard, LeagueLeaderboardSkeleton, houseBotLegend, type OpenSeat } from "@/components/league/LeagueLeaderboard";
import { LastWeek } from "@/components/league/LastWeek";
import { PositionsTable, RecentTrades } from "@/components/league/PositionsTable";
import { ScoutChip } from "@/components/league/ScoutChip";
import { TradeClosed } from "@/components/league/TradeClosed";
import { TradeForm, TradeFormSkeleton } from "@/components/league/TradeForm";
import { YouVsBots } from "@/components/league/YouVsBots";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { LEAGUE_MIN_TRADE_USD, LEAGUE_TOP_PRIZE_POINTS, WEEKEND_TRADES_COPY, formatUsdWhole, isPreWeek } from "@/components/league/format";
import { findScoutPlay, scoutProgress } from "@/components/league/scout";
import { MIN_TRADES_FOR_WEEKLY_POINTS } from "@/lib/games/ledger-policy";
import { APP_URL } from "@/lib/config";
import { START_PATH, rankShareOnXUrl } from "@/components/start/share";

/** Equity moves with prices; re-read the board every minute while the tab is visible. */
const REFRESH_MS = 60_000;
const CHAIN_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
/** GET /league returns the top 50; a full page means there may be more players. */
const BOARD_LIMIT = 50;
/** The places that earn Season points: the cream rule on the board sits under this rank. */
const POINTS_PLACES = 10;

/** A serif section name with a muted hint on the right (Broadcast: serif for section names). */
function SectionTitle({ id, children, hint }: { id: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="font-display text-[1.625rem] leading-none font-normal tracking-[-0.01em] sm:text-[1.875rem]">
        {children}
      </h2>
      {hint ? <span className="text-[0.84375rem] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

const RULES = (
  <ul className="flex list-disc flex-col gap-1.5 pl-5">
    <li>Each competition week closes Friday 20:00 UTC. Everyone starts with $10,000 of virtual cash. Not real money.</li>
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

/** The rules, folded under the standings (the same disclosure PageHeader draws for its details). */
function HowItWorks() {
  return (
    <details className="group border-b border-rule text-sm text-muted-foreground [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 py-2 text-[0.9375rem] font-semibold text-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        How it works
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="flex max-w-3xl flex-col gap-2 pt-1 pb-4 leading-relaxed">{RULES}</div>
    </details>
  );
}

/** The caller's own row for the board when it ranks below the top 50 the page holds. */
function meBeyondBoard(data: LeagueResponse, address: string | null): LeagueLeaderboardRow | null {
  const me = data.me;
  if (!me || me.isBot || me.rank === null || data.leaderboard.some((r) => r.isMe)) return null;
  return { rank: me.rank, userId: `me:${me.id}`, handle: null, address, equityUsd: me.equityUsd, pnlPct: me.pnlPct, isBot: false, delta: me.delta, isMe: true };
}

export default function LeaguePage() {
  const { session, loading: sessionLoading, refresh: refreshSession } = useSession();
  const sessionKey = session?.userId ?? "";
  // The shell's shared read (WeekData): the week track under the header reads the same request.
  const q = useLeagueQuery(sessionKey);
  const { refetch } = q;
  // Scout progress comes from the quests board (PlayProgress); only fetched when signed in.
  const plays = useApiQuery<PlaysResponse | null>(() => (sessionKey ? api.plays() : Promise.resolve(null)), sessionKey, { refetchOnFocus: false });
  const refetchPlays = plays.refetch;
  const reduced = useReducedMotion();

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
  // A pre-IPO token in a table puts PRE_IPO_COMPLIANCE_LINE under that table (the footer carries COMPLIANCE_LINE).
  const preIpoInPositions = (data?.me?.positions ?? []).some((p) => preIpoToken(p.symbol) !== null);
  const preIpoInTrades = (data?.me?.trades ?? []).some((t) => preIpoToken(t.symbol) !== null);
  const scout = signedIn ? scoutProgress(findScoutPlay(plays.data), data?.me?.trades.length ?? 0) : null;

  const onPlaced = React.useCallback(() => {
    refetch();
    refetchPlays();
    // A trade can complete a quest inline: the header balance and Season points come from /auth/me.
    void refreshSession();
  }, [refetch, refetchPlays, refreshSession]);

  const closed = Boolean(league && !league.open);
  const weekend = Boolean(data && league && league.open && isPreWeek(league, data.now));

  // The open seat on the board: signed out it carries Connect (the view's one gold action); signed
  // in before a first trade it shows where that trade lands. Shown once the session check settles.
  const seatMode: "connect" | "first-trade" | null =
    !data || !league ? null : !data.signedIn ? (!session && !sessionLoading ? "connect" : null) : data.me ? null : "first-trade";

  // Phones and tablets: a floating Trade button jumps to the trade panel under the board. It steps
  // out of the way while the standings are on screen (it would cover their Return column and the open
  // seat's Connect), while the panel itself is, and once the panel is above the viewport (its arrow
  // points down, so it shows only between the board and the panel).
  const boardRef = React.useRef<HTMLElement | null>(null);
  const panelRef = React.useRef<HTMLElement | null>(null);
  const loaded = Boolean(data && league);
  const boardInView = useInView(boardRef, loaded);
  const panelInView = useInView(panelRef, loaded);
  const panelPassed = useScrolledPast(panelRef, loaded);
  const hideFab = boardInView || panelInView || panelPassed;
  const jumpToPanel = React.useCallback(() => {
    const el = panelRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }, [reduced]);

  const seat: OpenSeat | null =
    seatMode === "connect"
      ? { signedIn: false, action: <ConnectButton size="lg" fullLabel className="h-10 shrink-0" /> }
      : seatMode === "first-trade"
        ? {
            signedIn: true,
            action: (
              <Button variant="outline" size="sm" className="lg:hidden" onClick={jumpToPanel}>
                Paper trade
              </Button>
            ),
          }
        : null;

  const tradePanel =
    data && league && closed ? (
      <TradeClosed league={league} serverNow={data.now} lastSettled={data.lastSettled} chainId={CHAIN_ID} botWords={false} />
    ) : (
      <TradeForm
        league={league}
        signedIn={signedIn}
        serverNow={data?.now ?? null}
        refreshKey={`${sessionKey}:${refreshKey}`}
        onPlaced={onPlaced}
        connectVariant={seatMode === "connect" ? "secondary" : "default"}
      />
    );

  const players = data ? (data.leaderboard.length >= BOARD_LIMIT ? `${BOARD_LIMIT}+` : String(data.leaderboard.length)) : "";
  const legend = data ? houseBotLegend(data.leaderboard, BOARD_LIMIT) : null;
  const extraMe = data ? meBeyondBoard(data, session?.address ?? null) : null;
  const pointsNote = (
    <>
      Top {POINTS_PLACES} with {MIN_TRADES_FOR_WEEKLY_POINTS}+ paper trades earn Season points
      <span className="hidden sm:inline">, {formatPoints(LEAGUE_TOP_PRIZE_POINTS)} for 1st</span>
    </>
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Weekly competition (virtual cash)"
        description={
          <>
            <b>{startingCash} of virtual cash</b> every week. The best return at Friday&apos;s close takes the week.
          </>
        }
        actions={data && league ? <LeagueClock league={league} serverNow={data.now} /> : q.loading ? <LeagueClockSkeleton /> : null}
        className="mb-6 pt-0 max-sm:[&_h1+p]:hidden md:mb-8"
      />

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
        <div className="grid gap-y-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-0 xl:grid-cols-[minmax(0,1fr)_392px] xl:gap-x-14">
          {/* 1. The standings: the hero. Signed in, the player's own week follows. */}
          <div className="flex min-w-0 flex-col gap-8 animate-in fade-in-0 duration-500 motion-reduce:animate-none lg:col-start-1 lg:row-start-1">
            <section ref={boardRef} className="flex flex-col" aria-labelledby="league-board" data-slot="league-standings">
              <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
                <h2 id="league-board" className="text-[1.0625rem] leading-tight font-semibold tracking-[-0.01em] md:text-[1.1875rem]">
                  {weekend ? "Next week's standings" : "This week's standings"}
                </h2>
                {legend ? (
                  <span className="inline-flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground md:text-sm">
                    <BotGlyph className="text-muted-foreground" />
                    {legend}
                  </span>
                ) : null}
              </div>
              {weekend ? <p className="mt-1.5 text-sm text-muted-foreground">{WEEKEND_TRADES_COPY}, with the same virtual cash.</p> : null}
              {data.leaderboard.length === 0 && !seat ? (
                <EmptyState
                  className="mt-3"
                  title="Nobody has traded this week yet."
                  description="Place the first trade and you are #1 until someone beats you."
                />
              ) : (
                <>
                  <LeagueLeaderboard
                    rows={data.leaderboard}
                    chainId={CHAIN_ID}
                    startingCashUsd={data.startingCashUsd}
                    seat={seat}
                    pointsCut={POINTS_PLACES}
                    pointsNote={pointsNote}
                    extraMe={extraMe}
                    label={weekend ? "Next week's standings" : "This week's standings"}
                    className="mt-2.5 max-md:mt-3"
                  />
                  {data.leaderboard.length === 0 ? (
                    <p className="pt-3 text-sm text-muted-foreground">Nobody has traded this week yet. Place the first trade and you are #1 until someone beats you.</p>
                  ) : null}
                </>
              )}
              <HowItWorks />
            </section>

            {signedIn ? (
              <div className="flex flex-col gap-4">
                <AccountCard me={data.me} startingCashUsd={data.startingCashUsd} players={players} />
                {/* Derived from the board above: renders nothing until this account has traded this week. */}
                <YouVsBots me={data.me} rows={data.leaderboard} />
                {data.me && !data.me.isBot && data.me.rank !== null ? (
                  <a
                    href={rankShareOnXUrl(data.me.rank, data.me.pnlPct, `${APP_URL}${START_PATH}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: "link" }), "self-start text-[0.9375rem]")}
                  >
                    Post your rank on X
                    <span aria-hidden>→</span>
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* 2. The paper-trade slip and last week's final: the right column from lg, under the standings on a phone. */}
          <div className="flex min-w-0 flex-col gap-10 md:max-lg:grid md:max-lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:max-lg:items-start md:max-lg:gap-8 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <section
              id="league-trade"
              ref={panelRef}
              tabIndex={-1}
              aria-labelledby="league-trade-title"
              data-slot="league-trade-panel"
              className="flex flex-col bg-card p-[22px] ring-1 ring-rule outline-none max-md:-mx-[var(--gutter)] max-md:border-y max-md:border-rule-2 max-md:px-[var(--gutter)] max-md:py-5 max-md:ring-0"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="league-trade-title" className="font-display text-[2rem] leading-none font-normal tracking-[-0.01em] lg:text-[2.125rem]">
                  Paper trade
                </h2>
                <span className="text-[0.84375rem] font-medium text-muted-foreground">Virtual cash</span>
              </div>
              {scout ? <ScoutChip progress={scout} className="mt-3 self-start" /> : null}
              <div className="mt-4">{tradePanel}</div>
              {closed ? null : <p className="mt-3 text-[0.8125rem] leading-[1.45] text-muted-foreground">Virtual fills at the live quote. Not real money, not real trading.</p>}
            </section>

            {data.lastSettled && data.lastSettled.top.length > 0 ? (
              <LastWeek
                settled={data.lastSettled}
                // Over the weekend the settled week is the one that just closed (the track's "Final"), so it is named by its date.
                currentWeekStart={weekend ? null : league.weekStart}
                chainId={CHAIN_ID}
                pointsNote={`Only real players with ${MIN_TRADES_FOR_WEEKLY_POINTS}+ trades earn points.`}
              />
            ) : null}
          </div>

          {/* 3. Signed in: positions and trades, under the standings. */}
          {signedIn ? (
            <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-2 lg:pt-10">
              <section className="flex flex-col gap-3" aria-labelledby="league-positions">
                <SectionTitle id="league-positions" hint={data.me?.positions.length ? "Valued at the last price" : undefined}>
                  Positions
                </SectionTitle>
                <PositionsTable positions={data.me?.positions ?? []} />
                {preIpoInPositions ? <PreIpoComplianceLine /> : null}
              </section>

              {data.me && data.me.trades.length > 0 ? (
                <section className="flex flex-col gap-3" aria-labelledby="league-trades">
                  <SectionTitle id="league-trades" hint="Three paper trades complete the First Paper Trades quest">
                    Your trades
                  </SectionTitle>
                  <RecentTrades trades={data.me.trades} />
                  {preIpoInTrades ? <PreIpoComplianceLine /> : null}
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {/* The session chip says whether the US market is open; the line says why the board never stops. */}
      <div className="mt-12 flex flex-col gap-2.5 border-t border-rule pt-6 md:flex-row md:items-center md:gap-6">
        <MarketSessionChip />
        <p className="max-w-2xl text-[0.8125rem] leading-snug text-pretty text-muted-foreground">
          Wall Street is closed outside market hours. Solana is not, so you can trade on paper at any hour and every price carries its source and age.
        </p>
      </div>

      {/*
        Phones and tablets: the floating Trade button. It is sticky, not fixed: it floats 1rem above the
        tab bar while the page scrolls, then comes to rest in its own slot at the end of the page, so it
        never covers the last row or the footer links. Only as wide as the button (self-end), so rows
        beside it stay tappable. Hidden (not unmounted, so its resting slot stays) while the open seat or
        the trade panel is in view: the seat's Connect and the panel itself are the action there.
      */}
      {data && league ? (
        <div data-slot="league-trade-fab" className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-40 mt-6 self-end lg:hidden">
          <Button
            variant="secondary"
            size="lg"
            className={cn(
              "h-11 px-4 text-base shadow-[0_12px_32px_-8px_rgb(0_0_0/0.8),0_4px_12px_rgb(0_0_0/0.5)] transition-opacity duration-200 motion-reduce:transition-none",
              hideFab && "pointer-events-none invisible opacity-0",
            )}
            onClick={jumpToPanel}
            aria-controls="league-trade"
          >
            Paper trade
            <span aria-hidden>↓</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PreIpoComplianceLine() {
  return (
    <p data-slot="pre-ipo-compliance" className="text-[0.8125rem] leading-[1.45] text-pretty text-muted-foreground">
      {PRE_IPO_COMPLIANCE_LINE}
    </p>
  );
}

function LeagueSkeleton() {
  return (
    <div className="grid gap-y-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-x-10 xl:grid-cols-[minmax(0,1fr)_392px] xl:gap-x-14" aria-hidden>
      <div className="flex min-w-0 flex-col gap-2.5">
        <Skeleton className="h-5 w-48" />
        <LeagueLeaderboardSkeleton />
      </div>
      <div className="bg-card p-[22px] ring-1 ring-rule max-md:-mx-[var(--gutter)] max-md:px-[var(--gutter)] max-md:ring-0">
        <Skeleton className="mb-5 h-8 w-40" />
        <TradeFormSkeleton />
      </div>
    </div>
  );
}
