"use client";

import Link from "next/link";
import { useSession } from "@/hooks/useSession";
import { ArrowRight, Copy } from "lucide-react";
import { mirrorApi, type MirrorIndexResponse } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { COMPLIANCE_LINE } from "@/components/common/compliance";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { useApiQuery } from "@/components/common/useApiQuery";
import { TargetList, TargetListSkeleton } from "@/components/mirror/TargetList";
import { MirrorAnyWallet } from "@/components/mirror/MirrorAnyWallet";
import { PUBLIC_WALLETS_HINT, PUBLIC_WALLETS_TITLE, PublicWalletList } from "@/components/mirror/PublicWalletList";

const CHAIN_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

function SectionTitle({ id, children, hint }: { id: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 id={id} className="text-lg font-semibold tracking-tight">
        {children}
      </h2>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

const HOW_IT_WORKS = (
  <ol className="flex list-decimal flex-col gap-1.5 pl-5">
    <li>Pick a wallet (a Season leader, a public holder or any Solana address you paste) and see how its xStocks portfolio is split.</li>
    <li>Choose how much USDC to put in. Dulo works out the amount for each stock.</li>
    <li>Open each swap in Jupiter and sign it from your own wallet. Dulo never touches your funds.</li>
    <li>Come back and tap &quot;I&apos;ve done my swaps&quot;. The next snapshot checks whether your wallet matches the same mix.</li>
  </ol>
);

const SECTION = "flex flex-col gap-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none";

/**
 * Season leaders (real Dulo players) first when there are any; otherwise the curated public
 * wallets lead so the page never opens on an empty board or on bots. Model portfolios (paper,
 * competition accounts) always come last. A section with no rows renders nothing at all: the
 * page already has a whole-page empty state for the case where every section is empty.
 */
function MirrorSections({ data }: { data: MirrorIndexResponse }) {
  const publicRows = data.public ?? [];
  const season =
    data.leaderboard.length > 0 ? (
      <section key="season" className={SECTION} aria-labelledby="mirror-board">
        <SectionTitle id="mirror-board" hint="Dulo players · real on-chain portfolios">
          Season leaders
        </SectionTitle>
        <TargetList rows={data.leaderboard} metric="points" chainId={CHAIN_ID} />
      </section>
    ) : null;
  const publicWallets =
    publicRows.length > 0 ? (
      <section key="public" className={SECTION} aria-labelledby="mirror-public">
        <SectionTitle id="mirror-public" hint={PUBLIC_WALLETS_HINT}>
          {PUBLIC_WALLETS_TITLE}
        </SectionTitle>
        <PublicWalletList rows={publicRows} chainId={CHAIN_ID} />
      </section>
    ) : null;
  const models =
    data.league.length > 0 ? (
      <section key="models" className={SECTION} aria-labelledby="mirror-league">
        <SectionTitle id="mirror-league" hint="Today's prices · one stock over 40% listed last">
          Model portfolios (paper)
        </SectionTitle>
        {/* House bots are named in words here, not only by TargetList's bot icon: /copy is the one
            page that invites a visitor to copy a portfolio, so the label may not be icon-only. */}
        <p className="-mt-1 text-xs leading-relaxed text-muted-foreground">
          Competition accounts (virtual cash), house bots included. House bots are ranked but never earn points.
        </p>
        <TargetList rows={data.league} metric="equity" chainId={CHAIN_ID} />
      </section>
    ) : null;
  return <>{data.leaderboard.length > 0 ? [season, publicWallets, models] : [publicWallets, season, models]}</>;
}

export default function MirrorIndexPage() {
  const { session } = useSession();
  const q = useApiQuery((signal) => mirrorApi.index({ signal }), session?.userId ?? "");
  const data = q.data;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Season 0"
        title="Copy a portfolio"
        description="Copy a real portfolio: a Season leader, a public wallet on Solana or any address you paste. You swap in Jupiter from your own wallet; Dulo never touches your funds. The next snapshot checks whether your wallet matches."
        details={HOW_IT_WORKS}
        className="mb-0"
      />

      <MirrorAnyWallet className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none" />

      <p className="-mt-4 text-xs leading-relaxed text-muted-foreground/80">{COMPLIANCE_LINE}</p>

      {q.loading ? (
        <div className="flex flex-col gap-3" aria-hidden>
          <div className="h-5" />
          <TargetListSkeleton />
        </div>
      ) : q.error ? (
        <ErrorState title="Couldn't load wallets to copy" message={q.error} onRetry={q.refetch} />
      ) : !data || (data.leaderboard.length === 0 && data.league.length === 0 && (data.public ?? []).length === 0) ? (
        <EmptyState
          icon={<Copy aria-hidden />}
          title="Nothing to copy yet."
          description="Paste any Solana address above, or come back once players trade in the weekly competition (virtual cash) or earn points on the Season leaderboard."
          action={
            <Link href="/competition" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Open the competition
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Link>
          }
        />
      ) : (
        <MirrorSections data={data} />
      )}
    </div>
  );
}
