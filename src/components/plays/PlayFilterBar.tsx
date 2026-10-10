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
 * All · In-platform · On-chain · Badges ("Filter quests"), drawn as Broadcast tabs: plain labels on a
 * 1px rule, the selected one cream over a 2px cream bar (the nav's and the trade panel's tabs). A
 * radiogroup with a roving tabindex: Tab lands on the selected option, arrow keys / Home / End move
 * and select. The bar slides between options; until it has been measured the option draws its own.
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
      className={cn("relative flex w-full gap-1 border-b border-rule sm:gap-6", className)}
    >
      {pill ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-px h-0.5 bg-foreground transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
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
              "relative z-10 flex h-11 min-w-0 flex-auto items-center justify-center gap-1.5 px-1 text-[0.9375rem] font-medium whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset motion-reduce:transition-none sm:flex-none sm:px-0",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              selected && !pill && "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground",
            )}
          >
            {f.label}
            {count !== undefined ? (
              <span className={cn("text-[0.84375rem] font-semibold tabular-nums font-stretch-[85%]", selected ? "text-foreground" : "text-dim")}>
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
