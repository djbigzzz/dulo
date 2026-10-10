"use client";

import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import type { PreviewPlayView, PreviewResponse } from "@/lib/api-client";
import { COMPLIANCE_LINE, PRE_IPO_COMPLIANCE_LINE } from "@/components/common/compliance";
import { PREVIEW_STATUS_LABEL, groupPreviewPlays, hasPreIpoHolding, hasPreIpoQuest, inPlatformSummary } from "@/app/check/_components/check-format";
import { PreviewPlayCard } from "@/app/check/_components/PreviewPlayCard";
import { SECTION_TITLE } from "@/components/common/SectionHeading";

/** The quests board's segment grid: each card's 1px rule overlaps its neighbour's into one ruled board. */
const GRID = "grid pt-px pl-px sm:grid-cols-2 [&>li]:-mt-px [&>li]:-ml-px";

/** Group headings on the check board, in the order they are shown. */
export const QUALIFIES_HEADING = PREVIEW_STATUS_LABEL.qualifies;
export const NEEDS_HISTORY_HEADING = PREVIEW_STATUS_LABEL.needs_history;
export const NOT_YET_HEADING = PREVIEW_STATUS_LABEL.not_yet;
export const NOTHING_QUALIFIES = "No on-chain quest is met on this read.";

interface GroupProps {
  id: string;
  title: string;
  hint: string;
  plays: PreviewPlayView[];
  /** Shown instead of the cards when the group is empty; groups without one render nothing while empty. */
  empty?: string;
  onProof: (play: PreviewPlayView) => void;
}

function PreviewGroup({ id, title, hint, plays, empty, onProof }: GroupProps) {
  if (plays.length === 0 && !empty) return null;
  return (
    <section data-preview-group={id} aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h3 id={id} className="flex items-baseline gap-2.5 text-[1.25rem] leading-tight font-semibold tracking-[-0.01em]">
          {title}
          <span className="text-[1.0625rem] font-semibold text-muted-foreground tabular-nums font-stretch-[85%]">{plays.length}</span>
        </h3>
        <p className="text-[0.9375rem] text-muted-foreground">{hint}</p>
      </header>
      {plays.length === 0 ? (
        <p className="border border-dashed border-[rgb(243_240_232/0.3)] px-4 py-4 text-[0.9375rem] text-muted-foreground">{empty}</p>
      ) : (
        <ul className={GRID}>
          {plays.map((play) => (
            <li key={play.key} className="min-w-0">
              <PreviewPlayCard play={play} onProof={onProof} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The quests of /check/[address], as a verdict: what this wallet already meets (the cream stamp,
 * with Proof), what needs daily snapshots once it is connected, what one read decided against, and
 * the in-platform quests behind one disclosure line, since no wallet read can decide those. The
 * compliance pair prints once, at the foot of the board, whenever a pre-IPO quest or token is on
 * screen. Exported for tests.
 */
export function PreviewBoard({ data, onProof, className }: { data: PreviewResponse; onProof: (play: PreviewPlayView) => void; className?: string }) {
  const groups = groupPreviewPlays(data.plays);
  const compliance = hasPreIpoQuest(data) || hasPreIpoHolding(data);
  return (
    <section className={cn("flex min-w-0 flex-col gap-8", className)} aria-labelledby="check-plays">
      <h2 id="check-plays" className={SECTION_TITLE}>
        Quests
      </h2>
      <PreviewGroup
        id="check-qualifies"
        title={QUALIFIES_HEADING}
        hint="On-chain quests this wallet already meets. They score the moment its owner connects."
        plays={groups.qualifies}
        empty={NOTHING_QUALIFIES}
        onProof={onProof}
      />
      <PreviewGroup
        id="check-needs-history"
        title={NEEDS_HISTORY_HEADING}
        hint="Met over daily snapshots, so they start counting once the wallet is connected."
        plays={groups.needsHistory}
        onProof={onProof}
      />
      <PreviewGroup
        id="check-not-yet"
        title={NOT_YET_HEADING}
        hint="One read decides these. Each card says what the wallet is missing."
        plays={groups.notYet}
        onProof={onProof}
      />
      {groups.inPlatform.length > 0 ? (
        <details data-slot="check-in-platform" className="group border-y border-rule text-[0.9375rem] [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 py-3 outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset">
            <span className="min-w-0 flex-1 text-pretty text-foreground">{inPlatformSummary(groups.inPlatform.length)}</span>
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
          </summary>
          <ul className={cn(GRID, "pb-4")}>
            {groups.inPlatform.map((play) => (
              <li key={play.key} className="min-w-0">
                <PreviewPlayCard play={play} onProof={onProof} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {compliance ? (
        <div className="flex flex-col gap-1">
          <p className="text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">{COMPLIANCE_LINE}</p>
          <p data-slot="pre-ipo-compliance" className="text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">
            {PRE_IPO_COMPLIANCE_LINE}
          </p>
        </div>
      ) : null}
    </section>
  );
}

export default PreviewBoard;
