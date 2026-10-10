"use client";

import * as React from "react";
import { Award, Lock, ScanSearch } from "lucide-react";
import { cn } from "cn";
import type { PlayView } from "@/lib/api-client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/EmptyState";
import { formatDateTime, formatPoints } from "@/components/common/format";
import { questAssetSource } from "@/components/common/issuer";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { playStatusChip } from "@/components/plays/PlayCard";
import { WALLET_CHECK_TIMING, questKind } from "@/components/plays/play-meta";
import { ruleToHint } from "@/components/plays/rule-hint";
import { flattenProof, isEmptyProof, type ProofEntry } from "@/components/plays/proof";

/**
 * The labelled evidence rows (flattenProof) as a definition list on 1px rules, the label muted on
 * the left and the value cream on the right. Shared by the Play proof drawer and the /check proof
 * sheet. A list row (array of stocks, legs, days) stacks its label over one line per item; raw
 * values sit in each value's `title` tooltip.
 */
export function ProofList({ entries, className }: { entries: ProofEntry[]; className?: string }) {
  return (
    <dl className={cn("border-b border-rule text-sm", className)}>
      {entries.map((e) => (
        <div
          key={e.key}
          className={cn("grid gap-3 border-t border-rule py-2.5", e.items ? "grid-cols-1 gap-1.5" : "grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}
        >
          <dt className="min-w-0 text-[0.8125rem] break-words text-muted-foreground" title={e.key}>
            {e.label}
          </dt>
          {e.items ? (
            <dd className="min-w-0">
              <ul className="flex flex-col gap-1">
                {e.items.map((item, i) => (
                  <li key={i} className="text-[0.8125rem] break-words text-foreground tabular-nums" title={item.raw ?? undefined}>
                    {item.value}
                  </li>
                ))}
              </ul>
            </dd>
          ) : (
            <dd
              className={cn("min-w-0 text-[0.8125rem] text-foreground tabular-nums", e.mono ? "font-mono break-all" : "break-words")}
              title={e.raw ?? undefined}
            >
              {e.value}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

export interface ProofDrawerProps {
  play: PlayView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The drawer head's points: the scoreboard numeral and the word, as the quest segment prints them. */
export function ProofPoints({ points }: { points: number }) {
  return (
    <span className="flex items-baseline gap-1.5 leading-none">
      <span className="figure text-[1.5rem] leading-none text-foreground">+{formatPoints(points)}</span>
      <span className="text-[0.8125rem] text-muted-foreground">points</span>
    </span>
  );
}

/**
 * Side sheet showing the evidence behind a Play's status: the proof JSON the engine stored on
 * PlayProgress, as labelled rows on rules. Full-width on phones. The head reads like a result card:
 * the serif title, the rule in one sentence, then the status, the points and the Badge on one line.
 */
export function ProofDrawer({ play, open, onOpenChange }: ProofDrawerProps) {
  // The quest's issuer fence picks the nouns: a pre-IPO quest's evidence never reads "Stock".
  const assetSource = play ? questAssetSource(play) : null;
  const entries = React.useMemo(() => (play ? flattenProof(play.proof, { assetSource }) : []), [play, assetSource]);
  const chip = play ? playStatusChip(play) : null;
  const ChipIcon = chip?.icon;
  // In-platform quests fill in from predictions and paper trades; only on-chain ones wait on a wallet read.
  const inPlatform = play ? questKind(play) === "in-platform" : false;

  return (
    <Sheet open={open} onOpenChange={(next) => onOpenChange(next)}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="gap-2 border-b border-rule-2 px-5 pt-5 pr-14 pb-5">
          <p className="text-[0.84375rem] font-medium text-muted-foreground">Proof</p>
          <SheetTitle className="text-[2rem] leading-none text-balance">{play ? play.title : "Proof"}</SheetTitle>
          <SheetDescription className="text-[0.9375rem] leading-snug">{play ? ruleToHint(play.rule, assetSource) : "Evidence behind this quest"}</SheetDescription>
          {play && chip && ChipIcon ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Badge variant="outline" className={cn("h-6 gap-1 px-2", chip.className)}>
                <ChipIcon className="size-3" aria-hidden />
                {chip.label}
              </Badge>
              <ProofPoints points={play.points} />
              {play.badgeKey ? (
                <span className="inline-flex items-center gap-1.5 text-[0.84375rem] text-muted-foreground">
                  <Award className="size-3.5" aria-hidden />
                  Mints a Badge
                </span>
              ) : null}
            </div>
          ) : null}
        </SheetHeader>

        <div className="flex-1 px-5 py-5">
          {!play ? null : play.status === "locked" && !play.comingSoon ? (
            <EmptyState
              variant="plain"
              icon={<Lock aria-hidden />}
              title="Sign in to see your proof"
              description={
                inPlatform
                  ? "Connect a wallet and sign in. Your predictions and paper trades fill in the evidence here."
                  : `Connect a wallet and sign in. We check your wallet ${WALLET_CHECK_TIMING} and keep the evidence here.`
              }
              action={<ConnectButton size="default" />}
            />
          ) : play.comingSoon && play.status !== "complete" ? (
            <EmptyState
              variant="plain"
              icon={<ScanSearch aria-hidden />}
              title="Coming soon"
              description="This Partner listing is pending. Once it goes live we verify it from your wallet like any other on-chain quest."
            />
          ) : isEmptyProof(play.proof) || entries.length === 0 ? (
            <EmptyState
              variant="plain"
              icon={<ScanSearch aria-hidden />}
              title="No proof yet."
              description={
                inPlatform
                  ? "It fills in with your first prediction or paper trade."
                  : `We check your wallet ${WALLET_CHECK_TIMING}. Press Refresh on the Quests page to check now.`
              }
            />
          ) : (
            <section aria-label="Evidence" className="flex flex-col gap-3">
              <p className="text-[0.84375rem] font-medium text-muted-foreground">What the engine checked</p>
              <ProofList entries={entries} />
            </section>
          )}
        </div>

        {play?.completedAt ? (
          <p className="border-t border-rule px-5 py-4 text-[0.8125rem] text-muted-foreground">
            Completed{" "}
            <time dateTime={play.completedAt} className="font-mono text-foreground">
              {formatDateTime(play.completedAt)}
            </time>
            .
          </p>
        ) : play && play.status === "in_progress" ? (
          <p className="border-t border-rule px-5 py-4 text-[0.8125rem] text-muted-foreground">
            {inPlatform
              ? "Proof updates with each prediction or paper trade."
              : "Proof updates each time we read your wallet. Press Refresh on the Quests page to read it now."}
          </p>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export default ProofDrawer;
