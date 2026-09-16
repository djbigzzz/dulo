"use client";

import * as React from "react";
import Link from "next/link";
import { useSession } from "@/hooks/useSession";
import { ArrowRight, RefreshCw, Sprout } from "lucide-react";
import { cn } from "cn";
import { toast } from "sonner";
import { api, apiGet, errorMessage, type PartnerGroup, type PlaysResponse, type PlayView } from "@/lib/api-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { StatStrip, type Stat } from "@/components/common/StatStrip";
import { SignInBanner } from "@/components/common/SignInBanner";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { useApiQuery } from "@/components/common/useApiQuery";
import { formatPoints } from "@/components/common/format";
import { PARTNER_MARKS_NOTICE } from "@/components/common/compliance";
import { PlayGrid, PlayGridSkeleton } from "@/components/plays/PlayGrid";
import { PlayFilterBar } from "@/components/plays/PlayFilterBar";
import { ProofDrawer } from "@/components/plays/ProofDrawer";
import { PLAY_FILTERS, boardTotals, listedPartnerCount, matchesFilter, questKind, type PlayFilter } from "@/components/plays/play-meta";

/**
 * Sign-in kicks off a wallet snapshot + quest evaluation on the server (auth/verify ->
 * runForUser). It usually lands within a couple of seconds, so re-read the board once
 * after that instead of making the user press Refresh to see "First Position" flip.
 */
const POST_SIGN_IN_REFETCH_MS = 3000;

function allPlays(groups: PartnerGroup[]): PlayView[] {
  return groups.flatMap((g) => g.campaigns.flatMap((c) => c.plays));
}

export default function QuestsPage() {
  const { session, refresh: refreshSession } = useSession();
  const q = useApiQuery((signal) => apiGet<PlaysResponse>("/api/v1/plays", { signal }), session?.userId ?? "");
  const { refetch } = q;

  const [filter, setFilter] = React.useState<PlayFilter>("all");
  const [proofKey, setProofKey] = React.useState<string | null>(null);
  const [proofOpen, setProofOpen] = React.useState(false);

  const groups = React.useMemo(() => q.data?.groups ?? [], [q.data]);
  const plays = React.useMemo(() => allPlays(groups), [groups]);
  // Resolve against the latest data so a background refetch updates an open drawer.
  const proofPlay = proofKey ? (plays.find((p) => p.key === proofKey) ?? null) : null;
  const signedIn = q.data?.signedIn ?? false;

  const openProof = React.useCallback((play: PlayView) => {
    setProofKey(play.key);
    setProofOpen(true);
  }, []);

  // Manual refresh: re-read the wallet now (server caps it at ~8s), then re-fetch the board and the
  // session, so a quest completed by this refresh shows in the points balance at once.
  const [refreshing, setRefreshing] = React.useState(false);
  const refreshPlays = React.useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await api.refreshPlays();
      refetch();
      void refreshSession().catch(() => undefined);
    } catch (e) {
      toast.error("Couldn't refresh your quests", { description: errorMessage(e) });
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refreshSession, refreshing]);

  // One delayed refetch when the board goes from signed-out to signed-in (see POST_SIGN_IN_REFETCH_MS).
  const prevSignedIn = React.useRef<boolean | null>(null);
  const postSignInTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (!q.data) return;
    const prev = prevSignedIn.current;
    prevSignedIn.current = q.data.signedIn;
    if (prev === false && q.data.signedIn) {
      window.clearTimeout(postSignInTimer.current);
      postSignInTimer.current = window.setTimeout(refetch, POST_SIGN_IN_REFETCH_MS);
    }
  }, [q.data, refetch]);
  React.useEffect(() => () => window.clearTimeout(postSignInTimer.current), []);

  const totals = boardTotals(plays);
  const kinds = {
    inPlatform: plays.filter((p) => questKind(p) === "in-platform").length,
    onChain: plays.filter((p) => questKind(p) === "on-chain").length,
    soon: plays.filter((p) => questKind(p) === "partner-coming-soon").length,
  };
  const counts = Object.fromEntries(PLAY_FILTERS.map((f) => [f.value, plays.filter((p) => matchesFilter(p, f.value)).length])) as Record<PlayFilter, number>;

  const stats: Stat[] = q.data
    ? [
        { label: "Live quests", value: totals.livePlays, hint: `${kinds.inPlatform} in-platform · ${kinds.onChain} on-chain` },
        { label: "Points available", value: formatPoints(totals.livePoints), tone: "ember", hint: "Points only, no cash value" },
        signedIn
          ? { label: "You completed", value: `${totals.completed}/${totals.livePlays}`, tone: totals.completed > 0 ? "positive" : "default" }
          : { label: "You completed", value: "—", hint: "Connect to track" },
        { label: "Listed projects", value: listedPartnerCount(groups), hint: kinds.soon > 0 ? `None signed yet · ${kinds.soon} quests coming soon` : "None signed yet" },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="mb-0"
        eyebrow="Season 0"
        title="Quests"
        description="In-platform quests with points and virtual cash, and on-chain quests verified from your wallet. Points only, no cash value."
        actions={
          signedIn ? (
            <Button
              variant="outline"
              className="h-10 sm:h-8"
              onClick={() => void refreshPlays()}
              disabled={refreshing}
              title="Re-read your wallet now instead of waiting for the next 5-minute check"
            >
              <RefreshCw className={refreshing ? "animate-spin" : undefined} data-icon="inline-start" aria-hidden />
              {refreshing ? "Reading wallet" : "Refresh"}
            </Button>
          ) : null
        }
        stats={stats.length > 0 ? <StatStrip stats={stats} /> : null}
        details={
          <>
            <p>
              In-platform quests are done inside Dulo: predictions with your starter points and paper trades with the competition&apos;s virtual
              cash. They complete the moment the prediction or trade goes through.
            </p>
            <p>
              On-chain quests are verified from your own wallet. Connect one or more wallets and sign a message once; every 5 minutes Dulo takes a
              snapshot of the xStocks in each connected wallet and checks it against every live on-chain quest. Each one describes a wallet state,
              and its proof shows the snapshot that reached it. Nothing to submit and no transaction to sign.
            </p>
            <p>
              Partner quests are coming soon. The plan is that partners list on-chain quests and pay per verified completion; nothing is billed
              today and no partner has signed. Badge quests also mint a soulbound Badge to your wallet a few minutes after you complete them.
              Points only, no cash value.
            </p>
          </>
        }
      />

      <SignInBanner title="Connect to start earning points." hint="Starter points and virtual cash cover every in-platform quest." />

      {q.loading ? (
        <PlayGridSkeleton />
      ) : q.error ? (
        <ErrorState title="Couldn't load your quests" message={q.error} onRetry={q.refetch} />
      ) : plays.length === 0 ? (
        <EmptyState
          icon={<Sprout aria-hidden />}
          title="Season 0 is being seeded."
          description="Quests land here in a moment. Your first prediction and your first paper trades already count."
          action={
            <Link href="/predictions" className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
              Make a prediction
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Link>
          }
        />
      ) : (
        <>
          <PlayFilterBar value={filter} onChange={setFilter} counts={counts} />
          <PlayGrid groups={groups} signedIn={signedIn} filter={filter} onProof={openProof} />
          {/* The board groups cards under Partner logos and names, so it carries the marks notice too. */}
          <p className="text-xs leading-relaxed text-muted-foreground">{PARTNER_MARKS_NOTICE}</p>
        </>
      )}

      <ProofDrawer play={proofPlay} open={proofOpen && proofPlay !== null} onOpenChange={setProofOpen} />
    </div>
  );
}
