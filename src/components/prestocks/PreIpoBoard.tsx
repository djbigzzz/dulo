"use client";

import * as React from "react";
import { ArrowUpRight, SearchX } from "lucide-react";
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
 * token · DEX price (with the 24h move under it) · issuer mark · action. Under md a row stacks:
 * the token and its Jupiter link on one line, then each price on its own labelled line; from md the
 * labels move to the header row. Measured 22 Sep at 1280: a price chip ("$1,051.83 · Jupiter · 32s
 * ago") needs about 250px to stay on one line, which these shares give it from lg. The action track
 * is a fixed 8.75rem (the ~133px "Open in Jupiter" button, right-aligned in it): the header and each
 * row are separate grids, so an `auto` track would size to the header's empty cell and shift the
 * header's columns off the rows'.
 */
export const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1.3fr)_8.75rem] md:gap-x-4";
/**
 * The list: Broadcast rows on rules, never a box or a card per row (the board is the page's hero,
 * like the competition's standings). The rows sit in a `display: contents` list under the header,
 * so each row draws its own top rule.
 */
export const LIST = "flex flex-col border-b border-rule";
/** A row: a 1px rule on top, no fill, no box. */
export const ROW = "border-t border-rule py-3.5 md:py-3";
/** Column heads and stacked-row labels: plain small text in the dim / muted grey, no tracked capitals. */
const HEAD = "text-[0.78125rem] leading-none font-medium text-dim";
/** Cell labels: shown on the stacked row under md, replaced by the header row from md. */
const CELL_LABEL = "text-[0.78125rem] leading-none font-medium text-muted-foreground md:sr-only";

/**
 * The board: one ruled row per pre-IPO token. Logo (greyscale), name and symbol; the DEX quote as a
 * PriceChip (source and age); the issuer mark with its own age; the 24h move from Jupiter; a small
 * ruled tag when the mint has a corporate action on record; and a quiet "Open in Jupiter" link.
 * The two prices are two labelled numbers: never a difference or a percentage between them.
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
      <div className="flex max-w-3xl flex-col gap-2">
        <p className="text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
          {PRE_IPO_BOARD_HINT} {ISSUER_MARK_EXPLANATION}
        </p>
        <p data-slot="pre-ipo-token-2022-note" className="text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">
          {PRE_IPO_TOKEN_2022_NOTE}
        </p>
      </div>
      <div className={LIST} data-slot="pre-ipo-board">
        {/* Column header, from md only: the stacked rows under md label each cell themselves. */}
        <div data-slot="pre-ipo-board-header" className={cn(ROW_GRID, "hidden h-[34px] md:grid")} aria-hidden>
          <span className={HEAD}>Token</span>
          <span className={HEAD}>DEX price · 24h move</span>
          <span className={HEAD}>Issuer mark</span>
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
        <div className="flex min-w-0 items-center gap-3">
          <PartnerLogo name={row.name} logoUrl={row.logoUrl} size={34} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[0.9375rem] leading-snug font-semibold md:text-base">{row.name}</h3>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8125rem] text-muted-foreground">
              {row.symbol}
              {row.action ? (
                <span
                  data-slot="corporate-action-badge"
                  title={`${corporateActionLabel(row.action)} on record for this mint. The number of tokens shown changed; the value did not.`}
                  className="inline-flex h-5 shrink-0 items-center rounded-sm border border-rule-2 px-1.5 text-xs font-semibold text-foreground"
                >
                  Adjustment
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {/* The DEX quote, and Jupiter's 24h move on it right under (its own labelled line on the stacked row). */}
        <div className="col-span-2 flex min-w-0 flex-col gap-1 max-md:row-start-2 md:col-span-1">
          <span className={CELL_LABEL}>DEX price</span>
          <PriceChip quote={row.view.quote} className="max-w-full self-start" session={false} />
          <span className="flex flex-wrap items-baseline gap-x-1.5 text-[0.8125rem] tabular-nums">
            <span className={CELL_LABEL}>24h move</span>
            <span className={cn("font-semibold font-stretch-[85%]", change === null ? "text-muted-foreground" : pnlClass(row.view.change24h))}>{change ?? "—"}</span>
            <span className="text-muted-foreground">Jupiter</span>
          </span>
        </div>
        <div className="col-span-2 flex min-w-0 flex-col gap-1 max-md:row-start-3 md:col-span-1">
          <span className={CELL_LABEL}>Issuer mark</span>
          <IssuerMarkChip mark={mark} />
        </div>

        <div className="flex min-w-0 justify-end max-md:col-start-2 max-md:row-start-1">
          {row.jupiterUrl ? (
            <a
              href={row.jupiterUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "md:h-9 md:px-3.5")}
              aria-label={`Open Jupiter with ${row.symbol} prefilled (opens in a new tab)`}
            >
              Open in Jupiter
              <ArrowUpRight data-icon="inline-end" aria-hidden />
            </a>
          ) : (
            <span className="text-right text-[0.8125rem] text-muted-foreground">No mint on record for a Jupiter link.</span>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * "$250.00 · PreStocks · 2m ago" as PriceChip draws a price (mono, the number in cream, the source
 * and age muted), or "No issuer mark" when the issuer gave none. Its own clock, so the age keeps
 * moving while the payload stays the same.
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
      className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5 self-start font-mono text-[0.8125rem] leading-[1.35] tracking-[-0.01em] text-muted-foreground tabular-nums"
      title={has ? `Issuer mark ${formatUsd(mark.price)}, published by PreStocks, ${formatAge(age)}. ${ISSUER_MARK_EXPLANATION}` : "The issuer has not published a mark"}
    >
      <span className={cn("font-medium", has ? "text-foreground" : "font-sans text-muted-foreground")}>{has ? formatUsd(mark.price) : "No issuer mark"}</span>
      {has ? (
        <>
          <span aria-hidden>·</span>
          <span>PreStocks</span>
          <span aria-hidden>·</span>
          <span>{formatAge(age)}</span>
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
        <div className={cn(ROW_GRID, "hidden h-[34px] md:grid")}>
          {["Token", "DEX price · 24h move", "Issuer mark"].map((label) => (
            <span key={label} className={HEAD}>
              {label}
            </span>
          ))}
          <span />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={cn(ROW, ROW_GRID)}>
            <div className="flex items-center gap-3">
              <Skeleton className="size-[34px] rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-14" />
              </div>
            </div>
            <div className="col-span-2 flex flex-col gap-1.5 max-md:row-start-2 md:col-span-1">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="col-span-2 h-4 w-44 max-w-full max-md:row-start-3 md:col-span-1" />
            <Skeleton className="h-8 w-32 max-w-full justify-self-end max-md:col-start-2 max-md:row-start-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default PreIpoBoard;
