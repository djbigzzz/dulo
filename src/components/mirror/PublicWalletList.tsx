"use client";

import Link from "next/link";
import { cn } from "cn";
import type { MirrorPublicRow } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { formatUsd, truncateAddress } from "@/components/common/format";

export interface PublicWalletListProps {
  rows: MirrorPublicRow[];
  chainId?: string;
  className?: string;
}

/** Label shown on /copy above the curated public wallets (15 Sep review M-D). */
export const PUBLIC_WALLETS_TITLE = "Public wallets on Solana";
export const PUBLIC_WALLETS_HINT = "Not Dulo players, never scored";

/** Label · address · xStocks value · Copy, one row on 1px rules. No rank column: these wallets are in no Dulo game. */
const ROW = "grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-rule py-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-x-5";

function stocksLabel(n: number): string {
  return `${n} ${n === 1 ? "stock" : "stocks"}`;
}

/**
 * Curated public holders: neutral label, address, live xStocks value (when the read landed) and a
 * quiet Copy button. No rank and no points: these wallets are not in any Dulo game.
 */
export function PublicWalletList({ rows, className }: PublicWalletListProps) {
  return (
    <ul className={cn("border-b border-rule", className)}>
      {rows.map((row) => {
        const value = row.totalUsd !== null ? formatUsd(row.totalUsd) : null;
        // Phones put the value first on the second line (it leads there) and may wrap to two lines.
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
          <li key={row.address} className={ROW}>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <span className="truncate text-[0.96875rem] font-semibold">{row.label}</span>
                <span className="hidden truncate text-[0.8125rem] text-dim sm:inline" title={row.address}>
                  {truncateAddress(row.address)}
                </span>
              </span>
              <span className="line-clamp-2 text-[0.8125rem] break-words text-muted-foreground sm:line-clamp-1">
                {value ? <span className="font-semibold text-foreground tabular-nums sm:hidden">{value} · </span> : null}
                {detail}
              </span>
            </div>
            {value ? <span className="hidden text-right text-[1.0625rem] font-semibold tabular-nums font-stretch-[85%] sm:block">{value}</span> : <span className="hidden sm:block" />}
            <Link
              href={`/copy/${encodeURIComponent(row.address)}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 px-3.5 sm:h-8")}
              aria-label={`Copy the portfolio of ${row.label}, a public wallet that is not a Dulo player`}
            >
              Copy
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default PublicWalletList;
