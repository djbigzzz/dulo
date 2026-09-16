"use client";

import * as React from "react";
import { cn } from "cn";
import { PLAY_FILTERS, type PlayFilter } from "@/components/plays/play-meta";

export interface PlayFilterBarProps {
  value: PlayFilter;
  onChange: (value: PlayFilter) => void;
  /** Matching quest count per filter, shown after the label. */
  counts?: Partial<Record<PlayFilter, number>>;
  className?: string;
}

const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * Segmented All · In-platform · On-chain · Badges control ("Filter quests"). A radiogroup with a roving tabindex:
 * Tab lands on the selected option, arrow keys / Home / End move and select. A glass pill
 * slides under the selected option; until it has been measured the option paints its own fill.
 */
export function PlayFilterBar({ value, onChange, counts, className }: PlayFilterBarProps) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, PLAY_FILTERS.findIndex((f) => f.value === value));
  const [pill, setPill] = React.useState<{ left: number; width: number } | null>(null);
  // Counts change the option widths; key on their values, not the (per-render) object.
  const countsKey = PLAY_FILTERS.map((f) => counts?.[f.value] ?? "").join(",");

  useIsoLayoutEffect(() => {
    const el = refs.current[index];
    if (!el) return;
    const measure = () => {
      const next = { left: el.offsetLeft, width: el.offsetWidth };
      // Bail out when nothing moved so a re-render never loops back into this effect.
      setPill((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next));
    };
    measure();
    const parent = el.parentElement;
    if (typeof ResizeObserver === "undefined" || !parent) return;
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [index, countsKey]);

  const move = (next: number) => {
    const i = (next + PLAY_FILTERS.length) % PLAY_FILTERS.length;
    onChange(PLAY_FILTERS[i].value);
    refs.current[i]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") move(index + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(PLAY_FILTERS.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Filter quests"
      onKeyDown={onKeyDown}
      className={cn(
        "relative inline-flex w-full rounded-xl border border-white/[0.07] bg-white/[0.025] p-1 shadow-[inset_0_1px_0_rgb(255_245_230/0.04),0_1px_2px_rgb(0_0_0/0.3)] backdrop-blur-sm sm:w-fit",
        className,
      )}
    >
      {pill ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 rounded-lg bg-white/[0.08] shadow-[inset_0_1px_0_rgb(255_245_230/0.12),0_1px_3px_rgb(0_0_0/0.45)] ring-1 ring-white/[0.06] transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
          style={{ left: pill.left, width: pill.width }}
        />
      ) : null}
      {PLAY_FILTERS.map((f, i) => {
        const selected = f.value === value;
        const count = counts?.[f.value];
        return (
          <button
            key={f.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(f.value)}
            className={cn(
              "relative z-10 flex h-9 min-w-0 flex-auto items-center justify-center gap-1 rounded-lg px-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-none sm:gap-1.5 sm:px-3.5",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              selected && !pill && "bg-white/[0.08]",
            )}
          >
            {f.label}
            {count !== undefined ? (
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs tabular-nums transition-colors",
                  selected ? "bg-white/[0.1] text-foreground/85" : "bg-white/[0.04] text-muted-foreground",
                )}
              >
                <span className="sr-only"> (</span>
                {count}
                <span className="sr-only">)</span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export default PlayFilterBar;
