"use client";

import * as React from "react";
import { Award, CheckCircle2, CircleDashed, Clock, FileSearch, Gamepad2 } from "lucide-react";
import { cn } from "cn";
import type { PreviewPlayStatus, PreviewPlayView } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PointsChip } from "@/components/common/PointsChip";
import { formatDateTime } from "@/components/common/format";
import { isPreIpoSource } from "@/components/common/issuer";
import { IssuerPill } from "@/components/common/IssuerPill";
import { ruleToHint } from "@/components/plays/rule-hint";
import { cardProgress } from "@/components/plays/play-meta";
import { flattenProof } from "@/components/plays/proof";
import { ProofList } from "@/components/plays/ProofDrawer";
import { RuleDisclosure } from "@/components/plays/RuleDisclosure";
import { PREVIEW_STATUS_LABEL } from "@/app/check/_components/check-format";

const PILL = "inline-flex h-7 w-fit items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap";
const PILL_GLASS = "border-white/[0.08] bg-white/[0.03] text-muted-foreground shadow-[inset_0_1px_0_rgb(255_245_230/0.05)]";

const STATUS_STYLE: Record<PreviewPlayStatus, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  qualifies: { icon: CheckCircle2, className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-400" },
  not_yet: { icon: CircleDashed, className: PILL_GLASS },
  needs_history: { icon: Clock, className: PILL_GLASS },
  needs_activity: { icon: Gamepad2, className: PILL_GLASS },
};

export function PreviewStatusPill({ status, className }: { status: PreviewPlayStatus; className?: string }) {
  const { icon: Icon, className: tone } = STATUS_STYLE[status];
  return (
    <span className={cn(PILL, tone, className)}>
      <Icon className="size-3.5" aria-hidden />
      {PREVIEW_STATUS_LABEL[status]}
    </span>
  );
}

/** One Play as this wallet would see it: status, one-line reason and a Proof button. */
export function PreviewPlayCard({ play, onProof }: { play: PreviewPlayView; onProof: (play: PreviewPlayView) => void }) {
  const qualifies = play.status === "qualifies";
  // Same rule as the quests board: no dollar target on a card, units labelled for people (the quest's own issuer noun).
  const progress = qualifies ? null : cardProgress(play.progress, play.assetSource);
  return (
    <article
      className={cn(
        "relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-4 sm:p-5",
        qualifies ? "border-emerald-400/20" : "border-white/[0.07]",
      )}
    >
      {qualifies ? (
        <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent" aria-hidden />
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-base font-semibold tracking-tight">{play.title}</h3>
            {isPreIpoSource(play.assetSource) ? <IssuerPill source={play.assetSource} /> : null}
          </div>
          <p className="text-sm text-muted-foreground">{ruleToHint(play.rule, play.assetSource)}</p>
        </div>
        <PointsChip points={play.points} signed muted={!qualifies} className="shrink-0" />
      </div>
      <p className="text-sm leading-relaxed text-foreground/90">{play.note}.</p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <PreviewStatusPill status={play.status} />
          {progress ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {`${progress.current} of ${progress.target}${progress.unit ? ` ${progress.unit}` : ""}`}
            </span>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="sm" className="-mr-2 h-10 text-muted-foreground hover:text-foreground sm:h-8" onClick={() => onProof(play)}>
          <FileSearch data-icon="inline-start" aria-hidden />
          Proof
          <span className="sr-only"> for {play.title}</span>
        </Button>
      </div>
      {/* The card already prints the sentence under the title, so this shows the JSON only. */}
      <RuleDisclosure rule={play.rule} showHint={false} />
    </article>
  );
}

/** Side sheet with the evidence the engine produced on this one live read. */
export function PreviewProofSheet({
  play,
  readAt,
  open,
  onOpenChange,
}: {
  play: PreviewPlayView | null;
  readAt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const entries = React.useMemo(() => (play ? flattenProof(play.proof, { assetSource: play.assetSource }) : []), [play]);
  return (
    <Sheet open={open} onOpenChange={(next) => onOpenChange(next)}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b border-white/[0.06] pr-12">
          <SheetTitle className="truncate">{play ? play.title : "Proof"}</SheetTitle>
          <SheetDescription className="truncate">{play ? ruleToHint(play.rule, play.assetSource) : "Evidence behind this quest"}</SheetDescription>
          {play ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <PreviewStatusPill status={play.status} className="h-6" />
              <PointsChip points={play.points} signed />
              {play.badgeKey ? (
                <Badge variant="outline" className="h-6 gap-1 border-gold/20 bg-gold/[0.06] px-2.5 text-gold">
                  <Award className="size-3" aria-hidden />
                  Badge
                </Badge>
              ) : null}
            </div>
          ) : null}
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 p-4">
          {play ? <p className="text-sm leading-relaxed text-muted-foreground">{play.note}.</p> : null}
          {entries.length > 0 ? (
            <ProofList entries={entries} />
          ) : null}
        </div>
        <p className="border-t border-white/[0.06] p-4 text-xs text-muted-foreground">
          Read live from Solana {formatDateTime(readAt)}. Nothing stored, never scored.
        </p>
      </SheetContent>
    </Sheet>
  );
}
