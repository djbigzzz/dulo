"use client";

import type { ReactNode } from "react";
import { Check, ChevronDown, Lock } from "lucide-react";
import { cn } from "cn";
import { TOUR_COPY, TOUR_TOTAL, type TourStepKey, type TourStepState } from "@/components/start/tour";

/** The segment names on the running-order strip: the mobile tab names, in the same order. */
export const TOUR_SEGMENT_LABEL: Readonly<Record<TourStepKey, string>> = Object.freeze({
  predict: "Predict",
  compete: "Compete",
  quests: "Quests",
  board: "Board",
});

/**
 * The status at the end of a row, as a running order reads it. Seen only: screen readers hear
 * TOUR_COPY.stateLabel after the title instead (", your next step").
 */
const STATUS: Readonly<Record<TourStepState, string>> = Object.freeze({
  done: "Done",
  current: "On now",
  todo: "Later",
  unavailable: "Not open",
});

/** The row's columns: the segment number, the title (the summary and the notes sit under it), the status. */
const ROW_GRID = "grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:gap-x-4 lg:grid-cols-[4.5rem_minmax(0,1fr)_auto] lg:gap-x-6";
/** Under the title column: the row's side padding plus the number column and its gap. */
const UNDER_TITLE = "pl-[3.75rem] pr-3 sm:pl-[4.75rem] sm:pr-4 lg:pl-[7rem] lg:pr-5";

function SegmentNumber({ index, state }: { index: number; state: TourStepState }) {
  if (state === "unavailable") {
    return (
      <span aria-hidden className="flex h-8 items-center text-dim lg:h-11">
        <Lock className="size-5 lg:size-6" strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "figure text-[2.25rem] leading-[0.8] font-medium transition-colors duration-300 motion-reduce:transition-none lg:text-[3.5rem]",
        state === "current" ? "text-foreground" : state === "done" ? "text-muted-foreground" : "text-dim",
      )}
    >
      {index}
    </span>
  );
}

function SegmentStatus({ state, toggle, open }: { state: TourStepState; toggle: boolean; open: boolean }) {
  return (
    <span className="flex items-center gap-2.5 sm:gap-3">
      <span
        aria-hidden
        className={cn(
          "inline-flex items-center gap-1.5 text-[0.8125rem] leading-none font-semibold whitespace-nowrap sm:text-sm",
          state === "current" && "text-foreground",
          state === "done" && "text-muted-foreground",
          (state === "todo" || state === "unavailable") && "text-dim",
          // A phone row is narrow: a later row says nothing at the end (its number says where it sits),
          // and a done row keeps only its check, so the title keeps the width.
          state === "todo" && "max-sm:hidden",
        )}
      >
        {state === "current" ? <span className="size-1.5 shrink-0 rounded-full bg-foreground" /> : null}
        {state === "done" ? <Check className="size-4 shrink-0 text-foreground sm:size-3.5" strokeWidth={2.5} /> : null}
        <span className={cn(state === "done" && "max-sm:hidden")}>{STATUS[state]}</span>
      </span>
      {toggle ? (
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")}
        />
      ) : null}
    </span>
  );
}

export interface TourStepProps {
  /** 1-based position in the tour. */
  index: number;
  stepKey: TourStepKey;
  title: string;
  state: TourStepState;
  open: boolean;
  /** One line shown while the step is folded (a done step's result, a teaser, or why it is not open). */
  summary?: ReactNode;
  /** Null renders a static row: no button, no chevron. */
  onToggle: (() => void) | null;
  children?: ReactNode;
}

/**
 * One segment of the /start running order: a ruled row with its number, its title in the serif and
 * its status at the end ("On now", "Done", "Later", "Not open"); the live one is the lit row (an
 * ink-2 band with a cream edge, as the competition marks a player's own row). It folds to a
 * one-line summary. Presentational: the page decides which step is open. In the page flow, never
 * pinned to the viewport.
 */
export function TourStep({ index, stepKey, title, state, open, summary, onToggle, children }: TourStepProps) {
  const bodyId = `tour-step-${stepKey}`;
  const live = state === "current";
  const head = (
    <>
      <SegmentNumber index={index} state={state} />
      <span
        className={cn(
          "min-w-0 font-display text-[1.5rem] leading-[1.02] font-normal tracking-[-0.012em] text-pretty sm:text-[1.75rem] lg:text-[2.125rem]",
          state === "current" || state === "done" ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {title}
        <span className="sr-only">, {TOUR_COPY.stateLabel[state]}</span>
      </span>
      <SegmentStatus state={state} toggle={onToggle !== null} open={open} />
    </>
  );
  const rowPad = "min-h-16 px-3 py-3.5 sm:px-4 sm:py-4 lg:min-h-[5.5rem] lg:px-5 lg:py-5";

  return (
    <li
      data-slot="tour-step"
      data-step={stepKey}
      data-state={state}
      aria-current={live ? "step" : undefined}
      className="scroll-mt-20 border-t border-rule first:border-t-0"
    >
      {/*
        The lit row: the live segment's band and its cream edge (an inset shadow, so the focus ring
        composes with it), over the title and, folded, its summary line. The open body sits on the ground.
      */}
      <div className={cn("transition-colors duration-300 motion-reduce:transition-none", live && "bg-card shadow-[inset_2px_0_0_var(--color-foreground)]")}>
        <h2>
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-controls={open ? bodyId : undefined}
              className={cn(
                ROW_GRID,
                rowPad,
                "w-full text-left outline-none transition-colors hover:bg-white/[0.025] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset motion-reduce:transition-none",
              )}
            >
              {head}
            </button>
          ) : (
            <span className={cn(ROW_GRID, rowPad, "w-full")}>{head}</span>
          )}
        </h2>
        {/* Outside the button: a done step's summary can carry its own link. */}
        {!open && summary ? (
          <div data-slot="tour-step-summary" className={cn("-mt-1.5 pb-4 text-[0.9375rem] leading-[1.45] text-pretty text-muted-foreground lg:-mt-2 lg:pb-5", UNDER_TITLE)}>
            {summary}
          </div>
        ) : null}
      </div>
      {open ? (
        // Full width on a phone (the prediction card needs it); under the title from sm.
        <div id={bodyId} className="pt-4 pb-8 sm:pt-5 sm:pr-4 sm:pl-[4.75rem] lg:pt-4 lg:pr-5 lg:pb-10 lg:pl-[7rem]">
          {children}
        </div>
      ) : null}
    </li>
  );
}

export interface TourProgressProps {
  steps: readonly { key: TourStepKey; state: TourStepState }[];
  done: number;
  /** Signed out there is nothing to count: the strip shows the running order only, and says nothing to a screen reader. */
  signedIn: boolean;
  className?: string;
}

/**
 * The running order at a glance: four segments on one thin track, as the week track draws the week.
 * Done is a cream bar, the live segment the elapsed cream (42%), a later one the ink well, and a
 * segment that is not open right now a dashed rule. Signed in, it is the tour's progress bar.
 */
export function TourProgress({ steps, done, signedIn, className }: TourProgressProps) {
  const track = (
    <ol className="grid grid-cols-4 gap-1.5" aria-hidden>
      {steps.map((s) => (
        <li key={s.key} className="flex min-w-0 flex-col gap-2">
          <span
            className={cn(
              "block h-[3px] w-full transition-colors duration-300 motion-reduce:transition-none",
              s.state === "done" && "bg-foreground",
              s.state === "current" && "bg-[rgb(243_240_232/0.42)]",
              s.state === "todo" && "bg-ink-4",
              s.state === "unavailable" && "border-t border-dashed border-dim bg-transparent",
            )}
          />
          <span
            className={cn(
              "flex min-w-0 items-center gap-1 text-[0.8125rem] leading-none font-medium",
              s.state === "current" ? "font-semibold text-foreground" : s.state === "done" ? "text-muted-foreground" : "text-dim",
            )}
          >
            {s.state === "done" ? <Check className="size-3 shrink-0 text-foreground" strokeWidth={2.75} /> : null}
            {s.state === "unavailable" ? <Lock className="size-3 shrink-0" strokeWidth={2} /> : null}
            <span className="truncate">{TOUR_SEGMENT_LABEL[s.key]}</span>
          </span>
        </li>
      ))}
    </ol>
  );

  return (
    // Signed out on a phone the strip steps aside: the rows below say the same, and the prediction comes first.
    <div data-slot="tour-progress" className={cn("flex w-full flex-col gap-3", !signedIn && "max-lg:hidden", className)}>
      {signedIn ? (
        <p aria-live="polite" className="text-[1.0625rem] leading-none font-semibold text-foreground tabular-nums font-stretch-[85%] lg:text-[1.25rem]">
          {TOUR_COPY.progress(done)}
        </p>
      ) : null}
      {signedIn ? (
        <div role="progressbar" aria-label={TOUR_COPY.progressAria} aria-valuemin={0} aria-valuemax={TOUR_TOTAL} aria-valuenow={done} aria-valuetext={TOUR_COPY.progress(done)}>
          {track}
        </div>
      ) : (
        track
      )}
    </div>
  );
}

export default TourStep;
