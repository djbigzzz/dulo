"use client";

import Link from "next/link";
import { Check, Compass } from "lucide-react";
import { cn } from "cn";
import type { ScoutProgress } from "@/components/league/scout";

/** "First Paper Trades 1/3 · +50" glass pill (emerald "complete" once verified). Links to the quests page. */
export function ScoutChip({ progress, className }: { progress: ScoutProgress | null; className?: string }) {
  if (!progress) return null;
  const { title, points, current, target, complete } = progress;
  const label = complete
    ? `${title} quest complete, ${points} points`
    : `${title} quest: ${current} of ${target} paper trades, ${points} points when complete`;

  return (
    <Link
      href="/quests"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium tabular-nums transition-colors duration-300 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        complete
          ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300"
          : "border-white/[0.08] bg-white/[0.03] text-muted-foreground shadow-[inset_0_1px_0_rgb(255_245_230/0.06)] hover:border-white/15 hover:text-foreground",
        className,
      )}
    >
      {complete ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : <Compass className="size-3.5 text-gold" aria-hidden />}
      <span className="text-foreground/90">{title}</span>
      <span>{complete ? "complete" : `${current}/${target}`}</span>
      {complete ? null : (
        <>
          <span className="text-muted-foreground/50" aria-hidden>
            ·
          </span>
          <span>+{points.toLocaleString("en-US")}</span>
        </>
      )}
    </Link>
  );
}

export default ScoutChip;
