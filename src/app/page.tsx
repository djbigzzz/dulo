import Link from "next/link";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { buttonVariants } from "@/components/ui/button";
import { Tamga } from "@/components/brand/Tamga";
import { GameTiles, LivePredictions, SeasonTop } from "@/components/landing/ScoreboardPreview";
import { CheckWalletBox } from "@/components/landing/CheckWalletBox";
import { SessionSwitch } from "@/components/landing/SessionSwitch";
import { offerParts, verbParts } from "@/components/landing/game-tiles";
import { MarketSessionChip } from "@/components/common/MarketSessionChip";
import { COMPLIANCE_LINE } from "@/components/common/compliance";
import { WELCOME_OFFER_LINE } from "@/lib/games/ledger-policy";
import { cn } from "@/lib/utils";

/** The three verbs under the headline, byte-identical to the approved first screen (16 Sep 2026). */
const VERBS = "Predict. Compete. Complete on-chain quests.";

/**
 * The hero's one gold action: the xl size (the mockup's 54px Connect wallet) from lg, full width at
 * 52px on a phone. Its ConnectButton passes fullLabel, so a phone reads the full "Connect wallet"
 * where the header's button says "Connect".
 */
const HERO_PRIMARY = "h-[3.25rem] w-full sm:w-auto lg:h-[3.375rem]";

/** A text link on a 1px rule, its arrow after it. */
const RULED_LINK = cn(buttonVariants({ variant: "link" }), "text-base");

/** The welcome line and the signed-in line share one size: 15px on a phone, 16px from lg. */
const WELCOME = "max-w-[40ch] text-[0.9375rem] leading-[1.45] text-pretty text-muted-foreground lg:text-base lg:leading-normal";

function Arrow() {
  return (
    <span aria-hidden className="ml-2 font-medium">
      →
    </span>
  );
}

/** The welcome offer, its grant in cream. The words are WELCOME_OFFER_LINE's, unchanged. */
function WelcomeOffer({ line }: { line: string }) {
  const { lead, strong, rest } = offerParts(line);
  return (
    <>
      {lead}
      {strong ? <b className="font-semibold text-foreground">{strong}</b> : null}
      {rest}
    </>
  );
}

/**
 * A signed-in player's next step: the tour picks up from their own data. Gold in the hero (the page's
 * one primary action); the closing band passes variant="secondary", the cream solid.
 */
function ContinueTour({ className, variant = "default" }: { className?: string; variant?: "default" | "secondary" }) {
  return (
    <Link href="/start" className={cn(buttonVariants({ variant, size: "xl" }), HERO_PRIMARY, className)}>
      Continue the tour
    </Link>
  );
}

export default function Home() {
  const verbs = verbParts(VERBS);
  return (
    <div className="flex flex-col">
      {/*
        1. Hero (Broadcast, 9 Oct 2026). One grid: the headline and the way in on top, this week's
        prediction as the stage under them, its tabs, then the status line. On a phone the way in
        sits between the stage and the tabs, so the headline, the prediction, the welcome line,
        Connect and the wallet check all fit on the first screen.
      */}
      <section
        aria-labelledby="hero-title"
        className="grid grid-cols-1 [grid-template-areas:'head'_'stage'_'join'_'mkts'_'status'] lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-12 xl:grid-cols-[minmax(0,1fr)_27rem] xl:gap-x-16 lg:pt-0.5 lg:[grid-template-areas:'head_join'_'stage_stage'_'mkts_mkts'_'status_status']"
      >
        <div className="min-w-0 [grid-area:head]">
          {/* max-w in em: "The entertainment layer" fits on the first line and "for xStocks." breaks to the second, at every size. */}
          <h1
            id="hero-title"
            className="max-w-[8.6em] font-display text-[2.5625rem] leading-[0.98] font-normal tracking-[-0.012em] text-foreground sm:text-[3.25rem] lg:-ml-[3px] lg:text-[3.5rem] xl:text-[4.25rem]"
          >
            The entertainment layer for{" "}
            <span className="whitespace-nowrap">xStocks.</span>
          </h1>
          <p className="mt-2.5 text-base leading-[1.2] font-medium tracking-[-0.015em] text-muted-foreground lg:mt-4 lg:text-[1.1875rem] lg:tracking-[-0.01em] xl:text-[1.3125rem]">
            <span className="text-foreground">{verbs.lead}</span>
            {verbs.rest}
          </p>
        </div>

        {/*
          The way in. The welcome offer is for visitors who have not signed in yet. A signed-in player
          gets a plain line that is true at a first sign-in and a return alike (the first-grant toast
          says "Welcome to Dulo" at the same moment), never a balance (docs/HANDOFF.md 3.8).
        */}
        <div className="mt-3 min-w-0 border-t border-rule pt-[18px] [grid-area:join] lg:mt-0 lg:self-end lg:border-t-0 lg:pt-0 lg:pb-1.5">
          <SessionSwitch
            signedIn={
              <p className={WELCOME}>
                <b className="font-semibold text-foreground">You&apos;re signed in.</b> The tour picks up from your own activity.
              </p>
            }
            signedOut={
              <p className={WELCOME}>
                <WelcomeOffer line={WELCOME_OFFER_LINE} />
              </p>
            }
          />
          <div className="mt-3.5 flex flex-col sm:flex-row sm:items-center sm:gap-[30px] lg:mt-5">
            <SessionSwitch signedIn={<ContinueTour />} signedOut={<ConnectButton size="xl" fullLabel className={HERO_PRIMARY} />} />
            <Link href="#check" className={cn(RULED_LINK, "mt-4 self-center sm:mt-0")}>
              Check a wallet
              <Arrow />
            </Link>
          </div>
        </div>

        <LivePredictions />

        {/* One status line: the US session, the one pre-IPO hook, and the compliance line. */}
        <div className="flex min-w-0 flex-col items-start gap-2.5 pt-[18px] font-medium [grid-area:status] lg:flex-row lg:items-center lg:gap-[26px] lg:py-[15px]">
          <MarketSessionChip className="h-6 text-sm" />
          <Link
            href="/prestocks"
            className="inline-flex min-h-6 shrink-0 leading-6 text-[0.8125rem] text-muted-foreground whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Pre-IPO tokens trade 24/7
            <span aria-hidden className="ml-1.5">
              →
            </span>
          </Link>
          <p className="text-[0.8125rem] leading-normal font-normal text-pretty text-muted-foreground lg:ml-auto lg:text-right">{COMPLIANCE_LINE}</p>
        </div>
      </section>

      {/* 2. The three games, each a lane on this week's Monday-to-Friday axis: one live figure and one button each. */}
      <GameTiles className="mt-11 lg:mt-[92px]" />

      {/*
        3. Check any wallet (no sign-in: a live read, nothing stored, never scored). tabIndex -1: the
        hero's "Check a wallet" link moves focus here as well as the view, so the next Tab reaches the
        address field instead of jumping back up to the hero.
      */}
      <section
        id="check"
        tabIndex={-1}
        aria-labelledby="check-title"
        className="mt-14 grid scroll-mt-10 gap-5 border-t border-rule-2 pt-7 outline-none lg:mt-24 lg:grid-cols-[minmax(17rem,1fr)_minmax(0,1.65fr)] lg:items-start lg:gap-14 lg:pt-12"
      >
        <div className="min-w-0">
          <h2 id="check-title" className="font-display text-4xl leading-none font-normal tracking-[-0.01em] lg:text-[2.875rem]">
            Check any wallet
          </h2>
          <p className="mt-2.5 max-w-[34ch] text-[0.9375rem] leading-[1.45] text-muted-foreground">
            See any wallet&apos;s xStocks and the quests it already meets. No sign-in, nothing stored.
          </p>
        </div>
        <CheckWalletBox bare />
      </section>

      {/* 4. The closing band: the Season, its seats, and the same two ways in. */}
      <section
        aria-labelledby="cta"
        className="mt-14 grid gap-6 border-t border-rule-2 pt-7 lg:mt-24 lg:grid-cols-[minmax(17rem,1fr)_minmax(0,1.65fr)] lg:items-start lg:gap-14 lg:pt-12"
      >
        <div className="flex min-w-0 items-start gap-3.5 lg:gap-[22px]">
          <Tamga tone="gradient" size={44} className="mt-1 size-[30px] shrink-0 lg:size-11" />
          <div className="min-w-0">
            <h2 id="cta" className="font-display text-4xl leading-none font-normal tracking-[-0.01em] lg:text-[2.875rem]">
              Stocks <span className="whitespace-nowrap">Season 0</span>
            </h2>
            <p className="mt-2.5 max-w-[34ch] text-[0.9375rem] leading-[1.45] text-muted-foreground">
              All three games score on one Season leaderboard. House bots never rank here.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-4">
              {/* Cream, not gold: the hero's button is the page's one gold primary (docs/DESIGN.md rule 1). */}
              <SessionSwitch
                signedIn={<ContinueTour variant="secondary" className="h-10 w-auto px-4 text-[0.9375rem] lg:h-10" />}
                signedOut={<ConnectButton size="lg" fullLabel variant="secondary" />}
              />
              <SessionSwitch
                signedIn={
                  <Link href="/predictions" className={RULED_LINK}>
                    Make a prediction
                    <Arrow />
                  </Link>
                }
                signedOut={
                  <Link href="/start" className={RULED_LINK}>
                    Take the tour
                    <Arrow />
                  </Link>
                }
              />
            </div>
          </div>
        </div>
        {/* The Season seats: real players only (bots never rank here), every other seat open. */}
        <SeasonTop className="lg:pt-1" />
      </section>
    </div>
  );
}
