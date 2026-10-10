import * as React from "react";
import { cn } from "cn";

export interface Stat {
  label: string;
  value: React.ReactNode;
  /** Small muted line under the value. */
  hint?: React.ReactNode;
  /**
   * Value colour. "positive" / "negative" are green / red (a gain or a loss, Yes or No) and nothing
   * else. "ember" and "gold" are kept from earlier themes and read as plain cream: Broadcast has no
   * accent colour for a headline number.
   */
  tone?: "default" | "ember" | "gold" | "positive" | "negative";
}

const TONE: Record<NonNullable<Stat["tone"]>, string> = {
  default: "text-foreground",
  ember: "text-foreground",
  gold: "text-foreground",
  positive: "text-yes",
  negative: "text-no",
};

/**
 * Broadcast numbers under a page title: an inline row of label / value pairs on 1px rules (a rule
 * above and below, a hairline between pairs), never a grid of boxes. One row from sm; on a phone
 * two columns, and an odd last pair spans both. Values are Archivo's condensed cut, tabular.
 */
export function StatStrip({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <dl
      data-slot="stat-strip"
      className={cn("grid grid-cols-2 border-y border-rule sm:flex sm:flex-wrap", className)}
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={cn(
            "flex min-w-0 flex-col gap-1.5 py-3 sm:min-w-[9rem] sm:flex-1 sm:py-4",
            // Phone: a hairline between the two columns and between rows.
            i % 2 === 1 ? "border-l border-rule pl-4" : "pr-4",
            i >= 2 && "border-t border-rule",
            // From sm: one row, a hairline before every pair but the first.
            "sm:border-t-0 sm:pr-6",
            i === 0 ? "sm:border-l-0 sm:pl-0" : "sm:border-l sm:border-rule sm:pl-6",
            // An odd count leaves a hole in the 2-column phone grid: the last pair spans it.
            stats.length % 2 === 1 && i === stats.length - 1 && "col-span-2 border-l-0 pl-0",
          )}
        >
          <dt className="truncate text-[0.84375rem] leading-tight font-medium text-muted-foreground">{s.label}</dt>
          <dd
            className={cn(
              "w-fit max-w-full truncate text-[1.5rem] leading-none font-semibold tracking-[-0.01em] tabular-nums font-stretch-[85%] sm:text-[1.625rem]",
              TONE[s.tone ?? "default"],
            )}
          >
            {s.value}
          </dd>
          {/* At most two lines at every width, so a hint is never cut to an ellipsis in a narrow cell. */}
          {s.hint ? <dd className="line-clamp-2 text-[0.78125rem] leading-snug break-words whitespace-normal text-muted-foreground">{s.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

export default StatStrip;
