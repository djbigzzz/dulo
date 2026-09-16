"use client";

import * as React from "react";
import { Award, Lock, ScanSearch } from "lucide-react";
import { cn } from "cn";
import type { PlayView } from "@/lib/api-client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/EmptyState";
import { PointsChip } from "@/components/common/PointsChip";
import { formatDateTime } from "@/components/common/format";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { playStatusChip } from "@/components/plays/PlayCard";
import { ruleToHint } from "@/components/plays/rule-hint";
import { flattenProof, isEmptyProof, type ProofEntry } from "@/components/plays/proof";

/**
 * The labelled evidence rows (flattenProof) as a definition list. Shared by the Play proof
 * drawer and the /check proof sheet. A list row (array of stocks, legs, days) stacks its
 * label over one line per item; raw values sit in each value's `title` tooltip.
 */
export function ProofList({ entries, className }: { entries: ProofEntry[]; className?: string }) {
  return (
    <dl
      className={cn(
        "divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06] bg-black/25 text-sm shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]",
        className,
      )}
    >
      {entries.map((e) => (
        <div
          key={e.key}
          className={cn("grid gap-3 px-3 py-2.5", e.items ? "grid-cols-1 gap-1.5" : "grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}
        >
          <dt className="min-w-0 text-xs break-words text-muted-foreground" title={e.key}>
            {e.label}
          </dt>
          {e.items ? (
            <dd className="min-w-0">
              <ul className="flex flex-col gap-1">
                {e.items.map((item, i) => (
                  <li key={i} className="text-xs break-words text-foreground tabular-nums" title={item.raw ?? undefined}>
                    {item.value}
                  </li>
                ))}
              </ul>
            </dd>
          ) : (
            <dd
              className={cn("min-w-0 text-xs text-foreground tabular-nums", e.mono ? "font-mono break-all" : "break-words")}
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

/**
 * Side sheet showing the evidence behind a Play's status: the proof JSON the engine
 * stored on PlayProgress, rendered as a key/value list. Full-width on phones.
 */
export function ProofDrawer({ play, open, onOpenChange }: ProofDrawerProps) {
  const entries = React.useMemo(() => (play ? flattenProof(play.proof) : []), [play]);
  const chip = play ? playStatusChip(play) : null;
  const ChipIcon = chip?.icon;

  return (
    <Sheet open={open} onOpenChange={(next) => onOpenChange(next)}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b border-white/[0.06] pr-12">
          <SheetTitle className="truncate">{play ? play.title : "Proof"}</SheetTitle>
          <SheetDescription className="truncate">{play ? ruleToHint(play.rule) : "Evidence behind this quest"}</SheetDescription>
          {play && chip && ChipIcon ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("h-6 gap-1 px-2.5", chip.className)}>
                <ChipIcon className="size-3" aria-hidden />
                {chip.label}
              </Badge>
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

        <div className="flex-1 p-4">
          {!play ? null : play.status === "locked" && !play.comingSoon ? (
            <EmptyState
              variant="plain"
              icon={<Lock aria-hidden />}
              title="Sign in to see your proof"
              description="Connect a wallet and sign in. We check your wallet every 5 minutes and keep the evidence here."
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
              description="We check your wallet every 5 minutes."
            />
          ) : (
            <ProofList entries={entries} />
          )}
        </div>

        {play?.completedAt ? (
          <p className="border-t border-white/[0.06] p-4 text-xs text-muted-foreground">
            Completed {formatDateTime(play.completedAt)}.
          </p>
        ) : play && play.status === "in_progress" ? (
          <p className="border-t border-white/[0.06] p-4 text-xs text-muted-foreground">
            Proof updates on every snapshot, about every 5 minutes.
          </p>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export default ProofDrawer;
