"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, Share2Icon, TargetIcon } from "lucide-react";
import { api, leagueApi, type CallMarketView, type CallPositionView, type CallSide, type PlaceCallResponse } from "@/lib/api-client";
import { APP_URL } from "@/lib/config";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { useApiQuery } from "@/components/common/useApiQuery";
import { useSession } from "@/hooks/useSession";
import { useSignInIntent } from "@/hooks/useSignInIntent";
import { MarketCard, MarketCardSkeleton } from "@/components/calls/MarketCard";
import { PlaceCallDialog } from "@/components/calls/PlaceCallDialog";
import { CALLS_LOCK_COPY, NEXT_WEEK_MARKETS_COPY, liveStatus } from "@/components/calls/calls-format";
import { START_PATH, competitionLine, shareOnXUrl, type SharePrediction } from "@/components/start/share";

const NO_POSITIONS: CallPositionView[] = [];

const STEPS = ["Connect your wallet and sign one message. No transaction.", "Get 1,000 starter points.", "Pick Yes or No. Results land after Friday's close."];

/**
 * /start: the one-screen entry for shared links. One featured prediction (the first open one),
 * sign-in on the button press, the same PlaceCallDialog as /predictions, then a prefilled post
 * for X. Everything else (the other predictions, the competition, quests) is one link away.
 */
export default function StartPage() {
  const { session } = useSession();
  const q = useApiQuery((signal) => api.calls({ signal }), session?.userId ?? "");
  const lq = useApiQuery((signal) => leagueApi.overview({ signal }), "");
  const compLine = competitionLine(lq.data?.league ?? null);
  const { refetch } = q;
  const nowMs = Date.now();

  const markets = React.useMemo(() => q.data?.markets ?? [], [q.data?.markets]);
  const featured: CallMarketView | null = markets.find((m) => liveStatus(m, nowMs) === "open") ?? null;
  const me = q.data?.me ?? null;
  const signedIn = me !== null;
  const positions = featured ? (me?.positions ?? []).filter((p) => p.marketId === featured.id) : NO_POSITIONS;

  const [side, setSide] = React.useState<CallSide | undefined>(undefined);
  const [open, setOpen] = React.useState(false);
  const [shared, setShared] = React.useState<SharePrediction | null>(null);
  const { pending, start: startSignIn, clear } = useSignInIntent<CallSide>(refetch);

  const onPlace = React.useCallback(
    (_market: CallMarketView, s: CallSide) => {
      setSide(s);
      if (signedIn) setOpen(true);
      else startSignIn(s);
    },
    [signedIn, startSignIn],
  );

  React.useEffect(() => {
    if (!signedIn || !pending) return;
    setSide(pending);
    setOpen(true);
    clear();
  }, [signedIn, pending, clear]);

  const onPlaced = React.useCallback(
    (result: PlaceCallResponse) => {
      setShared({ ticker: result.market.ticker, strike: result.market.strike, side: result.position.side });
      refetch();
    },
    [refetch],
  );

  const url = `${APP_URL}${START_PATH}`;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-2 text-center">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">This week on Dulo</p>
        <h1 className="text-3xl font-semibold text-balance sm:text-4xl">Make your first prediction</h1>
        <p className="text-pretty text-muted-foreground">Free, points only, settled from Friday&apos;s close.</p>
        {compLine ? (
          <Link href="/competition" className="mx-auto mt-1 inline-flex rounded-full border border-ember/30 bg-ember/10 px-3 py-1 text-xs font-medium text-pretty text-foreground hover:bg-ember/15">
            {compLine}
          </Link>
        ) : null}
      </header>

      {q.loading ? (
        <MarketCardSkeleton />
      ) : q.error ? (
        <ErrorState title="Couldn't load this week's predictions" message={q.error} onRetry={refetch} />
      ) : !featured ? (
        <EmptyState
          icon={<TargetIcon aria-hidden />}
          className="rounded-2xl border-white/[0.08] bg-card py-12"
          title="This week's predictions are locked."
          description={NEXT_WEEK_MARKETS_COPY}
          action={
            <Link href="/competition" className={buttonVariants({ size: "lg", className: "h-10" })}>
              Try the weekly competition (virtual cash)
              <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Link>
          }
        />
      ) : (
        <MarketCard market={featured} positions={positions} nowMs={nowMs} signedIn={signedIn} onPlace={onPlace} />
      )}

      {shared ? (
        <section className="flex flex-col items-center gap-3 rounded-2xl border border-white/[0.08] bg-card p-5 text-center" aria-live="polite">
          <p className="font-medium">You&apos;re in. Ask a friend which way they&apos;d go.</p>
          <a
            href={shareOnXUrl(shared, url)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size: "lg", className: "h-10" })}
          >
            <Share2Icon data-icon="inline-start" aria-hidden />
            Post your pick on X
          </a>
          <Link href="/predictions" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            See this week&apos;s other predictions
          </Link>
        </section>
      ) : (
        <ol className="flex flex-col gap-2 rounded-2xl border border-white/[0.08] bg-card p-5 text-sm">
          {STEPS.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="font-semibold text-primary tabular-nums">{i + 1}</span>
              <span className="text-pretty">{s}</span>
            </li>
          ))}
        </ol>
      )}

      <p className="text-center text-xs text-pretty text-muted-foreground">
        {CALLS_LOCK_COPY} Points only, no cash value.
      </p>

      <PlaceCallDialog
        market={featured}
        positions={positions}
        spendablePoints={me?.spendablePoints ?? 0}
        initialSide={side}
        open={open && featured !== null}
        onOpenChange={setOpen}
        onPlaced={onPlaced}
      />
    </div>
  );
}
