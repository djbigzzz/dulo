"use client";

import { Wallet } from "lucide-react";
import type { PreviewHoldingView, PreviewResponse } from "@/lib/api-client";
import { EmptyState } from "@/components/common/EmptyState";
import { PriceChip } from "@/components/common/PriceChip";
import { COMPLIANCE_LINE, PRE_IPO_COMPLIANCE_LINE } from "@/components/common/compliance";
import { ageSeconds, formatAge, formatUsd } from "@/components/common/format";
import { isPreIpoSource, unitWordFor } from "@/components/common/issuer";
import { IssuerPill } from "@/components/common/IssuerPill";
import { formatMultiplier, formatQty, hasPreIpoHolding, issuerMarkLine, multiplierArithmetic } from "@/app/check/_components/check-format";

const MULTIPLIER_TITLE = "Token-2022 multiplier applied to the raw balance (splits and dividends)";

/**
 * One position as the check page prints it: ticker, quantity with the issuer's unit word, the
 * issuer pill from Holding.source, the multiplier note (and, for a pre-IPO token, the arithmetic
 * once: raw × multiplier = quantity), the price chip, and for a pre-IPO token the issuer mark
 * beside the DEX price, worded as an explanation. Nothing here ranks, compares or recommends.
 */
export function HoldingRow({ holding: h, now }: { holding: PreviewHoldingView; now?: number }) {
  const mult = formatMultiplier(h.multiplier);
  const preIpo = isPreIpoSource(h.source);
  const arithmetic = preIpo ? multiplierArithmetic(h.qty, h.multiplier) : null;
  const markLine = issuerMarkLine(h, now);
  return (
    <li data-slot="holding-row" data-source={h.source} className="flex flex-col gap-2 px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-mono text-sm font-semibold">{h.symbol}</span>
          <IssuerPill source={h.source} />
          <span className="text-sm text-muted-foreground tabular-nums">
            {formatQty(h.qty)} {unitWordFor(h.source, h.qty)}
          </span>
          {mult ? (
            <span className="text-xs text-muted-foreground" title={MULTIPLIER_TITLE}>
              {mult} multiplier
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-base font-semibold tracking-tight tabular-nums">{formatUsd(h.usd)}</span>
      </div>
      {arithmetic ? (
        <p data-slot="multiplier-arithmetic" className="text-xs text-muted-foreground tabular-nums" title={MULTIPLIER_TITLE}>
          Balance on chain {arithmetic} {unitWordFor(h.source, h.qty)} after the Token-2022 multiplier.
        </p>
      ) : null}
      <PriceChip quote={h.quote} className="self-start" />
      {markLine ? (
        <p data-slot="issuer-mark" className="text-xs leading-relaxed text-pretty text-muted-foreground">
          {markLine}
        </p>
      ) : null}
    </li>
  );
}

/** The Holdings section of /check/[address]: every position largest first, then the compliance lines a pre-IPO token calls for. */
export function HoldingsList({ data, now }: { data: PreviewResponse; now?: number }) {
  const preIpo = hasPreIpoHolding(data);
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="check-holdings">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="check-holdings" className="text-lg font-semibold tracking-tight">
          Holdings
        </h2>
        {/* Client clock: a CDN-cached answer can be a few minutes old, and the label must say so. */}
        <span className="text-sm text-muted-foreground">Read {formatAge(ageSeconds(data.readAt, now))} from Solana</span>
      </div>
      {data.holdings.length === 0 ? (
        <EmptyState
          icon={<Wallet aria-hidden />}
          title="No xStocks or pre-IPO tokens in this wallet."
          description="On-chain quests need an xStock worth $5 or more, or any pre-IPO token. Try one of the real holders instead."
        />
      ) : (
        <>
          <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.07] bg-card">
            {data.holdings.map((h) => (
              <HoldingRow key={h.assetId} holding={h} now={now} />
            ))}
          </ul>
          {/* A pre-IPO token on screen: the standard line and the pre-IPO line together, once for the section. */}
          {preIpo ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-pretty text-muted-foreground">{COMPLIANCE_LINE}</p>
              <p data-slot="pre-ipo-compliance" className="text-xs text-pretty text-muted-foreground">
                {PRE_IPO_COMPLIANCE_LINE}
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export default HoldingsList;
