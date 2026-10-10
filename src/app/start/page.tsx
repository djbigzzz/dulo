"use client";

import * as React from "react";
import Link from "next/link";
import { Share2Icon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { api, apiGet, errorMessage, type CallMarketView, type CallPositionView, type CallSide, type PlaysResponse } from "@/lib/api-client";
import { APP_URL } from "@/lib/config";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/ErrorState";
import { useApiQuery } from "@/components/common/useApiQuery";
import { useCallsQuery, useLeagueQuery } from "@/components/layout/WeekData";
import { useSession } from "@/hooks/useSession";
import { useSignInIntent } from "@/hooks/useSignInIntent";
import { MarketCard, MarketCardSkeleton } from "@/components/calls/MarketCard";
import { PlaceCallDialog } from "@/components/calls/PlaceCallDialog";
import { CALLS_LOCK_COPY, liveStatus } from "@/components/calls/calls-format";
import { TradeForm, TradeFormSkeleton } from "@/components/league/TradeForm";
import { ScoutChip } from "@/components/league/ScoutChip";
import { findScoutPlay, scoutProgress } from "@/components/league/scout";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { START_PATH, competitionLineParts, rankShareOnXUrl, shareOnXUrl } from "@/components/start/share";
import { TourProgress, TourStep } from "@/components/start/TourStep";
import { BoardStepBody, LinkArrow, QuestsStepBody, StepColumns, TOUR_LINK, TOUR_NOTE, TourFinish } from "@/components/start/TourBodies";
import {
  TOUR_COPY,
  TOUR_HREFS,
  TOUR_LATE_REFETCH_MS,
  TOUR_QUICK_BUY_USD,
  TOUR_STEP_TEASER,
  TOUR_STEP_TITLE,
  TOUR_TRADE_SOURCES,
  boardLine,
  boardSummary,
  completeLine,
  competeUnavailableLine,
  completedQuests,
  deriveTour,
  findFirstHoldingQuest,
  findFirstPredictionQuest,
  latestPick,
  nextUpLine,
  nextUpQuests,
  openStepKey,
  predictionSummary,
  questsSummary,
  showFinish,
  shownStepState,
  tourHeading,
  tradesSummary,
  walletLine,
  walkReveal,
  walletReadState,
  type TourOverride,
  type TourReveal,
  type TourStepKey,
  type TourStepState,
} from "@/components/start/tour";

const NO_POSITIONS: CallPositionView[] = [];

/** Step 2's trade slip sits on one ruled panel, as the competition's paper-trade panel (nothing boxed inside it). */
const STAGE_PANEL = "rounded-md bg-card p-5 ring-1 ring-rule sm:p-6";
/**
 * Step 1's prediction on a rule, as /predictions lists its segments: the segment has no box of its
 * own and lays itself out by its width (the question, the price track against the line, the split).
 */
const SEGMENT = "border-t border-rule";
/** An invitation or a seat that waits: the dashed outline of the competition's "Your slot". */
const OPEN_SEAT = "border border-dashed border-[rgb(243_240_232/0.38)] px-5 py-5";

/**
 * /start: the entry for shared links, and a four-step tour of Dulo (8 Oct 2026). Step 1 is this
 * week's featured prediction (sign-in on the button press, the same PlaceCallDialog as
 * /predictions); step 2 is three paper trades with virtual cash in the competition's own form;
 * steps 3 and 4 reveal the quests and the Season leaderboard. Every tick comes from server data;
 * nothing is saved in the browser, and every step links to the real page.
 */
export default function StartPage() {
  const { session, user, refresh: refreshSession } = useSession();
  const sessionKey = session?.userId ?? "";
  // The shell's shared reads (WeekData): the week track under the header reads the same two requests.
  const q = useCallsQuery(sessionKey);
  const lq = useLeagueQuery(["start:league", sessionKey]);
  const plays = useApiQuery<PlaysResponse | null>(
    (signal) => (sessionKey ? apiGet<PlaysResponse>("/api/v1/plays", { signal }) : Promise.resolve(null)),
    ["start:plays", sessionKey],
    { refetchOnFocus: false },
  );
  const compLine = competitionLineParts(lq.data?.league ?? null);
  const { refetch } = q;
  const refetchLeague = lq.refetch;
  const refetchPlays = plays.refetch;
  const nowMs = Date.now();

  const markets = React.useMemo(() => q.data?.markets ?? [], [q.data?.markets]);
  const featured: CallMarketView | null = markets.find((m) => liveStatus(m, nowMs) === "open") ?? null;
  const me = q.data?.me ?? null;
  // /calls decides once it has answered; until then (or if it fails) the session does, so a
  // signed-in player never sees the signed-out tour while /calls loads.
  const signedIn = q.data ? me !== null : session !== null;
  const allPositions = me?.positions ?? NO_POSITIONS;
  const positions = featured ? allPositions.filter((p) => p.marketId === featured.id) : NO_POSITIONS;
  const featuredUnanswered = signedIn && featured !== null && positions.length === 0;

  const playsData = signedIn ? plays.data : null;
  const league = lq.data?.league ?? null;
  const leagueMe = lq.data?.me ?? null;

  const tour = deriveTour({
    signedIn,
    // Until each board has loaded, its step reads as open (a skeleton), never as "not open right now".
    predictionOpen: q.data ? featured !== null : true,
    positions: allPositions,
    plays: playsData,
    league: lq.data ? league : { open: true },
    leagueMe,
    points: user?.points,
  });

  // The walk through steps 3 and 4, and any step the player opened or closed by hand. React state only.
  const [reveal, setReveal] = React.useState<TourReveal>(null);
  const [override, setOverride] = React.useState<TourOverride | null>(null);

  // Start the walk when the two actions become done. A player who arrives (or signs in, or switches
  // account) with both already done is not walked: they see the finish card. The baseline is read
  // off fresh data only and belongs to one account; the walk itself is decided during render
  // (walkReveal), so the finish card never flashes while the second board is still refetching.
  const ready = Boolean(q.data && !q.refreshing && lq.data && !lq.refreshing && (!signedIn || (plays.data && !plays.refreshing)));
  const walkBase = React.useRef<{ session: string; actions: boolean | null }>({ session: sessionKey, actions: null });
  const actionsBefore = walkBase.current.session === sessionKey ? walkBase.current.actions : null;
  const shownReveal = walkReveal(tour, reveal, actionsBefore);
  React.useEffect(() => {
    if (walkBase.current.session !== sessionKey) {
      // Another account (or a sign-out): this render still shows the previous account's data.
      walkBase.current = { session: sessionKey, actions: null };
      setReveal(null);
      return;
    }
    if (!signedIn) {
      walkBase.current.actions = null;
      setReveal(null);
      return;
    }
    if (!ready) return;
    const prev = walkBase.current.actions;
    walkBase.current.actions = tour.actionsDone;
    if (prev === false && tour.actionsDone) setReveal((r) => r ?? "quests");
  }, [sessionKey, signedIn, ready, tour.actionsDone]);

  const currentKey = tour.current;
  React.useEffect(() => setOverride(null), [currentKey, shownReveal, sessionKey]);
  const openKey = openStepKey(tour, shownReveal, featuredUnanswered, override);
  const toggle = (key: TourStepKey) => setOverride({ key: openKey === key ? null : key });
  const finished = showFinish(tour, shownReveal);

  // One delayed re-read after each action and after sign-in: the inline quest checks (2 s for a
  // prediction, 2.5 s for a trade) and the sign-in wallet read can land a moment later.
  const lateTimer = React.useRef<number | undefined>(undefined);
  const refetchLate = React.useCallback(() => {
    window.clearTimeout(lateTimer.current);
    lateTimer.current = window.setTimeout(() => {
      refetchPlays();
      void refreshSession().catch(() => undefined);
    }, TOUR_LATE_REFETCH_MS);
  }, [refetchPlays, refreshSession]);
  React.useEffect(() => () => window.clearTimeout(lateTimer.current), []);

  const prevSignedIn = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    if (!q.data) return;
    const prev = prevSignedIn.current;
    prevSignedIn.current = signedIn;
    if (prev === false && signedIn) refetchLate();
  }, [q.data, signedIn, refetchLate]);

  const [side, setSide] = React.useState<CallSide | undefined>(undefined);
  const [open, setOpen] = React.useState(false);
  const { pending, start: startSignIn, clear } = useSignInIntent<CallSide>(refetch);

  const onPlace = React.useCallback(
    (_market: CallMarketView, s: CallSide) => {
      setSide(s);
      if (signedIn) setOpen(true);
      else startSignIn(s);
    },
    [signedIn, startSignIn],
  );

  React.useEffect(() => {
    if (!signedIn || !pending) return;
    setSide(pending);
    setOpen(true);
    clear();
  }, [signedIn, pending, clear]);

  // The dialog toasts the prediction and any quest it completed, and refreshes the session itself.
  const onPlaced = React.useCallback(() => {
    refetch();
    refetchPlays();
    refetchLate();
  }, [refetch, refetchPlays, refetchLate]);

  // TradeForm toasts the fill and any quest it completed.
  const onTraded = React.useCallback(() => {
    refetchLeague();
    refetchPlays();
    void refreshSession().catch(() => undefined);
    refetchLate();
  }, [refetchLeague, refetchPlays, refreshSession, refetchLate]);

  const [reading, setReading] = React.useState(false);
  const readWallet = React.useCallback(async () => {
    if (reading) return;
    setReading(true);
    try {
      await api.refreshPlays();
      refetchPlays();
      void refreshSession().catch(() => undefined);
    } catch (e) {
      toast.error(TOUR_COPY.questsReadError, { description: errorMessage(e) });
    } finally {
      setReading(false);
    }
  }, [reading, refetchPlays, refreshSession]);

  // On a phone the step that opens on its own (after a prediction, the third trade, a Next) can sit
  // below the fold: bring it, or the finish card, into view. Only between two reads of fresh data
  // while signed in, so never on first load, on sign-in or for a step opened by hand.
  const autoTarget = finished ? "finish" : override ? null : openKey;
  const lastTarget = React.useRef<{ session: string; target: string | null | undefined }>({ session: sessionKey, target: undefined });
  React.useEffect(() => {
    if (!signedIn || lastTarget.current.session !== sessionKey) {
      // Signed out, or another account: this render still shows the previous account's data.
      lastTarget.current = { session: sessionKey, target: undefined };
      return;
    }
    if (!ready) return;
    const prev = lastTarget.current.target;
    lastTarget.current.target = autoTarget;
    if (prev === undefined || prev === autoTarget || autoTarget === null) return;
    const el = document.querySelector<HTMLElement>(autoTarget === "finish" ? '[data-slot="tour-finish"]' : `[data-slot="tour-step"][data-step="${autoTarget}"]`);
    if (!el) return;
    // The control the player just used has folded away with its step: move focus to what opened
    // (its step header, or the finish heading) so keyboard and screen-reader users keep their place.
    const active = document.activeElement;
    if (!active || active === document.body) {
      const focusTo = autoTarget === "finish" ? el.querySelector<HTMLElement>("#tour-finish-title") : el.querySelector<HTMLElement>("h2 > button");
      focusTo?.focus({ preventScroll: true });
    }
    const top = el.getBoundingClientRect().top;
    if (top >= 64 && top < window.innerHeight * 0.6) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [sessionKey, signedIn, ready, autoTarget]);

  // Derived lines, all from the same server data.
  const firstPrediction = findFirstPredictionQuest(playsData);
  const scout = findScoutPlay(playsData);
  const holding = findFirstHoldingQuest(playsData);
  const walletState = walletReadState(holding);
  const complete = completedQuests(playsData);
  const pick = latestPick(allPositions, markets);
  const shareUrl = pick ? shareOnXUrl(pick, `${APP_URL}${START_PATH}`) : null;
  const rankShareUrl =
    leagueMe && !leagueMe.isBot && leagueMe.rank !== null ? rankShareOnXUrl(leagueMe.rank, leagueMe.pnlPct, `${APP_URL}${START_PATH}`) : null;

  const shareLink = shareUrl ? (
    <a href={shareUrl} target="_blank" rel="noopener noreferrer" className={TOUR_LINK}>
      <Share2Icon className="size-3.5" aria-hidden />
      {TOUR_COPY.predictShare}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : null;

  const summaryFor = (key: TourStepKey, state: TourStepState): React.ReactNode => {
    if (state === "unavailable") return key === "predict" ? TOUR_COPY.predictLocked : key === "compete" ? competeUnavailableLine(league) : null;
    // After the walk, a folded step 3 says where the wallet stands even before Solana has been read.
    if (key === "quests" && tour.actionsDone && playsData) return questsSummary(complete.length, walletState);
    if (state !== "done") return TOUR_STEP_TEASER[key];
    switch (key) {
      case "predict": {
        const line = predictionSummary(pick, firstPrediction);
        if (!line) return null;
        return (
          <span className="flex flex-col items-start gap-3.5">
            <span>{line}</span>
            {shareLink}
          </span>
        );
      }
      case "compete":
        return tradesSummary(leagueMe, scout);
      case "quests":
        return questsSummary(complete.length, walletState);
      case "board":
        return boardSummary(user?.points);
    }
  };

  const predictBody = (state: TourStepState): React.ReactNode => {
    if (q.loading) {
      return (
        <StepColumns
          layout="full"
          notes={
            <div className="flex flex-col gap-2.5 pt-1" aria-hidden>
              <Skeleton className="h-4 w-full max-w-sm" />
              <Skeleton className="h-4 w-2/3 max-w-60" />
            </div>
          }
          stage={
            <div className={SEGMENT}>
              <MarketCardSkeleton />
            </div>
          }
        />
      );
    }
    // A failed background refetch keeps the data on screen; the error shows only when there is none.
    if (q.error && !q.data) {
      return <StepColumns notes={<ErrorState title={TOUR_COPY.predictLoadError} message={q.error} onRetry={refetch} className="py-8 sm:py-10" />} />;
    }
    if (state === "unavailable" || (state !== "done" && !featured)) {
      return (
        <StepColumns
          notes={<p className={TOUR_NOTE}>{TOUR_COPY.predictLocked}</p>}
          stage={
            signedIn ? null : (
              // An open seat, as the competition's "Your slot": the dashed invitation with Connect.
              <div className={cn(OPEN_SEAT, "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6")}>
                <p className="text-base leading-snug font-semibold text-pretty text-foreground">{TOUR_COPY.predictLockedSignIn}</p>
                <ConnectButton size="lg" className="shrink-0" />
              </div>
            )
          }
          actions={
            signedIn ? null : (
              <Link href={TOUR_HREFS.competition} className={TOUR_LINK}>
                {TOUR_COPY.predictLockedCompetition}
                <LinkArrow />
              </Link>
            )
          }
        />
      );
    }
    const segment = featured ? (
      <div className={SEGMENT}>
        <MarketCard market={featured} positions={positions} nowMs={nowMs} signedIn={signedIn} onPlace={onPlace} />
      </div>
    ) : null;
    if (state === "done") {
      return (
        <StepColumns
          layout="full"
          stage={segment}
          actions={
            <>
              {shareLink}
              <Link href={TOUR_HREFS.predictions} className={TOUR_LINK}>
                {TOUR_COPY.predictMore}
                <LinkArrow />
              </Link>
            </>
          }
        />
      );
    }
    return <StepColumns layout="full" notes={<p className={TOUR_NOTE}>{TOUR_COPY.predictBody}</p>} stage={segment} />;
  };

  const competeBody = (): React.ReactNode => {
    const formOpen = Boolean(lq.data?.league?.open);
    return (
      <StepColumns
        notes={
          <>
            <p className={TOUR_NOTE}>{TOUR_COPY.competeBody}</p>
            <ScoutChip progress={scoutProgress(scout, leagueMe?.trades.length ?? 0)} className="self-start" />
            {formOpen ? <p className="max-w-[34rem] text-sm leading-[1.45] text-pretty text-muted-foreground">{TOUR_COPY.competeHint}</p> : null}
          </>
        }
        stage={
          lq.loading ? (
            <div className={STAGE_PANEL}>
              <TradeFormSkeleton />
            </div>
          ) : lq.error && !lq.data ? (
            <ErrorState title={TOUR_COPY.competeLoadError} message={lq.error} onRetry={refetchLeague} className="py-8 sm:py-10" />
          ) : lq.data && formOpen ? (
            <div className={STAGE_PANEL}>
              <TradeForm
                league={lq.data.league}
                signedIn={lq.data.signedIn}
                serverNow={lq.data.now}
                refreshKey={`${sessionKey}:${lq.data.now}`}
                onPlaced={onTraded}
                sources={TOUR_TRADE_SOURCES}
                quickBuyUsd={TOUR_QUICK_BUY_USD}
              />
            </div>
          ) : (
            // The seat waits for the next week: a dashed open seat, never a closed box.
            <p className={cn(OPEN_SEAT, "text-base leading-snug font-semibold text-pretty text-foreground")}>{competeUnavailableLine(league)}</p>
          )
        }
        actions={
          <Link href={TOUR_HREFS.competition} className={TOUR_LINK}>
            {TOUR_COPY.competeLink}
            <LinkArrow />
          </Link>
        }
      />
    );
  };

  const bodyFor = (key: TourStepKey, state: TourStepState): React.ReactNode => {
    switch (key) {
      case "predict":
        return predictBody(state);
      case "compete":
        return competeBody();
      case "quests":
        return (
          <QuestsStepBody
            completeLine={completeLine(complete)}
            nextUpLine={nextUpLine(nextUpQuests(playsData, 3))}
            walletLine={walletLine(holding, walletState, user?.wallets.length ?? 1, nowMs)}
            showReadNow={walletState === "unread"}
            reading={reading}
            onReadNow={() => void readWallet()}
            onNext={tour.actionsDone ? () => setReveal("board") : null}
            loading={plays.loading}
            error={plays.data ? null : plays.error}
            onRetry={refetchPlays}
          />
        );
      case "board":
        return <BoardStepBody line={boardLine(user?.points)} onFinish={tour.actionsDone ? () => setReveal("end") : null} />;
    }
  };

  return (
    <div className="flex w-full flex-col">
      {/*
        The show's opening: what is on this week, then the running order at a glance. PageHeader's
        measures (the title lands where every page's does); its rule is the running order's top rule.
      */}
      <header className="flex flex-col gap-6 border-b border-rule-2 pt-2 pb-6 lg:flex-row lg:items-end lg:justify-between lg:gap-16 lg:pb-7">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-sm font-medium text-muted-foreground">{TOUR_COPY.eyebrow}</p>
          <h1 className="font-display text-[2.25rem] leading-none font-normal tracking-[-0.012em] text-balance text-foreground sm:text-5xl lg:text-[3.625rem]">
            {tourHeading(tour, finished)}
          </h1>
          {compLine ? (
            // A status line, as the market-session line reads; the dot is the live part.
            <Link
              href="/competition"
              className="inline-flex max-w-xl items-start gap-2.5 self-start text-base leading-[1.45] text-pretty text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
            >
              {compLine.live ? <span className="mt-[0.59375rem] size-1.5 shrink-0 rounded-full bg-foreground" aria-hidden /> : null}
              <span>
                {compLine.before}
                <span className="font-semibold whitespace-nowrap text-foreground">{compLine.countdown}</span>
                {compLine.after} <LinkArrow />
              </span>
            </Link>
          ) : lq.loading ? (
            // The status line's place while the competition loads (two lines on a phone), so the running order never moves.
            <span aria-hidden className="flex flex-col gap-2 py-[0.1875rem]">
              <Skeleton className="h-[1.0625rem] w-full max-w-[26rem]" />
              <Skeleton className="h-[1.0625rem] w-1/3 sm:hidden" />
            </span>
          ) : null}
        </div>
        <TourProgress
          steps={tour.steps.map((s) => ({ key: s.key, state: shownStepState(s.state, finished) }))}
          done={tour.done}
          signedIn={signedIn}
          className="lg:w-[26rem] lg:shrink-0"
        />
      </header>

      <ol aria-label={TOUR_COPY.listLabel} className="border-b border-rule">
        {tour.steps.map((step, i) => {
          const isOpen = openKey === step.key;
          const state = shownStepState(step.state, finished);
          return (
            <TourStep
              key={step.key}
              index={i + 1}
              stepKey={step.key}
              title={TOUR_STEP_TITLE[step.key]}
              state={state}
              open={isOpen}
              summary={summaryFor(step.key, state)}
              onToggle={signedIn ? () => toggle(step.key) : null}
            >
              {isOpen ? bodyFor(step.key, state) : null}
            </TourStep>
          );
        })}
      </ol>

      {finished ? (
        <div className="mt-8 lg:mt-10">
          <TourFinish rankShareUrl={rankShareUrl} />
        </div>
      ) : null}

      <p className="mt-6 max-w-2xl text-[0.8125rem] leading-[1.45] text-pretty text-muted-foreground lg:mt-7">
        {CALLS_LOCK_COPY} Points only, no cash value.
      </p>

      <PlaceCallDialog
        market={featured}
        positions={positions}
        spendablePoints={me?.spendablePoints ?? 0}
        initialSide={side}
        open={open && featured !== null}
        onOpenChange={setOpen}
        onPlaced={onPlaced}
      />
    </div>
  );
}
