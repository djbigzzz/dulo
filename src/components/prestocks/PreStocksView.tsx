"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Gamepad2, Sprout } from "lucide-react";
import { cn } from "cn";
import { useSession } from "@/hooks/useSession";
import { api, leagueApi, type LeagueResponse, type LeagueSymbolsResponse, type PartnerDetail, type PlaysResponse, type PlayView } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { COMPLIANCE_LINE, PRE_IPO_COMPLIANCE_LINE } from "@/components/common/compliance";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { MarketSessionChip } from "@/components/common/MarketSessionChip";
import { PageHeader } from "@/components/common/PageHeader";
import { SignInBanner } from "@/components/common/SignInBanner";
import { StatStrip, type Stat } from "@/components/common/StatStrip";
import { useApiQuery } from "@/components/common/useApiQuery";
import { formatUsd } from "@/components/common/format";
import { WEEKEND_TRADES_COPY, formatSignedUsd, formatUsdWhole, isPreWeek, pnlClass } from "@/components/league/format";
import { PositionsTable, PositionsTableSkeleton } from "@/components/league/PositionsTable";
import { TradeClosed } from "@/components/league/TradeClosed";
import { TradeForm } from "@/components/league/TradeForm";
import { CorporateActionsSection } from "@/components/partners/PartnerView";
import { PlayCard, PlayCardSkeleton } from "@/components/plays/PlayCard";
import { ProofDrawer } from "@/components/plays/ProofDrawer";
import { PreIpoBoard, PreIpoBoardSkeleton } from "@/components/prestocks/PreIpoBoard";
import { PRE_IPO_PARTNER_SLUG, PRE_IPO_QUEST_KEYS, PRE_IPO_TRADE_NOTE, preIpoPnlUsd, preIpoPositions, preIpoSymbolSet } from "@/components/prestocks/tokens";

/** Prices move; re-read the board and the account every minute while the tab is visible. */
const REFRESH_MS = 60_000;
const CHAIN_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export const PRE_IPO_PAGE_TITLE = "Pre-IPO tokens, 24/7";
export const PRE_IPO_PAGE_DESCRIPTION = "Trade them with virtual cash in this week's competition, complete pre-IPO quests, and see what the mint says.";

const DIVIDER = "h-px bg-gradient-to-r from-white/[0.12] via-white/[0.05] to-transparent";
const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-4";

function SectionHeading({ id, eyebrow, title, hint }: { id: string; eyebrow: string; title: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium tracking-[0.14em] text-gold uppercase">{eyebrow}</p>
          <h2 id={id} className="font-display text-3xl leading-none font-normal sm:text-4xl">
            {title}
          </h2>
        </div>
        {hint ? <p className="max-w-xl text-sm text-pretty text-muted-foreground">{hint}</p> : null}
      </div>
      <div className={DIVIDER} aria-hidden />
    </div>
  );
}

/** The four pre-IPO quests from the board payload, in PRE_IPO_QUEST_KEYS order (missing keys skipped). Exported for tests. */
export function preIpoQuests(data: PlaysResponse | null | undefined): PlayView[] {
  const all = new Map<string, PlayView>();
  for (const g of data?.groups ?? []) for (const c of g.campaigns) for (const p of c.plays) all.set(p.key, p);
  return PRE_IPO_QUEST_KEYS.map((k) => all.get(k)).filter((p): p is PlayView => p !== undefined);
}

export interface PreStocksViewProps {
  className?: string;
}

/**
 * The /prestocks page body: the board of eight tokens, the competition's trade form fenced to
 * pre-IPO tokens with the caller's pre-IPO positions, the four pre-IPO quests with live progress,
 * and the corporate actions read from the mints. Every read goes through /api/v1.
 *
 * Hierarchy (22 Sep): the trade form's submit is the page's one ember action; every other control
 * is outline or ghost, the sign-in banner's Connect included. The compliance pair prints once, in
 * the header details. Under lg the trade section comes before the board (CSS order; the DOM keeps
 * board, trade, quests, actions), so a phone reaches the action first.
 */
export function PreStocksView({ className }: PreStocksViewProps) {
  const { session, refresh: refreshSession } = useSession();
  const sessionKey = session?.userId ?? "";

  const symbols = useApiQuery<LeagueSymbolsResponse>((signal) => leagueApi.symbols({ signal }), ["prestocks:symbols", sessionKey]);
  const league = useApiQuery<LeagueResponse>((signal) => leagueApi.overview({ signal }), ["prestocks:league", sessionKey]);
  const partner = useApiQuery<PartnerDetail>((signal) => api.partner(PRE_IPO_PARTNER_SLUG, { signal }), "prestocks:partner", { refetchOnFocus: false });
  const plays = useApiQuery<PlaysResponse>(() => api.plays(), ["prestocks:plays", sessionKey], { refetchOnFocus: false });

  const refetchSymbols = symbols.refetch;
  const refetchLeague = league.refetch;
  const refetchPlays = plays.refetch;

  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refetchSymbols();
      refetchLeague();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refetchSymbols, refetchLeague]);

  // Bumped after every successful load so the trade form re-reads held quantities and cash.
  const [refreshKey, setRefreshKey] = React.useState(0);
  React.useEffect(() => {
    if (league.data) setRefreshKey((k) => k + 1);
  }, [league.data]);

  const [proofKey, setProofKey] = React.useState<string | null>(null);
  const [proofOpen, setProofOpen] = React.useState(false);
  const quests = React.useMemo(() => preIpoQuests(plays.data), [plays.data]);
  const proofPlay = proofKey ? (quests.find((p) => p.key === proofKey) ?? null) : null;
  const openProof = React.useCallback((play: PlayView) => {
    setProofKey(play.key);
    setProofOpen(true);
  }, []);

  const onPlaced = React.useCallback(() => {
    refetchLeague();
    refetchSymbols();
    refetchPlays();
    // A trade can complete a quest inline: the header balance and Season points come from /auth/me.
    void refreshSession();
  }, [refetchLeague, refetchSymbols, refetchPlays, refreshSession]);

  const data = league.data;
  const week = data?.league ?? null;
  const signedIn = data?.signedIn ?? false;
  const startingCash = formatUsdWhole(data?.startingCashUsd ?? 10_000);
  const preIpo = React.useMemo(() => preIpoSymbolSet(symbols.data?.symbols), [symbols.data]);
  const positions = React.useMemo(() => preIpoPositions(data?.me?.positions, preIpo), [data, preIpo]);
  const pnl = preIpoPnlUsd(positions);
  const closed = Boolean(week && !week.open);
  const weekend = Boolean(data && week && week.open && isPreWeek(week, data.now));

  const stats: Stat[] | null =
    data && signedIn
      ? [
          { label: "Virtual cash", value: formatUsd(data.me?.cashUsd ?? data.startingCashUsd), hint: "Shared with your xStock trades" },
          { label: "Pre-IPO positions", value: String(positions.length), hint: positions.length === 0 ? "Paper trade below" : "Valued at the last price" },
          {
            label: "Pre-IPO P&L",
            value: pnl === null ? "—" : formatSignedUsd(pnl),
            hint: pnl === null ? "No live price yet" : "This week, pre-IPO tokens only",
            tone: pnl === null || Math.abs(pnl) < 0.005 ? "default" : pnl > 0 ? "positive" : "negative",
          },
          { label: "Your rank", value: data.me?.rank ? `#${data.me.rank}` : "—", hint: data.me?.rank ? "Weekly competition" : "Paper trade to get ranked" },
        ]
      : null;

  const tradePanel =
    data && week && closed ? (
      <TradeClosed league={week} serverNow={data.now} lastSettled={data.lastSettled} chainId={CHAIN_ID} />
    ) : (
      <TradeForm
        league={week}
        signedIn={signedIn}
        serverNow={data?.now ?? null}
        refreshKey={`${sessionKey}:${refreshKey}`}
        onPlaced={onPlaced}
        sources={["prestocks"]}
        symbolLabel="Pre-IPO token"
        preIpoNotice={false}
      />
    );

  return (
    <div className={cn("flex flex-col gap-10 sm:gap-12", className)}>
      <PageHeader
        className="mb-0"
        eyebrow="PreStocks"
        title={PRE_IPO_PAGE_TITLE}
        description={PRE_IPO_PAGE_DESCRIPTION}
        stats={stats ? <StatStrip stats={stats} /> : league.loading && sessionKey ? <Skeleton className="h-[84px] w-full rounded-2xl" /> : undefined}
        details={
          <>
            <p>
              Pre-IPO tokens are Token-2022 mints issued by PreStocks on Solana. They trade on Jupiter around the clock, so their DEX price
              never waits for Wall Street to open. The issuer also publishes its own mark; the board shows both, each with its source and age.
            </p>
            <p>
              In the weekly competition they fill at the live DEX quote with the same 0.1% spread and the same {startingCash} of virtual cash as
              your xStock trades, and count on the same leaderboard. Nothing is bought on-chain. {WEEKEND_TRADES_COPY}.
            </p>
            <p>
              Two pre-IPO quests are completed with paper trades here; two are verified from your own wallet. A quest describes a wallet state
              or an in-app action, never a purchase. Points only, no cash value.
            </p>
          </>
        }
      />

      <div className="-mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 sm:-mt-6">
        <MarketSessionChip />
        <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
          The US session chip is for xStocks. Pre-IPO tokens quote on Solana at any hour, and every price carries its source and age.
        </p>
      </div>

      {/* a + b. The board and the trade section: DOM order board, trade; under lg the trade section shows first. */}
      <div className="flex flex-col gap-10 sm:gap-12">
        <section aria-labelledby="pre-ipo-board" className="flex min-w-0 flex-col gap-5">
          <SectionHeading id="pre-ipo-board" eyebrow="The board" title="Eight pre-IPO tokens" hint="DEX price from Jupiter, the issuer's mark from PreStocks, and Jupiter's 24h move." />
          {symbols.loading ? (
            <PreIpoBoardSkeleton />
          ) : symbols.error ? (
            <ErrorState title="Couldn't load the board" message={symbols.error} onRetry={symbols.refetch} />
          ) : (
            <PreIpoBoard symbols={symbols.data?.symbols ?? []} actions={partner.data?.corporateActions ?? []} />
          )}
        </section>

        <section aria-labelledby="pre-ipo-trade" data-slot="pre-ipo-trade" className="order-first flex min-w-0 flex-col gap-5 lg:order-none">
          <SectionHeading id="pre-ipo-trade" eyebrow="Weekly competition (virtual cash)" title="Trade with virtual cash" hint={PRE_IPO_TRADE_NOTE} />
          {/* Outline Connect: the trade form below carries the page's one ember action. */}
          <SignInBanner
            title={`Sign in to trade with ${startingCash} of virtual cash.`}
            hint="Same account and same leaderboard as your xStock paper trades."
            connectVariant="outline"
          />
          {league.loading ? (
            <TradeSkeleton />
          ) : league.error ? (
            <ErrorState title="Couldn't load the competition" message={league.error} onRetry={league.refetch} />
          ) : !data || !week ? (
            <EmptyState icon={<Sprout aria-hidden />} title="Season 0 is being set up." description="The competition opens as soon as the Season starts. Check back in a moment." />
          ) : (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              {/* The form first on a phone (order), beside the positions from lg. */}
              <section className="order-first rounded-2xl border-gradient bg-card p-5 lg:order-none lg:col-start-2" aria-labelledby="pre-ipo-trade-form">
                <div className="mb-5 flex flex-col gap-1">
                  <h3 id="pre-ipo-trade-form" className="text-lg font-semibold tracking-tight">
                    Paper trade a pre-IPO token
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {closed ? `This week is settling. ${WEEKEND_TRADES_COPY}.` : weekend ? `${WEEKEND_TRADES_COPY}. Virtual fills at the live quote, 0.1% spread.` : "Virtual fills at the live DEX quote, 0.1% spread."}
                  </p>
                </div>
                {tradePanel}
              </section>
              <div className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="text-lg font-semibold tracking-tight">Your pre-IPO positions</h3>
                  {signedIn ? (
                    <span className={cn("text-xs tabular-nums", pnlClass(pnl))}>{pnl === null ? "" : `${formatSignedUsd(pnl)} this week`}</span>
                  ) : null}
                </div>
                {signedIn ? (
                  <PositionsTable positions={positions} emptyDescription="Paper-buy any pre-IPO token with your virtual cash. Sells count too." />
                ) : (
                  <EmptyState
                    icon={<Gamepad2 aria-hidden />}
                    title="Sign in to see your positions."
                    description={`${startingCash} of virtual cash a week, xStocks and pre-IPO tokens in one account.`}
                    action={
                      <Link href="/competition" className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
                        Open the competition
                        <ArrowRight data-icon="inline-end" aria-hidden />
                      </Link>
                    }
                  />
                )}
                <p className="text-xs text-pretty text-muted-foreground">{PRE_IPO_TRADE_NOTE}</p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* c. Pre-IPO quests */}
      <section aria-labelledby="pre-ipo-quests" className="flex flex-col gap-5">
        <SectionHeading id="pre-ipo-quests" eyebrow="Quests" title="Pre-IPO quests" hint="Two complete with paper trades here; two are verified from your own wallet." />
        {plays.loading ? (
          <div className={GRID} aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <PlayCardSkeleton key={i} />
            ))}
          </div>
        ) : plays.error ? (
          <ErrorState title="Couldn't load the quests" message={plays.error} onRetry={plays.refetch} />
        ) : quests.length === 0 ? (
          <EmptyState
            icon={<Sprout aria-hidden />}
            title="Pre-IPO quests are being seeded."
            description="They land here in a moment. Your first pre-IPO paper trade already counts."
            action={
              <Link href="/quests" className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
                All quests
                <ArrowRight data-icon="inline-end" aria-hidden />
              </Link>
            }
          />
        ) : (
          <ul className={GRID} data-slot="pre-ipo-quests">
            {quests.map((play) => (
              <li key={play.key} className="min-w-0">
                <PlayCard play={play} signedIn={plays.data?.signedIn ?? signedIn} onProof={openProof} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* d. Corporate actions, read from the mints (renders nothing while empty; an unlisted Partner is "nothing on record", not a failure) */}
      {partner.loading ? (
        <Skeleton className="h-24 w-full rounded-2xl" aria-hidden />
      ) : partner.error && partner.errorStatus !== 404 ? (
        <ErrorState title="Couldn't read the mints" message={partner.error} onRetry={partner.refetch} />
      ) : (
        <CorporateActionsSection actions={partner.data?.corporateActions} className="pt-0" />
      )}

      {/* Once per page, and visible without opening anything: the standard line and the pre-IPO line at the foot. */}
      <div data-slot="board-compliance" className="flex flex-col gap-1 text-xs text-pretty text-muted-foreground">
        <p>{COMPLIANCE_LINE}</p>
        <p data-slot="pre-ipo-compliance">{PRE_IPO_COMPLIANCE_LINE}</p>
      </div>

      <ProofDrawer play={proofPlay} open={proofOpen && proofPlay !== null} onOpenChange={setProofOpen} />
    </div>
  );
}

function TradeSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]" aria-hidden>
      <div className="flex min-w-0 flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <PositionsTableSkeleton rows={2} />
      </div>
      <Skeleton className="h-96 w-full rounded-2xl" />
    </div>
  );
}

export default PreStocksView;
