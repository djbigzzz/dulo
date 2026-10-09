"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, ChevronRightIcon, TargetIcon, TrophyIcon, ZapIcon, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import {
  api,
  apiGet,
  ApiClientError,
  leagueApi,
  type CallMarketView,
  type CallsResponse,
  type LeaderboardResponse,
  type LeagueResponse,
  type PlaysResponse,
} from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PriceChip } from "@/components/common/PriceChip";
import { displayName, formatPoints, formatUsd } from "@/components/common/format";
import { NEXT_WEEK_MARKETS_COPY, formatPct, liveStatus, lockLabel, marketQuestion } from "@/components/calls/calls-format";
import {
  GAME_TILE_ORDER,
  TILE_COPY,
  TILE_PLACEHOLDER,
  competitionTileFigure,
  createSharedReads,
  onChainQuestTileStat,
  pickLiveMarkets,
  predictionsTileFigure,
  questTileFigure,
  type GameTileKey,
  type TileFigure,
} from "@/components/landing/game-tiles";
import { seasonTopRows } from "@/components/landing/scoreboard-mode";

/**
 * The live landing, all read from /api/v1 (approved wireframe, 16 Sep 2026; calmer pass 9 Oct 2026):
 *   - LivePredictions: the hero visual. One featured prediction (big Yes / No split, one action),
 *     then this week's other predictions as compact rows in the same card;
 *   - GameTiles: the row under the hero, one live figure, one short line and one button per game;
 *   - SeasonTop: the Season top 3 in the closing section, once three real players exist (else nothing).
 *
 * Four endpoints, one request each per page load: the components share them through SHARED_READS.
 * Each component loads on its own, so one slow endpoint never blanks the rest.
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

const useCalls = () => useShared<CallsResponse>("calls", () => api.calls());
const useLeague = () => useShared<LeagueResponse>("league", () => leagueApi.overview());
const usePlays = () => useShared<PlaysResponse>("plays", () => apiGet<PlaysResponse>("/api/v1/plays"));
// Three rows are enough to decide: the board only lists real players with positive Season points.
const useBoard = () => useShared<LeaderboardResponse>("board", () => apiGet<LeaderboardResponse>("/api/v1/leaderboard?limit=3"));

/** Client clock corrected by the server's `now`, ticking every `ms`. */
function useServerNow(serverNow: string | undefined, ms = 30_000): number {
  const offset = React.useMemo(() => {
    const t = serverNow ? Date.parse(serverNow) : NaN;
    return Number.isFinite(t) ? t - Date.now() : 0;
  }, [serverNow]);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now + offset;
}

/**
 * The hero's one raised surface: near-opaque warm glass, a lit top edge and a deep soft shadow.
 * Kept out of cn(): tailwind-merge would read `border-gradient` as a border colour.
 */
const SURFACE =
  "border-gradient relative overflow-hidden rounded-[1.75rem] bg-[linear-gradient(180deg,rgb(31_27_23/0.92)_0%,rgb(17_15_13/0.96)_100%)] shadow-[inset_0_1px_0_rgb(255_245_230/0.07),0_40px_90px_-40px_rgb(0_0_0/0.95)] backdrop-blur-xl";

/** Skeleton tuned to the glass surface (the default bg-muted reads too flat here). */
function Bar({ className }: { className?: string }) {
  return <Skeleton className={cn("rounded-md bg-white/[0.06] motion-reduce:animate-none", className)} />;
}

function Arrow({ className }: { className?: string }) {
  return (
    <ArrowRightIcon
      className={cn("size-4 transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none", className)}
      aria-hidden
    />
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Predictions                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** Share of the points in on Yes, as a bar width; an empty pool reads as a neutral half. */
function yesWidth(m: CallMarketView): string {
  return `${Math.round((m.odds.total === 0 ? 0.5 : m.odds.yesProb) * 100)}%`;
}

/** Large live figures (the split, the tiles): the sans face, light and tight, so a 1 never reads as an l. */
const FIGURE = "font-sans font-light tracking-[-0.045em] tabular-nums";
const SPLIT_FIGURE = cn(FIGURE, "text-[3.25rem] leading-[0.85]");

/** The featured split: two large figures, Yes and No, over one thin bar. */
function BigSplit({ market }: { market: CallMarketView }) {
  const empty = market.odds.total === 0;
  const yes = formatPct(market.odds.yesProb);
  const no = formatPct(market.odds.noProb);
  const label = "text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <p className="flex flex-col gap-2">
          <span className={label}>Yes</span>
          <span className={cn(SPLIT_FIGURE, empty ? "text-muted-foreground" : "text-emerald-300")}>{yes}</span>
        </p>
        <p className="flex flex-col items-end gap-2">
          <span className={label}>No</span>
          <span className={cn(SPLIT_FIGURE, empty ? "text-muted-foreground" : "text-rose-300")}>{no}</span>
        </p>
      </div>
      <div
        role="img"
        aria-label={empty ? "Current split: no points in yet" : `Current split: Yes ${yes}, No ${no}`}
        className="flex h-1.5 gap-1 overflow-hidden rounded-full"
      >
        <div className={cn("rounded-full", empty ? "bg-white/[0.1]" : "bg-emerald-400")} style={{ width: yesWidth(market) }} />
        <div className={cn("flex-1 rounded-full", empty ? "bg-white/[0.06]" : "bg-rose-400/85")} />
      </div>
    </div>
  );
}

/** One of this week's other predictions: ticker and strike, a small split, and the way to it. */
function CompactRow({ market }: { market: CallMarketView }) {
  const empty = market.odds.total === 0;
  const yes = formatPct(market.odds.yesProb);
  return (
    <li>
      <Link
        href="/predictions"
        aria-label={`${marketQuestion(market)} ${empty ? "No points in yet" : `Current split: Yes ${yes}`}`}
        className="group -mx-2 flex min-h-12 items-center gap-3 lg:[@media(max-height:860px)]:min-h-10 rounded-xl px-2 text-sm outline-none transition-colors hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
      >
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          <span className="font-medium text-foreground">{market.ticker}</span> above {formatUsd(market.strike)}
        </span>
        <span className="hidden h-1 w-14 shrink-0 overflow-hidden rounded-full bg-rose-400/40 min-[360px]:flex" aria-hidden>
          <span className={cn("h-full rounded-full", empty ? "bg-white/[0.15]" : "bg-emerald-400")} style={{ width: yesWidth(market) }} />
        </span>
        <span className="w-[4.5rem] shrink-0 text-right tabular-nums">
          <span className={cn("font-medium", empty ? "text-muted-foreground" : "text-emerald-300")}>{yes}</span>{" "}
          <span className="text-muted-foreground">Yes</span>
        </span>
        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
          aria-hidden
        />
      </Link>
    </li>
  );
}

/** The live dot and its label, top left of the card. */
function LiveLabel({ open }: { open: boolean }) {
  // Entries closed: a still gold dot, not the live pulse, until Friday's settle.
  if (!open) {
    return (
      <span className="inline-flex items-center gap-2 text-xs font-medium text-gold">
        <span className="size-1.5 rounded-full bg-gold" aria-hidden />
        This week&apos;s prediction
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-emerald-300">
      <span className="relative flex size-1.5" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/70 motion-reduce:animate-none" />
        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
      </span>
      Live right now
    </span>
  );
}

/** The card's one action: a full-width quiet button. */
const CARD_ACTION = cn(buttonVariants({ variant: "outline", size: "lg" }), "group h-12 w-full rounded-xl text-base");

/** The featured prediction: question, price with source and age, the split, points in, one action. */
function Featured({ market, now }: { market: CallMarketView; now: number }) {
  const question = marketQuestion(market);
  // A locked card offers the board, not an action nobody can take until next week.
  const open = liveStatus(market, now) === "open";
  return (
    <article className="flex flex-col" aria-label={question}>
      <div className="flex items-center justify-between gap-3">
        <LiveLabel open={open} />
        <span className="text-xs text-muted-foreground tabular-nums">{lockLabel(market, now)}</span>
      </div>
      <h3 className="mt-4 text-2xl leading-tight font-semibold tracking-tight text-balance text-foreground sm:text-[1.625rem]">{question}</h3>
      {market.quote ? (
        <PriceChip
          quote={market.quote}
          symbol={market.symbol}
          className="mt-2 self-start border-0 bg-transparent px-0 py-0 text-sm text-foreground/90 shadow-none"
        />
      ) : (
        <span className="mt-2 text-sm text-muted-foreground">No live price right now</span>
      )}
      <div className="mt-7 lg:[@media(max-height:860px)]:mt-5">
        <BigSplit market={market} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground tabular-nums">
        {market.odds.total === 0 ? "No points in yet" : `${formatPoints(market.odds.total)} pts in, incl. bot seed`}
      </p>
      <Link href="/predictions" className={cn(CARD_ACTION, "mt-5")}>
        {open ? "Make a prediction" : "See predictions"}
        <Arrow />
      </Link>
    </article>
  );
}

function FeaturedSkeleton() {
  return (
    <div className="flex flex-col" aria-hidden>
      <div className="flex items-center justify-between">
        <Bar className="h-4 w-24" />
        <Bar className="h-4 w-28" />
      </div>
      <Bar className="mt-4 h-7 w-11/12" />
      <Bar className="mt-2 h-7 w-2/3" />
      <Bar className="mt-3 h-4 w-48" />
      <div className="mt-7 flex items-end justify-between">
        <Bar className="h-14 w-24" />
        <Bar className="h-14 w-24" />
      </div>
      <Bar className="mt-3 h-1.5 w-full rounded-full" />
      <Bar className="mt-3 h-3 w-36" />
      <Bar className="mt-5 mb-2 h-12 w-full rounded-xl" />
    </div>
  );
}

/** The card for the states with no market to show: a sentence and the way to the board. */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <TargetIcon className="size-3.5 text-gold" aria-hidden />
        Friday predictions
      </span>
      <p className="mt-5 text-xl leading-snug font-medium text-balance text-foreground">{children}</p>
      <Link href="/predictions" className={cn(CARD_ACTION, "mt-8")}>
        See predictions
        <Arrow />
      </Link>
    </div>
  );
}

/**
 * This week's predictions (open or locked): the first as the featured card, the next two as
 * compact rows under it in the same surface, and a link to the rest when there are more.
 */
export function LivePredictions({ className }: { className?: string }) {
  const q = useCalls();
  const now = useServerNow(q.data?.now);
  const { shown, count } = pickLiveMarkets(q.data?.markets, now);
  const [featured, ...others] = shown;

  let body: React.ReactNode;
  if (q.loading) {
    body = <FeaturedSkeleton />;
  } else if (q.error || !q.data) {
    body = <Notice>This week&apos;s board is not available right now.</Notice>;
  } else if (!featured) {
    body = <Notice>{NEXT_WEEK_MARKETS_COPY}</Notice>;
  } else {
    body = (
      <>
        <Featured market={featured} now={now} />
        {others.length > 0 ? (
          <div className="mt-6 border-t border-white/[0.06] pt-2">
            <h3 className="sr-only">Also this week</h3>
            <ul className="flex flex-col">
              {others.map((m) => (
                <CompactRow key={m.id} market={m} />
              ))}
            </ul>
            {count > shown.length ? (
              <Link
                href="/predictions"
                className="group mt-2 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
              >
                See all {count} predictions
                <Arrow />
              </Link>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section
      aria-labelledby="live-predictions-title"
      aria-busy={q.loading || undefined}
      className={`${SURFACE} ${cn(
        "isolate p-5 pb-3 sm:p-6 sm:pb-4 animate-in fade-in-0 slide-in-from-bottom-2 delay-150 duration-700 fill-mode-both motion-reduce:animate-none",
        className,
      )}`}
    >
      {/* One ember bloom in the top corner: the only glow on the first screen. */}
      <div
        className="pointer-events-none absolute -top-40 -right-32 -z-10 size-96 rounded-full bg-[radial-gradient(closest-side,rgb(255_106_42/0.16),transparent)]"
        aria-hidden
      />
      <h2 id="live-predictions-title" className="sr-only">
        This week&apos;s predictions
      </h2>
      {body}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Game tiles                                                                                  */
/* ------------------------------------------------------------------------------------------ */

const TILE_ICON: Record<GameTileKey, LucideIcon> = {
  predictions: TargetIcon,
  competition: TrophyIcon,
  quests: ZapIcon,
};

/**
 * Three games, one Season leaderboard: one surface split in three, one large live figure per game
 * (an em dash while it loads or when it is unavailable, never a made-up figure), one short line
 * and one button.
 */
export function GameTiles({ className }: { className?: string }) {
  const calls = useCalls();
  const league = useLeague();
  const plays = usePlays();
  const now = useServerNow(calls.data?.now);

  // With every prediction locked, the button offers the board instead of an action nobody can take.
  const openCount = calls.data ? calls.data.markets.filter((m) => liveStatus(m, now) === "open").length : null;
  const live: Record<GameTileKey, { figure: TileFigure | null; busy: boolean }> = {
    predictions: { figure: predictionsTileFigure(calls.data?.markets, now), busy: calls.loading },
    competition: { figure: competitionTileFigure(league.data), busy: league.loading },
    quests: { figure: questTileFigure(onChainQuestTileStat(plays.data)), busy: plays.loading },
  };

  return (
    <section aria-labelledby="games-title" className={className}>
      <h2 id="games-title" className="sr-only">
        Three games, one Season leaderboard
      </h2>
      <ul className="grid divide-y divide-white/[0.06] overflow-hidden rounded-[1.75rem] border border-white/[0.07] bg-white/[0.02] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {GAME_TILE_ORDER.map((key) => {
          const copy = TILE_COPY[key];
          const Icon = TILE_ICON[key];
          const { figure, busy } = live[key];
          return (
            <li key={key} className="flex min-w-0 flex-col gap-4 p-5 sm:gap-5 sm:p-6 lg:[@media(max-height:860px)]:gap-3.5 lg:[@media(max-height:860px)]:py-5">
              <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Icon className={cn("size-4", key === "predictions" ? "text-ember" : "text-gold")} aria-hidden />
                {copy.title}
              </h3>
              <div
                className="flex min-w-0 flex-col gap-2"
                aria-busy={busy || undefined}
              >
                <p className={cn(FIGURE, "text-[2.5rem] leading-none text-foreground sm:text-5xl")}>
                  {figure?.figure ?? (
                    <>
                      <span aria-hidden>{TILE_PLACEHOLDER}</span>
                      <span className="sr-only">{busy ? "Loading" : "Not available right now"}</span>
                    </>
                  )}
                </p>
                <p className="text-sm leading-snug text-pretty text-muted-foreground">{figure?.line ?? copy.note}</p>
              </div>
              <Link
                href={copy.href}
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "group mt-auto h-auto min-h-10 self-start rounded-xl px-4 py-2 text-sm whitespace-normal",
                )}
              >
                {key === "predictions" && openCount === 0 ? "See predictions" : copy.cta}
                <Arrow className="size-3.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Season top 3                                                                                */
/* ------------------------------------------------------------------------------------------ */

/**
 * The landing top 3: the Season leaderboard's first three rows, once three real players have Season
 * points (bots are never on this board; starter points never count). One quiet line linking to the
 * board. Until then, and while it loads or after a failed read, it renders nothing.
 */
export function SeasonTop({ className }: { className?: string }) {
  const top = seasonTopRows(useBoard().data);
  if (!top) return null;
  return (
    <Link
      href="/leaderboard"
      className={cn(
        "group inline-flex max-w-full flex-wrap items-center justify-center gap-x-4 gap-y-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
        className,
      )}
    >
      <span className="w-full text-xs font-medium tracking-[0.16em] text-gold uppercase sm:w-auto">Season top 3</span>
      {top.map((r) => (
        <span key={r.userId} className="inline-flex min-w-0 items-center gap-1.5">
          <span className="text-muted-foreground tabular-nums">#{r.rank}</span>
          <span className="max-w-[10rem] truncate font-medium text-foreground">{displayName(r.handle, r.address)}</span>
          <span className="tabular-nums">{formatPoints(r.points)} Season pts</span>
        </span>
      ))}
      <Arrow className="size-3.5" />
    </Link>
  );
}
