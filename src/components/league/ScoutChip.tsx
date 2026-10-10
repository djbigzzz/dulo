"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "cn";
import type { ScoutProgress } from "@/components/league/scout";

/**
 * "First Paper Trades 1/3 · +50" as a Broadcast ruled tag (a 1px strong rule, no fill, no hue):
 * the quest's name in cream, the progress muted, a cream check once verified. Links to the quests page.
 */
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
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-rule-2 px-2 text-[0.8125rem] font-medium text-muted-foreground tabular-nums transition-colors outline-none hover:border-[rgb(243_240_232/0.3)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
        className,
      )}
    >
      {complete ? <Check className="size-3.5 text-foreground" strokeWidth={2.5} aria-hidden /> : null}
      <span className="font-semibold text-foreground">{title}</span>
      <span>{complete ? "complete" : `${current}/${target}`}</span>
      {complete ? null : (
        <>
          <span className="text-dim" aria-hidden>
            ·
          </span>
          <span>+{points.toLocaleString("en-US")}</span>
        </>
      )}
    </Link>
  );
}

export default ScoutChip;
