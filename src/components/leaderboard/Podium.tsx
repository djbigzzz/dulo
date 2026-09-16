"use client";

import type { ReactNode } from "react";
import { Crown } from "lucide-react";
import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName, formatPoints, initials } from "@/components/common/format";
import { podiumSlots } from "@/components/leaderboard/podium-slots";

/** The minimum a podium spot needs; Season rows and League rows both fit. */
export interface PodiumEntry {
  rank: number;
  userId: string;
  handle: string | null;
  address: string | null;
}

export interface PodiumProps<T extends PodiumEntry> {
  /** Already-ranked rows; only the first three are used. */
  rows: T[];
  /** Highlight the signed-in user's spot. */
  meUserId?: string | null;
  /** The number under the name. Defaults to Season points. */
  renderValue?: (row: T) => ReactNode;
  /** Small muted tag after the name (e.g. "bot"). */
  renderTag?: (row: T) => ReactNode;
  size?: "lg" | "sm";
  className?: string;
  "aria-label"?: string;
}

/** Gold / silver / bronze per docs/DESIGN.md. Shared with the tables and the League preview. */
export const MEDAL: Record<1 | 2 | 3, { chip: string; avatar: string; edge: string; text: string; number: string; label: string }> = {
  1: {
    chip: "border-gold/30 bg-gold/[0.10] text-gold",
    avatar: "bg-gold/[0.10] text-gold ring-gold/60",
    edge: "from-gold/0 via-[#f0d9a4] to-gold/0",
    text: "text-gold",
    number: "text-gradient-gold",
    label: "1st",
  },
  2: {
    chip: "border-zinc-300/20 bg-zinc-300/10 text-zinc-300",
    avatar: "bg-zinc-300/10 text-zinc-300 ring-zinc-300/40",
    edge: "from-zinc-300/0 via-zinc-300/60 to-zinc-300/0",
    text: "text-zinc-300",
    number: "text-zinc-300",
    label: "2nd",
  },
  3: {
    chip: "border-[#d49a6a]/25 bg-[#d49a6a]/10 text-[#d49a6a]",
    avatar: "bg-[#d49a6a]/10 text-[#d49a6a] ring-[#d49a6a]/45",
    edge: "from-[#d49a6a]/0 via-[#d49a6a]/60 to-[#d49a6a]/0",
    text: "text-[#d49a6a]",
    number: "text-[#d49a6a]",
    label: "3rd",
  },
};

/** A round rank chip: medal-toned for 1-3, a quiet number otherwise. */
export function MedalChip({ rank, className }: { rank: number; className?: string }) {
  const medal = rank >= 1 && rank <= 3 ? MEDAL[rank as 1 | 2 | 3] : null;
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
        medal ? cn("border shadow-[inset_0_1px_0_rgb(255_245_230/0.10)]", medal.chip) : "text-muted-foreground",
        className,
      )}
    >
      {rank}
    </span>
  );
}

const HEIGHT = {
  lg: { 1: "h-32 sm:h-48", 2: "h-24 sm:h-36", 3: "h-20 sm:h-28" },
  sm: { 1: "h-16", 2: "h-12", 3: "h-9" },
} as const;

function defaultValue(row: PodiumEntry): ReactNode {
  return "points" in row && typeof row.points === "number" ? `${formatPoints(row.points)} pts` : null;
}

/**
 * Top three as an award ceremony: glass plinths of different heights, the centre slot tallest with
 * a soft gold glow behind it. Slot order and heights are visual (2nd, 1st, 3rd); the medal, crown,
 * chip and label follow each row's own rank, so two players tied for 1st both read "=1st" in gold
 * (15 Sep review M-P). Three columns fit a 375px phone.
 */
export function Podium<T extends PodiumEntry>({
  rows,
  meUserId,
  renderValue = defaultValue,
  renderTag,
  size = "lg",
  className,
  "aria-label": ariaLabel = "Top three",
}: PodiumProps<T>) {
  if (rows.length === 0) return null;
  const slots = podiumSlots(rows);
  const lg = size === "lg";

  return (
    <ol className={cn("relative isolate grid grid-cols-3 items-end gap-2 sm:gap-4", lg && "mx-auto w-full max-w-3xl", className)} aria-label={ariaLabel}>
      {slots.map(({ slot: pos, row, tier, label, spokenLabel }) => {
        const medal = MEDAL[tier];
        // Missing spots (fewer than three players) stay empty.
        if (!row) return <li key={`empty-${pos}`} aria-hidden className="min-w-0" />;
        const name = displayName(row.handle, row.address);
        const isMe = Boolean(meUserId && row.userId === meUserId);
        const value = renderValue(row);
        return (
          <li
            key={row.userId}
            value={row.rank}
            className="relative flex min-w-0 flex-col items-center gap-3"
            aria-label={`${spokenLabel}: ${name}${isMe ? " (you)" : ""}${typeof value === "string" || typeof value === "number" ? `, ${value}` : ""}`}
          >
            {pos === 1 ? (
              <span
                className={cn(
                  "pointer-events-none absolute left-1/2 -z-10 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(216_180_106/0.26),rgb(216_180_106/0.08)_55%,transparent)]",
                  lg ? "-top-10 size-60 sm:size-72" : "-top-6 size-36",
                )}
                aria-hidden
              />
            ) : null}

            <div className="flex w-full min-w-0 flex-col items-center gap-1.5">
              <span
                className={cn(
                  "relative flex items-center justify-center rounded-full font-semibold tracking-tight uppercase ring-2 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.6),inset_0_1px_0_rgb(255_245_230/0.12)]",
                  lg ? (pos === 1 ? "size-16 text-lg sm:size-20 sm:text-xl" : "size-12 text-sm sm:size-14") : pos === 1 ? "size-11 text-sm" : "size-9 text-xs",
                  medal.avatar,
                  isMe && "ring-ember",
                )}
                aria-hidden
              >
                {initials(name)}
                {tier === 1 ? <Crown className={cn("absolute left-1/2 -translate-x-1/2 fill-gold/20 text-gold", lg ? "-top-5 size-5" : "-top-4 size-4")} /> : null}
              </span>
              <span
                className={cn("mt-1 max-w-full truncate text-center font-medium", lg ? "text-sm sm:text-base" : "text-sm", isMe && "text-ember")}
                title={row.address ?? name}
              >
                {name}
              </span>
              {isMe || renderTag ? (
                <span className="flex h-5 items-center gap-1 text-xs text-muted-foreground">
                  {isMe ? (
                    <span className="rounded-full border border-ember/30 bg-ember/10 px-2 text-xs font-medium text-ember">You</span>
                  ) : (
                    renderTag?.(row)
                  )}
                </span>
              ) : null}
              {value !== null ? (
                <span
                  className={cn(
                    "font-semibold tracking-tight tabular-nums",
                    lg ? (pos === 1 ? "text-lg sm:text-2xl" : "text-base sm:text-xl") : "text-sm",
                    tier === 1 ? "text-gradient-gold" : "text-foreground",
                  )}
                >
                  {value}
                </span>
              ) : null}
            </div>

            <div
              className={cn(
                "relative flex w-full flex-col items-center justify-start gap-2 overflow-hidden rounded-t-2xl border border-b-0 border-white/[0.07] bg-card [mask-image:linear-gradient(to_bottom,#000_calc(100%_-_1.5rem),transparent)]",
                lg ? "pt-3 sm:pt-4" : "pt-1.5",
                HEIGHT[size][pos],
                pos === 1 && "border-gold/20",
              )}
            >
              <span className={cn("absolute inset-x-0 top-0 h-px bg-gradient-to-r", medal.edge)} aria-hidden />
              {pos === 1 ? (
                <span className="pointer-events-none absolute inset-x-0 top-0 h-2/3 bg-gradient-to-b from-gold/[0.10] to-transparent" aria-hidden />
              ) : null}
              <span className={cn("relative leading-none font-semibold tracking-tight tabular-nums", lg ? "text-3xl sm:text-5xl" : "text-lg", medal.number)}>
                {row.rank}
              </span>
              {lg ? (
                <span className={cn("relative hidden rounded-full border px-2 py-0.5 text-xs font-medium tracking-[0.14em] uppercase sm:inline-flex", medal.chip)}>
                  {label}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function PodiumSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto grid w-full max-w-3xl grid-cols-3 items-end gap-2 sm:gap-4", className)} aria-hidden>
      {([2, 1, 3] as const).map((pos) => (
        <div key={pos} className="flex flex-col items-center gap-3">
          <Skeleton className={cn("rounded-full", pos === 1 ? "size-16 sm:size-20" : "size-12 sm:size-14")} />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-14" />
          <Skeleton className={cn("w-full rounded-t-2xl rounded-b-none", HEIGHT.lg[pos])} />
        </div>
      ))}
    </div>
  );
}

export default Podium;
