"use client";

import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Ban, Check, CheckCircle2, Clock, Lock, Minus, XCircle } from "lucide-react";
import { cn } from "cn";
import type { CallMarketView, CallPositionView, CallSide } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PriceChip, priceSourceLabel } from "@/components/common/PriceChip";
import { formatDateTime, formatPoints, formatUsd } from "@/components/common/format";
import { PoolBar } from "@/components/calls/PoolBar";
import {
  formatMultiplier,
  formatPct,
  liveStatus,
  lockLabel,
  marketQuestion,
  outcomeLabel,
  resultLabel,
  sideButtonLabel,
  sideLabel,
  strikeDistance,
} from "@/components/calls/calls-format";

export interface MarketCardProps {
  market: CallMarketView;
  /** The viewer's stakes on this market (0, 1 or 2 entries — one per side). */
  positions: CallPositionView[];
  /** Client clock, ms. Drives the lock countdown and the open -> locked flip. */
  nowMs: number;
  signedIn: boolean;
  /**
   * A side button was pressed. The page decides what happens: the stake dialog when signed
   * in, the wallet / sign-in flow when not. Buttons are never rendered disabled.
   */
  onPlace?: (market: CallMarketView, side: CallSide) => void;
  className?: string;
}

const XSTOCK_LOGO = (symbol: string) => `https://xstocks-metadata.backed.fi/logos/tokens/${encodeURIComponent(symbol)}.png`;

/** Inset well: pool bars, position rows, the settled result. */
const WELL = "rounded-xl border border-white/[0.06] bg-black/25 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]";
const DIVIDER = "h-px bg-gradient-to-r from-transparent via-white/10 to-transparent";
const PILL = "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap";

function XStockLogo({ symbol, ticker }: { symbol: string; ticker: string }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [symbol]);
  return (
    <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] font-mono text-xs font-semibold text-foreground shadow-[inset_0_1px_0_rgb(255_245_230/0.06)]">
      {failed ? (
        ticker.slice(0, 4)
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- xStocks metadata CDN, no next/image remotePatterns to maintain
        <img
          src={XSTOCK_LOGO(symbol)}
          alt={`${symbol} logo`}
          width={44}
          height={44}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function StatusChip({ market, nowMs }: { market: CallMarketView; nowMs: number }) {
  const status = liveStatus(market, nowMs);
  if (status === "settled") {
    const yes = market.outcome === "yes";
    return (
      <span className={cn(PILL, yes ? "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-300" : "border-rose-400/25 bg-rose-400/[0.07] text-rose-300")}>
        {yes ? <CheckCircle2 className="size-3.5" aria-hidden /> : <XCircle className="size-3.5" aria-hidden />}
        {yes ? "Yes won" : "No won"}
      </span>
    );
  }
  if (status === "void") {
    return (
      <span className={cn(PILL, "border-dashed border-white/15 bg-white/[0.02] text-muted-foreground")}>
        <Ban className="size-3.5" aria-hidden />
        Void
      </span>
    );
  }
  if (status === "locked") {
    return (
      <span className={cn(PILL, "border-white/10 bg-white/[0.03] text-muted-foreground")}>
        <Lock className="size-3.5" aria-hidden />
        Locked
      </span>
    );
  }
  return (
    <span className={cn(PILL, "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300 shadow-[inset_0_1px_0_rgb(255_245_230/0.05)]")}>
      <span className="relative flex size-1.5" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
      </span>
      Open
    </span>
  );
}

const SIDE_STYLE: Record<CallSide, { idle: string; held: string; label: string }> = {
  yes: {
    idle: "border-emerald-400/25 bg-emerald-400/[0.05] hover:border-emerald-400/45 hover:bg-emerald-400/[0.10]",
    held: "border-emerald-400/60 bg-emerald-400/[0.12] hover:bg-emerald-400/[0.16]",
    label: "text-emerald-300",
  },
  no: {
    idle: "border-rose-400/25 bg-rose-400/[0.05] hover:border-rose-400/45 hover:bg-rose-400/[0.10]",
    held: "border-rose-400/60 bg-rose-400/[0.12] hover:bg-rose-400/[0.16]",
    label: "text-rose-300",
  },
};

function PriceVsStrike({ price, strike }: { price: number | null; strike: number }) {
  const distance = strikeDistance(price, strike);
  if (price === null) {
    return <p className="text-sm text-muted-foreground">No live price</p>;
  }
  const diff = price - strike;
  const at = Math.abs(diff) < 0.005;
  const Glyph = at ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = at ? "text-muted-foreground" : diff > 0 ? "text-emerald-400" : "text-rose-400";
  return (
    <p className="flex min-w-0 items-center gap-2 text-sm">
      <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-md bg-white/[0.04]", tone)} aria-hidden>
        <Glyph className="size-3.5" />
      </span>
      <span className="font-semibold tracking-tight text-foreground tabular-nums">{formatUsd(price)}</span>
      <span className="text-muted-foreground">now</span>
      {distance ? <span className={cn("truncate", tone)}>{distance}</span> : null}
    </p>
  );
}

function YourPosition({ p, children }: { p: CallPositionView; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", p.side === "yes" ? "bg-emerald-400" : "bg-rose-400")} aria-hidden />
        <span className="truncate text-muted-foreground">
          You · <span className="font-medium text-foreground">{sideLabel(p.side)}</span> · <span className="tabular-nums">{formatPoints(p.points)}</span> pts
        </span>
      </span>
      {children}
    </li>
  );
}

export function MarketCard({ market, positions, nowMs, signedIn, onPlace, className }: MarketCardProps) {
  const status = liveStatus(market, nowMs);
  const open = status === "open";
  const done = status === "settled" || status === "void";
  const highlight = positions.length === 1 ? positions[0].side : null;
  const price = market.quote?.price ?? null;
  const settleSource = market.source === "pyth" || market.source === "jupiter" ? priceSourceLabel(market.source) : market.source;

  return (
    <Card
      data-market-id={market.id}
      data-status={status}
      className={cn(
        "h-full gap-5 [--card-spacing:--spacing(5)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/[0.04] hover:ring-white/[0.12] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        status === "void" && "ring-white/[0.05]",
        className,
      )}
    >
      <CardHeader className="gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <XStockLogo symbol={market.symbol} ticker={market.ticker} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono text-sm font-medium text-foreground">{market.symbol}</span>
              <span className="text-xs text-muted-foreground">Friday close</span>
            </span>
          </div>
          <StatusChip market={market} nowMs={nowMs} />
        </div>

        <CardTitle className="text-xl leading-snug font-semibold tracking-tight text-balance">{marketQuestion(market)}</CardTitle>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-gold/20 bg-gold/[0.06] px-3 text-xs shadow-[inset_0_1px_0_rgb(255_245_230/0.06)]">
            <span className="font-medium tracking-[0.08em] text-gold uppercase">Strike</span>
            <span className="font-semibold text-foreground tabular-nums">{formatUsd(market.strike)}</span>
          </span>
          {!done && market.quote ? <PriceChip quote={market.quote} symbol={market.symbol} className="max-w-full" /> : null}
        </div>

        {done ? null : <PriceVsStrike price={price} strike={market.strike} />}
      </CardHeader>

      <CardContent className="mt-auto flex flex-col gap-4">
        <PoolBar odds={market.odds} highlight={highlight} labels={done || !open} />

        {done ? (
          <div className={cn(WELL, "flex flex-col gap-3 p-4")}>
            <div className="flex items-end justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">Result</span>
                <span
                  className={cn(
                    "text-3xl leading-none font-semibold tracking-tight",
                    market.outcome === "yes" ? "text-emerald-400" : market.outcome === "no" ? "text-rose-400" : "text-muted-foreground",
                  )}
                >
                  {market.outcome === "yes" ? "Yes" : market.outcome === "no" ? "No" : status === "void" ? "Void" : "Pending"}
                </span>
              </div>
              {market.settledPrice !== null ? (
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-xs text-muted-foreground">Settled at</span>
                  <span className="text-xl leading-none font-semibold tracking-tight tabular-nums">{formatUsd(market.settledPrice)}</span>
                </div>
              ) : null}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="text-foreground/80">{outcomeLabel(market.outcome)}</span>
              {" · "}
              {settleSource ? `Friday close from ${settleSource}` : "No price within 24h of the close"} · {formatDateTime(market.settleAt)}
            </p>
            {positions.length > 0 ? (
              <>
                <div className={DIVIDER} aria-hidden />
                <ul className="flex flex-col gap-1.5">
                  {positions.map((p) => (
                    <YourPosition key={p.side} p={p}>
                      <span
                        className={cn(
                          "shrink-0 text-sm font-semibold tabular-nums",
                          p.result === "won" && "text-emerald-400",
                          p.result === "lost" && "text-rose-400",
                          (p.result === "refunded" || p.result === "pending") && "text-muted-foreground",
                        )}
                      >
                        {resultLabel(p)}
                      </span>
                    </YourPosition>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : (
          <>
            {positions.length > 0 ? (
              <ul className={cn(WELL, "flex flex-col gap-1.5 px-3.5 py-2.5")}>
                {positions.map((p) => (
                  <YourPosition key={p.side} p={p}>
                    <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                      <span className="font-semibold text-foreground">{formatPoints(p.potentialPayout)}</span> points back
                    </span>
                  </YourPosition>
                ))}
              </ul>
            ) : null}

            {open ? (
              <div className="grid grid-cols-2 gap-2.5">
                {(["yes", "no"] as const).map((side) => {
                  const held = positions.some((p) => p.side === side);
                  const pct = formatPct(side === "yes" ? market.odds.yesProb : market.odds.noProb);
                  const mult = side === "yes" ? market.odds.yesMultiplier : market.odds.noMultiplier;
                  return (
                    <button
                      key={side}
                      type="button"
                      onClick={() => onPlace?.(market, side)}
                      aria-label={`${sideButtonLabel(market.odds, side)}. ${signedIn ? (held ? "Add to your prediction" : "Make a prediction") : "Sign in to make a prediction"}`}
                      className={cn(
                        "flex h-12 min-w-0 items-center justify-between gap-2 rounded-xl border px-3.5 whitespace-nowrap shadow-[inset_0_1px_0_rgb(255_245_230/0.08),0_1px_2px_rgb(0_0_0/0.3)] transition-all duration-200 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px",
                        held ? SIDE_STYLE[side].held : SIDE_STYLE[side].idle,
                      )}
                    >
                      <span className={cn("flex items-center gap-1.5 text-sm font-semibold", SIDE_STYLE[side].label)}>
                        {held ? <Check className="size-3.5" aria-hidden /> : null}
                        {sideLabel(side)}
                      </span>
                      <span className="flex min-w-0 items-baseline gap-1.5 tabular-nums">
                        <span className="text-lg leading-none font-semibold tracking-tight text-foreground">{pct}</span>
                        {mult !== null ? <span className="text-xs text-muted-foreground">{formatMultiplier(mult)}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              <div className={DIVIDER} aria-hidden />
              <p className="flex items-center gap-2 text-xs text-muted-foreground" title={`Settles ${formatDateTime(market.settleAt)}`}>
                <span className="inline-flex items-center gap-1.5">
                  {open ? <Clock className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
                  <span className="tabular-nums">{lockLabel(market, nowMs)}</span>
                </span>
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function MarketCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("h-full gap-5 [--card-spacing:--spacing(5)]", className)} aria-hidden>
      <CardHeader className="gap-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Skeleton className="size-11 rounded-xl" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <Skeleton className="h-7 w-5/6" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-32 rounded-full" />
          <Skeleton className="h-7 w-40 rounded-full" />
        </div>
        <Skeleton className="h-5 w-48" />
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-4">
        <Skeleton className="h-2.5 w-full rounded-full" />
        <Skeleton className="h-3 w-full" />
        <div className="grid grid-cols-2 gap-2.5">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
        </div>
      </CardContent>
    </Card>
  );
}

export default MarketCard;
