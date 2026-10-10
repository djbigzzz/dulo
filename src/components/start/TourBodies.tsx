"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Loader2Icon, RefreshCw, Share2Icon } from "lucide-react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/ErrorState";
import { TOUR_COPY, TOUR_HREFS } from "@/components/start/tour";

/**
 * The text link every step ends with: cream on a 1px rule, as the mockup's "Leaderboard →". The
 * pseudo-element widens the hit area to 40px on a phone without moving the rule off the text.
 */
export const TOUR_LINK =
  "relative inline-flex items-center gap-1.5 self-start pb-[3px] text-[0.9375rem] leading-tight font-semibold text-foreground bg-[linear-gradient(var(--rule-2),var(--rule-2))] bg-[length:100%_1px] bg-bottom bg-no-repeat outline-none transition-[background-image,color] after:absolute after:-inset-x-1 after:-inset-y-2.5 hover:bg-[linear-gradient(var(--color-foreground),var(--color-foreground))] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-4 focus-visible:ring-offset-background motion-reduce:transition-none";

/** The arrow after a link that goes to another page (never after a share link). */
export function LinkArrow() {
  return (
    <span aria-hidden className="text-muted-foreground">
      →
    </span>
  );
}

/** The quiet paragraph that opens a step's notes. */
export const TOUR_NOTE = "max-w-[34rem] text-base leading-[1.5] text-pretty text-muted-foreground";

/** A step's buttons and links: stacked on a phone (buttons full width), one row from sm. */
const ACTIONS = "flex flex-col items-stretch gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7 sm:gap-y-4";

export interface StepColumnsProps {
  /** The words: what the step is, a quest chip, a hint. */
  notes?: ReactNode;
  /** The live part of the step: the prediction segment, the trade slip, the quest readout. */
  stage?: ReactNode;
  /** The step's buttons and links, under the notes. */
  actions?: ReactNode;
  /**
   * "split" (default): the notes on the left and the live part in a 31rem column on the right from lg.
   * "full": the live part takes the step's whole width under the notes, as this week's prediction
   * does (the segment lays itself out by its own width, the price track against the line).
   */
  layout?: "split" | "full";
  className?: string;
}

/**
 * A step's body as a running-order sheet sets it: the notes on the left and the live part on the
 * right from lg, both under the segment's title; one column on a phone (notes, the live part, then
 * the links). Without a stage it is one readable column.
 */
export function StepColumns({ notes, stage, actions, layout = "split", className }: StepColumnsProps) {
  if (!stage || layout === "full") {
    return (
      <div className={cn("flex min-w-0 flex-col gap-5", !stage && "max-w-[40rem]", className)}>
        {notes ? <div className="flex max-w-[40rem] min-w-0 flex-col gap-4">{notes}</div> : null}
        {stage ? <div className="min-w-0">{stage}</div> : null}
        {actions ? <div className={ACTIONS}>{actions}</div> : null}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,31rem)] lg:grid-rows-[auto_1fr] lg:gap-x-14 lg:gap-y-6 xl:gap-x-20",
        className,
      )}
    >
      {notes ? <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1">{notes}</div> : null}
      {/* Under lg the live part keeps a card's width rather than stretching across a tablet. */}
      <div className="min-w-0 max-lg:max-w-[34rem] lg:col-start-2 lg:row-span-2 lg:row-start-1">{stage}</div>
      {actions ? <div className={cn(ACTIONS, "lg:col-start-1 lg:row-start-2 lg:self-start")}>{actions}</div> : null}
    </div>
  );
}

export interface QuestsStepBodyProps {
  completeLine: string;
  nextUpLine: string | null;
  walletLine: string | null;
  /** Only while the wallet has not been read yet. */
  showReadNow: boolean;
  reading: boolean;
  onReadNow: () => void;
  /** Set on the walk: "Next: the leaderboard". */
  onNext: (() => void) | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

/** Step 3: what is complete, what is next, and what Solana last said about the wallet, on rules. */
export function QuestsStepBody({ completeLine, nextUpLine, walletLine, showReadNow, reading, onReadNow, onNext, loading, error, onRetry }: QuestsStepBodyProps) {
  const readout = loading ? (
    <div className="flex flex-col border-t border-rule" aria-hidden>
      {["w-4/5", "w-3/5", "w-full"].map((w) => (
        <div key={w} className="border-b border-rule py-4">
          <Skeleton className={cn("h-4", w)} />
        </div>
      ))}
    </div>
  ) : error ? (
    <ErrorState title={TOUR_COPY.questsLoadError} message={error} onRetry={onRetry} className="py-8 sm:py-10" />
  ) : (
    <ul data-slot="tour-quests" className="flex flex-col border-t border-rule text-[0.9375rem] leading-[1.45] text-pretty">
      <li className="border-b border-rule py-3.5 font-semibold text-foreground">{completeLine}</li>
      {nextUpLine ? <li className="border-b border-rule py-3.5 text-muted-foreground">{nextUpLine}</li> : null}
      {walletLine ? (
        <li data-slot="tour-wallet-line" className="border-b border-rule py-3.5 text-muted-foreground">
          {walletLine}
        </li>
      ) : null}
    </ul>
  );

  return (
    <StepColumns
      notes={<p className={TOUR_NOTE}>{TOUR_COPY.questsBody}</p>}
      stage={
        <div className="flex flex-col gap-4">
          {readout}
          {showReadNow ? (
            <Button variant="outline" size="lg" className="sm:self-start" onClick={onReadNow} disabled={reading}>
              {reading ? (
                <Loader2Icon className="animate-spin motion-reduce:animate-none" data-icon="inline-start" aria-hidden />
              ) : (
                <RefreshCw data-icon="inline-start" aria-hidden />
              )}
              {reading ? TOUR_COPY.questsReading : TOUR_COPY.questsReadNow}
            </Button>
          ) : null}
        </div>
      }
      actions={
        <>
          {onNext ? (
            <Button size="lg" onClick={onNext}>
              {TOUR_COPY.questsNext}
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Button>
          ) : null}
          <Link href={TOUR_HREFS.quests} className={TOUR_LINK}>
            {TOUR_COPY.questsAll}
            <LinkArrow />
          </Link>
        </>
      }
    />
  );
}

export interface BoardStepBodyProps {
  /** "You: 175 Season points · Rank #1"; null when the server sent no points. */
  line: string | null;
  /** Set on the walk: "Finish the tour". */
  onFinish: (() => void) | null;
}

/** Step 4: what Season points are and where the player stands. */
export function BoardStepBody({ line, onFinish }: BoardStepBodyProps) {
  return (
    <StepColumns
      notes={<p className={TOUR_NOTE}>{TOUR_COPY.boardBody}</p>}
      stage={
        line ? (
          <p className="border-y border-rule py-4 text-[1.375rem] leading-tight font-semibold text-pretty text-foreground tabular-nums font-stretch-[85%] lg:text-[1.625rem]">
            {line}
          </p>
        ) : null
      }
      actions={
        <>
          {onFinish ? (
            <Button size="lg" onClick={onFinish}>
              {TOUR_COPY.boardFinish}
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Button>
          ) : null}
          <Link href={TOUR_HREFS.leaderboard} className={TOUR_LINK}>
            {TOUR_COPY.boardOpen}
            <LinkArrow />
          </Link>
        </>
      }
    />
  );
}

/**
 * The end card after the running order: the one part of Dulo not seen yet (the copy tool, the
 * view's one gold action) beside the sign-off, then the games again along the card's foot. A single
 * ruled panel with nothing boxed inside it; the copy tool comes first in reading order.
 */
export function TourFinish({ rankShareUrl }: { rankShareUrl: string | null }) {
  return (
    <section
      data-slot="tour-finish"
      aria-labelledby="tour-finish-title"
      className="grid scroll-mt-20 grid-cols-1 gap-x-14 gap-y-7 rounded-md bg-card px-5 py-7 ring-1 ring-rule sm:px-8 sm:py-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,31rem)] lg:px-10 lg:pt-11 lg:pb-9 xl:gap-x-20"
    >
      <div className="flex flex-col gap-3">
        {/* tabIndex -1: the page moves focus here when the finish card opens on its own. */}
        <h2 id="tour-finish-title" tabIndex={-1} className="font-display text-[2.375rem] leading-[0.98] font-normal tracking-[-0.012em] text-balance text-foreground outline-none sm:text-[2.875rem]">
          {TOUR_COPY.finishTitle}
        </h2>
        <p className={TOUR_NOTE}>{TOUR_COPY.finishBody}</p>
      </div>
      <div className="flex flex-col gap-3 lg:pt-1">
        <Link href={TOUR_HREFS.copy} className={buttonVariants({ size: "xl", className: "w-full sm:w-auto sm:self-start" })}>
          {TOUR_COPY.finishCopy}
          <ArrowRight data-icon="inline-end" aria-hidden />
        </Link>
        <p className="max-w-[26rem] text-sm leading-[1.45] text-pretty text-muted-foreground">{TOUR_COPY.finishCopyBody}</p>
      </div>
      {/* The games again, along the foot of the card on a rule. */}
      <div className="flex flex-col items-start gap-5 border-t border-rule pt-6 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8 sm:gap-y-4 lg:col-span-2 lg:pt-7">
        <Link href={TOUR_HREFS.predictions} className={TOUR_LINK}>
          {TOUR_COPY.finishPredictions}
          <LinkArrow />
        </Link>
        <Link href={TOUR_HREFS.competition} className={TOUR_LINK}>
          {TOUR_COPY.finishCompetition}
          <LinkArrow />
        </Link>
        {rankShareUrl ? (
          <a href={rankShareUrl} target="_blank" rel="noopener noreferrer" className={cn(TOUR_LINK, "sm:ml-auto")}>
            <Share2Icon className="size-3.5" aria-hidden />
            {TOUR_COPY.finishRankShare}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    </section>
  );
}
