"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "@/hooks/useSession";
import { ArrowLeft, Copy } from "lucide-react";
import { mirrorApi, type PriceQuoteView } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { useApiQuery } from "@/components/common/useApiQuery";
import { AllocationTable, AllocationTableSkeleton } from "@/components/mirror/AllocationTable";
import { MirrorPlanCard } from "@/components/mirror/MirrorPlanCard";
import { StaleBanner } from "@/components/mirror/StaleBanner";
import { TargetHeader } from "@/components/mirror/TargetHeader";
import { MIRROR_COMPLIANCE_LINE } from "@/components/mirror/mirror-format";
import { emptyAllocationCopy } from "@/components/mirror/target-stats";

/** Prices move; re-read the target every minute while the tab is visible. */
const REFRESH_MS = 60_000;

export default function MirrorWalletPage() {
  const params = useParams<{ wallet: string }>();
  const wallet = typeof params?.wallet === "string" ? params.wallet : "";
  const { session } = useSession();
  const q = useApiQuery((signal) => mirrorApi.target(wallet, { signal }), [wallet, session?.userId ?? ""]);
  const { refetch } = q;

  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refetch();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refetch]);

  const data = q.data;
  const quotes = React.useMemo(() => new Map<string, PriceQuoteView>((data?.quotes ?? []).map((x) => [x.assetId, x])), [data?.quotes]);
  const marketClosed = (data?.quotes ?? []).some((x) => x.marketOpen === false);

  const back = (
    <Link href="/copy" className={buttonVariants({ variant: "ghost", size: "lg", className: "-ml-2.5 h-10 self-start text-muted-foreground" })}>
      <ArrowLeft data-icon="inline-start" aria-hidden />
      All leaders
    </Link>
  );

  if (q.loading) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-6 w-64 rounded-md" />
          <Skeleton className="h-[84px] w-full rounded-2xl" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <AllocationTableSkeleton />
          <Skeleton className="h-80 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (q.error || !data) {
    const notFound = q.errorStatus === 404;
    return (
      <div className="flex flex-col gap-4">
        {back}
        <PageHeader eyebrow="Copy a portfolio" title="Copy a wallet's portfolio" className="mb-0" />
        {notFound ? (
          <EmptyState
            icon={<Copy aria-hidden />}
            title="Nothing to copy here."
            description={q.error ?? "This wallet has no portfolio we can read yet."}
            action={
              <Link href="/copy" className={buttonVariants({ size: "lg" })}>
                Pick another leader
              </Link>
            }
          />
        ) : (
          <ErrorState title="Couldn't load this wallet" message={q.error} onRetry={q.refetch} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {back}
      <TargetHeader target={data.target} now={data.now} />

      {data.stale ? <StaleBanner marketClosed={marketClosed} /> : null}

      <div className="mt-4 grid items-start gap-8 animate-in fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="mirror-allocation">
          <h2 id="mirror-allocation" className="text-lg font-semibold tracking-tight">
            Allocation
          </h2>
          {data.target.legs.length === 0 ? (
            <EmptyState
              icon={<Copy aria-hidden />}
              title="No stocks worth $1 or more right now."
              description={emptyAllocationCopy(data.target.source)}
            />
          ) : (
            <AllocationTable legs={data.target.legs} quotes={quotes} totalUsd={data.target.totalUsd} />
          )}
        </section>

        {/* Sticky lives on a wrapper: .border-gradient sets position: relative on the card itself. */}
        <div className="min-w-0 lg:sticky lg:top-20">
          <MirrorPlanCard
            target={data.target}
            signedIn={data.signedIn}
            stale={data.stale}
            tolerance={data.tolerance}
            usdcMint={data.usdcMint}
            onRecorded={refetch}
          />
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground/80">
        {data.target.source === "public" ? "Public wallet on Solana: not a Dulo player, never scored. " : ""}Points only, no cash value. {MIRROR_COMPLIANCE_LINE}
      </p>
    </div>
  );
}
