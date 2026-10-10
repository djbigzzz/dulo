"use client";

import * as React from "react";
import { cn } from "cn";
import type { PriceSourceName } from "@/lib/core";
import { ageSeconds, formatAge, formatUsd } from "@/components/common/format";

/**
 * Presentational only. Takes a PriceQuote-shaped object (dates may be ISO strings on the wire)
 * and renders "$360.83 · Jupiter · 12s ago" in mono (price, source and age are the only mono text
 * in Broadcast) with a ruled "stale" tag. Never fetches.
 */
export interface PriceChipQuote {
  price: number | null;
  source: PriceSourceName;
  publishedAt?: string | Date | null;
  ageSeconds?: number | null;
  stale?: boolean;
  marketOpen?: boolean;
}

export interface PriceChipProps {
  quote: PriceChipQuote;
  /** Optional symbol to prefix, e.g. "TSLAx". */
  symbol?: string;
  /** Re-render the age text every `tickMs` (0 disables). */
  tickMs?: number;
  className?: string;
  /** False for assets that quote around the clock (pre-IPO tokens): no US-session tag. Default true. */
  session?: boolean;
}

const SOURCE_LABEL: Record<PriceSourceName, string> = {
  pyth: "Pyth",
  jupiter: "Jupiter",
  cache: "Cached",
  none: "No source",
};

export function priceSourceLabel(source: PriceSourceName): string {
  return SOURCE_LABEL[source] ?? source;
}

/** A small ruled tag beside the age ("stale", "closed"): cream text on a 1px rule, no fill, no hue. */
const TAG = "self-center rounded-sm border border-rule-2 px-1 py-px font-sans text-[0.6875rem] leading-none font-semibold text-foreground";

export function PriceChip({ quote, symbol, tickMs = 15_000, className, session = true }: PriceChipProps) {
  // Ticking clock so "12s ago" keeps moving while the quote object stays the same.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!tickMs) return;
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  const liveAge = ageSeconds(quote.publishedAt ?? null, now);
  const age = liveAge ?? quote.ageSeconds ?? null;
  const hasPrice = quote.price !== null && quote.price !== undefined && Number.isFinite(quote.price);
  const stale = quote.stale === true || (!hasPrice && quote.source === "none");

  // Broadcast: no pill. A mono line, "TSLAx $372.08 · Jupiter · 18s ago", the price in cream and
  // its source and age in the muted grey (7.6:1), with small ruled tags for stale and closed.
  return (
    <span
      data-slot="price-chip"
      className={cn(
        "inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono text-[0.8125rem] leading-[1.35] tracking-[-0.01em] text-muted-foreground tabular-nums",
        className,
      )}
      title={
        hasPrice
          ? `${symbol ? `${symbol} ` : ""}${formatUsd(quote.price)} from ${priceSourceLabel(quote.source)}, ${formatAge(age)}${
              session && quote.marketOpen === false ? " (US market closed)" : ""
            }`
          : "No price available"
      }
    >
      {symbol ? <span className="font-medium text-foreground">{symbol}</span> : null}
      <span className={cn("font-medium", hasPrice ? "text-foreground" : "text-muted-foreground")}>
        {hasPrice ? formatUsd(quote.price) : "No price"}
      </span>
      <span aria-hidden>·</span>
      <span>{priceSourceLabel(quote.source)}</span>
      <span aria-hidden>·</span>
      <span>{formatAge(age)}</span>
      {stale ? <span className={TAG}>stale</span> : null}
      {session && quote.marketOpen === false && hasPrice ? <span className={TAG}>closed</span> : null}
    </span>
  );
}
