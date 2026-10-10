"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import {
  apiGet,
  ApiClientError,
  type CallMarketView,
  type CallsResponse,
  type LeaderboardResponse,
  type LeagueResponse,
  type PlaysResponse,
} from "@/lib/api-client";
import type { PriceSourceName } from "@/lib/core";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiQueryResult } from "@/components/common/useApiQuery";
import { useCallsQuery, useLeagueQuery } from "@/components/layout/WeekData";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useOptionalSession } from "@/hooks/useSession";
import { PriceChip, type PriceChipQuote } from "@/components/common/PriceChip";
import { XStockLogo } from "@/components/common/XStockLogo";
import { displayName, formatPoints, formatUsd } from "@/components/common/format";
import { NEXT_WEEK_MARKETS_COPY, formatSettleDay, liveStatus } from "@/components/calls/calls-format";
import {
  DAY_MS,
  TRACK_DAYS,
  WEEKDAYS_SHARE,
  formatTrackClock,
  spokenTrackClock,
  spokenUtcDayTime,
  trackX,
  utcDayMonth,
  utcDayTime,
  weekTrackModel,
  type WeekTrackModel,
} from "@/components/layout/week-track";
import {
  GAME_TILE_ORDER,
  STRIKE_NOTE,
  TILE_COPY,
  TILE_PLACEHOLDER,
  competitionLaneFigure,
  createSharedReads,
  crowdLead,
  gapLabel,
  gaugePosition,
  nextQuestCheck,
  onChainQuestTileStat,
  pickHeroMarkets,
  predictionsLaneFigure,
  questTileFigure,
  utcStamp,
  type GameTileKey,
  type TileFigure,
} from "@/components/landing/game-tiles";
import { openSeatCopy, seasonSeats } from "@/components/landing/scoreboard-mode";

/**
 * The live landing, Broadcast (9 Oct 2026), all read from /api/v1:
 *   - LivePredictions: the hero's stage. This week's prediction as a plain question, the live price
 *     drawn against the line it has to beat, the lock countdown, the split and one action; the
 *     week's other questions as tabs under it. From Friday's close it replays the week as final.
 *   - GameTiles: the three games, each a lane on the same Monday-to-Friday axis as the week track,
 *     with one live figure, one line and one button.
 *   - SeasonTop: the Season seats in the closing band (real players only, the rest open).
 *
 * Four endpoints, one request each per page load. /calls and /league are the shell's shared reads
 * (src/components/layout/WeekData.tsx), which the week track under the header also draws from;
 * /plays and the Season seats are shared between this file's components through SHARED_READS.
 * Each component loads on its own, so one slow endpoint never blanks the rest.
 *
 * The hero is laid out by the page's grid (src/app/page.tsx): LivePredictions renders its stage and
 * its tabs as two grid items (a `contents` wrapper), so the welcome line can sit between them on a
 * phone and above them on a desktop.
 */

/** A settled read is reused this long; a remount after that (a later visit) reads fresh numbers. */
const SHARED_READ_TTL_MS = 30_000;
const SHARED_READS = createSharedReads(SHARED_READ_TTL_MS);

type Loaded<T> = { data: T | null; error: boolean; loading: boolean };

function useShared<T>(key: string, fetcher: () => Promise<T>): Loaded<T> {
  const [state, setState] = React.useState<Loaded<T>>({ data: null, error: false, loading: true });
  const ref = React.useRef(fetcher);
  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A cold or busy server can answer one request with a 5xx; retry twice before showing "not available".
    // A failed read leaves the shared cache at once, so a retry (from any component) starts a new request.
    const run = (attempt: number) => {
      SHARED_READS.get(key, ref.current)
        .then((data) => {
          if (!cancelled) setState({ data, error: false, loading: false });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          const retryable = !(e instanceof ApiClientError) || e.status >= 500;
          if (retryable && attempt < 2) {
            timer = setTimeout(() => run(attempt + 1), 600 * (attempt + 1));
            return;
          }
          setState({ data: null, error: true, loading: false });
        });
    };
    run(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);
  return state;
}

/** A shared query in this file's Loaded shape: an error only counts while there is nothing to show. */
function fromQuery<T>(q: ApiQueryResult<T>): Loaded<T> {
  return { data: q.data, error: q.data === null && q.error !== null, loading: q.loading };
}

const useCalls = (): Loaded<CallsResponse> => fromQuery(useCallsQuery("landing:calls"));
const useLeague = (): Loaded<LeagueResponse> => fromQuery(useLeagueQuery("landing:league"));
const usePlays = () => useShared<PlaysResponse>("plays", () => apiGet<PlaysResponse>("/api/v1/plays"));
// Three rows fill the three seats: the board only lists real players with positive Season points.
const useBoard = () => useShared<LeaderboardResponse>("board", () => apiGet<LeaderboardResponse>("/api/v1/leaderboard?limit=3"));

/** Client clock corrected by the server's `now`, ticking every `ms`. */
function useServerNow(serverNow: string | undefined, ms: number): number {
  const offset = React.useMemo(() => {
    const t = serverNow ? Date.parse(serverNow) : NaN;
    return Number.isFinite(t) ? t - Date.now() : 0;
  }, [serverNow]);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now + offset;
}


/** The week the week track draws (the same model and the same two reads), or null before either read lands. */
function landingWeek(calls: CallsResponse | null, league: LeagueResponse | null, nowMs: number): WeekTrackModel | null {
  if (!calls && !league) return null;
  return weekTrackModel({
    nowMs,
    league: league?.league ?? null,
    leagueNow: league?.now ?? null,
    calls: calls ? { markets: calls.markets, season: calls.season } : null,
  });
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

/** Skeleton on the ink ground; still under reduced motion. */
function Bar({ className }: { className?: string }) {
  return <Skeleton className={cn("rounded-sm bg-ink-3 motion-reduce:animate-none", className)} />;
}

/** A text link on a 1px rule with its arrow ("Make a prediction →"). */
const RULED_LINK = cn(buttonVariants({ variant: "link" }), "text-base");

function Arrow() {
  return (
    <span aria-hidden className="ml-2 font-medium">
      →
    </span>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* The hero's stage                                                                            */
/* ------------------------------------------------------------------------------------------ */

/** The stage: the question and its price track on the left, the clock and the crowd on the right (a ruled column). */
const STAGE = "[grid-area:stage] mt-5 grid grid-cols-2 border-t border-rule-2 lg:mt-[30px] lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24.5rem]";
const MAIN = "col-span-2 min-w-0 pt-4 lg:col-span-1 lg:pt-6 lg:pr-10 lg:pb-[26px] xl:pr-14";
/** The side column from lg; on a phone its two blocks sit side by side under the track. */
const SIDE = "contents lg:flex lg:min-w-0 lg:flex-col lg:border-l lg:border-rule lg:pt-6 lg:pb-[26px] lg:pl-8 xl:pl-10";
const CLOCK = "mt-3 min-w-0 border-t border-rule pt-2.5 pr-3.5 lg:mt-0 lg:border-t-0 lg:p-0";
const CROWD = "mt-3 min-w-0 border-t border-l border-rule pt-2.5 pl-3.5 lg:mt-6 lg:mb-5 lg:border-l-0 lg:pt-5 lg:pl-0";
const CLOCK_LABEL = "text-[0.78125rem] leading-none font-medium text-muted-foreground lg:text-sm";
const KICK = "flex min-w-0 items-center gap-[9px] text-[0.8125rem] leading-none font-medium text-muted-foreground lg:gap-3 lg:text-sm";
const STAGE_ACTION = cn(buttonVariants({ variant: "secondary" }), "h-12 px-[22px] text-base");

/** The split, both sides always named: "43 Yes ▬▬▬|▬▬▬▬ No 57". An empty pool draws a neutral track. */
function SplitBar({ odds, className }: { odds: CallMarketView["odds"]; className?: string }) {
  const empty = !(odds.total > 0);
  const yes = Math.round(odds.yesProb * 100);
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 text-[0.78125rem] leading-none font-semibold tabular-nums font-stretch-[88%] lg:gap-2.5 lg:text-[0.9375rem]",
        className,
      )}
    >
      <span className="sr-only">Current split: </span>
      <span className={empty ? "text-muted-foreground" : "text-yes"}>{empty ? "Yes" : `${yes} Yes`}</span>
      <span
        aria-hidden
        className="relative flex h-1.5 gap-[3px] after:absolute after:-inset-y-1 after:left-1/2 after:w-px after:bg-rule-2"
      >
        <i className={cn("block h-full", empty ? "bg-ink-4" : "bg-yes")} style={{ width: `calc(${empty ? 50 : yes}% - 1.5px)` }} />
        <i className={cn("block h-full flex-1", empty ? "bg-ink-4" : "bg-no")} />
      </span>
      <span className={empty ? "text-muted-foreground" : "text-no"}>{empty ? "No" : `No ${100 - yes}`}</span>
    </div>
  );
}

const SOURCES: readonly PriceSourceName[] = ["pyth", "jupiter", "cache", "none"];
const asSource = (s: string | null): PriceSourceName => (SOURCES.includes(s as PriceSourceName) ? (s as PriceSourceName) : "none");

/**
 * The price track: No on the left, Yes on the right, the line (the strike) in the middle, the price
 * as a dot with its gap to the line bracketed above it and its source and age under it. Final: the
 * settled close instead of the live price.
 */
function Gauge({ market, settled }: { market: CallMarketView; settled: boolean }) {
  const price = settled ? market.settledPrice : (market.quote?.price ?? null);
  const pos = gaugePosition(price, market.strike);
  const below = pos !== null && pos.gap < 0;
  const at = pos ? `${pos.p.toFixed(2)}%` : "50%";
  const quote: PriceChipQuote | null = settled
    ? { price: market.settledPrice, source: asSource(market.source), publishedAt: market.settleAt, stale: false }
    : market.quote;
  return (
    <div className="relative mt-3.5 h-[84px] lg:mt-[30px] lg:h-[108px]" style={{ "--p": at } as React.CSSProperties}>
      <span className="sr-only">{settled ? "The settled close against the line:" : "The live price against the line:"}</span>
      {/* No below the line, Yes above it. */}
      <div aria-hidden className="absolute inset-x-0 top-10 flex h-2 lg:top-[52px] lg:h-2.5">
        <i className="block h-full w-1/2 bg-no/[0.13] shadow-[inset_0_-2px_0_rgb(255_93_108/0.75)]" />
        <i className="block h-full flex-1 bg-yes/[0.13] shadow-[inset_0_-2px_0_rgb(58_208_138/0.75)]" />
      </div>
      <p className="absolute top-3.5 left-0 text-sm leading-[1.15] font-semibold text-no lg:top-1 lg:text-base">
        No
        <span className="hidden text-[0.8125rem] leading-[1.3] font-normal text-muted-foreground lg:block">closes below</span>
      </p>
      <p className="absolute top-3.5 right-0 text-right text-sm leading-[1.15] font-semibold text-yes lg:top-1 lg:text-base">
        Yes
        <span className="hidden text-[0.8125rem] leading-[1.3] font-normal text-muted-foreground lg:block">closes above</span>
      </p>
      {/* The line it has to beat, labelled on the side away from the price. */}
      <span aria-hidden className="absolute top-1 left-1/2 h-[52px] w-0.5 -translate-x-px bg-paper lg:top-0 lg:h-[74px]" />
      <p
        className={cn(
          "absolute -top-0.5 left-1/2 hidden whitespace-nowrap lg:block",
          below ? "pl-3" : "-translate-x-full pr-3 text-right",
        )}
      >
        <span className="block text-xl leading-none font-semibold tabular-nums font-stretch-[92%]">{formatUsd(market.strike)}</span>
        <span className="mt-[5px] block text-[0.8125rem] leading-none text-muted-foreground">{STRIKE_NOTE}</span>
      </p>
      {pos ? (
        <>
          {Math.abs(pos.gap) >= 0.005 ? (
            <div
              className="absolute top-[22px] h-2.5 border border-b-0 border-mute lg:top-[30px] lg:h-3"
              style={below ? { left: "var(--p)", width: "calc(50% - var(--p))" } : { left: "50%", width: "calc(var(--p) - 50%)" }}
            >
              <span
                className={cn(
                  "absolute bottom-[13px] text-[0.78125rem] leading-none font-semibold whitespace-nowrap text-foreground lg:bottom-4 lg:text-sm",
                  // Centred over a wide bracket; over a narrow one it keeps clear of the line, on the price's side.
                  below ? "right-2" : "left-2",
                  Math.abs(pos.p - 50) >= 18 && (below ? "lg:right-auto lg:left-1/2 lg:-translate-x-1/2" : "lg:left-1/2 lg:-translate-x-1/2"),
                )}
              >
                {gapLabel(pos.gap)}
              </span>
            </div>
          ) : (
            <span className="absolute top-[22px] left-1/2 ml-2 text-[0.78125rem] leading-none font-semibold text-foreground lg:top-[30px] lg:text-sm">
              {gapLabel(pos.gap)}
            </span>
          )}
          <span
            aria-hidden
            className="absolute top-11 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper shadow-[0_0_0_4px_rgb(243_240_232/0.14)] lg:top-[57px] lg:size-[22px] lg:shadow-[0_0_0_5px_rgb(243_240_232/0.14),inset_0_0_0_1px_var(--ink)]"
            style={{ left: "var(--p)" }}
          />
        </>
      ) : null}
      {/* Its source and age: the anchor slides along the line with the dot, so it never leaves the track. */}
      <div className="absolute top-[60px] whitespace-nowrap lg:top-[78px]" style={{ left: "var(--p)", transform: "translateX(calc(-1 * var(--p)))" }}>
        {quote ? (
          <PriceChip quote={quote} symbol={settled ? "Settled" : market.symbol} className="flex-nowrap" tickMs={settled ? 60_000 : 15_000} />
        ) : (
          <span className="text-[0.8125rem] text-muted-foreground">No live price right now</span>
        )}
      </div>
    </div>
  );
}

/** "Locks in 6:01:45" while open; "Locked" until the settle; then the result. */
function Clock({ market, now, final, reduced }: { market: CallMarketView; now: number; final: boolean; reduced: boolean }) {
  const status = liveStatus(market, now);
  if (status === "open" && !final) {
    const ms = Date.parse(market.locksAt) - now;
    const text = formatTrackClock(ms, !reduced);
    return (
      <div className={CLOCK}>
        <p className={CLOCK_LABEL}>Locks in</p>
        <p
          role="timer"
          aria-label={`Locks in ${spokenTrackClock(ms, !reduced)}`}
          className={cn(
            "figure mt-1.5 tabular-nums lg:mt-3",
            text.length > 8 ? "text-[2.125rem] sm:text-[2.75rem] lg:text-[3.75rem] xl:text-[4.5rem]" : "text-[2.75rem] sm:text-[3.5rem] lg:text-[5rem] xl:text-[6.25rem]",
            // After the size: tailwind-merge drops a line height that comes before a font size.
            "leading-[0.8]",
          )}
        >
          {text}
        </p>
        <p className="mono-meta mt-3.5 hidden lg:block">
          <time dateTime={market.locksAt}>{utcStamp(market.locksAt)}</time>
        </p>
      </div>
    );
  }
  const settling = Date.parse(market.settleAt) <= now;
  const word =
    status === "settled" ? (market.outcome === "yes" ? "Yes" : market.outcome === "no" ? "No" : "Void") : status === "void" ? "Void" : settling ? "Settling" : "Locked";
  const tone = word === "Yes" ? "text-yes" : word === "No" ? "text-no" : "text-foreground";
  const label = status === "settled" || status === "void" ? "Result" : "Entries closed";
  const meta =
    status === "settled" ? `Settled ${utcStamp(market.settleAt)}` : status === "void" ? `Refunded ${utcStamp(market.settleAt)}` : `Settles ${utcStamp(market.settleAt)}`;
  return (
    <div className={CLOCK}>
      <p className={CLOCK_LABEL}>{label}</p>
      <p
        className={cn(
          "figure mt-1.5 font-medium font-stretch-[85%] lg:mt-3",
          word.length > 4 ? "text-[2rem] sm:text-[2.75rem] lg:text-[3.75rem] xl:text-[4.5rem]" : "text-[2.75rem] sm:text-[3.5rem] lg:text-[5rem] xl:text-[6.25rem]",
          "leading-[0.8]",
          tone,
        )}
      >
        {word}
      </p>
      <p className="mono-meta mt-3.5 hidden lg:block">
        <time dateTime={market.settleAt}>{meta}</time>
      </p>
    </div>
  );
}

/** "57% say No", the split, and the points in (the house bots seed every pool, so it says so). */
function Crowd({ market, final }: { market: CallMarketView; final: boolean }) {
  const lead = crowdLead(market.odds);
  const empty = !(market.odds.total > 0);
  return (
    <div className={CROWD}>
      <p className="mb-[9px] font-display text-[1.1875rem] leading-none lg:mb-3.5 lg:text-[1.875rem]">
        {lead ? (
          <>
            <b
              className={cn(
                "mr-[3px] font-sans text-xl font-semibold tracking-[-0.01em] tabular-nums font-stretch-[88%] lg:mr-1.5 lg:text-[1.875rem]",
                lead.side === "yes" ? "text-yes" : "text-no",
              )}
            >
              {lead.pct}
            </b>
            {final ? "said" : "say"} {lead.side === "yes" ? "Yes" : "No"}
          </>
        ) : empty ? (
          "No points in yet"
        ) : (
          "An even split"
        )}
      </p>
      <SplitBar odds={market.odds} />
      <p className="mt-2 text-xs leading-snug text-pretty text-muted-foreground lg:mt-3 lg:text-[0.84375rem] lg:leading-[1.4]">
        {empty ? "Points only." : `${formatPoints(market.odds.total)} points in, incl. bot seed. Points only.`}
      </p>
    </div>
  );
}

function Stage({
  market,
  index,
  total,
  count,
  final,
  week,
  now,
  reduced,
  questionId,
}: {
  market: CallMarketView;
  index: number;
  total: number;
  count: number;
  final: boolean;
  week: WeekTrackModel | null;
  now: number;
  reduced: boolean;
  questionId: string;
}) {
  const status = liveStatus(market, now);
  const settled = final && status === "settled" && market.settledPrice !== null;
  // Locked or final, the action is the board, never one nobody can take until next week.
  const action = final ? "See all results" : status === "open" ? "Make a prediction" : "See predictions";
  return (
    <>
      <div className={MAIN}>
        <div className={KICK}>
          <XStockLogo symbol={market.symbol} className="size-[22px] lg:size-7" />
          <b className="font-semibold whitespace-nowrap text-foreground">
            {final && week ? `Week of ${utcDayMonth(week.monday)}` : "This week's prediction"}
          </b>
          {total > 1 ? (
            <>
              <span aria-hidden className="h-3.5 w-px shrink-0 bg-rule-2" />
              <span className="whitespace-nowrap">
                {index + 1} of {total}
              </span>
            </>
          ) : null}
          {settled ? <span className="stamp ml-0.5">Final</span> : null}
        </div>
        <h2
          id={questionId}
          className="mt-2.5 font-display text-[2.1875rem] leading-[0.98] font-normal tracking-[-0.012em] sm:text-5xl lg:mt-4 lg:text-[3.25rem] lg:leading-[0.96] xl:text-[4.375rem]"
        >
          Will {market.ticker} close above{" "}
          <span className="block whitespace-nowrap">
            {formatUsd(market.strike)} on {formatSettleDay(market.settleAt)}?
          </span>
        </h2>
        <Gauge market={market} settled={settled} />
        {count > total ? (
          <Link
            href="/predictions"
            className="mt-2 inline-flex min-h-10 items-center rounded-sm text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--focus)] motion-reduce:transition-none"
          >
            See all {count} predictions
            <Arrow />
          </Link>
        ) : null}
      </div>
      <div className={SIDE}>
        <Clock market={market} now={now} final={final} reduced={reduced} />
        <Crowd market={market} final={final} />
        <Link href="/predictions" className={cn(STAGE_ACTION, "mt-auto hidden self-start lg:inline-flex")}>
          {action}
        </Link>
      </div>
    </>
  );
}

/** The loading stage, at its loaded sizes, so the hero does not jump when the board arrives. */
function StageSkeleton() {
  return (
    <>
      <div className={MAIN} aria-hidden>
        <div className="flex items-center gap-3">
          <Bar className="size-[22px] rounded-full lg:size-7" />
          <Bar className="h-3.5 w-44" />
        </div>
        <Bar className="mt-2.5 h-[34px] w-[85%] lg:mt-4 lg:h-[50px] xl:h-[67px]" />
        <Bar className="mt-0.5 h-[34px] w-[65%] lg:mt-0.5 lg:h-[50px] xl:h-[67px]" />
        <div className="relative mt-3.5 h-[84px] lg:mt-[30px] lg:h-[108px]">
          <Bar className="absolute inset-x-0 top-10 h-2 lg:top-[52px] lg:h-2.5" />
        </div>
      </div>
      <div className={SIDE} aria-hidden>
        <div className={CLOCK}>
          <Bar className="h-3 w-16 lg:h-3.5" />
          <Bar className="mt-1.5 h-[35px] w-32 lg:mt-3 lg:h-16 lg:w-52 xl:h-20 xl:w-64" />
          <Bar className="mt-3.5 hidden h-3.5 w-44 lg:block" />
        </div>
        <div className={CROWD}>
          <Bar className="h-[19px] w-24 lg:h-[30px] lg:w-44" />
          <Bar className="mt-[9px] h-3 w-full lg:mt-3.5 lg:h-4" />
          <Bar className="mt-2 h-3 w-3/4" />
        </div>
        <Bar className="mt-auto hidden h-12 w-48 lg:block" />
      </div>
    </>
  );
}

/** The stage for the states with no question to show: a sentence and the way to the board. */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-2 py-6 lg:py-8">
      <p className={KICK}>
        <b className="font-semibold text-foreground">Friday predictions</b>
      </p>
      <p className="mt-3 max-w-[24ch] font-display text-[1.75rem] leading-[1.02] text-balance sm:text-4xl lg:mt-4 lg:text-[2.75rem]">{children}</p>
      <Link href="/predictions" className={cn(STAGE_ACTION, "mt-6")}>
        See predictions
      </Link>
    </div>
  );
}

const TABS = "[grid-area:mkts] mt-[30px] grid border-y border-rule md:grid-cols-3 lg:mt-0";

/** This week's questions as tabs (WAI-ARIA tabs: arrow keys, Home and End move the selection). */
function MarketTabs({
  markets,
  selected,
  onSelect,
  baseId,
  panelId,
}: {
  markets: CallMarketView[];
  selected: number;
  onSelect: (id: string) => void;
  baseId: string;
  panelId: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = markets.length;
    const j =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (i + 1) % n
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    if (j < 0) return;
    e.preventDefault();
    onSelect(markets[j].id);
    refs.current[j]?.focus();
  };
  return (
    <div role="tablist" aria-label="This week's predictions" className={TABS}>
      {markets.map((m, i) => {
        const on = i === selected;
        return (
          <button
            key={m.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${i}`}
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(m.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "relative grid min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-3 pt-3.5 pb-[15px] text-left outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset motion-reduce:transition-none md:pr-7 md:pb-4",
              i > 0 && "border-t border-rule md:border-t-0 md:border-l md:pl-7",
              on ? "before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:bg-paper md:before:right-7" : "opacity-[0.86] hover:opacity-100",
              on && i > 0 && "md:before:left-7",
            )}
          >
            <XStockLogo symbol={m.symbol} className="size-[26px]" />
            <span className="truncate text-sm leading-tight text-muted-foreground">
              <b className="mr-1 font-semibold text-foreground">{m.ticker}</b>above {formatUsd(m.strike)}
            </span>
            <SplitBar odds={m.odds} className="col-span-2" />
          </button>
        );
      })}
    </div>
  );
}

function TabsSkeleton() {
  return (
    <div className={TABS} aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          data-slot="tab-skeleton"
          className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 pt-3.5 pb-[15px] md:pr-7 md:pb-4", i > 0 && "border-t border-rule md:border-t-0 md:border-l md:pl-7")}
        >
          <Bar className="size-[26px] rounded-full" />
          <Bar className="h-3.5 w-36" />
          <Bar className="col-span-2 h-3 w-full lg:h-4" />
        </div>
      ))}
    </div>
  );
}

/**
 * The hero's stage and tabs: this week's prediction (open or locked) as the stage, the week's other
 * questions as tabs. From Friday's close, the week that just closed, as final results.
 */
export function LivePredictions() {
  const calls = useCalls();
  const league = useLeague();
  const reduced = useReducedMotion();
  const now = useServerNow(calls.data?.now, reduced ? 60_000 : 1_000);
  const week = landingWeek(calls.data, league.data, now);
  const { shown, count, final } = pickHeroMarkets(calls.data?.markets, now, week);
  const [picked, setPicked] = React.useState<string | null>(null);
  const baseId = React.useId();
  const panelId = `${baseId}-panel`;
  const questionId = `${baseId}-question`;
  const index = Math.max(0, shown.findIndex((m) => m.id === picked));
  const market = shown[index];
  const tabs = market !== undefined && shown.length > 1;

  let body: React.ReactNode;
  if (calls.loading) {
    body = <StageSkeleton />;
  } else if (calls.error || !calls.data) {
    body = <Notice>This week&apos;s board is not available right now.</Notice>;
  } else if (!market) {
    body = <Notice>{NEXT_WEEK_MARKETS_COPY}</Notice>;
  } else {
    body = (
      <Stage
        market={market}
        index={index}
        total={shown.length}
        count={count}
        final={final}
        week={week}
        now={now}
        reduced={reduced}
        questionId={questionId}
      />
    );
  }

  return (
    <div className="contents">
      {/* A section, not an article: ARIA in HTML allows role=tabpanel on section and div only. */}
      <section
        id={panelId}
        role={tabs ? "tabpanel" : undefined}
        aria-labelledby={tabs ? `${baseId}-tab-${index}` : market ? questionId : undefined}
        aria-label={market ? undefined : "This week's predictions"}
        aria-busy={calls.loading || undefined}
        className={STAGE}
      >
        {body}
      </section>
      {calls.loading ? <TabsSkeleton /> : tabs ? <MarketTabs markets={shown} selected={index} onSelect={setPicked} baseId={baseId} panelId={panelId} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* The three games, each a lane on the week                                                    */
/* ------------------------------------------------------------------------------------------ */

const LANE_COLS = "xl:grid-cols-[16.75rem_minmax(0,1fr)_14.75rem] xl:gap-x-10";
/**
 * A lane's words sit above the gold "now" line (z-10), with a halo in the grained ground's own tone
 * (#101011), so the line passes behind them instead of striking through them.
 */
const LANE_TEXT =
  "absolute top-8 z-10 text-[0.8125rem] leading-none font-medium whitespace-nowrap text-foreground [text-shadow:0_0_1px_rgb(16_16_17),0_0_3px_rgb(16_16_17),0_0_6px_rgb(16_16_17)] xl:top-[46px] xl:text-sm";
const LANE_BAR = "absolute top-[54px] h-2 xl:top-[72px] xl:h-2.5";

/** The days above the lanes (desktop), with the gold "now" tag. */
function DayAxis({ week }: { week: WeekTrackModel | null }) {
  const nowX = week ? trackX(week.nowMs, week.monday) : null;
  return (
    <div className="relative h-[30px]">
      {TRACK_DAYS.map((d, i) => {
        const past = week !== null && nowX !== null && (i < 5 ? week.monday + i * DAY_MS <= week.nowMs : nowX >= WEEKDAYS_SHARE);
        // A day name the "now" tag would sit on steps aside for it.
        const covered = nowX !== null && nowX >= d.x - 0.012 && nowX - d.x < 0.05;
        return (
          <span
            key={d.long}
            className={cn(
              "absolute bottom-[9px] translate-x-[7px] text-[0.78125rem] leading-none font-medium whitespace-nowrap",
              past ? "text-muted-foreground" : "text-dim",
              covered && "invisible",
            )}
            style={{ left: pct(d.x) }}
          >
            {d.long}
          </span>
        );
      })}
      {nowX !== null ? (
        <span
          className="absolute bottom-1.5 -translate-x-1/2 bg-signal px-[5px] pt-[3px] pb-0.5 text-[0.78125rem] leading-none font-semibold text-signal-foreground"
          style={{ left: pct(nowX) }}
        >
          Now
        </span>
      ) : null}
    </div>
  );
}

/**
 * Friday's finish: a checkered line at the close, and its stamp (filled once the week is final). The
 * stamp sits above the "now" line (z-10): over the weekend "now" lands right on it.
 */
function Finish({ x, weekend }: { x: number; weekend: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className="absolute inset-y-0 -bottom-px w-1.5 -translate-x-[3px] bg-[conic-gradient(var(--paper)_25%,transparent_0_50%,var(--paper)_0_75%,transparent_0)] bg-[length:6px_6px] opacity-55"
        style={{ left: pct(x) }}
      />
      <span
        className={cn(
          "absolute top-[70px] z-10 -translate-x-1/2 px-1.5 pt-1 pb-[3px] font-sans text-[11px] leading-none font-extrabold tracking-[0.06em] uppercase italic font-stretch-[112%] xl:top-[69px] xl:translate-x-3",
          weekend ? "bg-paper text-ink" : "bg-ink text-foreground shadow-[inset_0_0_0_1px_var(--paper)] xl:bg-transparent",
        )}
        style={{ left: pct(x) }}
      >
        Final
      </span>
    </>
  );
}

/** Elapsed (cream) then still to run (faint), from the lane's start to `end`. */
function RunBar({ end, nowX }: { end: number; nowX: number }) {
  const done = Math.min(end, nowX);
  return (
    <>
      <span className={cn(LANE_BAR, "left-0 bg-[rgb(243_240_232/0.62)]")} style={{ width: pct(done) }} />
      <span className={cn(LANE_BAR, "bg-[rgb(243_240_232/0.2)]")} style={{ left: pct(done), width: pct(Math.max(0, end - done)) }} />
    </>
  );
}

/**
 * The lane's accessible name (the lane is role="img", so its drawn words are not read): everything
 * the lane says, the next quest checked and the week's prediction count included.
 */
function laneLabel(kind: GameTileKey, week: WeekTrackModel | null, next: { title: string; points: number } | null = null, weekCount = 0): string {
  if (kind === "quests") {
    const base = "On-chain quests: your wallet is checked all week, about every 5 minutes.";
    return next ? `${base} Next check: ${next.title}, +${formatPoints(next.points)} points.` : base;
  }
  if (kind === "predictions") {
    const count = weekCount > 0 ? ` ${weekCount} ${week?.weekend ? "settled" : "this week"}.` : "";
    if (!week || week.lockAt === null) return `Predictions: Yes or No on Friday's close.${count}`;
    const locked = week.weekend || week.nowMs >= week.lockAt;
    return `Predictions ${locked ? "locked" : "lock"} ${spokenUtcDayTime(week.lockAt)} and settle after Friday's close.${count}`;
  }
  if (!week || week.closeAt === null) return "The weekly competition, with virtual cash.";
  return `The virtual-cash competition ${week.weekend ? "closed" : "closes"} ${spokenUtcDayTime(week.closeAt)}.`;
}

function LaneTrack({
  kind,
  week,
  weekCount,
  next,
}: {
  kind: GameTileKey;
  week: WeekTrackModel | null;
  weekCount: number;
  next: { title: string; points: number } | null;
}) {
  const at = (t: number) => (week ? trackX(t, week.monday) : 0);
  const nowX = week ? at(week.nowMs) : null;
  const lockAt = week?.lockAt ?? null;
  const lockX = lockAt !== null ? at(lockAt) : null;
  const closeX = week?.closeAt != null ? at(week.closeAt) : null;
  const weekend = week?.weekend ?? false;

  let content: React.ReactNode = null;
  if (week && nowX !== null) {
    if (kind === "predictions") {
      const end = lockX ?? closeX;
      const state = weekend ? "Final" : lockAt !== null && week.nowMs >= lockAt ? "Locked" : "Open";
      content = (
        <>
          <span className={cn(LANE_TEXT, "left-0")}>
            {state}
            {weekCount > 0 ? (
              <span className="ml-2 hidden font-normal text-muted-foreground xl:inline">
                {weekCount} {weekend ? "settled" : "this week"}
              </span>
            ) : null}
          </span>
          {end !== null ? <RunBar end={end} nowX={nowX} /> : null}
          {lockAt !== null && lockX !== null ? (
            <>
              {closeX !== null && closeX > lockX ? (
                <span
                  className={cn(LANE_BAR, "bg-[repeating-linear-gradient(135deg,rgb(243_240_232/0.34)_0_2px,transparent_2px_6px)]")}
                  style={{ left: pct(lockX), width: pct(closeX - lockX) }}
                />
              ) : null}
              <span className="absolute top-[46px] h-6 w-0.5 -translate-x-px bg-paper xl:top-[62px] xl:h-[30px]" style={{ left: pct(lockX) }} />
              <span className={LANE_TEXT} style={{ left: `calc(${pct(lockX)} + 10px)` }}>
                Lock
                {/* The time only where the lane leaves it room before Friday's finish (the week track above always shows it). */}
                <span className="ml-2 hidden font-mono text-[0.8125rem] font-normal text-muted-foreground min-[1400px]:inline">{utcDayTime(lockAt)}</span>
              </span>
            </>
          ) : null}
        </>
      );
    } else if (kind === "competition") {
      content = (
        <>
          <span className={cn(LANE_TEXT, "left-0")}>Paper trades with $10,000 virtual cash</span>
          {closeX !== null ? <RunBar end={closeX} nowX={nowX} /> : null}
        </>
      );
    } else {
      content = (
        <>
          <span className={cn(LANE_TEXT, "left-0")}>
            Checked from your wallet<span className="hidden xl:inline">, about every 5 minutes</span>
          </span>
          {/* Checks, not a bar: a dotted rail, the checks already run in cream, the rest of the week faint. */}
          <span className="absolute inset-x-0 top-[59px] h-0.5 -translate-y-1/2 bg-[repeating-linear-gradient(90deg,var(--rule-2)_0_2px,transparent_2px_7px)] xl:top-[76px]" />
          <span
            className="absolute left-0 top-[59px] h-0.5 -translate-y-1/2 bg-[repeating-linear-gradient(90deg,rgb(243_240_232/0.62)_0_2px,transparent_2px_7px)] xl:top-[76px]"
            style={{ width: pct(nowX) }}
          />
          <span
            className="absolute top-[59px] z-10 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink shadow-[inset_0_0_0_1.5px_var(--paper),0_0_0_4px_rgb(243_240_232/0.12)] xl:top-[76px] xl:size-[13px]"
            style={{ left: pct(nowX) }}
          />
          {/* The tip reads from the ring onwards, clear of the "now" line; late in the week it turns to the left of it. */}
          <span
            className={cn(
              "absolute top-[70px] text-[0.78125rem] leading-[1.25] font-medium whitespace-nowrap text-foreground xl:top-24 xl:text-[0.8125rem]",
              nowX > 0.7 ? "-translate-x-[calc(100%+12px)] text-right" : "translate-x-3",
            )}
            style={{ left: pct(nowX) }}
          >
            Next check
            {next ? (
              <span className="hidden text-[0.78125rem] font-normal text-muted-foreground xl:block">
                {next.title} · +{formatPoints(next.points)}
              </span>
            ) : null}
          </span>
        </>
      );
    }
  }

  return (
    <div className="relative min-h-[92px] xl:min-h-[132px]" role="img" aria-label={laneLabel(kind, week, next, weekCount)}>
      {/* The days: a rule at each midnight, the weekend hatched. */}
      {TRACK_DAYS.map((d) => (
        <span key={d.long} className="absolute inset-y-0 w-px bg-rule" style={{ left: pct(d.x) }} />
      ))}
      <span
        className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(135deg,rgb(243_240_232/0.025)_0_6px,transparent_6px_12px)]"
        style={{ left: pct(WEEKDAYS_SHARE) }}
      />
      {TRACK_DAYS.map((d) => (
        <span key={`d-${d.long}`} className="absolute top-2 translate-x-[5px] text-[0.6875rem] leading-none font-medium text-dim xl:hidden" style={{ left: pct(d.x) }}>
          {d.short}
        </span>
      ))}
      {content}
      {week && closeX !== null && kind !== "quests" ? <Finish x={closeX} weekend={weekend} /> : null}
      {nowX !== null ? <span className="absolute inset-y-0 -bottom-px w-px bg-signal" style={{ left: pct(nowX) }} /> : null}
    </div>
  );
}

/**
 * Three games, one Season leaderboard: each a lane on this week's Monday-to-Friday axis, with one
 * large live figure (an em dash while it loads or when it is unavailable, never a made-up figure),
 * one short line and one button.
 */
export function GameTiles({ className }: { className?: string }) {
  const calls = useCalls();
  const league = useLeague();
  const plays = usePlays();
  const now = useServerNow(calls.data?.now ?? league.data?.now, 30_000);
  const week = landingWeek(calls.data, league.data, now);
  const weekend = week?.weekend ?? false;

  // With every prediction locked, the button offers the board instead of an action nobody can take.
  const openCount = calls.data ? calls.data.markets.filter((m) => liveStatus(m, now) === "open").length : null;
  const weekCount =
    week && calls.data
      ? calls.data.markets.filter((m) => {
          const t = Date.parse(m.settleAt);
          return t >= week.monday && t < week.nextMonday;
        }).length
      : 0;
  const live: Record<GameTileKey, { figure: TileFigure | null; busy: boolean }> = {
    predictions: { figure: predictionsLaneFigure(calls.data?.markets, now, week), busy: calls.loading },
    competition: { figure: competitionLaneFigure(league.data, weekend), busy: league.loading },
    quests: { figure: questTileFigure(onChainQuestTileStat(plays.data)), busy: plays.loading },
  };
  const next = nextQuestCheck(plays.data);

  return (
    <section aria-labelledby="games-title" className={className}>
      <h2 id="games-title" className="sr-only">
        Three games, one Season leaderboard
      </h2>
      <div aria-hidden className={cn("hidden xl:grid", LANE_COLS)}>
        <p className="self-end pb-[7px] font-display text-[1.625rem] leading-none text-muted-foreground">
          {weekend && week ? `Week of ${utcDayMonth(week.monday)}` : "This week"}
        </p>
        <DayAxis week={week} />
        <span />
      </div>
      <ul>
        {GAME_TILE_ORDER.map((key) => {
          const copy = TILE_COPY[key];
          const { figure, busy } = live[key];
          return (
            <li key={key} className={cn("grid border-t border-rule-2 xl:border-rule xl:last:border-b", LANE_COLS)}>
              <div
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 pt-[18px] pb-1 xl:block xl:pt-6 xl:pb-[22px]"
                aria-busy={busy || undefined}
              >
                <h3 className="font-display text-[1.875rem] leading-none font-normal tracking-[-0.005em] xl:text-[2.25rem]">{copy.title}</h3>
                <p className="figure col-start-2 row-start-1 text-[2rem] leading-[0.8] font-light tabular-nums xl:mt-3.5 xl:text-[2.75rem]">
                  {figure?.figure ?? (
                    <>
                      <span aria-hidden>{TILE_PLACEHOLDER}</span>
                      <span className="sr-only">{busy ? "Loading" : "Not available right now"}</span>
                    </>
                  )}
                </p>
                <p className="col-span-2 mt-2 text-[0.84375rem] leading-[1.35] text-pretty text-muted-foreground xl:mt-2.5 xl:max-w-[30ch]">
                  {figure?.line ?? copy.note}
                </p>
              </div>
              <LaneTrack kind={key} week={week} weekCount={weekCount} next={next} />
              <Link href={copy.href} className={cn(RULED_LINK, "mt-1 mb-5 justify-self-start xl:my-0 xl:self-center xl:justify-self-end")}>
                {key === "predictions" && openCount === 0 ? "See predictions" : copy.cta}
                <Arrow />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Season seats                                                                                */
/* ------------------------------------------------------------------------------------------ */

const SEAT = "grid h-[76px] grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 px-4 py-3 lg:h-[108px] lg:px-5 lg:py-[18px]";

/**
 * The Season seats: the Season leaderboard's first three places. A real player takes a seat (bots
 * are never on this board; starter points never count); every seat left is an open "Your slot".
 * While the board loads, and after a failed read, it renders nothing.
 */
export function SeasonTop({ className }: { className?: string }) {
  const seats = seasonSeats(useBoard().data);
  // An open seat says whose it could be: the visitor's, until they hold a seat themselves (as /leaderboard).
  const userId = useOptionalSession()?.session?.userId ?? null;
  if (!seats) return null;
  const open = openSeatCopy(seats, userId);
  return (
    <div className={cn("min-w-0", className)}>
      <ol aria-label="Season top 3" className="grid grid-cols-2 gap-2 lg:gap-2.5 xl:grid-cols-[1.25fr_1fr_1fr]">
        {seats.map(({ rank, row }) =>
          row ? (
            <li key={rank} className={cn(SEAT, "col-span-2 bg-ink-2 shadow-[inset_0_0_0_1px_var(--rule)] xl:col-span-1")}>
              <span className="figure text-[2.75rem] leading-[0.8] font-light lg:text-[3.75rem]">{row.rank ?? rank}</span>
              <div className="min-w-0">
                <p className="truncate text-base leading-[1.1] font-semibold">{displayName(row.handle, row.address)}</p>
                <p className="mt-1 text-[1.375rem] leading-none font-semibold tabular-nums font-stretch-[85%] lg:mt-2 lg:text-[1.625rem]">
                  {formatPoints(row.points)}
                  <span className="ml-1.5 font-sans text-[0.8125rem] font-normal text-muted-foreground font-stretch-normal">Season points</span>
                </p>
              </div>
            </li>
          ) : (
            <li key={rank} className={cn(SEAT, "border border-dashed border-[rgb(243_240_232/0.3)]")}>
              <span className="figure text-[2.75rem] leading-[0.8] font-light text-dim lg:text-[3.75rem]">{rank}</span>
              <div className="min-w-0">
                <p className="text-base leading-[1.1] font-semibold">{open.title}</p>
                <p className="mt-1 text-sm leading-tight text-muted-foreground lg:mt-2">{open.hint}</p>
              </div>
            </li>
          ),
        )}
      </ol>
      <Link href="/leaderboard" className={cn(RULED_LINK, "mt-5 text-[0.9375rem]")}>
        Leaderboard
        <Arrow />
      </Link>
    </div>
  );
}
