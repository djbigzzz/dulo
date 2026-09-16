"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Copy, SearchX, Wallet } from "lucide-react";
import { cn } from "cn";
import { previewApi, type PreviewPlayView, type PreviewResponse } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressChip } from "@/components/common/AddressChip";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { PriceChip } from "@/components/common/PriceChip";
import { StatStrip, type Stat } from "@/components/common/StatStrip";
import { ageSeconds, formatAge, formatPoints, formatUsd } from "@/components/common/format";
import { useApiQuery } from "@/components/common/useApiQuery";
import { CheckWalletBox } from "@/components/landing/CheckWalletBox";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { CONNECT_CTA_TITLE, checkErrorCopy, decidablePlays, formatMultiplier, formatQty } from "@/app/check/_components/check-format";
import { PreviewPlayCard, PreviewProofSheet } from "@/app/check/_components/PreviewPlayCard";

const ENTER = "animate-in fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none";

/** Route params arrive URL-encoded on some paths; a malformed escape is passed through (the API answers 400). */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function BackLink() {
  return (
    <Link href="/check" className={buttonVariants({ variant: "ghost", size: "lg", className: "-ml-2.5 h-10 self-start text-muted-foreground" })}>
      <ArrowLeft data-icon="inline-start" aria-hidden />
      Check another wallet
    </Link>
  );
}

function Holdings({ data }: { data: PreviewResponse }) {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="check-holdings">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="check-holdings" className="text-lg font-semibold tracking-tight">
          Holdings
        </h2>
        {/* Client clock: a CDN-cached answer can be a few minutes old, and the label must say so. */}
        <span className="text-sm text-muted-foreground">Read {formatAge(ageSeconds(data.readAt))} from Solana</span>
      </div>
      {data.holdings.length === 0 ? (
        <EmptyState
          icon={<Wallet aria-hidden />}
          title="No xStocks in this wallet."
          description="On-chain quests need an xStock worth $5 or more. Try one of the real holders instead."
        />
      ) : (
        <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.07] bg-card">
          {data.holdings.map((h) => {
            const mult = formatMultiplier(h.multiplier);
            return (
              <li key={h.assetId} className="flex flex-col gap-2 px-4 py-3 sm:px-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-mono text-sm font-semibold">{h.symbol}</span>
                    <span className="text-sm text-muted-foreground tabular-nums">{formatQty(h.qty)} shares</span>
                    {mult ? (
                      <span className="text-xs text-muted-foreground" title="Token-2022 multiplier applied to the raw balance (splits and dividends)">
                        {mult} multiplier
                      </span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-base font-semibold tracking-tight tabular-nums">{formatUsd(h.usd)}</span>
                </div>
                <PriceChip quote={h.quote} className="self-start" />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ConnectPanel({ address }: { address: string }) {
  // Hero panel: `ember-glow` stays outside cn() so tailwind-merge never drops bg-card (docs/DESIGN.md).
  return (
    <section aria-labelledby="check-connect" className={`border-gradient bg-card ember-glow ${cn("relative flex flex-col gap-4 overflow-hidden rounded-3xl p-5 sm:p-6")}`}>
      <p className="text-xs font-medium tracking-[0.14em] text-gold uppercase">Is this your wallet?</p>
      <h2 id="check-connect" className="font-display text-3xl leading-[1.05] font-normal text-balance">
        {CONNECT_CTA_TITLE}
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Sign one message with it (no transaction). Dulo then snapshots it every few minutes, so the on-chain quests it meets earn points and the streaks
        start counting.
      </p>
      <ConnectButton size="lg" className="h-11 w-full text-base" />
      <Link href={`/copy/${encodeURIComponent(address)}`} className={buttonVariants({ variant: "outline", size: "lg", className: "h-11 w-full text-base" })}>
        <Copy data-icon="inline-start" aria-hidden />
        Copy this wallet&apos;s portfolio
      </Link>
      <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" aria-hidden />
      <p className="text-xs leading-relaxed text-muted-foreground">Points only, no cash value. This check read the chain once: nothing stored, never scored.</p>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-[82px] w-full rounded-2xl" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-2xl" />
            ))}
          </div>
        </div>
        <Skeleton className="h-80 w-full rounded-3xl" />
      </div>
    </div>
  );
}

export default function CheckWalletPage() {
  const params = useParams<{ address: string }>();
  const address = typeof params?.address === "string" ? safeDecode(params.address) : "";
  // The preview does not depend on the session and every read counts against a per-IP limit: no focus or session refetches.
  const q = useApiQuery((signal) => previewApi.wallet(address, { signal }), [address], {
    refetchOnFocus: false,
    refetchOnSessionChange: false,
    awaitSession: false,
  });
  const [proofPlay, setProofPlay] = React.useState<PreviewPlayView | null>(null);
  const [proofOpen, setProofOpen] = React.useState(false);
  const openProof = React.useCallback((play: PreviewPlayView) => {
    setProofPlay(play);
    setProofOpen(true);
  }, []);

  if (q.loading) return <LoadingState />;

  const data = q.data;
  if (q.error || !data) {
    const copy = checkErrorCopy(q.errorStatus, q.error);
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <PageHeader eyebrow="Check a wallet" title="Check any wallet" className="mb-0" />
        {q.errorStatus === 400 ? (
          <>
            <EmptyState icon={<SearchX aria-hidden />} title={copy.title} description={copy.description} />
            <CheckWalletBox primary />
          </>
        ) : (
          <ErrorState title={copy.title} message={copy.description} onRetry={q.errorStatus === 429 ? undefined : q.refetch} />
        )}
      </div>
    );
  }

  const decidable = decidablePlays(data);
  const stats: Stat[] = [
    { label: "xStocks value", value: formatUsd(data.totalUsd), hint: `${data.holdings.length} ${data.holdings.length === 1 ? "stock" : "stocks"}` },
    { label: "Verified now", value: `${data.qualifying} of ${decidable}`, tone: data.qualifying > 0 ? "ember" : "default", hint: "on-chain quests" },
    { label: "Would score", value: `+${formatPoints(data.qualifyingPoints)}`, tone: "gold", hint: "pts once connected" },
    { label: "Quests listed", value: formatPoints(data.plays.length), hint: "active this Season" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <PageHeader
        className="mb-0"
        eyebrow={data.label ? `Check a wallet · ${data.label}` : "Check a wallet"}
        title={
          <>
            What this wallet <span className="text-gradient-ember pr-[0.08em] italic">already scores</span>
          </>
        }
        description={
          data.label
            ? "A public wallet on Solana: not a Dulo player, never scored. Its xStocks were read live, and every quest was checked by the same engine the Season uses."
            : "Its xStocks were read live from Token-2022 balances, and every quest was checked by the same engine the Season uses. Nothing was stored."
        }
        actions={<AddressChip address={data.address} chainId={data.chainId} explorer />}
        stats={<StatStrip stats={stats} />}
      />

      <div className={cn("mt-4 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]", ENTER)}>
        <div className="flex min-w-0 flex-col gap-8">
          <Holdings data={data} />

          <section className="flex min-w-0 flex-col gap-3" aria-labelledby="check-plays">
            <h2 id="check-plays" className="text-lg font-semibold tracking-tight">
              Quests
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {data.plays.map((play) => (
                <li key={play.key} className="min-w-0">
                  <PreviewPlayCard play={play} onProof={openProof} />
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Sticky lives on a wrapper: .border-gradient sets position: relative on the card itself. */}
        <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-20">
          <ConnectPanel address={data.address} />
          <CheckWalletBox />
        </div>
      </div>

      <PreviewProofSheet play={proofPlay} readAt={data.readAt} open={proofOpen} onOpenChange={setProofOpen} />
    </div>
  );
}
