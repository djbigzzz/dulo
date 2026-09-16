"use client";

import { Globe, Link2, PencilLine } from "lucide-react";
import { cn } from "cn";
import type { MirrorTargetView } from "@/lib/api-client";
import { AddressChip } from "@/components/common/AddressChip";
import { PageHeader } from "@/components/common/PageHeader";
import { StatStrip } from "@/components/common/StatStrip";
import { ageSeconds, formatAge } from "@/components/common/format";
import { BotMarker } from "@/components/league/LeagueLeaderboard";
import { sourceChip, targetStats } from "@/components/mirror/target-stats";

export interface TargetHeaderProps {
  target: MirrorTargetView;
  /** Server clock (ISO) the asOf age is measured against. */
  now: string;
  actions?: React.ReactNode;
}

/** Handle / address, portfolio source and age, and the headline numbers for one Mirror target. */
export function TargetHeader({ target, now, actions }: TargetHeaderProps) {
  const nowMs = Date.parse(now) || Date.now();
  const age = ageSeconds(target.asOf, nowMs);
  const paper = target.source === "paper";
  const chip = sourceChip(target.source);
  const stats = targetStats(target, nowMs);

  return (
    <PageHeader
      eyebrow="Copy a portfolio"
      title={
        target.handle ? (
          <span className="inline-flex max-w-full items-center gap-2">
            <span className="truncate">{target.handle}</span>
            {target.isBot ? <BotMarker className="[&>svg]:size-5" /> : null}
          </span>
        ) : (
          <span className="inline-flex max-w-full items-center gap-2">
            <AddressChip address={target.address} chainId={target.chainId} chars={6} explorer className="h-9 text-base" />
            {target.isBot ? <BotMarker className="[&>svg]:size-5" /> : null}
          </span>
        )
      }
      description={
        <span className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          {target.handle ? <AddressChip address={target.address} chainId={target.chainId} chars={5} explorer /> : null}
          <span
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 text-xs font-medium text-foreground/90 shadow-[inset_0_1px_0_rgb(255_245_230/0.06)] [&>svg]:size-3.5 [&>svg]:text-muted-foreground",
            )}
            title={chip.title}
          >
            {paper ? <PencilLine aria-hidden /> : target.source === "public" ? <Globe aria-hidden /> : <Link2 aria-hidden />}
            {chip.label}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {chip.age} {formatAge(age)}
          </span>
        </span>
      }
      actions={actions}
      stats={<StatStrip stats={stats} />}
      className="mb-0"
    />
  );
}

export default TargetHeader;
