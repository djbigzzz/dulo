"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { ArrowRightIcon, TargetIcon } from "lucide-react";
import {
  type CallMarketView,
  type CallPositionView,
  type CallSide,
  type CallsResponse,
  type PlaceCallResponse,
} from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/PageHeader";
import { SignInBanner } from "@/components/common/SignInBanner";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { MarketSessionChip } from "@/components/common/MarketSessionChip";
import { useCallsQuery } from "@/components/layout/WeekData";
import { formatTrackClock, spokenTrackClock } from "@/components/layout/week-track";
import { formatPoints } from "@/components/common/format";
import { useSession } from "@/hooks/useSession";
import { starterPointsHint } from "@/hooks/session-helpers";
import { PREDICTION_LOSS_COPY } from "@/lib/games/ledger-policy";
import { useSignInIntent } from "@/hooks/useSignInIntent";
import { MarketCard, MarketCardSkeleton } from "@/components/calls/MarketCard";
import { PlaceCallDialog } from "@/components/calls/PlaceCallDialog";
import { ResultsList } from "@/components/calls/ResultsList";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  CALLS_LOCK_COPY,
  NEXT_WEEK_MARKETS_COPY,
  STAKE_LEAVES_SCORE_COPY,
  liveStatus,
  liveWeekHeading,
  predictionsBoard,
  predictionsClock,
  utcStamp,
  type PredictionsClock,
} from "@/components/calls/calls-format";

/** Pools and quotes move; re-read the board this often while the tab is visible. */
const POLL_MS = 60_000;
/** Stable empty list so the dialog's props do not change identity every tick. */
const NO_POSITIONS: CallPositionView[] = [];

function positionsByMarket(me: CallsResponse["me"]): Map<string, CallPositionView[]> {
  const out = new Map<string, CallPositionView[]>();
  for (const p of me?.positions ?? []) {
    const list = out.get(p.marketId) ?? [];
    list.push(p);
    out.set(p.marketId, list);
  }
  return out;
}

const DETAILS = (
  <ul className="flex list-disc flex-col gap-1.5 pl-5">
    <li>Each prediction asks whether an xStock closes above its line on Friday. The line is the price when the prediction opened. Pick Yes or No and put in points from your balance; your starter points count.</li>
    <li>
      Correct picks share the pool: everyone on the right side gets their own points back plus a share of the points from the other side, in proportion to what they put in. Dulo takes no cut.
      The split under each question is each side&apos;s share of the pool; before you confirm, the dialog shows how many points back your points get at the current split. Both move until entries close.
    </li>
    <li>{CALLS_LOCK_COPY} If nobody took the other side, or no price is available within 24 hours, points are refunded.</li>
    <li>Settlement uses the Friday close price. The source and time are printed on every result.</li>
    <li>Points only, no cash value: they cannot be withdrawn or exchanged. {STAKE_LEAVES_SCORE_COPY}</li>
    <li>{PREDICTION_LOSS_COPY}</li>
    <li>House bots put points into every question so the split is never empty. They never get starter or quest points and never appear on the Season leaderboard.</li>
    <li>{NEXT_WEEK_MARKETS_COPY}</li>
  </ul>
);

/**
 * The page's one clock (the week track under the header counts to Friday's close on this page):
 * the lock countdown while predictions take points, "Locked" with the settle time once entries
 * close, and the FINAL stamp once the week has settled and nothing new is open yet.
 */
function PageClock({ clock, nowMs }: { clock: PredictionsClock; nowMs: number }) {
  const reduced = useReducedMotion();
  if (clock.kind === "none") return null;
  const label = clock.kind === "lock" ? "Locks in" : clock.kind === "settle" ? (clock.settling ? "Settling" : "Settles") : "Results are in";
  // Mono only for the time itself; "Reading the Friday close" is words, so it stays in the sans.
  const stamp =
    clock.kind === "lock" ? (
      <p className="mono-meta">
        <time dateTime={clock.iso}>{utcStamp(clock.iso)}</time>
      </p>
    ) : clock.kind === "settle" ? (
      clock.settling ? (
        <p className="text-[0.8125rem] leading-[1.35] text-muted-foreground">Reading the Friday close</p>
      ) : (
        <p className="mono-meta">
          <time dateTime={clock.iso}>{utcStamp(clock.iso)}</time>
        </p>
      )
    ) : (
      <p className="mono-meta">
        <time dateTime={clock.week.settleAt}>Settled {utcStamp(clock.week.settleAt)}</time>
      </p>
    );
  const text = clock.kind === "lock" ? formatTrackClock(clock.at - nowMs, !reduced) : clock.kind === "settle" ? "Locked" : null;
  return (
    <div data-slot="predictions-clock" className="flex w-full items-end justify-between gap-5 sm:w-auto sm:justify-end sm:gap-6">
      <div className="flex min-w-0 flex-col gap-2 sm:items-end sm:pb-1">
        <p className="flex items-center gap-2.5 text-[0.9375rem] leading-none font-medium text-muted-foreground lg:text-base">
          {label}
          {clock.kind === "final" ? <span className="stamp">Final</span> : null}
        </p>
        {stamp}
      </div>
      {text ? (
        <p
          role={clock.kind === "lock" ? "timer" : undefined}
          aria-label={clock.kind === "lock" ? `Locks in ${spokenTrackClock(clock.at - nowMs, !reduced)}` : undefined}
          className={cn(
            "figure shrink-0",
            clock.kind !== "lock" && "font-stretch-[85%] font-medium",
            clock.kind !== "lock"
              ? "text-[2.75rem] sm:text-[4rem] lg:text-[5.5rem]"
              : text.length > 8
                ? "text-[2.5rem] sm:text-[3.5rem] lg:text-[4.5rem]"
                : "text-[3.25rem] sm:text-[4.5rem] lg:text-[6.25rem]",
            // After the size: tailwind-merge drops a line height that comes before a font size.
            "leading-[0.8]",
          )}
        >
          {text}
        </p>
      ) : null}
    </div>
  );
}

/** A section name in the serif with its line on the right, on a strong rule. */
function SectionHead({ id, title, children }: { id: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1.5 pb-3.5">
      <h2 id={id} className="font-display text-[1.875rem] leading-none font-normal tracking-[-0.01em] text-foreground sm:text-[2.25rem]">
        {title}
      </h2>
      {children ? <div className="text-[0.875rem] text-muted-foreground tabular-nums sm:text-[0.9375rem]">{children}</div> : null}
    </div>
  );
}

export default function CallsPage() {
  const { session, user } = useSession();
  const starterPoints = user?.points?.starterPoints ?? 0;
  // Keyed on the session: signing in anywhere (header, banner, a side button) re-reads the board.
  // The shell's shared read (WeekData): the week track under the header reads the same request.
  const q = useCallsQuery(session?.userId ?? "");
  const { refetch } = q;

  // One ticking clock for every countdown; the server's `now` anchors it against clock skew.
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const skew = React.useRef(0);
  React.useEffect(() => {
    if (q.data?.now) {
      skew.current = Date.parse(q.data.now) - Date.now();
      setNowMs(Date.now() + skew.current);
    }
  }, [q.data?.now]);
  React.useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now() + skew.current), 1000);
    return () => window.clearInterval(id);
  }, []);

  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refetch();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refetch]);

  // Local overlay so a placed Call shows instantly; the next fetch replaces it.
  const [overlay, setOverlay] = React.useState<PlaceCallResponse | null>(null);
  React.useEffect(() => setOverlay(null), [q.data]);

  const [placing, setPlacing] = React.useState<{ id: string; side: CallSide } | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  /**
   * A side pressed while signed out: connect, sign in (auto, one signature), then it opens
   * for real once the board says signed in. Dropped if the modal or signature is cancelled.
   */
  const { pending, start: startSignIn, clear: clearPending } = useSignInIntent<{ id: string; side: CallSide }>(refetch);

  const markets: CallMarketView[] = React.useMemo(() => {
    const list = q.data?.markets ?? [];
    if (!overlay) return list;
    return list.map((m) => (m.id === overlay.market.id ? { ...overlay.market, positionsCount: undefined } : m));
  }, [q.data?.markets, overlay]);

  const me = React.useMemo(() => {
    const base = q.data?.me ?? null;
    if (!base || !overlay) return base;
    const rest = base.positions.filter((p) => !(p.marketId === overlay.position.marketId && p.side === overlay.position.side));
    return { spendablePoints: overlay.spendablePoints, positions: [...rest, overlay.position] };
  }, [q.data?.me, overlay]);

  const byMarket = React.useMemo(() => positionsByMarket(me), [me]);
  const signedIn = me !== null;
  const placingMarket = placing ? markets.find((m) => m.id === placing.id) ?? null : null;

  const onPlace = React.useCallback(
    (market: CallMarketView, side: CallSide) => {
      if (signedIn) {
        setPlacing({ id: market.id, side });
        setDialogOpen(true);
        return;
      }
      // Signed out: never a dead button. Connect first, then sign in; the Call opens afterwards.
      startSignIn({ id: market.id, side });
    },
    [signedIn, startSignIn],
  );

  React.useEffect(() => {
    if (!signedIn || !pending) return;
    setPlacing(pending);
    setDialogOpen(true);
    clearPending();
  }, [signedIn, pending, clearPending]);

  // PlaceCallDialog re-reads the session (the header balance) right after this runs.
  const onPlaced = React.useCallback(
    (result: PlaceCallResponse) => {
      setOverlay(result);
      refetch();
    },
    [refetch],
  );

  // The segments: this week's predictions, still taking points or waiting for the close. Once a
  // week has settled and the next one is not open yet, that final week is drawn as segments.
  const board = predictionsBoard(markets, nowMs);
  const clock = predictionsClock(board, nowMs);
  const finalWeek = board.live.length === 0 ? (board.results[0] ?? null) : null;
  const segments = board.live.length > 0 ? board.live : (finalWeek?.markets ?? []);
  const resultWeeks = finalWeek ? board.results.slice(1) : board.results;
  const openCount = board.live.filter((m) => liveStatus(m, nowMs) === "open").length;
  const pageLock = clock.kind === "lock" ? clock.iso : null;

  // Every market settled or void: the cron opens next week's three on the first tick after
  // Friday's settle (as soon as a strike quote is available).
  const footer = finalWeek
    ? NEXT_WEEK_MARKETS_COPY
    : openCount === 0
      ? "Every prediction is locked; points land in your balance after the close."
      : CALLS_LOCK_COPY;
  // The points in the segments shown: still in play, or (a final week) what that week pooled.
  const pooled = segments.reduce((sum, m) => sum + m.odds.total, 0);

  const balance = me
    ? { label: "Points balance", value: formatPoints(me.spendablePoints), hint: starterPointsHint(starterPoints, me.spendablePoints) }
    : null;

  return (
    <div className="flex flex-col gap-6 md:gap-10">
      <PageHeader
        className="mb-0"
        extrasLastOnMobile
        title="Predictions"
        description={
          <>
            Yes or No on Friday&apos;s close, <b>for points</b>. Points only, no cash value.
          </>
        }
        actions={q.data ? <PageClock clock={clock} nowMs={nowMs} /> : q.loading ? <Skeleton className="h-[52px] w-full sm:h-[80px] sm:w-[22rem]" aria-hidden /> : null}
        details={DETAILS}
      />

      {/* Desktop: the session line on the left and the points balance on the right, on one row. A phone keeps the balance up top and moves the session line to the end. */}
      <div className="-mt-3 flex flex-col gap-3 max-md:contents md:-mt-5 md:flex-row md:items-center md:justify-between md:gap-8">
        {/* The session chip says whether the US market is open; the line says why that is fine. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 max-md:order-last">
          <MarketSessionChip />
          <p className="max-w-2xl text-[0.875rem] text-pretty text-muted-foreground">
            Wall Street is closed outside market hours. Solana is not, so every price here carries its source and age.
          </p>
        </div>
        {balance ? (
          <p data-slot="points-balance" className="flex shrink-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[0.9375rem] text-muted-foreground max-md:-mt-3">
            <span>{balance.label}</span>
            <b className="text-[1.375rem] leading-none font-semibold text-foreground tabular-nums font-stretch-[85%]">{balance.value}</b>
            <span className="text-[0.84375rem]">{balance.hint}</span>
          </p>
        ) : null}
      </div>

      {q.loading ? (
        <section role="status" aria-busy aria-label="Loading predictions">
          <div className="pb-3.5">
            <Skeleton className="h-[1.875rem] w-40 sm:h-9" />
          </div>
          <ol className="border-b border-rule">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="border-t border-rule-2">
                <MarketCardSkeleton />
              </li>
            ))}
          </ol>
        </section>
      ) : q.error ? (
        <ErrorState title="Couldn't load predictions" message={q.error} onRetry={q.refetch} />
      ) : markets.length === 0 ? (
        <EmptyState
          icon={<TargetIcon aria-hidden />}
          title="No predictions this week yet."
          description={`${NEXT_WEEK_MARKETS_COPY} Until then, quests are where the points are.`}
          action={
            <Link href="/quests" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              See quests
              <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Link>
          }
        />
      ) : (
        <>
          {!signedIn ? <SignInBanner title="Sign in to make a prediction." hint="Sign in free and start with 1,000 starter points." /> : null}

          <section aria-labelledby="predictions-live">
            <SectionHead id="predictions-live" title={finalWeek ? finalWeek.label : liveWeekHeading(segments[0].settleAt, nowMs)}>
              {/* A phone keeps the points beside the heading: the count is in every kicker ("1 of 3"). The page clock carries the settle time. */}
              <span className={cn(pooled > 0 && "max-sm:hidden")}>
                {segments.length} {segments.length === 1 ? "prediction" : "predictions"}
                {pooled > 0 ? " · " : ""}
              </span>
              {pooled > 0 ? `${formatPoints(pooled)} points in, incl. bot seed` : ""}
            </SectionHead>
            <ol className="border-b border-rule animate-in duration-500 fade-in-0 motion-reduce:animate-none">
              {segments.map((m, i) => (
                <li key={m.id} className="border-t border-rule-2">
                  <MarketCard
                    market={m}
                    positions={byMarket.get(m.id) ?? NO_POSITIONS}
                    nowMs={nowMs}
                    signedIn={signedIn}
                    onPlace={onPlace}
                    showClock={m.locksAt !== pageLock}
                    index={i}
                    total={segments.length}
                  />
                </li>
              ))}
            </ol>
            <p className="mt-5 flex items-center justify-center gap-3 text-center text-[0.875rem] text-pretty text-muted-foreground">
              <span className="hidden h-px w-10 bg-rule-2 sm:block" aria-hidden />
              {footer}
              <span className="hidden h-px w-10 bg-rule-2 sm:block" aria-hidden />
            </p>
          </section>

          {resultWeeks.length > 0 ? (
            <section aria-labelledby="predictions-results">
              <SectionHead id="predictions-results" title={finalWeek ? "Earlier results" : "Results"}>
                Settled on the Friday close, with the source on every line.
              </SectionHead>
              <ResultsList weeks={resultWeeks} positions={byMarket} />
            </section>
          ) : null}
        </>
      )}

      <PlaceCallDialog
        market={placingMarket}
        positions={placingMarket ? byMarket.get(placingMarket.id) ?? NO_POSITIONS : NO_POSITIONS}
        spendablePoints={me?.spendablePoints ?? 0}
        initialSide={placing?.side}
        open={dialogOpen && placingMarket !== null}
        onOpenChange={setDialogOpen}
        onPlaced={onPlaced}
      />
    </div>
  );
}
