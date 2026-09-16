"use client";

import Link from "next/link";
import { Copy, Globe } from "lucide-react";
import { cn } from "cn";
import type { MirrorPublicRow } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { AddressChip } from "@/components/common/AddressChip";
import { formatUsd } from "@/components/common/format";

export interface PublicWalletListProps {
  rows: MirrorPublicRow[];
  chainId?: string;
  className?: string;
}

const ITEM = "flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-card px-3.5 py-3 sm:gap-4 sm:px-5";

/** Label shown on /copy above the curated public wallets (15 Sep review M-D). */
export const PUBLIC_WALLETS_TITLE = "Public wallets on Solana";
export const PUBLIC_WALLETS_HINT = "Not Dulo players, never scored";

function stocksLabel(n: number): string {
  return `${n} ${n === 1 ? "stock" : "stocks"}`;
}

/**
 * Curated public holders: neutral label, address, live xStocks value (when the read landed) and
 * an outline Mirror button. No rank and no points: these wallets are not in any Dulo game.
 */
export function PublicWalletList({ rows, chainId, className }: PublicWalletListProps) {
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {rows.map((row) => {
        const value = row.totalUsd !== null ? formatUsd(row.totalUsd) : null;
        // Phones drop the "xStocks · " prefix (the value leads the line there) and may wrap to two lines.
        const detail =
          row.stocks !== null ? (
            <>
              <span className="hidden sm:inline">xStocks · </span>
              {stocksLabel(row.stocks)}
            </>
          ) : (
            "Value loads when you open it"
          );
        return (
          <li
            key={row.address}
            className={cn(ITEM, "transition-all duration-300 hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.04] motion-reduce:transition-none motion-reduce:hover:translate-y-0")}
          >
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-muted-foreground shadow-[inset_0_1px_0_rgb(255_245_230/0.06)] [&>svg]:size-4"
              aria-hidden
            >
              <Globe />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="truncate text-sm font-medium sm:text-base">{row.label}</span>
                <AddressChip address={row.address} chainId={chainId} copy={false} className="hidden sm:inline-flex" />
              </span>
              <span className="line-clamp-2 text-xs break-words text-muted-foreground sm:line-clamp-1">
                {value ? <span className="font-semibold text-foreground/90 tabular-nums sm:hidden">{value} · </span> : null}
                {detail}
              </span>
            </div>
            {value ? <span className="hidden shrink-0 text-right text-base font-semibold tracking-tight tabular-nums sm:block">{value}</span> : null}
            <Link
              href={`/copy/${encodeURIComponent(row.address)}`}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-9 shrink-0 rounded-xl px-3 font-medium sm:ml-2 sm:h-10 sm:px-4")}
              aria-label={`Copy the portfolio of ${row.label}, a public wallet that is not a Dulo player`}
            >
              <Copy data-icon="inline-start" aria-hidden />
              Copy
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default PublicWalletList;
