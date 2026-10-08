"use client";

import type { ReactNode } from "react";
import { Check, ChevronDown, Lock } from "lucide-react";
import { cn } from "cn";
import { TOUR_COPY, type TourStepKey, type TourStepState } from "@/components/start/tour";

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

const BORDER: Record<TourStepState, string> = {
  current: "border-ember/40",
  done: "border-emerald-400/20",
  todo: "border-white/[0.08]",
  unavailable: "border-white/[0.08]",
};

function StepBadge({ index, state }: { index: number; state: TourStepState }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
        state === "done" && "border-emerald-400/25 bg-emerald-400/[0.1] text-emerald-300",
        state === "current" && "border-ember/40 bg-ember/15 text-foreground",
        state === "todo" && "border-white/[0.1] bg-white/[0.03] text-muted-foreground",
        state === "unavailable" && "border-white/[0.08] bg-transparent text-muted-foreground/70",
      )}
    >
      {state === "done" ? <Check className="size-3.5" strokeWidth={2.5} /> : state === "unavailable" ? <Lock className="size-3.5" /> : index}
    </span>
  );
}

/**
 * One step of the /start tour: a numbered row that folds to a one-line summary. Presentational;
 * the page decides which step is open. In the page flow, never pinned to the viewport.
 */
export function TourStep({ index, stepKey, title, state, open, summary, onToggle, children }: TourStepProps) {
  const bodyId = `tour-step-${stepKey}`;
  const head = (
    <>
      <StepBadge index={index} state={state} />
      <span className={cn("min-w-0 flex-1 text-pretty", state === "unavailable" && "text-muted-foreground")}>
        {title}
        <span className="sr-only">, {TOUR_COPY.stateLabel[state]}</span>
      </span>
      {onToggle ? (
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")}
        />
      ) : null}
    </>
  );

  return (
    <li
      data-slot="tour-step"
      data-step={stepKey}
      data-state={state}
      aria-current={state === "current" ? "step" : undefined}
      className={cn("scroll-mt-20 rounded-2xl border bg-card transition-colors duration-300 motion-reduce:transition-none", BORDER[state])}
    >
      <h2 className="text-base font-semibold">
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-5"
          >
            {head}
          </button>
        ) : (
          <span className="flex min-h-14 w-full items-center gap-3 px-4 py-3 sm:px-5">{head}</span>
        )}
      </h2>
      {/* Outside the button: a done step's summary can carry its own link. */}
      {!open && summary ? (
        <div data-slot="tour-step-summary" className="-mt-2 pr-4 pb-3.5 pl-14 text-sm text-pretty text-muted-foreground sm:pr-5 sm:pl-15">
          {summary}
        </div>
      ) : null}
      {open ? (
        <div id={bodyId} className="flex flex-col gap-4 px-4 pb-4 sm:px-5 sm:pb-5">
          {children}
        </div>
      ) : null}
    </li>
  );
}

export default TourStep;
