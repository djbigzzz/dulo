import * as React from "react";
import { cn } from "cn";

/**
 * The Broadcast section name (docs/DESIGN.md "Type"): Instrument Serif, 28px on a phone and 32px
 * from sm, normal weight, tight tracking. One class for every page's section heads, so Quests,
 * Profile, Copy a portfolio, Check a wallet, Partners and the Leaderboard stay in step. Page titles
 * (PageHeader) and a game's own hero sizes (the prediction question, the competition's page clock)
 * are larger by design and keep their own classes.
 */
export const SECTION_TITLE = "font-display text-[1.75rem] leading-none font-normal tracking-[-0.012em] text-balance sm:text-[2rem]";

export interface SectionHeadingProps {
  id: string;
  title: React.ReactNode;
  /** A muted line on the right of the name (a count, a source, a one-line hint). */
  hint?: React.ReactNode;
  /** A control on the right of the name (a link, a button). */
  action?: React.ReactNode;
  /** A sentence under the name. */
  note?: React.ReactNode;
  className?: string;
}

/** A serif section name with an optional hint or action on its right and a sentence under it. */
export function SectionHeading({ id, title, hint, action, note, className }: SectionHeadingProps) {
  return (
    <div className={cn("flex flex-col gap-2 pb-1", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5">
        <h2 id={id} className={SECTION_TITLE}>
          {title}
        </h2>
        {hint ? <span className="text-[0.9375rem] text-muted-foreground">{hint}</span> : null}
        {action}
      </div>
      {note ? <p className="text-[0.9375rem] leading-snug text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export default SectionHeading;
