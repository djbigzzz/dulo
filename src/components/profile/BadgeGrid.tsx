"use client";

import { Check, ExternalLink, Lock } from "lucide-react";
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

/** Centred wrap so a short last row sits in the middle of the shelf. */
const SHELF = "flex flex-wrap items-start justify-center gap-x-3 gap-y-8 sm:gap-x-8";
const ITEM = "flex w-[5.5rem] flex-col items-center gap-3 text-center sm:w-36";
const FRAME =
  "relative flex size-20 shrink-0 items-center justify-center rounded-full bg-gold/[0.06] p-1.5 ring-1 ring-gold/30 sm:size-28 sm:p-2";
const PILL = "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap";

/** A soft radial gold glow behind the shelf. Place inside a `relative` parent. */
export function ShelfGlow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 bg-[radial-gradient(55%_65%_at_50%_42%,rgb(216_180_106/0.1)_0%,transparent_70%)]",
        className,
      )}
      aria-hidden
    />
  );
}

/**
 * Badges as a trophy shelf: medallions in gold-rimmed frames on a subtle gold glow. Minted
 * badges link to their transaction on Solscan; queued ones read "Minting soon"; designs not
 * yet earned are greyed out.
 */
export function BadgeGrid({ badges, showLocked = true, className }: BadgeGridProps) {
  const earned = new Set(badges.map((b) => b.playKey));
  const locked = showLocked ? BADGE_KEYS.filter((k) => !earned.has(k)) : [];
  return (
    <div className={cn("relative overflow-hidden rounded-3xl border border-white/[0.07] bg-card px-3 py-8 sm:px-8 sm:py-10", className)}>
      <ShelfGlow />
      {/* Earned tiles carry a date and a mint status, so phones get two wider columns here. */}
      <ul className={cn(SHELF, "relative gap-x-5 [&>li]:w-[8.25rem] sm:gap-x-8 sm:[&>li]:w-36")}>
        {badges.map((b) => (
          <BadgeTile key={b.playKey} badge={b} />
        ))}
        {locked.map((key) => (
          <LockedBadgeTile key={key} badgeKey={key} />
        ))}
      </ul>
    </div>
  );
}

function BadgeTile({ badge }: { badge: BadgeView }) {
  const info = badgeInfo(badge.playKey);
  const title = info?.title ?? badge.title ?? badge.playKey;
  const minted = Boolean(badge.mint && badge.txSig);
  const color = info?.color ?? "#ff6b1a";
  return (
    <li className={ITEM}>
      <span
        className={FRAME}
        style={{
          boxShadow: `inset 0 1px 0 rgb(255 245 230 / 0.1), 0 0 36px -8px color-mix(in oklch, ${color} 55%, transparent), 0 0 24px -10px rgb(216 180 106 / 0.5)`,
        }}
      >
        {info ? (
          // Plain <img>: the SVG is served by our own route and next/image would only re-encode it.
          <span className="block size-full overflow-hidden rounded-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={badgeImageUrl(badge.playKey)} alt={info.name} width={512} height={512} className="size-full scale-[1.2]" loading="lazy" />
          </span>
        ) : (
          <span className="flex size-full items-center justify-center rounded-full bg-white/[0.04] text-xs text-muted-foreground">{badge.playKey}</span>
        )}
      </span>
      <div className="flex min-w-0 flex-col items-center gap-1.5">
        <p className="text-sm leading-snug font-semibold tracking-tight text-balance" title={info?.description}>
          {title}
        </p>
        <p className="text-xs whitespace-nowrap text-muted-foreground">Earned {formatDate(badge.createdAt)}</p>
        {minted && badge.txSig ? (
          <div className="flex flex-col items-center gap-1">
            <span className={cn(PILL, "border-emerald-400/25 bg-emerald-400/10 text-emerald-400")}>
              <Check className="size-3" strokeWidth={2.75} aria-hidden />
              Minted
            </span>
            <a
              href={txExplorerUrl(badge.txSig)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-8 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
            >
              View on Solscan
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        ) : (
          <span
            className={cn(PILL, "border-white/[0.08] bg-white/[0.03] text-muted-foreground")}
            title="Badges mint to your wallet a few minutes after they are earned"
          >
            Minting soon
          </span>
        )}
      </div>
    </li>
  );
}

/** A greyed-out design the user has not earned. Also used as the signed-out preview. */
export function LockedBadgeTile({ badgeKey }: { badgeKey: string }) {
  const info = badgeInfo(badgeKey);
  if (!info) return null;
  return (
    <li className={ITEM} aria-label={`${info.title}: not earned yet`}>
      <span className={cn(FRAME, "shadow-[inset_0_1px_0_rgb(255_245_230/0.08),0_0_28px_-10px_rgb(216_180_106/0.35)]")}>
        <span className="block size-full overflow-hidden rounded-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={badgeImageUrl(badgeKey)} alt="" width={512} height={512} className="size-full scale-[1.2] opacity-40 grayscale" loading="lazy" />
        </span>
      </span>
      <div className="flex min-w-0 flex-col items-center gap-1">
        <p className="text-sm leading-snug font-medium text-balance text-foreground/80">{info.title}</p>
        <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
          <Lock className="hidden size-3 sm:block" aria-hidden />
          Not earned yet
        </span>
      </div>
    </li>
  );
}

/** The five designs, locked, as a bare shelf (no panel) for embedding in a hero. */
export function BadgePreviewGrid({ className }: { className?: string }) {
  return (
    <ul className={cn(SHELF, className)}>
      {BADGE_KEYS.map((key) => (
        <LockedBadgeTile key={key} badgeKey={key} />
      ))}
    </ul>
  );
}

export default BadgeGrid;
