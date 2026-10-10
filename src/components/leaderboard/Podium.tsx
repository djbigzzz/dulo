"use client";

import type { ReactNode } from "react";
import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { displayName, formatPoints } from "@/components/common/format";
import { podiumSlots, type PodiumTier } from "@/components/leaderboard/podium-slots";

/** The minimum a podium spot needs; Season rows and League rows both fit. */
export interface PodiumEntry {
  rank: number;
  userId: string;
  handle: string | null;
  address: string | null;
}

/** The words in an empty seat (fewer than three players): an open seat, never a fake player. */
export interface OpenSeatCopy {
  title: string;
  hint: string;
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
  /** An action in a filled seat (e.g. "Copy portfolio"). */
  renderAction?: (row: T) => ReactNode;
  /** Empty seats read "Your slot · Open" by default; null leaves them out. */
  openSeat?: OpenSeatCopy | null;
  size?: "lg" | "sm";
  className?: string;
  "aria-label"?: string;
}

/**
 * Rank tones for 1st, 2nd and 3rd. Broadcast has no metals: the numeral is cream for the top of the
 * board and muted below it, as on the weekly standings. Shared with the tables and the competition preview.
 */
export const MEDAL: Record<PodiumTier, { number: string; seat: string; label: string }> = {
  1: { number: "text-foreground", seat: "border-rule-2", label: "1st" },
  2: { number: "text-muted-foreground", seat: "border-rule", label: "2nd" },
  3: { number: "text-muted-foreground", seat: "border-rule", label: "3rd" },
};

/** A rank as a scoreboard numeral (Archivo's narrow cut): cream for 1st, muted below it. */
export function MedalChip({ rank, className }: { rank: number; className?: string }) {
  const tone = rank === 1 ? "text-foreground" : "text-muted-foreground";
  return (
    <span className={cn("inline-flex min-w-7 shrink-0 items-center text-xl leading-none tabular-nums font-stretch-[74%]", tone, className)}>
      <span className="sr-only">Rank </span>
      {rank}
    </span>
  );
}

function defaultValue(row: PodiumEntry): ReactNode {
  return "points" in row && typeof row.points === "number" ? (
    <>
      <span className="figure text-[1.75rem] leading-none text-foreground">{formatPoints(row.points)}</span>
      <span className="text-[0.84375rem] text-muted-foreground">Season points</span>
    </>
  ) : null;
}

/** Visual seat order: 1st, 2nd, 3rd, left to right, the way the board reads (the mockup's Season seats). */
const SEAT_ORDER: Record<PodiumTier, number> = { 1: 0, 2: 1, 3: 2 };

/**
 * The top three as the Broadcast Season seats: three seats in a row, a scoreboard numeral in each,
 * the filled ones on the panel surface with the name and the points, the empty ones a dashed open
 * seat ("Your slot · Open"), so one or two players never borrow a podium they do not fill. The
 * numeral's tone, the "=1st" tie mark and the spoken label follow each row's own rank (podiumSlots
 * and MEDAL[tier]), never the seat it sits in: two players tied for 1st both read "Tied 1st".
 */
export function Podium<T extends PodiumEntry>({
  rows,
  meUserId,
  renderValue = defaultValue,
  renderTag,
  renderAction,
  openSeat = { title: "Your slot", hint: "Open" },
  size = "lg",
  className,
  "aria-label": ariaLabel = "Top three",
}: PodiumProps<T>) {
  const slots = [...podiumSlots(rows)].sort((a, b) => SEAT_ORDER[a.slot] - SEAT_ORDER[b.slot]);
  if (rows.length === 0 && !openSeat) return null;
  const lg = size === "lg";

  return (
    <ol className={cn("grid gap-3", lg ? "sm:grid-cols-3 sm:gap-4" : "grid-cols-3 gap-2", className)} aria-label={ariaLabel}>
      {slots.map(({ slot, row, tier, tied, label, spokenLabel }) => {
        const numeral = cn("figure shrink-0 leading-[0.8]", lg ? "text-[3.75rem] sm:text-[4.5rem]" : "text-[2.25rem]");
        if (!row) {
          if (!openSeat) return <li key={`empty-${slot}`} aria-hidden className="min-w-0" />;
          return (
            <li
              key={`empty-${slot}`}
              data-slot="open-seat"
              className={cn(
                "flex min-w-0 items-center border border-dashed border-[rgb(243_240_232/0.3)]",
                lg ? "min-h-[5.5rem] gap-4 px-4 py-4 sm:min-h-28 sm:px-5" : "min-h-16 gap-2.5 px-2.5 py-2",
              )}
              aria-label={`${label}: open`}
            >
              <span className={cn(numeral, "text-dim")} aria-hidden>
                {slot}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className={cn("truncate font-semibold text-foreground", lg ? "text-[1.0625rem]" : "text-sm")}>{openSeat.title}</span>
                <span className={cn("truncate text-muted-foreground", lg ? "text-[0.9375rem]" : "text-xs")}>{openSeat.hint}</span>
              </span>
            </li>
          );
        }
        const medal = MEDAL[tier];
        const name = displayName(row.handle, row.address);
        const isMe = Boolean(meUserId && row.userId === meUserId);
        const value = renderValue(row);
        const action = renderAction?.(row);
        return (
          <li
            key={row.userId}
            value={row.rank}
            data-user-id={row.userId}
            className={cn(
              "relative flex min-w-0 items-center border bg-card",
              lg ? "min-h-[5.5rem] gap-4 px-4 py-4 sm:min-h-28 sm:px-5" : "min-h-16 gap-2.5 px-2.5 py-2",
              medal.seat,
              isMe && "before:absolute before:inset-y-0 before:-left-px before:w-0.5 before:bg-foreground",
            )}
            aria-label={`${spokenLabel}: ${name}${isMe ? " (you)" : ""}`}
          >
            <span className={cn(numeral, medal.number)} aria-hidden>
              {row.rank}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn("truncate font-semibold text-foreground", lg ? "text-[1.0625rem]" : "text-sm")} title={row.address ?? name}>
                  {name}
                </span>
                {isMe ? <Badge className="h-5 px-1.5 text-xs font-semibold">You</Badge> : renderTag?.(row)}
                {tied ? <span className="shrink-0 text-xs text-muted-foreground">{label}</span> : null}
              </span>
              {value !== null ? <span className={cn("flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5", !lg && "text-xs")}>{value}</span> : null}
              {action ? <span className="mt-0.5">{action}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function PodiumSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-3 sm:gap-4", className)} aria-hidden>
      {[1, 2, 3].map((n) => (
        <div key={n} className="flex min-h-[5.5rem] items-center gap-4 border border-rule px-4 py-4 sm:min-h-28 sm:px-5">
          <Skeleton className="h-14 w-9" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default Podium;
