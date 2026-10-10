"use client";

import { Globe, Link2, PencilLine } from "lucide-react";
import type { MirrorTargetView } from "@/lib/api-client";
import { AddressChip } from "@/components/common/AddressChip";
import { PageHeader } from "@/components/common/PageHeader";
import { StatStrip } from "@/components/common/StatStrip";
import { ageSeconds, formatAge, truncateAddress } from "@/components/common/format";
import { BotMarker } from "@/components/league/LeagueLeaderboard";
import { sourceChip, targetStats } from "@/components/mirror/target-stats";

export interface TargetHeaderProps {
  target: MirrorTargetView;
  /** Server clock (ISO) the asOf age is measured against. */
  now: string;
  actions?: React.ReactNode;
}

/**
 * One copy target's masthead: the handle (or the short address) as the serif title, a house bot
 * labelled beside it, then the full address with its explorer link, where the portfolio was read
 * from and how old it is (mono: it is an age), and the headline numbers on rules.
 */
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
        <span className="inline-flex max-w-full items-center gap-3">
          <span className="truncate" title={target.address}>
            {target.handle ?? truncateAddress(target.address)}
          </span>
          {target.isBot ? <BotMarker className="font-sans [&>span]:text-[0.9375rem] [&>svg]:h-4 [&>svg]:w-5" /> : null}
        </span>
      }
      description={
        <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.9375rem]">
          <AddressChip
            address={target.address}
            chainId={target.chainId}
            chars={target.handle ? 5 : 6}
            explorer
            className="h-auto rounded-none border-0 bg-transparent px-0 text-[0.84375rem] text-muted-foreground"
          />
          <span className="inline-flex items-center gap-1.5 text-foreground [&>svg]:size-3.5 [&>svg]:text-muted-foreground" title={chip.title}>
            {paper ? <PencilLine aria-hidden /> : target.source === "public" ? <Globe aria-hidden /> : <Link2 aria-hidden />}
            {chip.label}
          </span>
          <span className="mono-meta">
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
