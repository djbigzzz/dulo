"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Clock, LoaderCircle, Lock } from "lucide-react";
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
  questStatusNote,
  showsProgressBar,
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

/**
 * Status tones, shared by the segment's foot and the proof drawer. Broadcast keeps green and red
 * for Yes / No and gain / loss, so a state is told by weight and a mark, never by a hue: a complete
 * quest is cream with a check, one in progress cream with a dot, the rest muted.
 */
const STATUS = "inline-flex w-fit items-center gap-1.5 text-[0.84375rem] leading-none font-medium whitespace-nowrap";
const STATUS_DONE = "font-semibold text-foreground";
const STATUS_LIVE = "text-foreground";
const STATUS_QUIET = "text-muted-foreground";

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
      icon: Check,
      className: "border-foreground bg-foreground text-background",
    };
  }
  if (play.comingSoon)
    return {
      label: "Coming soon",
      icon: Clock,
      className: "border-dashed border-[rgb(243_240_232/0.38)] text-muted-foreground",
    };
  if (play.status === "in_progress")
    return {
      label: "In progress",
      icon: LoaderCircle,
      className: "border-rule-2 text-foreground",
    };
  return {
    label: "Not started",
    icon: Lock,
    className: "border-rule-2 text-muted-foreground",
  };
}

/** Medallion from the real Badge design (the artwork is unchanged by Broadcast, see docs/DESIGN.md). */
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
      className={cn("shrink-0 rounded-full", crop && "scale-[1.28]", dimmed && "opacity-60 grayscale", className)}
      style={{ width: size, height: size }}
    />
  );
  // `crop` zooms past the artwork's square card edge so the medallion ring fills the circle.
  return crop ? (
    <span className="inline-flex shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size }}>
      {img}
    </span>
  ) : (
    img
  );
}

/**
 * A round well with a thin cream ring, for Badge medallions (the logo well of docs/DESIGN.md).
 * `size` is the outer diameter; the medallion sits inside with a small inset. `glow` is kept for
 * callers: true draws the strong rule, false the quiet one.
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
        "relative inline-flex shrink-0 items-center justify-center rounded-full bg-ink-4 ring-1 ring-inset",
        glow ? "ring-rule-2" : "ring-rule",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

/**
 * Progress as segments: a quest of a few steps ("2 of 3 days") draws one segment per step, the done
 * ones cream; a longer one draws one cream bar on the ink well. Never shown for a dollar target.
 */
function ProgressSegments({ current, target, label }: { current: number; target: number; label: string }) {
  const whole = Number.isInteger(target) && target >= 2 && target <= 12;
  const pct = Math.max(0, Math.min(100, Math.round((current / target) * 100)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={target}
      aria-valuenow={current}
      className={cn("flex h-1.5 w-full", whole ? "gap-[3px]" : "bg-ink-4")}
    >
      {whole ? (
        Array.from({ length: target }).map((_, i) => (
          <span key={i} className={cn("h-full flex-1", i < Math.floor(current) ? "bg-foreground" : "bg-ink-4")} aria-hidden />
        ))
      ) : (
        <span className="h-full bg-foreground transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%` }} aria-hidden />
      )}
    </div>
  );
}

/**
 * One quest as a segment of the board: a scoreboard numeral for the points, the title, the rule in
 * one sentence, progress drawn in segments, and a foot with the status and the one way in. The
 * segment draws its own 1px rule, so a board of them (PlayGrid) overlaps the rules into one ruled
 * board, and a single one (the /prestocks list) still reads as a ruled tile. A complete quest
 * carries a cream rule along its top edge, as a lit row does on the standings.
 */
export function PlayCard<P extends PlayCardPlay>({ play, signedIn = false, showStatus = true, onProof, className }: PlayCardProps<P>) {
  const status = play.status ?? "locked";
  const complete = status === "complete";
  const soon = play.comingSoon && !complete;
  // The issuer the quest is fenced to: picks the noun in the hint and the unit, and the pill on a pre-IPO quest.
  const assetSource = questAssetSource(play);
  const preIpo = isPreIpoSource(assetSource);
  // No bar for a dollar target (it would read as "buy more"); units are labelled for people.
  // No bar either for a one-event quest (an adjustment): its status note says what it waits on.
  const progress = status === "in_progress" && showsProgressBar(play.rule) ? cardProgress(proofProgress(play.proof), assetSource) : null;
  // "Completes on the next adjustment.": the quest waits on the chain, not on the player, and never reads as failed.
  const statusNote = showStatus ? questStatusNote({ ...play, status }) : null;
  // In-platform quests (and Portfolio Match) link to where they happen inside Dulo; on-chain quests carry no action.
  const where = visibleStartAction({ ...play, status });
  const hasProof = !isEmptyProof(play.proof);
  const isGame = questKind(play) === "in-platform";
  const showProof = signedIn && Boolean(onProof) && hasProof;
  const showWhere = where !== null;
  const hasFooter = soon || showStatus || play.completions > 0 || showProof || showWhere;

  return (
    <article
      data-play-key={play.key}
      data-status={play.comingSoon ? "coming_soon" : status}
      className={cn(
        "group/play relative flex h-full flex-col gap-3.5 border bg-background p-4 sm:p-5",
        soon ? "border-dashed border-[rgb(243_240_232/0.3)]" : "border-rule",
        complete && "z-[1] bg-white/[0.025] before:absolute before:-inset-x-px before:-top-px before:h-0.5 before:bg-foreground",
        className,
      )}
    >
      {/* The points as a scoreboard numeral; the Badge the quest mints, beside it. */}
      <div className="flex items-start justify-between gap-4">
        <p className={cn("flex items-baseline gap-1.5 leading-none", soon && "opacity-70")}>
          <span className="figure text-[2.25rem] leading-[0.8] text-foreground sm:text-[2.5rem]">+{formatPoints(play.points)}</span>
          <span className="text-[0.8125rem] font-medium text-muted-foreground">points</span>
        </p>
        {play.badgeKey ? (
          <MedallionFrame size={40} glow={!soon}>
            <BadgeMedallion badgeKey={play.badgeKey} dimmed={soon} size={34} crop />
          </MedallionFrame>
        ) : (
          <span className="pt-0.5 text-[0.8125rem] text-dim">{isGame ? "In Dulo" : "From your wallet"}</span>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-[1.0625rem] leading-snug font-semibold tracking-[-0.005em]">{play.title}</h3>
          {/* Only a pre-IPO quest names its issuer: every other quest is an xStocks quest, the Season 0 default. */}
          {preIpo ? <IssuerPill source={assetSource} /> : null}
        </div>
        <p className="line-clamp-2 text-[0.9375rem] leading-relaxed text-muted-foreground">{play.desc}</p>
      </div>

      {/* The rule in one sentence; on phones the action below says the same thing, so it is hidden there. */}
      <p className="hidden border-l border-rule-2 pl-3 text-sm leading-snug text-foreground/85 sm:block">{ruleToHint(play.rule, assetSource)}</p>

      {progress ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-semibold text-foreground tabular-nums font-stretch-[85%]">
              {formatPoints(progress.current)} of {formatPoints(progress.target)}
              {progress.unit ? ` ${progress.unit}` : ""}
            </span>
          </div>
          <ProgressSegments current={progress.current} target={progress.target} label={`${play.title} progress`} />
        </div>
      ) : null}

      {hasFooter ? (
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-rule pt-3.5">
          {soon ? (
            <span className={cn(STATUS, STATUS_QUIET)}>
              <Clock className="size-3.5" aria-hidden />
              Coming soon
            </span>
          ) : showStatus ? (
            <StatusLine status={status} signedIn={signedIn} completedAt={play.completedAt ?? null} />
          ) : null}
          {statusNote ? (
            <span data-slot="status-note" className="text-[0.8125rem] text-muted-foreground">
              {statusNote}
            </span>
          ) : null}
          {/* A count only once it is social proof, not "1 player". */}
          {play.completions >= 5 ? (
            <span className="text-[0.8125rem] text-muted-foreground tabular-nums">
              {formatPoints(play.completions)} {play.completions === 1 ? "player" : "players"}
            </span>
          ) : null}
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3">
            {showProof && onProof ? (
              <Button variant="outline" size="sm" className="h-10 sm:h-8" onClick={() => onProof(play)}>
                Proof
              </Button>
            ) : null}
            {showWhere && where ? (
              <Link href={where.href} className={cn(buttonVariants({ variant: "link" }), "min-h-10 sm:min-h-0")}>
                {where.label}
                <ArrowRight data-icon="inline-end" className="transition-transform group-hover/play:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* The stored rule, verbatim, under the proof control. The card already prints the
          sentence above, so the disclosure shows the JSON only. Carries mt-auto itself when
          there is no footer to hold the card's foot. */}
      <RuleDisclosure rule={play.rule} showHint={false} className={cn("-mt-1.5 max-sm:hidden", !hasFooter && "mt-auto")} />
    </article>
  );
}

function StatusLine({ status, signedIn, completedAt }: { status: PlayStatus; signedIn: boolean; completedAt: string | null }) {
  if (status === "complete") {
    const when = formatDate(completedAt);
    return (
      <span className={cn(STATUS, STATUS_DONE)}>
        <span className="flex size-4 items-center justify-center rounded-full bg-foreground text-background" aria-hidden>
          <Check className="size-3" strokeWidth={3} />
        </span>
        {when ? `Complete · ${when}` : "Complete"}
      </span>
    );
  }
  if (!signedIn) {
    return (
      <span className={cn(STATUS, STATUS_QUIET)}>
        <Lock className="size-3.5" aria-hidden />
        Connect to track
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className={cn(STATUS, STATUS_LIVE)}>
        <span className="size-1.5 rounded-full bg-foreground" aria-hidden />
        In progress
      </span>
    );
  }
  if (status === "locked")
    return (
      <span className={cn(STATUS, STATUS_QUIET)}>
        <span className="size-3.5 rounded-full border-[1.5px] border-dashed border-muted-foreground" aria-hidden />
        Not started
      </span>
    );
  return null;
}

export function PlayCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full flex-col gap-4 border border-rule bg-background p-5", className)} aria-hidden>
      <div className="flex items-start justify-between gap-4">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="size-10 rounded-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <div className="mt-auto border-t border-rule pt-3.5">
        <Skeleton className="h-4 w-28" />
      </div>
    </div>
  );
}

export default PlayCard;
