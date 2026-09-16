import * as React from "react";
import { cn } from "cn";

export interface Stat {
  label: string;
  value: React.ReactNode;
  /** Small muted line under the value. */
  hint?: React.ReactNode;
  /** "ember" highlights the headline number of the page; use it at most once per strip. */
  tone?: "default" | "ember" | "gold" | "positive" | "negative";
}

const TONE: Record<NonNullable<Stat["tone"]>, string> = {
  default: "text-foreground",
  ember: "text-gradient-ember",
  gold: "text-gradient-gold",
  positive: "text-emerald-400",
  negative: "text-rose-400",
};

/**
 * A row of scoreboard-style numbers under a page title: 2 columns on phones, up to 4 on
 * desktop. One glass panel; tiles are separated by hairlines drawn on each tile's right and
 * bottom edge (the panel clips the outer ones), so it works on translucent surfaces.
 */
export function StatStrip({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 overflow-hidden rounded-2xl border border-white/[0.07] bg-card",
        stats.length >= 4 ? "md:grid-cols-4" : stats.length === 3 ? "md:grid-cols-3" : "",
        className,
      )}
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={cn(
            "-mr-px -mb-px flex min-w-0 flex-col gap-1 border-r border-b border-white/[0.06] px-4 py-3 sm:px-5 sm:py-4",
            // An odd count leaves a hole in the 2-column phone grid: let the last tile span it.
            stats.length % 2 === 1 && i === stats.length - 1 && "col-span-2 md:col-span-1",
          )}
        >
          <dt className="truncate text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">{s.label}</dt>
          <dd className={cn("w-fit max-w-full truncate text-2xl font-semibold tracking-tight tabular-nums sm:text-[1.9rem] sm:leading-tight", TONE[s.tone ?? "default"])}>
            {s.value}
          </dd>
          {/* Phones: the half-width tile is too narrow for one line, so the hint wraps to two. From sm: one line. */}
          {s.hint ? <dd className="line-clamp-2 text-xs break-words whitespace-normal text-muted-foreground/90 sm:line-clamp-1">{s.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

export default StatStrip;
