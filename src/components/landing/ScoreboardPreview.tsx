"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, BotIcon, TargetIcon, TrophyIcon, ZapIcon, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import {
  api,
  apiGet,
  ApiClientError,
  leagueApi,
  type CallMarketView,
  type CallsResponse,
  type LeaderboardResponse,
  type LeaderboardRow,
  type LeagueResponse,
  type PlaysResponse,
} from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PriceChip } from "@/components/common/PriceChip";
import { displayName, formatPoints, formatUsd } from "@/components/common/format";
import { NEXT_WEEK_MARKETS_COPY, formatCountdown, formatPct, liveStatus, lockLabel, marketQuestion } from "@/components/calls/calls-format";
import { formatSignedPct } from "@/components/league/format";
import { PRACTICE_LEAGUE_TITLE, seasonTopRows } from "@/components/landing/scoreboard-mode";
import {
  GAME_TILE_ORDER,
  TILE_COPY,
  TILE_PLACEHOLDER,
  competitionTileStat,
  createSharedReads,
  onChainQuestTileStat,
  pickLiveMarkets,
  predictionsTileStat,
  questTileNote,
  type GameTileKey,
} from "@/components/landing/game-tiles";

/**
 * The live landing, all read from /api/v1 (approved wireframe, 16 Sep 2026):
 *   - ScoreboardPreview: the hero's right column, a "Live right now" frame around
 *   - LivePredictions: this week's predictions as stacked cards, the hero visual at every width
 *     (all three from lg, the first one plus "See all N predictions" below lg), then
 *   - RankCard: the Season top 3 once three real players exist, until then the weekly
 *     competition (virtual cash) against labelled house bots;
 *   - GameTiles: the row under the hero, one live number and one button per game.
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

/** Glass for the preview stack: near-opaque so overlapping cards read as layers, lit top edge, deep shadow. */
const GLASS =
  "rounded-2xl border border-white/[0.08] bg-[linear-gradient(180deg,rgb(34_30_26/0.94)_0%,rgb(19_17_15/0.96)_100%)] shadow-[inset_0_1px_0_rgb(255_245_230/0.07),0_1px_2px_rgb(0_0_0/0.4),0_24px_48px_-20px_rgb(0_0_0/0.85)] backdrop-blur-xl";

const ICON_TILE =
  "flex shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] shadow-[inset_0_1px_0_rgb(255_245_230/0.06)]";

/** A quiet in-card link: 40px tall on phones (touch), 32px from sm. */
const CARD_LINK =
  "group -my-1 flex min-h-10 items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--focus)] sm:min-h-8";

/** Skeleton tuned to the glass surface (the default bg-muted reads too flat here). */
function Bar({ className }: { className?: string }) {
  return <Skeleton className={cn("rounded-md bg-white/[0.06] motion-reduce:animate-none", className)} />;
}

function Arrow() {
  return (
    <ArrowRightIcon
      className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none"
      aria-hidden
    />
  );
}

/** Bot marker copy, shared with the competition page's BotMarker. */
const BOT_LABEL = "House bot, never earns points";

/**
 * Phones get "Virtual competition" as the title and the rest of PRACTICE_LEAGUE_TITLE as a muted
 * sub-line, so the header stays short at 375 px; sm and up keep the full sentence.
 */
const [PRACTICE_SHORT, PRACTICE_REST = ""] = PRACTICE_LEAGUE_TITLE.split(": ");
const PRACTICE_SUB = PRACTICE_REST ? PRACTICE_REST.charAt(0).toUpperCase() + PRACTICE_REST.slice(1) : undefined;

function PreviewCard({
  icon: Icon,
  label,
  shortLabel,
  subLabel,
  meta,
  href,
  cta,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  /** Title shown below `sm` instead of `label`. */
  shortLabel?: string;
  /** Muted line under the title, below `sm` only. */
  subLabel?: string;
  meta?: React.ReactNode;
  href: string;
  cta: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(GLASS, "relative flex flex-col gap-4 p-4 sm:p-5 lg:gap-3 lg:p-4", className)}>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex min-w-0 items-center gap-2.5 text-sm font-semibold tracking-tight text-foreground">
            <span className={cn(ICON_TILE, "size-7")} aria-hidden>
              <Icon className="size-3.5 text-gold" />
            </span>
            {/* Wraps rather than truncates: the practice title is a full sentence (phones show the short form). */}
            <span className="min-w-0 leading-snug text-pretty">
              {shortLabel ? (
                <>
                  <span className="sm:hidden">{shortLabel}</span>
                  <span className="hidden sm:inline">{label}</span>
                </>
              ) : (
                label
              )}
            </span>
          </h3>
          {meta ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span> : null}
        </div>
        {/* Full card width under the header row (indented to the title: size-7 tile + gap-2.5), so it stays one line next to the meta. */}
        {subLabel ? <p className="pl-[2.375rem] text-xs leading-snug text-pretty text-muted-foreground sm:hidden">{subLabel}</p> : null}
      </div>
      {children}
      <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" aria-hidden />
      <Link href={href} className={cn(CARD_LINK, "justify-between")}>
        {cta}
        <Arrow />
      </Link>
    </section>
  );
}

function Unavailable({ what }: { what: string }) {
  return <p className="py-2 text-sm text-muted-foreground">{what} is not available right now.</p>;
}

/* ------------------------------------------------------------------------------------------ */
/* Hero frame                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/**
 * The hero's right column: the "Live right now" chip over the live cards (passed as children).
 * Phones stack; md puts the first prediction and the ranking side by side; lg stacks again.
 */
export function ScoreboardPreview({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "relative isolate flex flex-col gap-3 lg:gap-2.5 animate-in fade-in-0 slide-in-from-bottom-2 delay-150 duration-700 fill-mode-both motion-reduce:animate-none md:grid md:grid-cols-2 md:items-start lg:flex lg:items-stretch",
        className,
      )}
      aria-label="Live from Dulo"
    >
      {/* Ember bloom behind the stack gives the cards something to sit on. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-1/4 bottom-0 -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(255_106_42/0.18),transparent)] blur-2xl"
        aria-hidden
      />
      <div className="flex items-center justify-between gap-3 md:col-span-2">
        <span className="inline-flex h-6 items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-2.5 text-xs font-medium text-emerald-300">
          <span className="relative flex size-1.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/70 motion-reduce:animate-none" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
          </span>
          Live right now
        </span>
        <span className="text-xs text-muted-foreground">Points only, no cash value</span>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Predictions                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** "Yes 64%" [bar] "36% No": the current split of the points in. An empty pool reads as a neutral 50/50. */
function SplitRow({ market }: { market: CallMarketView }) {
  const { odds: split } = market;
  const empty = split.total === 0;
  const yes = formatPct(split.yesProb);
  const no = formatPct(split.noProb);
  return (
    <div className="flex items-center gap-2.5 text-xs leading-4 tabular-nums">
      <span className="shrink-0 text-muted-foreground">
        Yes <span className={cn("font-semibold", empty ? "text-muted-foreground" : "text-emerald-400")}>{yes}</span>
      </span>
      <div
        role="img"
        aria-label={empty ? "Current split: no points in yet" : `Current split: Yes ${yes}, No ${no}`}
        className="flex h-2 min-w-0 flex-1 gap-0.5 overflow-hidden rounded-full border border-white/[0.06] bg-black/25 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]"
      >
        <div
          className={cn("rounded-full", empty ? "bg-white/[0.08]" : "bg-gradient-to-r from-emerald-500 to-emerald-400")}
          style={{ width: `${Math.round((empty ? 0.5 : split.yesProb) * 100)}%` }}
        />
        <div className={cn("flex-1 rounded-full", empty ? "bg-white/[0.05]" : "bg-gradient-to-r from-rose-400/80 to-rose-500/80")} />
      </div>
      <span className="shrink-0 text-muted-foreground">
        <span className={cn("font-semibold", empty ? "text-muted-foreground" : "text-rose-400")}>{no}</span> No
      </span>
    </div>
  );
}

/** One prediction: question, price with source and age, current split, points in, and the way in. */
function PredictionCard({ market, now, className }: { market: CallMarketView; now: number; className?: string }) {
  const question = marketQuestion(market);
  // A locked card offers the board, not an action nobody can take until next week.
  const open = liveStatus(market, now) === "open";
  return (
    <article className={cn(GLASS, "flex flex-col gap-3 p-4 sm:p-5 lg:gap-2 lg:px-4 lg:py-3", className)} aria-label={question}>
      <div className="flex items-start gap-2.5">
        <span className={cn(ICON_TILE, "mt-px size-6 lg:hidden")} aria-hidden>
          <TargetIcon className="size-3 text-gold" />
        </span>
        <p className="min-w-0 text-base leading-snug font-medium text-pretty text-foreground lg:text-sm">{question}</p>
      </div>
      {market.quote ? (
        <PriceChip
          quote={market.quote}
          symbol={market.symbol}
          className="self-start rounded-lg border-white/[0.06] bg-black/25 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]"
        />
      ) : (
        <span className="text-xs text-muted-foreground">No live price right now</span>
      )}
      <SplitRow market={market} />
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {market.odds.total === 0 ? "No points in yet" : `${formatPoints(market.odds.total)} pts in, house-bot seed included`}
          <span aria-hidden> · </span>
          <span className="sr-only">, </span>
          {lockLabel(market, now)}
        </span>
        <Link href="/predictions" className={cn(CARD_LINK, "text-foreground/90 lg:my-0 lg:min-h-5")}>
          {open ? "Make a prediction" : "See predictions"}
          <Arrow />
        </Link>
      </div>
    </article>
  );
}

function PredictionSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(GLASS, "flex flex-col gap-3 p-4 sm:p-5 lg:gap-2 lg:px-4 lg:py-3", className)} aria-hidden>
      <Bar className="h-5 w-4/5" />
      <Bar className="h-5 w-48 rounded-lg" />
      <Bar className="my-1 h-2 w-full rounded-full" />
      <div className="flex items-center justify-between">
        <Bar className="h-3 w-36" />
        <Bar className="h-4 w-28" />
      </div>
    </div>
  );
}

/** A single glass card for the states with no market to show. */
function PredictionNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(GLASS, "flex flex-col gap-3 p-4 sm:p-5")}>
      <p className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-foreground">
        <span className={cn(ICON_TILE, "size-7")} aria-hidden>
          <TargetIcon className="size-3.5 text-gold" />
        </span>
        Friday predictions
      </p>
      {children}
      <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" aria-hidden />
      <Link href="/predictions" className={cn(CARD_LINK, "justify-between")}>
        See predictions
        <Arrow />
      </Link>
    </div>
  );
}

/**
 * This week's predictions (open or locked), up to three, as stacked cards. The hero visual at
 * every width: lg shows all of them, below lg the first one plus a link to the rest.
 */
export function LivePredictions({ className }: { className?: string }) {
  const q = useCalls();
  const now = useServerNow(q.data?.now);
  const { shown, count } = pickLiveMarkets(q.data?.markets, now);

  let body: React.ReactNode;
  if (q.loading) {
    body = (
      <>
        <PredictionSkeleton />
        <PredictionSkeleton className="hidden lg:flex" />
        <PredictionSkeleton className="hidden lg:flex" />
      </>
    );
  } else if (q.error || !q.data) {
    body = (
      <PredictionNotice>
        <Unavailable what="This week's board" />
      </PredictionNotice>
    );
  } else if (shown.length === 0) {
    body = (
      <PredictionNotice>
        <p className="py-2 text-sm text-muted-foreground">{NEXT_WEEK_MARKETS_COPY}</p>
      </PredictionNotice>
    );
  } else {
    body = (
      <>
        {shown.map((m, i) => (
          <PredictionCard key={m.id} market={m} now={now} className={cn(i > 0 && "hidden lg:flex")} />
        ))}
        {count > 1 ? (
          <Link href="/predictions" className={cn(CARD_LINK, "self-start px-1 lg:hidden")}>
            See all {count} predictions
            <Arrow />
          </Link>
        ) : null}
      </>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)} aria-busy={q.loading || undefined}>
      {body}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Ranking                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** Podium colours from docs/DESIGN.md: gold, silver, bronze. Keyed by rank (tied ranks share a colour). */
const RANK_CHIP: Record<number, string> = {
  1: "border-gold/30 bg-gold/10 text-gold",
  2: "border-zinc-300/20 bg-zinc-300/10 text-zinc-300",
  3: "border-[#d49a6a]/25 bg-[#d49a6a]/10 text-[#d49a6a]",
};

const RANK_CHIP_BASE = "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold";
const RANK_CHIP_QUIET = "border-white/[0.08] bg-white/[0.03] text-muted-foreground";

function RowsSkeleton() {
  return (
    <ol className="flex flex-col divide-y divide-white/[0.05]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
          <Bar className="size-7 shrink-0 rounded-full" />
          <Bar className="h-4 w-28" />
          <span className="ml-auto flex flex-col items-end gap-1.5">
            <Bar className="h-4 w-20" />
            <Bar className="h-3 w-12" />
          </span>
        </li>
      ))}
    </ol>
  );
}

function LeagueTop({ q, className }: { q: Loaded<LeagueResponse>; className?: string }) {
  const now = useServerNow(q.data?.now);
  const league = q.data?.league ?? null;
  const rows = q.data?.leaderboard.slice(0, 3) ?? [];
  const closesAt = league?.open && league.closesIn !== null && q.data ? Date.parse(q.data.now) + league.closesIn : null;
  const meta = closesAt ? `Closes in ${formatCountdown(closesAt - now)}` : league && !league.open ? "Between weeks" : null;

  return (
    <PreviewCard
      icon={TrophyIcon}
      label={PRACTICE_LEAGUE_TITLE}
      shortLabel={PRACTICE_SHORT}
      subLabel={PRACTICE_SUB}
      meta={meta}
      href="/competition"
      cta="Practice in the competition"
      className={className}
    >
      {q.loading ? (
        <RowsSkeleton />
      ) : q.error || !q.data ? (
        <Unavailable what="The competition" />
      ) : rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">No trades yet this week. First trade takes the top spot.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-white/[0.05]">
          {rows.map((r) => (
            <li key={r.userId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className={cn(RANK_CHIP_BASE, RANK_CHIP[r.rank] ?? RANK_CHIP_QUIET)}>{r.rank}</span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate text-sm font-medium text-foreground">{displayName(r.handle, r.address)}</span>
                {/* Phones: icon only, so the name keeps the width. sm and up: the "house bot" pill. */}
                {r.isBot ? (
                  <span
                    role="img"
                    aria-label={BOT_LABEL}
                    title={BOT_LABEL}
                    className="inline-flex shrink-0 items-center gap-1 text-muted-foreground/70 sm:rounded-full sm:border sm:border-white/[0.06] sm:bg-white/[0.03] sm:px-1.5 sm:text-xs sm:text-muted-foreground"
                  >
                    <BotIcon className="size-3.5 sm:size-3" aria-hidden />
                    <span className="hidden sm:inline">house bot</span>
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 flex-col items-end leading-tight">
                <span className="text-sm font-semibold tracking-tight text-foreground">{formatUsd(r.equityUsd)}</span>
                <span
                  className={cn(
                    "text-xs font-medium",
                    r.pnlPct > 0 ? "text-emerald-400" : r.pnlPct < 0 ? "text-rose-400" : "text-muted-foreground",
                  )}
                >
                  {formatSignedPct(r.pnlPct, 2)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </PreviewCard>
  );
}

/** Season top 3: only real players are ever on this board. */
function SeasonTop({ rows, className }: { rows: LeaderboardRow[]; className?: string }) {
  return (
    <PreviewCard icon={TrophyIcon} label="Season leaderboard" meta="Season 0" href="/leaderboard" cta="See the full leaderboard" className={className}>
      <ol className="flex flex-col divide-y divide-white/[0.05]">
        {rows.map((r) => (
          <li key={r.userId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className={cn(RANK_CHIP_BASE, RANK_CHIP[r.rank] ?? RANK_CHIP_QUIET)}>{r.rank}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{displayName(r.handle, r.address)}</span>
            <span className="shrink-0 text-sm font-semibold tracking-tight text-foreground">
              {formatPoints(r.points)} <span className="text-xs font-medium text-muted-foreground">Season pts</span>
            </span>
          </li>
        ))}
      </ol>
    </PreviewCard>
  );
}

/**
 * Season top 3 when three real players exist, else the virtual competition. Neutral skeleton while
 * the board loads. Sits after the prediction cards.
 */
export function RankCard({ className }: { className?: string }) {
  const board = useBoard();
  const league = useLeague();
  if (board.loading) {
    return (
      <PreviewCard icon={TrophyIcon} label="Leaderboard" href="/leaderboard" cta="See the leaderboard" className={className}>
        <RowsSkeleton />
      </PreviewCard>
    );
  }
  const top = seasonTopRows(board.data);
  return top ? <SeasonTop rows={top} className={className} /> : <LeagueTop q={league} className={className} />;
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
 * Three games, one Season leaderboard: one glass tile per game with one live number (an em dash
 * while it loads or when it is unavailable, never a made-up figure), a short note and one button.
 */
export function GameTiles({ className }: { className?: string }) {
  const calls = useCalls();
  const league = useLeague();
  const plays = usePlays();
  const now = useServerNow(calls.data?.now);

  const competition = competitionTileStat(league.data);
  const quests = onChainQuestTileStat(plays.data);
  // No dead end: between weeks (nothing open or locked) the tile says so, and with every
  // prediction locked its button offers the board instead of an action nobody can take.
  const liveCount = calls.data ? pickLiveMarkets(calls.data.markets, now, 0).count : null;
  const openCount = calls.data ? calls.data.markets.filter((m) => liveStatus(m, now) === "open").length : null;
  const live: Record<GameTileKey, { value: string | null; note: string; busy: boolean }> = {
    predictions: {
      value: liveCount === 0 ? "Between weeks" : predictionsTileStat(calls.data?.markets, now),
      note: liveCount === 0 ? NEXT_WEEK_MARKETS_COPY : TILE_COPY.predictions.note,
      busy: calls.loading,
    },
    competition: {
      value: competition?.value ?? null,
      note: competition?.note ?? TILE_COPY.competition.note,
      busy: league.loading,
    },
    quests: {
      value: quests?.value ?? null,
      note: questTileNote(quests),
      busy: plays.loading,
    },
  };

  return (
    <section aria-labelledby="games-title" className={cn("flex flex-col gap-3", className)}>
      <h2 id="games-title" className="sr-only">
        Three games, one Season leaderboard
      </h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {GAME_TILE_ORDER.map((key) => {
          const copy = TILE_COPY[key];
          const Icon = TILE_ICON[key];
          const { value, note, busy } = live[key];
          return (
            <li
              key={key}
              className="relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-2xl border border-white/[0.07] bg-card p-4 lg:px-5"
            >
              <span
                className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent"
                aria-hidden
              />
              <h3 className="flex items-center gap-2 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                <Icon className={cn("size-4", key === "predictions" ? "text-ember" : "text-gold")} aria-hidden />
                {copy.title}
              </h3>
              <div className="flex min-w-0 flex-col gap-0.5" aria-busy={busy || undefined}>
                <p className="text-2xl leading-8 font-semibold tracking-tight text-balance text-foreground tabular-nums sm:text-xl sm:leading-7 lg:text-2xl lg:leading-8">
                  {value ?? (
                    <>
                      <span aria-hidden>{TILE_PLACEHOLDER}</span>
                      <span className="sr-only">{busy ? "Loading" : "Not available right now"}</span>
                    </>
                  )}
                </p>
                <p className="text-xs leading-snug text-pretty text-muted-foreground">{note}</p>
              </div>
              <Link
                href={copy.href}
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "mt-auto h-auto min-h-10 self-start py-1.5 whitespace-normal sm:min-h-8 lg:h-8 lg:py-0",
                )}
              >
                {key === "predictions" && openCount === 0 ? "See predictions" : copy.cta}
                <ArrowRightIcon data-icon="inline-end" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default ScoreboardPreview;
