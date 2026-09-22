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

const CARD = "flex flex-col gap-4 rounded-2xl border border-white/[0.07] bg-card p-4 sm:p-5";
const LABEL = "text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase";

/**
 * The board: one glass card per pre-IPO token. Logo, name and symbol; the DEX quote as a
 * PriceChip (source and age); the issuer mark with its own age; the 24h move from Jupiter; a
 * small badge when the mint has a corporate action on record; and an outline "Open in Jupiter"
 * link. The two prices are two labelled numbers: never a difference or a percentage between them.
 * The Token-2022 note prints once above the cards, because every card leads out to a swap.
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
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-slot="pre-ipo-board">
        {rows.map((row) => (
          <li key={row.view.assetId} className="min-w-0">
            <PreIpoCard row={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Exported for tests. */
export function PreIpoCard({ row, className }: { row: PreIpoBoardRow; className?: string }) {
  const change = formatChange24h(row.view.change24h);
  const mark = row.view.issuerMark ?? null;
  return (
    <article data-slot="pre-ipo-card" data-symbol={row.symbol} className={cn(CARD, "h-full", className)}>
      <div className="flex items-center gap-3">
        <PartnerLogo name={row.name} logoUrl={row.logoUrl} size={40} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base leading-snug font-semibold tracking-tight">{row.name}</h3>
          <p className="font-mono text-xs text-muted-foreground">{row.symbol}</p>
        </div>
        {row.action ? (
          <span
            data-slot="corporate-action-badge"
            title={`${corporateActionLabel(row.action)} on record for this mint. The number of tokens shown changed; the value did not.`}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-gold/20 bg-gold/[0.06] px-2 text-xs font-medium text-gold"
          >
            <Landmark className="size-3" aria-hidden />
            Adjustment
          </span>
        ) : null}
      </div>

      <dl className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-1">
          <dt className={LABEL}>DEX price</dt>
          <dd>
            <PriceChip quote={row.view.quote} className="max-w-full" />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className={LABEL}>Issuer mark</dt>
          <dd>
            <IssuerMarkChip mark={mark} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className={LABEL}>24h move</dt>
          <dd className={cn("text-sm font-semibold tabular-nums", change === null ? "text-muted-foreground" : pnlClass(row.view.change24h))}>
            {change ?? "—"}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">Jupiter</span>
          </dd>
        </div>
      </dl>

      <div className="mt-auto pt-1">
        {row.jupiterUrl ? (
          <a
            href={row.jupiterUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline" }), "h-10 w-full sm:h-9")}
            aria-label={`Open Jupiter with ${row.symbol} prefilled (opens in a new tab)`}
          >
            Open in Jupiter
            <ExternalLink data-icon="inline-end" aria-hidden />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">No mint on record for a Jupiter link.</span>
        )}
      </div>
    </article>
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

export function PreIpoBoardSkeleton({ cards = 8, className }: { cards?: number; className?: string }) {
  return (
    <div role="status" aria-busy aria-label="Loading pre-IPO tokens" className={cn("flex flex-col gap-4", className)}>
      <Skeleton className="h-4 w-3/4 max-w-xl" />
      <Skeleton className="h-3 w-full max-w-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className={CARD}>
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-xl bg-white/[0.05]" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-2/3 bg-white/[0.05]" />
                <Skeleton className="h-3 w-14 bg-white/[0.05]" />
              </div>
            </div>
            <Skeleton className="h-6 w-40 rounded-full bg-white/[0.05]" />
            <Skeleton className="h-6 w-36 rounded-full bg-white/[0.05]" />
            <Skeleton className="h-4 w-20 bg-white/[0.05]" />
            <Skeleton className="h-9 w-full rounded-lg bg-white/[0.05]" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default PreIpoBoard;
