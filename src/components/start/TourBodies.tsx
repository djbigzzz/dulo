"use client";

import Link from "next/link";
import { ArrowRight, Loader2Icon, RefreshCw, Share2Icon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/ErrorState";
import { TOUR_COPY, TOUR_HREFS } from "@/components/start/tour";

/** The quiet text link every step ends with. */
export const TOUR_LINK =
  "inline-flex min-h-10 items-center text-sm text-muted-foreground underline decoration-white/20 underline-offset-4 transition-colors hover:text-foreground hover:decoration-ember sm:min-h-0";

/** The step's buttons and links: stacked full width on a phone, one row from sm. */
const ACTIONS = "flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4";

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

/** Step 3: what is complete, what is next, and what Solana last said about the wallet. */
export function QuestsStepBody({ completeLine, nextUpLine, walletLine, showReadNow, reading, onReadNow, onNext, loading, error, onRetry }: QuestsStepBodyProps) {
  return (
    <>
      <p className="text-sm text-pretty text-muted-foreground">{TOUR_COPY.questsBody}</p>
      {loading ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : error ? (
        <ErrorState title={TOUR_COPY.questsLoadError} message={error} onRetry={onRetry} className="rounded-xl border-white/[0.08] py-6" />
      ) : (
        <ul data-slot="tour-quests" className="flex flex-col gap-2 text-sm text-pretty">
          <li className="font-medium">{completeLine}</li>
          {nextUpLine ? <li className="text-muted-foreground">{nextUpLine}</li> : null}
          {walletLine ? (
            <li data-slot="tour-wallet-line" className="text-muted-foreground">
              {walletLine}
            </li>
          ) : null}
        </ul>
      )}
      {showReadNow ? (
        <Button variant="outline" size="lg" className="h-10 sm:self-start" onClick={onReadNow} disabled={reading}>
          {reading ? (
            <Loader2Icon className="animate-spin motion-reduce:animate-none" data-icon="inline-start" aria-hidden />
          ) : (
            <RefreshCw data-icon="inline-start" aria-hidden />
          )}
          {reading ? TOUR_COPY.questsReading : TOUR_COPY.questsReadNow}
        </Button>
      ) : null}
      <div className={ACTIONS}>
        {onNext ? (
          <Button size="lg" className="h-10" onClick={onNext}>
            {TOUR_COPY.questsNext}
            <ArrowRight data-icon="inline-end" aria-hidden />
          </Button>
        ) : null}
        <Link href={TOUR_HREFS.quests} className={TOUR_LINK}>
          {TOUR_COPY.questsAll}
        </Link>
      </div>
    </>
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
    <>
      <p className="text-sm text-pretty text-muted-foreground">{TOUR_COPY.boardBody}</p>
      {line ? <p className="font-semibold tabular-nums">{line}</p> : null}
      <div className={ACTIONS}>
        {onFinish ? (
          <Button size="lg" className="h-10" onClick={onFinish}>
            {TOUR_COPY.boardFinish}
            <ArrowRight data-icon="inline-end" aria-hidden />
          </Button>
        ) : null}
        <Link href={TOUR_HREFS.leaderboard} className={TOUR_LINK}>
          {TOUR_COPY.boardOpen}
        </Link>
      </div>
    </>
  );
}

/** The card after the walk: the one part of Dulo not seen yet, then the games again. */
export function TourFinish({ rankShareUrl }: { rankShareUrl: string | null }) {
  return (
    <section
      data-slot="tour-finish"
      aria-labelledby="tour-finish-title"
      className="flex scroll-mt-20 flex-col items-center gap-4 rounded-2xl border border-ember/30 bg-card p-5 text-center"
    >
      <div className="flex flex-col gap-2">
        {/* tabIndex -1: the page moves focus here when the finish card opens on its own. */}
        <h2 id="tour-finish-title" tabIndex={-1} className="text-xl font-semibold text-balance outline-none">
          {TOUR_COPY.finishTitle}
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">{TOUR_COPY.finishBody}</p>
      </div>
      <div className="flex w-full flex-col items-center gap-2">
        <Link href={TOUR_HREFS.copy} className={buttonVariants({ size: "lg", className: "h-10 w-full sm:w-auto" })}>
          {TOUR_COPY.finishCopy}
          <ArrowRight data-icon="inline-end" aria-hidden />
        </Link>
        <p className="text-xs text-pretty text-muted-foreground">{TOUR_COPY.finishCopyBody}</p>
      </div>
      <div className="flex flex-col items-center gap-1 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-4">
        <Link href={TOUR_HREFS.predictions} className={TOUR_LINK}>
          {TOUR_COPY.finishPredictions}
        </Link>
        <Link href={TOUR_HREFS.competition} className={TOUR_LINK}>
          {TOUR_COPY.finishCompetition}
        </Link>
        {rankShareUrl ? (
          <a href={rankShareUrl} target="_blank" rel="noopener noreferrer" className={`${TOUR_LINK} gap-1.5`}>
            <Share2Icon className="size-3.5" aria-hidden />
            {TOUR_COPY.finishRankShare}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    </section>
  );
}
