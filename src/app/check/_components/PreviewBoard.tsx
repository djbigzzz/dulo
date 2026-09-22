"use client";

import { CheckCircle2, ChevronDownIcon, CircleDashed, Clock, Gamepad2 } from "lucide-react";
import { cn } from "cn";
import type { PreviewPlayView, PreviewResponse } from "@/lib/api-client";
import { COMPLIANCE_LINE, PRE_IPO_COMPLIANCE_LINE } from "@/components/common/compliance";
import { PREVIEW_STATUS_LABEL, groupPreviewPlays, hasPreIpoHolding, hasPreIpoQuest, inPlatformSummary } from "@/app/check/_components/check-format";
import { PreviewPlayCard } from "@/app/check/_components/PreviewPlayCard";

const GRID = "grid gap-4 sm:grid-cols-2";
const TILE = "flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] shadow-[inset_0_1px_0_rgb(255_245_230/0.06)]";

/** Group headings on the check board, in the order they are shown. */
export const QUALIFIES_HEADING = PREVIEW_STATUS_LABEL.qualifies;
export const NEEDS_HISTORY_HEADING = PREVIEW_STATUS_LABEL.needs_history;
export const NOT_YET_HEADING = PREVIEW_STATUS_LABEL.not_yet;
export const NOTHING_QUALIFIES = "No on-chain quest is met on this read.";

interface GroupProps {
  id: string;
  title: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "positive" | "default";
  plays: PreviewPlayView[];
  /** Shown instead of the cards when the group is empty; groups without one render nothing while empty. */
  empty?: string;
  onProof: (play: PreviewPlayView) => void;
}

function PreviewGroup({ id, title, hint, icon: Icon, tone = "default", plays, empty, onProof }: GroupProps) {
  if (plays.length === 0 && !empty) return null;
  return (
    <section data-preview-group={id} aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <header className="flex items-center gap-3">
        <span className={cn(TILE, tone === "positive" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-400" : "text-gold")} aria-hidden>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={id} className="text-base leading-tight font-semibold tracking-tight">
            {title}
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">{plays.length}</span>
          </h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </header>
      {plays.length === 0 ? (
        <p className="rounded-2xl border border-white/[0.07] bg-card px-4 py-4 text-sm text-muted-foreground">{empty}</p>
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
 * The quests of /check/[address], as a verdict: what this wallet already meets (green, with Proof),
 * what needs daily snapshots once it is connected, what one read decided against, and the
 * in-platform quests behind one disclosure line, since no wallet read can decide those. The
 * compliance pair prints once, at the foot of the board, whenever a pre-IPO quest or token is on
 * screen. Exported for tests.
 */
export function PreviewBoard({ data, onProof, className }: { data: PreviewResponse; onProof: (play: PreviewPlayView) => void; className?: string }) {
  const groups = groupPreviewPlays(data.plays);
  const compliance = hasPreIpoQuest(data) || hasPreIpoHolding(data);
  return (
    <section className={cn("flex min-w-0 flex-col gap-6", className)} aria-labelledby="check-plays">
      <h2 id="check-plays" className="text-lg font-semibold tracking-tight">
        Quests
      </h2>
      <PreviewGroup
        id="check-qualifies"
        title={QUALIFIES_HEADING}
        hint="On-chain quests this wallet already meets. They score the moment its owner connects."
        icon={CheckCircle2}
        tone="positive"
        plays={groups.qualifies}
        empty={NOTHING_QUALIFIES}
        onProof={onProof}
      />
      <PreviewGroup
        id="check-needs-history"
        title={NEEDS_HISTORY_HEADING}
        hint="Met over daily snapshots, so they start counting once the wallet is connected."
        icon={Clock}
        plays={groups.needsHistory}
        onProof={onProof}
      />
      <PreviewGroup
        id="check-not-yet"
        title={NOT_YET_HEADING}
        hint="One read decides these. Each card says what the wallet is missing."
        icon={CircleDashed}
        plays={groups.notYet}
        onProof={onProof}
      />
      {groups.inPlatform.length > 0 ? (
        <details
          data-slot="check-in-platform"
          className="group rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-sm transition-colors open:bg-white/[0.03] sm:px-5 [&_summary::-webkit-details-marker]:hidden"
        >
          <summary className="flex cursor-pointer list-none items-center gap-3 outline-none select-none focus-visible:text-ember">
            <span className={cn(TILE, "text-gold")} aria-hidden>
              <Gamepad2 className="size-4" />
            </span>
            <span className="min-w-0 flex-1 text-pretty text-foreground/90">{inPlatformSummary(groups.inPlatform.length)}</span>
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" aria-hidden />
          </summary>
          <ul className={cn(GRID, "pt-4")}>
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
          <p className="text-xs text-pretty text-muted-foreground">{COMPLIANCE_LINE}</p>
          <p data-slot="pre-ipo-compliance" className="text-xs text-pretty text-muted-foreground">
            {PRE_IPO_COMPLIANCE_LINE}
          </p>
        </div>
      ) : null}
    </section>
  );
}

export default PreviewBoard;
