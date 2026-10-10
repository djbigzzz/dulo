"use client";

import * as React from "react";
import { Award, Check, CircleDashed, Clock, FileSearch, Gamepad2 } from "lucide-react";
import { cn } from "cn";
import type { PreviewPlayStatus, PreviewPlayView } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDateTime, formatPoints } from "@/components/common/format";
import { isPreIpoSource } from "@/components/common/issuer";
import { IssuerPill } from "@/components/common/IssuerPill";
import { ruleToHint } from "@/components/plays/rule-hint";
import { cardProgress } from "@/components/plays/play-meta";
import { flattenProof } from "@/components/plays/proof";
import { ProofList } from "@/components/plays/ProofDrawer";
import { RuleDisclosure } from "@/components/plays/RuleDisclosure";
import { PREVIEW_STATUS_LABEL } from "@/app/check/_components/check-format";

/** A small ruled tag: the verdict "Meets it now" is the cream stamp, every other state a quiet rule (no hue). */
const PILL = "inline-flex h-6 w-fit items-center gap-1.5 border px-2 text-xs font-semibold whitespace-nowrap";
const PILL_QUIET = "border-rule-2 text-muted-foreground";

const STATUS_STYLE: Record<PreviewPlayStatus, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  qualifies: { icon: Check, className: "border-foreground bg-foreground text-background" },
  not_yet: { icon: CircleDashed, className: PILL_QUIET },
  needs_history: { icon: Clock, className: PILL_QUIET },
  needs_activity: { icon: Gamepad2, className: PILL_QUIET },
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

/**
 * One Play as this wallet would see it, as a segment of the verdict board (the quests board's
 * segment): the points as a scoreboard numeral, the verdict, the rule, the one-line reason, and a
 * Proof button. A quest the wallet already meets carries the cream rule along its top edge.
 */
export function PreviewPlayCard({ play, onProof }: { play: PreviewPlayView; onProof: (play: PreviewPlayView) => void }) {
  const qualifies = play.status === "qualifies";
  // Same rule as the quests board: no dollar target on a card, units labelled for people (the quest's own issuer noun).
  const progress = qualifies ? null : cardProgress(play.progress, play.assetSource);
  return (
    <article
      data-status={play.status}
      className={cn(
        "relative flex h-full flex-col gap-3 border border-rule bg-background p-4 sm:p-5",
        qualifies && "z-[1] bg-white/[0.025] before:absolute before:-inset-x-px before:-top-px before:h-0.5 before:bg-foreground",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-baseline gap-1.5 leading-none">
          <span className={cn("figure text-[2rem] leading-[0.8]", qualifies ? "text-foreground" : "text-muted-foreground")}>+{formatPoints(play.points)}</span>
          <span className="text-[0.8125rem] text-muted-foreground">points</span>
        </p>
        <PreviewStatusPill status={play.status} />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-[1.0625rem] leading-snug font-semibold">{play.title}</h3>
          {isPreIpoSource(play.assetSource) ? <IssuerPill source={play.assetSource} /> : null}
        </div>
        <p className="text-[0.9375rem] leading-snug text-muted-foreground">{ruleToHint(play.rule, play.assetSource)}</p>
      </div>
      <p className="border-l border-rule-2 pl-3 text-sm leading-relaxed text-foreground/90">{play.note}.</p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3">
        <span className="text-[0.8125rem] text-muted-foreground tabular-nums">
          {progress ? `${progress.current} of ${progress.target}${progress.unit ? ` ${progress.unit}` : ""}` : null}
        </span>
        <Button type="button" variant="outline" size="sm" className="h-10 sm:h-8" onClick={() => onProof(play)}>
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

/** Side sheet with the evidence the engine produced on this one live read (the quests' proof drawer, read-only). */
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
        <SheetHeader className="gap-2 border-b border-rule-2 px-5 pt-5 pr-14 pb-5">
          <p className="text-[0.84375rem] font-medium text-muted-foreground">Proof from one live read</p>
          <SheetTitle className="text-[2rem] leading-none text-balance">{play ? play.title : "Proof"}</SheetTitle>
          <SheetDescription className="text-[0.9375rem] leading-snug">{play ? ruleToHint(play.rule, play.assetSource) : "Evidence behind this quest"}</SheetDescription>
          {play ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <PreviewStatusPill status={play.status} />
              <span className="flex items-baseline gap-1.5 leading-none">
                <span className="figure text-[1.5rem] leading-none text-foreground">+{formatPoints(play.points)}</span>
                <span className="text-[0.8125rem] text-muted-foreground">points</span>
              </span>
              {play.badgeKey ? (
                <Badge variant="outline" className="h-6 gap-1 px-2 text-muted-foreground">
                  <Award className="size-3" aria-hidden />
                  Badge
                </Badge>
              ) : null}
            </div>
          ) : null}
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 px-5 py-5">
          {play ? <p className="text-[0.9375rem] leading-relaxed text-foreground/90">{play.note}.</p> : null}
          {entries.length > 0 ? (
            <ProofList entries={entries} />
          ) : null}
        </div>
        <p className="border-t border-rule px-5 py-4 text-[0.8125rem] text-muted-foreground">
          Read live from Solana <time dateTime={readAt} className="font-mono text-foreground">{formatDateTime(readAt)}</time>. Nothing stored, never scored.
        </p>
      </SheetContent>
    </Sheet>
  );
}
