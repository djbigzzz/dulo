"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  FileSearch,
  Gamepad2,
  LoaderCircle,
  Lock,
  WalletCards,
} from "lucide-react";
import { cn } from "cn";
import { badgeImageUrl, type PlayStatus } from "@/lib/api-client";
import type { PlayRule } from "@/lib/plays/rules";
import { badgeInfo } from "@/lib/badges/keys";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatPoints } from "@/components/common/format";
import { isPreIpoSource, questAssetSource } from "@/components/common/issuer";
import { IssuerPill } from "@/components/common/IssuerPill";
import { ruleToHint } from "@/components/plays/rule-hint";
import { RuleDisclosure } from "@/components/plays/RuleDisclosure";
import { isEmptyProof } from "@/components/plays/proof";
import {
  cardProgress,
  proofProgress,
  questKind,
  visibleStartAction,
} from "@/components/plays/play-meta";

/**
 * A quest as the card needs it. PlayView fits as-is; PartnerPlayView (no per-user state)
 * fits with status/proof/completedAt left out.
 */
export interface PlayCardPlay {
  key: string;
  title: string;
  desc: string;
  points: number;
  badgeKey: string | null;
  rule: PlayRule;
  completions: number;
  comingSoon: boolean;
  status?: PlayStatus;
  completedAt?: string | null;
  proof?: unknown;
  /** Play.assetSource when the route sends it; the card also reads the key (questAssetSource). */
  assetSource?: string | null;
}

export interface PlayCardProps<P extends PlayCardPlay = PlayCardPlay> {
  play: P;
  /** Signed-out cards show a quiet lock and never a Proof button. */
  signedIn?: boolean;
  /** False drops the per-user status line (Partner pages carry no user state). Default true. */
  showStatus?: boolean;
  /** Opens the proof drawer. The Proof button shows only when there is proof. */
  onProof?: (play: P) => void;
  className?: string;
}

/** Refined status pills shared by the card footer and the proof drawer. */
const PILL =
  "inline-flex h-7 w-fit items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap";
const PILL_GLASS =
  "border-white/[0.08] bg-white/[0.03] text-muted-foreground shadow-[inset_0_1px_0_rgb(255_245_230/0.05)]";
const PILL_EMBER = "border-ember/25 bg-ember/[0.08] text-[#ff9452]";
const PILL_EMERALD = "border-emerald-400/25 bg-emerald-400/10 text-emerald-400";

/** Status chip copy + styling for the proof drawer. "Coming soon" wins over everything except a completed quest. */
export function playStatusChip(play: {
  status: PlayStatus;
  comingSoon: boolean;
  completedAt: string | null;
}): {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  className: string;
} {
  if (play.status === "complete") {
    const when = formatDate(play.completedAt);
    return {
      label: when ? `Complete · ${when}` : "Complete",
      icon: CheckCircle2,
      className: PILL_EMERALD,
    };
  }
  if (play.comingSoon)
    return {
      label: "Coming soon",
      icon: Clock,
      className: "border-dashed border-white/15 text-muted-foreground",
    };
  if (play.status === "in_progress")
    return {
      label: "In progress",
      icon: LoaderCircle,
      className: PILL_EMBER,
    };
  return {
    label: "Not started",
    icon: Lock,
    className: PILL_GLASS,
  };
}

/** Medallion from the real Badge design. */
export function BadgeMedallion({
  badgeKey,
  dimmed = false,
  size = 40,
  crop = false,
  className,
}: {
  badgeKey: string;
  dimmed?: boolean;
  size?: number;
  /** Zoom into the medallion ring (for round frames). */
  crop?: boolean;
  className?: string;
}) {
  const info = badgeInfo(badgeKey);
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- our own SVG route; next/image would only re-encode it
    <img
      src={badgeImageUrl(badgeKey)}
      alt={info ? `${info.title} Badge` : "Badge"}
      title={info ? `Mints the ${info.title} Badge` : "Mints a Badge"}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={cn(
        "shrink-0 rounded-full",
        crop && "scale-[1.28]",
        dimmed && "opacity-60 grayscale",
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
  // `crop` zooms past the artwork's square card edge so the medallion ring fills the circle.
  return crop ? (
    <span
      className="inline-flex shrink-0 overflow-hidden rounded-full"
      style={{ width: size, height: size }}
    >
      {img}
    </span>
  ) : (
    img
  );
}

/**
 * A round gold-rimmed frame with a soft gold glow, for Badge medallions. `size` is the
 * outer diameter; the medallion sits inside with a small inset.
 */
export function MedallionFrame({
  size = 56,
  glow = true,
  className,
  children,
}: {
  size?: number;
  glow?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full bg-gold/[0.06] ring-1 ring-gold/30",
        glow
          ? "shadow-[inset_0_1px_0_rgb(255_245_230/0.1),0_0_28px_-6px_rgb(216_180_106/0.45)]"
          : "shadow-[inset_0_1px_0_rgb(255_245_230/0.08)]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

export function PlayCard<P extends PlayCardPlay>({
  play,
  signedIn = false,
  showStatus = true,
  onProof,
  className,
}: PlayCardProps<P>) {
  const status = play.status ?? "locked";
  const complete = status === "complete";
  // The issuer the quest is fenced to: picks the noun in the hint and the unit, and the pill on a pre-IPO quest.
  const assetSource = questAssetSource(play);
  const preIpo = isPreIpoSource(assetSource);
  // No bar for a dollar target (it would read as "buy more"); units are labelled for people.
  const progress = status === "in_progress" ? cardProgress(proofProgress(play.proof), assetSource) : null;
  // In-platform quests (and Portfolio Match) link to where they happen inside Dulo; on-chain quests carry no action.
  const where = visibleStartAction({ ...play, status });
  const hasProof = !isEmptyProof(play.proof);
  const pct = progress
    ? Math.round((progress.current / progress.target) * 100)
    : 0;
  const isGame = questKind(play) === "in-platform";
  const showProof = signedIn && Boolean(onProof) && hasProof;
  const showWhere = where !== null;
  const hasFooter =
    (play.comingSoon && !complete) ||
    showStatus ||
    play.completions > 0 ||
    showProof ||
    showWhere;
  const CategoryIcon = isGame ? Gamepad2 : WalletCards;

  return (
    <article
      data-play-key={play.key}
      data-status={play.comingSoon ? "coming_soon" : status}
      className={cn(
        "group/play relative flex h-full flex-col gap-4 overflow-hidden rounded-2xl border bg-card p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.04] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        play.comingSoon && !complete
          ? "border-dashed border-white/10"
          : complete
            ? "border-emerald-400/15"
            : "border-white/[0.07]",
        className,
      )}
    >
      {complete ? (
        <span
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent"
          aria-hidden
        />
      ) : null}

      {/* Medallion (or category tile) and the points, collectible-card style. */}
      <div className="flex items-start justify-between gap-4">
        {play.badgeKey ? (
          <MedallionFrame size={56} glow={!play.comingSoon}>
            <BadgeMedallion
              badgeKey={play.badgeKey}
              dimmed={play.comingSoon}
              size={48}
              crop
            />
          </MedallionFrame>
        ) : (
          <span
            className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-gold shadow-[inset_0_1px_0_rgb(255_245_230/0.06)]"
            aria-hidden
          >
            <CategoryIcon className="size-5" />
          </span>
        )}
        <p className="shrink-0 text-right leading-none">
          <span
            className={cn(
              "block text-3xl font-semibold tracking-tight tabular-nums",
              play.badgeKey ? "text-gradient-gold" : "text-foreground",
              play.comingSoon && !complete && "opacity-70",
            )}
          >
            +{formatPoints(play.points)}
          </span>
          <span className="mt-1.5 block text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            pts
          </span>
        </p>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-base leading-snug font-semibold tracking-tight">
            {play.title}
          </h3>
          {/* Only a pre-IPO quest names its issuer: every other quest is an xStocks quest, the Season 0 default. */}
          {preIpo ? <IssuerPill source={assetSource} /> : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {play.desc}
        </p>
      </div>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <FileSearch
          className="mt-0.5 size-4 shrink-0 text-gold/70"
          aria-hidden
        />
        <span>{ruleToHint(play.rule, assetSource)}</span>
      </p>

      {progress ? (
        <div className="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2.5 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-medium text-foreground tabular-nums">
              {formatPoints(progress.current)} of{" "}
              {formatPoints(progress.target)}
              {progress.unit ? ` ${progress.unit}` : ""}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={`${play.title} progress`}
            aria-valuemin={0}
            aria-valuemax={progress.target}
            aria-valuenow={progress.current}
            className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
          >
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#ff9452,#ff6a2a_60%,#e2471a)] shadow-[0_0_12px_rgb(255_106_42/0.55)] transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : null}

      {hasFooter ? (
        <div className="mt-auto flex flex-col gap-4">
          <div
            className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"
            aria-hidden
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {play.comingSoon && !complete ? (
              <span
                className={cn(
                  PILL,
                  "border-dashed border-white/15 text-muted-foreground",
                )}
              >
                <Clock className="size-3.5" aria-hidden />
                Coming soon
              </span>
            ) : showStatus ? (
              <StatusLine
                status={status}
                signedIn={signedIn}
                completedAt={play.completedAt ?? null}
              />
            ) : null}
            {play.completions > 0 ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatPoints(play.completions)}{" "}
                {play.completions === 1 ? "player" : "players"}
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {showProof && onProof ? (
                <Button
                  variant="outline"
                  className="h-10 sm:h-8"
                  onClick={() => onProof(play)}
                >
                  Proof
                </Button>
              ) : null}
              {showWhere && where ? (
                <Link
                  href={where.href}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "h-10 sm:h-8",
                  )}
                >
                  {where.label}
                  <ArrowRight
                    data-icon="inline-end"
                    className="transition-transform group-hover/play:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* The stored rule, verbatim, under the proof control. The card already prints the
          sentence above, so the disclosure shows the JSON only. Carries mt-auto itself when
          there is no footer to hold the card's foot. */}
      <RuleDisclosure
        rule={play.rule}
        showHint={false}
        className={cn(!hasFooter && "mt-auto")}
      />
    </article>
  );
}

function StatusLine({
  status,
  signedIn,
  completedAt,
}: {
  status: PlayStatus;
  signedIn: boolean;
  completedAt: string | null;
}) {
  if (status === "complete") {
    const when = formatDate(completedAt);
    return (
      <span className={cn(PILL, PILL_EMERALD)}>
        <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
        {when ? `Complete · ${when}` : "Complete"}
      </span>
    );
  }
  if (!signedIn) {
    return (
      <span className={cn(PILL, PILL_GLASS)}>
        <Lock className="size-3.5" aria-hidden />
        Connect to track
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className={cn(PILL, PILL_EMBER)}>
        <span className="relative flex size-1.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-ember/70 motion-reduce:animate-none" />
          <span className="relative inline-flex size-1.5 rounded-full bg-ember" />
        </span>
        In progress
      </span>
    );
  }
  if (status === "locked")
    return (
      <span className={cn(PILL, PILL_GLASS)}>
        <Lock className="size-3.5" aria-hidden />
        Not started
      </span>
    );
  return null;
}

export function PlayCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-4 rounded-2xl border border-white/[0.07] bg-card p-5",
        className,
      )}
      aria-hidden
    >
      <div className="flex items-start justify-between gap-4">
        <Skeleton className="size-14 rounded-full bg-white/[0.05]" />
        <Skeleton className="h-8 w-16 rounded-lg bg-white/[0.05]" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-2/5 bg-white/[0.05]" />
        <Skeleton className="h-4 w-full bg-white/[0.05]" />
        <Skeleton className="h-4 w-4/5 bg-white/[0.05]" />
      </div>
      <Skeleton className="h-4 w-3/5 bg-white/[0.05]" />
      <div className="mt-auto h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <Skeleton className="h-7 w-28 rounded-full bg-white/[0.05]" />
    </div>
  );
}

export default PlayCard;
