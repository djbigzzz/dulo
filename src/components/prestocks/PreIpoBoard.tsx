"use client";

import * as React from "react";
import { ExternalLink, Landmark, SearchX } from "lucide-react";
import { cn } from "cn";
import type { CorporateActionView, LeagueSymbolView } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PRE_IPO_TOKEN_2022_NOTE } from "@/components/common/compliance";
import { corporateActionLabel } from "@/components/common/corporate-actions";
import { EmptyState } from "@/components/common/EmptyState";
import { PartnerLogo } from "@/components/common/PartnerLogo";
import { PriceChip } from "@/components/common/PriceChip";
import { ageSeconds, formatAge, formatUsd } from "@/components/common/format";
import { pnlClass } from "@/components/league/format";
import { ISSUER_MARK_EXPLANATION } from "@/app/check/_components/check-format";
import { PRE_IPO_BOARD_HINT, formatChange24h, preIpoBoardRows, type PreIpoBoardRow } from "@/components/prestocks/tokens";

export interface PreIpoBoardProps {
  symbols: readonly LeagueSymbolView[];
  actions: readonly CorporateActionView[] | null | undefined;
  className?: string;
}

/**
 * One grid for the column header and every row, so the columns line up down the board:
 * token · DEX price (with the 24h move under it) · issuer mark · action. Under md each row is a
 * card of its own and the cells stack two-up with their own labels; from md the labels move to
 * the header row. Measured 22 Sep at 1280: a price chip ("$1,051.83 · Jupiter · 32s ago · closed")
 * needs about 250px to stay on one line, which these shares give it from lg.
 */
export const ROW_GRID = "grid grid-cols-2 gap-x-3 gap-y-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1.3fr)_auto] md:items-center md:gap-x-4";
/**
 * The list: separate glass cards under md, one glass panel of hairline rows from md. The rows sit
 * in a `display: contents` list under the header, so each row draws its own top hairline (divide-y
 * would only separate the header from the list).
 */
export const LIST = "flex flex-col gap-3 md:gap-0 md:overflow-hidden md:rounded-2xl md:border md:border-white/[0.07] md:bg-card";
/** A row: its own card under md (rounded, hairline, glass); a plain hairline row from md. */
export const ROW = "max-md:rounded-2xl max-md:border max-md:border-white/[0.07] max-md:bg-card px-4 py-4 md:border-t md:border-white/[0.05] md:px-5 md:py-3";
const LABEL = "text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase";
/** Cell labels: shown on the stacked card under md, replaced by the header row from md. */
const CELL_LABEL = cn(LABEL, "md:sr-only");

/**
 * The board: one glass row per pre-IPO token. Logo, name and symbol; the DEX quote as a
 * PriceChip (source and age); the issuer mark with its own age; the 24h move from Jupiter; a
 * small badge when the mint has a corporate action on record; and an outline "Open in Jupiter"
 * link. The two prices are two labelled numbers: never a difference or a percentage between them.
 * The Token-2022 note prints once above the rows, because every row leads out to a swap.
 */
export function PreIpoBoard({ symbols, actions, className }: PreIpoBoardProps) {
  const rows = React.useMemo(() => preIpoBoardRows(symbols, actions), [symbols, actions]);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<SearchX aria-hidden />}
        title="No pre-IPO tokens listed right now."
        description="The issuer's catalogue did not answer. The board fills in as soon as it does."
        className={className}
      />
    );
  }
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
        {PRE_IPO_BOARD_HINT} {ISSUER_MARK_EXPLANATION}
      </p>
      <p data-slot="pre-ipo-token-2022-note" className="text-xs leading-relaxed text-pretty text-muted-foreground">
        {PRE_IPO_TOKEN_2022_NOTE}
      </p>
      <div className={LIST} data-slot="pre-ipo-board">
        {/* Column header, from md only: the stacked cards under md label each cell themselves. */}
        <div data-slot="pre-ipo-board-header" className={cn(ROW_GRID, "hidden px-5 py-2.5 md:grid")} aria-hidden>
          <span className={LABEL}>Token</span>
          <span className={LABEL}>DEX price · 24h move</span>
          <span className={LABEL}>Issuer mark</span>
          <span />
        </div>
        <ul className="contents">
          {rows.map((row) => (
            <PreIpoRow key={row.view.assetId} row={row} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Exported for tests. Renders an <li>; the board's list wraps the rows. */
export function PreIpoRow({ row, className }: { row: PreIpoBoardRow; className?: string }) {
  const change = formatChange24h(row.view.change24h);
  const mark = row.view.issuerMark ?? null;
  return (
    <li data-slot="pre-ipo-row" data-symbol={row.symbol} className={cn(ROW, className)}>
      <div className={ROW_GRID}>
        <div className="col-span-2 flex min-w-0 items-center gap-3 md:col-span-1">
          <PartnerLogo name={row.name} logoUrl={row.logoUrl} size={36} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm leading-snug font-semibold tracking-tight md:text-base">{row.name}</h3>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-muted-foreground">
              {row.symbol}
              {row.action ? (
                <span
                  data-slot="corporate-action-badge"
                  title={`${corporateActionLabel(row.action)} on record for this mint. The number of tokens shown changed; the value did not.`}
                  className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-gold/20 bg-gold/[0.06] px-1.5 font-sans text-xs font-medium text-gold"
                >
                  <Landmark className="size-3" aria-hidden />
                  Adjustment
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {/* The DEX quote, and Jupiter's 24h move on it right under (its own labelled block on the stacked card). */}
        <div className="flex min-w-0 flex-col gap-1">
          <span className={CELL_LABEL}>DEX price</span>
          <PriceChip quote={row.view.quote} className="max-w-full" session={false} />
          <span className="flex flex-wrap items-baseline gap-x-1.5 text-xs tabular-nums">
            <span className={CELL_LABEL}>24h move</span>
            <span className={cn("font-semibold", change === null ? "text-muted-foreground" : pnlClass(row.view.change24h))}>{change ?? "—"}</span>
            <span className="text-muted-foreground">Jupiter</span>
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={CELL_LABEL}>Issuer mark</span>
          <IssuerMarkChip mark={mark} />
        </div>

        <div className="flex min-w-0 items-end md:justify-end">
          {row.jupiterUrl ? (
            <a
              href={row.jupiterUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline" }), "h-10 w-full md:h-9 md:w-auto")}
              aria-label={`Open Jupiter with ${row.symbol} prefilled (opens in a new tab)`}
            >
              Open in Jupiter
              <ExternalLink data-icon="inline-end" aria-hidden />
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">No mint on record for a Jupiter link.</span>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * "$250.00 · PreStocks · 2m ago" in the PriceChip's glass shape, or "No issuer mark" when the
 * issuer gave none. Its own clock, so the age keeps moving while the payload stays the same.
 */
function IssuerMarkChip({ mark, tickMs = 15_000 }: { mark: { price: number; publishedAt: string } | null; tickMs?: number }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!tickMs) return;
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  const has = mark !== null && Number.isFinite(mark.price) && mark.price > 0;
  const age = has ? ageSeconds(mark.publishedAt, now) : null;
  return (
    <span
      data-slot="issuer-mark"
      className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full border border-white/[0.08] bg-black/25 px-2.5 py-0.5 text-xs shadow-[inset_0_1px_0_rgb(255_245_230/0.04)]"
      title={has ? `Issuer mark ${formatUsd(mark.price)}, published by PreStocks, ${formatAge(age)}. ${ISSUER_MARK_EXPLANATION}` : "The issuer has not published a mark"}
    >
      <span className={cn("font-mono tabular-nums", !has && "text-muted-foreground")}>{has ? formatUsd(mark.price) : "No issuer mark"}</span>
      {has ? (
        <>
          <span className="text-muted-foreground" aria-hidden>
            ·
          </span>
          <span className="text-muted-foreground">PreStocks</span>
          <span className="text-muted-foreground" aria-hidden>
            ·
          </span>
          <span className="text-muted-foreground">{formatAge(age)}</span>
        </>
      ) : null}
    </span>
  );
}

export function PreIpoBoardSkeleton({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy aria-label="Loading pre-IPO tokens" className={cn("flex flex-col gap-4", className)}>
      <Skeleton className="h-4 w-3/4 max-w-xl" />
      <Skeleton className="h-3 w-full max-w-2xl" />
      <div className={LIST} aria-hidden>
        <div className={cn(ROW_GRID, "hidden px-5 py-2.5 md:grid")}>
          {["Token", "DEX price · 24h move", "Issuer mark"].map((label) => (
            <span key={label} className={LABEL}>
              {label}
            </span>
          ))}
          <span />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={cn(ROW, ROW_GRID)}>
            <div className="col-span-2 flex items-center gap-3 md:col-span-1">
              <Skeleton className="size-9 rounded-xl bg-white/[0.05]" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-2/3 bg-white/[0.05]" />
                <Skeleton className="h-3 w-14 bg-white/[0.05]" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-6 w-40 max-w-full rounded-full bg-white/[0.05]" />
              <Skeleton className="h-3 w-16 bg-white/[0.05]" />
            </div>
            <Skeleton className="h-6 w-36 max-w-full rounded-full bg-white/[0.05]" />
            <Skeleton className="h-9 w-32 max-w-full rounded-lg bg-white/[0.05] md:justify-self-end" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default PreIpoBoard;
