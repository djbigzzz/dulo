import * as React from "react";
import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";

/** `title` is a ReactNode here, so drop the HTML `title` attribute (a string tooltip) from the base props. */
export interface PageHeaderProps extends Omit<React.ComponentProps<"header">, "title"> {
  /** Small label above the title. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /** Rendered after the title in muted italic, e.g. "· Week of 14 Sep". */
  suffix?: React.ReactNode;
  /** One sentence. Longer explanations belong in `details`. */
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Usually a <StatStrip />, rendered under the title row. */
  stats?: React.ReactNode;
  /** Rules and fine print, collapsed behind "How it works" so the content stays above the fold. */
  details?: React.ReactNode;
}

/** Strip a leading "·" from legacy suffixes; the serif italic carries the separation on its own. */
function cleanSuffix(suffix: React.ReactNode): React.ReactNode {
  return typeof suffix === "string" ? suffix.replace(/^\s*·\s*/, "") : suffix;
}

export function PageHeader({ eyebrow, title, suffix, description, actions, stats, details, className, ...props }: PageHeaderProps) {
  return (
    <header className={cn("mb-8 flex flex-col gap-5 pt-2", className)} {...props}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          {eyebrow ? (
            <p className="flex items-center gap-2 text-xs font-medium tracking-[0.18em] text-gold uppercase">
              <span className="h-px w-5 bg-gradient-to-r from-gold/0 to-gold/80" aria-hidden />
              {eyebrow}
            </p>
          ) : null}
          <h1 className="font-display text-[2rem] leading-[1.02] font-normal tracking-[-0.015em] text-foreground sm:text-5xl md:text-6xl">
            {title}
            {suffix ? <span className="text-muted-foreground/80 italic"> {cleanSuffix(suffix)}</span> : null}
          </h1>
          {description ? <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {stats}
      {details ? (
        <details className="group rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-2 text-sm text-muted-foreground transition-colors open:bg-white/[0.03] [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1 font-medium text-foreground/90 outline-none select-none hover:text-foreground focus-visible:text-ember">
            How it works
            <ChevronDownIcon className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" aria-hidden />
          </summary>
          <div className="flex flex-col gap-2 pt-2 pb-2 leading-relaxed">{details}</div>
        </details>
      ) : null}
    </header>
  );
}
