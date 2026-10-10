import * as React from "react";
import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";

/** `title` is a ReactNode here, so drop the HTML `title` attribute (a string tooltip) from the base props. */
export interface PageHeaderProps extends Omit<React.ComponentProps<"header">, "title"> {
  /** Small label above the title. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /** Rendered after the title in muted grey, e.g. "· Week of 14 Sep". */
  suffix?: React.ReactNode;
  /** One sentence. Longer explanations belong in `details`. */
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Usually a <StatStrip />, rendered under the title row. */
  stats?: React.ReactNode;
  /** Rules and fine print, collapsed behind "How it works" so the content stays above the fold. */
  details?: React.ReactNode;
  /**
   * Below `md`, render `stats` and `details` after the page's own content (the cards), so a phone
   * opens on the game, not on numbers. The page container must be a flex column; the header
   * becomes `display: contents` on small screens and its extras take `order: last`.
   */
  extrasLastOnMobile?: boolean;
}

/** Strip a leading "·" from legacy suffixes; the muted colour carries the separation on its own. */
function cleanSuffix(suffix: React.ReactNode): React.ReactNode {
  return typeof suffix === "string" ? suffix.replace(/^\s*·\s*/, "") : suffix;
}

/**
 * Broadcast page header (the mockup's competition heading): an Instrument Serif title, one sentence
 * in Archivo under it (bold words in cream), `actions` on the right (a page clock, a button), and a
 * 1px cream rule under the row. `stats` sit under the rule; `details` fold behind "How it works".
 */
export function PageHeader({ eyebrow, title, suffix, description, actions, stats, details, extrasLastOnMobile, className, ...props }: PageHeaderProps) {
  const extras = (
    <>
      {stats}
      {details ? (
        <details className="group border-y border-rule text-sm text-muted-foreground [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 py-2 text-[0.9375rem] font-semibold text-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            How it works
            <ChevronDownIcon className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
          </summary>
          <div className="flex max-w-3xl flex-col gap-2 pt-1 pb-4 leading-relaxed">{details}</div>
        </details>
      ) : null}
    </>
  );
  return (
    <header className={cn("mb-8 flex flex-col gap-5 pt-2", extrasLastOnMobile && "max-md:contents", className)} {...props}>
      <div className="flex flex-col gap-4 border-b border-rule-2 pb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-10 sm:pb-6">
        <div className="flex min-w-0 flex-col gap-3">
          {eyebrow ? <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">{eyebrow}</p> : null}
          <h1 className="font-display text-[2.25rem] leading-none font-normal tracking-[-0.012em] text-balance text-foreground sm:text-5xl lg:text-[3.625rem]">
            {title}
            {suffix ? <span className="text-muted-foreground"> {cleanSuffix(suffix)}</span> : null}
          </h1>
          {description ? (
            <p className="max-w-2xl text-base leading-[1.45] text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">{actions}</div> : null}
      </div>
      {extrasLastOnMobile ? (stats || details ? <div className="flex flex-col gap-5 max-md:order-last">{extras}</div> : null) : extras}
    </header>
  );
}
