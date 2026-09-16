"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { ArrowRightIcon, TargetIcon } from "lucide-react";
import {
  api,
  type CallMarketView,
  type CallPositionView,
  type CallSide,
  type CallsResponse,
  type PlaceCallResponse,
} from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/PageHeader";
import { StatStrip, type Stat } from "@/components/common/StatStrip";
import { SignInBanner } from "@/components/common/SignInBanner";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { SeasonBadge, SeasonBadgeSkeleton } from "@/components/common/SeasonBadge";
import { MarketSessionChip } from "@/components/common/MarketSessionChip";
import { useApiQuery } from "@/components/common/useApiQuery";
import { formatPoints } from "@/components/common/format";
import { useSession } from "@/hooks/useSession";
import { starterPointsHint } from "@/hooks/session-helpers";
import { PREDICTION_LOSS_COPY } from "@/lib/games/ledger-policy";
import { useSignInIntent } from "@/hooks/useSignInIntent";
import { MarketCard, MarketCardSkeleton } from "@/components/calls/MarketCard";
import { PlaceCallDialog } from "@/components/calls/PlaceCallDialog";
import { CALLS_LOCK_COPY, NEXT_WEEK_MARKETS_COPY, STAKE_LEAVES_SCORE_COPY, formatCountdown, liveStatus, soonestLockMs } from "@/components/calls/calls-format";

const GRID = "grid gap-5 md:grid-cols-2 xl:grid-cols-3";
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
    <li>Each prediction asks whether an xStock closes above its strike on Friday. Pick Yes or No and put in points from your balance; your starter points count.</li>
    <li>
      Correct picks share the pool: everyone on the right side gets their own points back plus a share of the points from the other side, in proportion to what they put in. Dulo takes no cut.
      The multiplier on each button is how many points back one point gets at the current split; it moves until the lock.
    </li>
    <li>{CALLS_LOCK_COPY} If nobody took the other side, or no price is available within 24 hours, points are refunded.</li>
    <li>Settlement uses the Friday close price. The source and time are printed on each settled card.</li>
    <li>Points only, no cash value: they cannot be withdrawn or exchanged. {STAKE_LEAVES_SCORE_COPY}</li>
    <li>{PREDICTION_LOSS_COPY}</li>
    <li>House bots put points into every question so the split is never empty. They never get starter or quest points and never appear on the Season leaderboard.</li>
    <li>{NEXT_WEEK_MARKETS_COPY}</li>
  </ul>
);

export default function CallsPage() {
  const { session, user } = useSession();
  const starterPoints = user?.points?.starterPoints ?? 0;
  // Keyed on the session: signing in anywhere (header, banner, a side button) re-reads the board.
  const q = useApiQuery((signal) => api.calls({ signal }), session?.userId ?? "");
  const { refetch } = q;

  // One ticking clock for every countdown; the server's `now` anchors it against clock skew.
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const skew = React.useRef(0);
  React.useEffect(() => {
    if (q.data?.now) skew.current = Date.parse(q.data.now) - Date.now();
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

  const openCount = markets.filter((m) => liveStatus(m, nowMs) === "open").length;
  // Every market settled or void: the cron opens next week's three on the first tick after
  // Friday's settle (as soon as a strike quote is available).
  const allDone = markets.length > 0 && markets.every((m) => liveStatus(m, nowMs) === "settled" || liveStatus(m, nowMs) === "void");
  const footer = allDone
    ? NEXT_WEEK_MARKETS_COPY
    : openCount === 0
      ? "Every prediction is locked; points land in your balance after the close."
      : CALLS_LOCK_COPY;

  const inPlay = markets.reduce((sum, m) => {
    const s = liveStatus(m, nowMs);
    return s === "open" || s === "locked" ? sum + m.odds.total : sum;
  }, 0);
  const lockMs = soonestLockMs(markets, nowMs);

  const stats: Stat[] | null = q.data
    ? [
        { label: "Open predictions", value: openCount },
        { label: "Points in the pools", value: formatPoints(inPlay), tone: "ember", hint: "Includes house-bot seed points" },
        { label: "Locks in", value: lockMs === null ? "—" : formatCountdown(lockMs), hint: lockMs === null ? (allDone ? "All settled" : "All locked") : "Soonest prediction" },
        ...(me
          ? [
              {
                label: "Your points balance",
                value: formatPoints(me.spendablePoints),
                hint: starterPointsHint(starterPoints, me.spendablePoints),
              } satisfies Stat,
            ]
          : []),
      ]
    : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        className="mb-0"
        eyebrow="Season 0"
        title="Predictions"
        description="Yes or No on Friday's close, for points. Correct picks share the points from the other side."
        actions={q.data ? <SeasonBadge season={q.data.season} className="hidden sm:inline-flex" /> : q.loading ? <SeasonBadgeSkeleton className="hidden sm:block" /> : null}
        stats={
          stats ? (
            <StatStrip stats={stats} className="[&>div:nth-child(3):last-child]:col-span-2 md:[&>div:nth-child(3):last-child]:col-span-1" />
          ) : q.loading ? (
            <Skeleton className="h-[74px] w-full rounded-2xl sm:h-[82px]" aria-hidden />
          ) : null
        }
        details={DETAILS}
      />

      {/* The session chip says whether the US market is open; the line says why that is fine. */}
      <div className="-mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <MarketSessionChip />
        <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
          Wall Street is closed outside market hours. Solana is not, so every price on these cards carries its source and age.
        </p>
      </div>

      {q.loading ? (
        <div role="status" className={GRID} aria-busy aria-label="Loading predictions">
          {Array.from({ length: 3 }).map((_, i) => (
            <MarketCardSkeleton key={i} />
          ))}
        </div>
      ) : q.error ? (
        <ErrorState title="Couldn't load predictions" message={q.error} onRetry={q.refetch} />
      ) : markets.length === 0 ? (
        <EmptyState
          icon={<TargetIcon aria-hidden />}
          className="rounded-2xl border-white/[0.08] bg-card py-14"
          title="No predictions this week yet."
          description={`${NEXT_WEEK_MARKETS_COPY} Until then, quests are where the points are.`}
          action={
            <Link href="/quests" className={buttonVariants({ size: "lg", className: "h-10" })}>
              See quests
              <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Link>
          }
        />
      ) : (
        <>
          {!signedIn ? <SignInBanner title="Sign in to make a prediction." hint="Sign in free and start with 1,000 starter points." /> : null}

          <ul className={cn(GRID, "animate-in duration-500 fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none")}>
            {markets.map((m) => (
              <li key={m.id} className="min-w-0">
                <MarketCard market={m} positions={byMarket.get(m.id) ?? NO_POSITIONS} nowMs={nowMs} signedIn={signedIn} onPlace={onPlace} />
              </li>
            ))}
          </ul>

          <p className="-mt-2 flex items-center justify-center gap-3 text-center text-sm text-muted-foreground"><span className="hidden h-px w-10 bg-gradient-to-r from-transparent to-white/15 sm:block" aria-hidden />{footer}<span className="hidden h-px w-10 bg-gradient-to-l from-transparent to-white/15 sm:block" aria-hidden /></p>
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
