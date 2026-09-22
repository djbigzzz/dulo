"use client";

import * as React from "react";
import { cn } from "cn";
import type { PriceSourceName } from "@/lib/core";
import { ageSeconds, formatAge, formatUsd } from "@/components/common/format";

/**
 * Presentational only. Takes a PriceQuote-shaped object (dates may be ISO strings on the wire)
 * and renders "$360.83 · Jupiter · 12s ago" with a muted "stale" tag. Never fetches.
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

  return (
    <span
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full border border-white/[0.08] bg-black/25 px-2.5 py-0.5 text-xs shadow-[inset_0_1px_0_rgb(255_245_230/0.04)]",
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
      {symbol ? <span className="font-medium">{symbol}</span> : null}
      <span className={cn("font-mono tabular-nums", !hasPrice && "text-muted-foreground")}>
        {hasPrice ? formatUsd(quote.price) : "No price"}
      </span>
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <span className="text-muted-foreground">{priceSourceLabel(quote.source)}</span>
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <span className="text-muted-foreground">{formatAge(age)}</span>
      {stale ? (
        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-1.5 py-px text-xs font-medium tracking-wide text-muted-foreground">
          stale
        </span>
      ) : null}
      {session && quote.marketOpen === false && hasPrice ? (
        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-1.5 py-px text-xs font-medium tracking-wide text-muted-foreground">
          closed
        </span>
      ) : null}
    </span>
  );
}
