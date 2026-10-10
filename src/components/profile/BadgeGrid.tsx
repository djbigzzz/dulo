"use client";

import { ArrowUpRight, Check } from "lucide-react";
import { cn } from "cn";
import { badgeImageUrl, type BadgeView } from "@/lib/api-client";
import { BADGE_KEYS, badgeInfo, txExplorerUrl } from "@/lib/badges/keys";
import { formatDate } from "@/components/common/format";

export interface BadgeGridProps {
  badges: BadgeView[];
  /** Show the badge designs the user has not earned yet, dimmed. Default true. */
  showLocked?: boolean;
  className?: string;
}

/**
 * The shelf as a ruled board of segments, like the quests board: each tile draws its own 1px rule
 * and pulls back by a pixel, so neighbours share one rule. Two columns on a phone and in a side
 * column, more where there is room.
 */
const SHELF = "grid grid-cols-2 pt-px pl-px [&>li]:-mt-px [&>li]:-ml-px";
const ITEM = "flex min-w-0 flex-col items-center gap-3 border border-rule px-3 py-5 text-center";
/** The medallion's round well (docs/DESIGN.md logo well); the artwork itself is unchanged by Broadcast. */
const FRAME = "relative flex size-[4.5rem] shrink-0 items-center justify-center rounded-full bg-ink-4 p-1 ring-1 ring-inset sm:size-20";
const TAG = "inline-flex h-5 items-center gap-1 border px-1.5 text-xs font-medium whitespace-nowrap";

/** Kept for callers from earlier themes: a flat, empty layer (Broadcast has no glow). Place inside a `relative` parent. */
export function ShelfGlow({ className }: { className?: string }) {
  return <div className={cn("pointer-events-none absolute inset-0 bg-transparent", className)} aria-hidden />;
}

/**
 * Badges as a shelf of segments: the medallion in a round well, the name, when it was earned, and
 * its mint status as a small ruled tag. Minted badges link to their transaction on Solscan; queued
 * ones read "Minting soon"; designs not yet earned are greyed out.
 */
export function BadgeGrid({ badges, showLocked = true, className }: BadgeGridProps) {
  const earned = new Set(badges.map((b) => b.playKey));
  const locked = showLocked ? BADGE_KEYS.filter((k) => !earned.has(k)) : [];
  return (
    <ul className={cn(SHELF, className)}>
      {badges.map((b) => (
        <BadgeTile key={b.playKey} badge={b} />
      ))}
      {locked.map((key) => (
        <LockedBadgeTile key={key} badgeKey={key} />
      ))}
    </ul>
  );
}

function BadgeTile({ badge }: { badge: BadgeView }) {
  const info = badgeInfo(badge.playKey);
  const title = info?.title ?? badge.title ?? badge.playKey;
  const minted = Boolean(badge.mint && badge.txSig);
  return (
    <li className={cn(ITEM, "relative z-[1] bg-white/[0.025] before:absolute before:-inset-x-px before:-top-px before:h-0.5 before:bg-foreground")}>
      <span className={cn(FRAME, "ring-rule-2")}>
        {info ? (
          // Plain <img>: the SVG is served by our own route and next/image would only re-encode it.
          <span className="block size-full overflow-hidden rounded-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={badgeImageUrl(badge.playKey)} alt={info.name} width={512} height={512} className="size-full scale-[1.2]" loading="lazy" />
          </span>
        ) : (
          <span className="flex size-full items-center justify-center rounded-full text-xs text-muted-foreground">{badge.playKey}</span>
        )}
      </span>
      <div className="flex min-w-0 flex-col items-center gap-1.5">
        <p className="text-[0.9375rem] leading-snug font-semibold text-balance" title={info?.description}>
          {title}
        </p>
        <p className="text-[0.8125rem] whitespace-nowrap text-muted-foreground">
          Earned <time dateTime={badge.createdAt}>{formatDate(badge.createdAt)}</time>
        </p>
        {minted && badge.txSig ? (
          <div className="flex flex-col items-center gap-1">
            <span className={cn(TAG, "border-foreground bg-foreground text-background")}>
              <Check className="size-3" strokeWidth={3} aria-hidden />
              Minted
            </span>
            <a
              href={txExplorerUrl(badge.txSig)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-8 items-center gap-1 text-[0.8125rem] whitespace-nowrap text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline motion-reduce:transition-none"
            >
              View on Solscan
              <ArrowUpRight className="size-3" aria-hidden />
            </a>
          </div>
        ) : (
          <span className={cn(TAG, "border-rule-2 text-muted-foreground")} title="Badges mint to your wallet a few minutes after they are earned">
            Minting soon
          </span>
        )}
      </div>
    </li>
  );
}

/** A greyed-out design the user has not earned. Also used as the signed-out preview. */
export function LockedBadgeTile({ badgeKey, className }: { badgeKey: string; className?: string }) {
  const info = badgeInfo(badgeKey);
  if (!info) return null;
  return (
    <li className={cn(ITEM, className)} aria-label={`${info.title}: not earned yet`}>
      <span className={cn(FRAME, "ring-rule")}>
        <span className="block size-full overflow-hidden rounded-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={badgeImageUrl(badgeKey)} alt="" width={512} height={512} className="size-full scale-[1.2] opacity-40 grayscale" loading="lazy" />
        </span>
      </span>
      <div className="flex min-w-0 flex-col items-center gap-1">
        <p className="text-[0.9375rem] leading-snug font-medium text-balance text-foreground/85">{info.title}</p>
        <span className="inline-flex items-center gap-1.5 text-[0.8125rem] whitespace-nowrap text-muted-foreground">
          <span className="size-3 rounded-full border border-dashed border-muted-foreground" aria-hidden />
          Not earned yet
        </span>
      </div>
    </li>
  );
}

/** The five designs, locked, as one row of segments for the signed-out profile. */
export function BadgePreviewGrid({ className }: { className?: string }) {
  return (
    <ul className={cn(SHELF, "sm:grid-cols-3 lg:grid-cols-5", className)}>
      {BADGE_KEYS.map((key) => (
        <LockedBadgeTile key={key} badgeKey={key} />
      ))}
    </ul>
  );
}

export default BadgeGrid;
