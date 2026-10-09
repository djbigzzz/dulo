import Link from "next/link";
import { ArrowRightIcon, GiftIcon } from "lucide-react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { buttonVariants } from "@/components/ui/button";
import { Tamga } from "@/components/brand/Tamga";
import { GameTiles, LivePredictions, SeasonTop } from "@/components/landing/ScoreboardPreview";
import { CheckWalletBox } from "@/components/landing/CheckWalletBox";
import { SessionSwitch } from "@/components/landing/SessionSwitch";
import { MarketSessionChip } from "@/components/common/MarketSessionChip";
import { COMPLIANCE_LINE } from "@/components/common/compliance";
import { WELCOME_OFFER_LINE } from "@/lib/games/ledger-policy";
import { cn } from "@/lib/utils";

const ENTER = "animate-in fade-in-0 slide-in-from-bottom-2 duration-500 fill-mode-both motion-reduce:animate-none";

/** The landing's large buttons: two per row on phones, side by side from sm. */
const BIG = "h-12 rounded-xl px-4 text-[0.9375rem] sm:px-6 sm:text-base";
const OUTLINE = cn(buttonVariants({ variant: "outline", size: "lg" }), BIG);
const PRIMARY = cn(buttonVariants({ size: "lg" }), BIG);

/** A signed-in player's next step: the tour picks up from their own data. */
function ContinueTour() {
  return (
    <Link href="/start" className={PRIMARY}>
      Continue the tour
      <ArrowRightIcon data-icon="inline-end" />
    </Link>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col">
      {/* 1. Hero: the pitch and the way in on the left, this week's live prediction on the right. No panel: one raised card. */}
      <section
        aria-labelledby="hero-title"
        className="grid gap-10 pt-4 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26.5rem)] lg:items-center lg:gap-16 lg:pt-6 lg:[@media(max-height:860px)]:pt-0"
      >
        <div className={cn("flex min-w-0 flex-col", ENTER)}>
          <h1
            id="hero-title"
            className="font-display text-[2.75rem] leading-[0.95] font-normal tracking-[-0.02em] text-balance text-foreground sm:text-7xl lg:text-[4.75rem]"
          >
            The entertainment layer for{" "}
            <span className="text-gradient-ember pr-[0.08em] whitespace-nowrap italic">xStocks.</span>
          </h1>
          <p className="mt-4 font-display text-[1.625rem] leading-tight font-normal text-balance text-foreground/65 sm:mt-5 sm:text-3xl">
            Predict. Compete. Complete on-chain quests.
          </p>
          {/*
            The welcome offer, stated before sign-in. Signed in: a plain welcome, never a balance (the
            landing shows no personal balance, docs/HANDOFF.md 3.8).
          */}
          <SessionSwitch
            signedIn={
              <p className="mt-7 flex max-w-md items-start gap-3 text-base leading-relaxed text-pretty text-foreground/85">
                <span className="mx-1 mt-[0.5625rem] size-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
                <span>Welcome back.</span>
              </p>
            }
            signedOut={
              <p className="mt-7 flex max-w-md items-start gap-3 text-base leading-relaxed text-pretty text-foreground/85">
                <GiftIcon className="mt-[0.3rem] size-4 shrink-0 text-gold" aria-hidden />
                <span>{WELCOME_OFFER_LINE}</span>
              </p>
            }
          />
          <div className="mt-7 grid gap-3 min-[385px]:grid-cols-2 sm:flex sm:items-center">
            <SessionSwitch signedIn={<ContinueTour />} signedOut={<ConnectButton size="lg" className={BIG} />} />
            <Link href="#check" className={OUTLINE}>
              Check a wallet
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </div>
          {/* One quiet status line (the US session, the one pre-IPO hook), then the compliance line. */}
          <div className="mt-9 flex flex-col gap-2 border-t border-white/[0.06] pt-5 sm:mt-12">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <MarketSessionChip className="h-5 border-0 bg-transparent px-0 tracking-normal" />
              <span className="text-xs text-muted-foreground/40" aria-hidden>
                ·
              </span>
              <Link
                href="/prestocks"
                className="group/preipo flex items-center gap-1.5 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
              >
                Pre-IPO tokens trade 24/7
                <ArrowRightIcon className="size-3 transition-transform duration-300 group-hover/preipo:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
              </Link>
            </div>
            <p className="max-w-lg text-xs leading-relaxed text-pretty text-muted-foreground/70">{COMPLIANCE_LINE}</p>
          </div>
        </div>

        <LivePredictions className="min-w-0" />
      </section>

      {/*
        The three games, one live figure and one button each, on the first desktop screen. A short
        desktop (1280x800) tightens the hero card and the tiles a little so the buttons still land on it.
      */}
      <GameTiles className={cn("mt-10 sm:mt-12 lg:mt-10 lg:[@media(max-height:860px)]:mt-6", ENTER)} />

      {/* 2. Check any wallet (no sign-in: a live read, nothing stored, never scored) */}
      <section
        id="check"
        aria-labelledby="check-title"
        className="mt-20 grid scroll-mt-24 gap-6 sm:mt-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-16"
      >
        <div className="flex flex-col gap-3">
          <h2 id="check-title" className="font-display text-4xl leading-none font-normal text-foreground sm:text-5xl">
            Check <span className="italic">any wallet</span>
          </h2>
          <p className="max-w-sm text-base leading-relaxed text-muted-foreground">
            See any wallet&apos;s xStocks and the quests it already meets. No sign-in, nothing stored.
          </p>
        </div>
        <CheckWalletBox className="border-0 bg-transparent p-0 shadow-none backdrop-blur-none sm:p-0" />
      </section>

      {/* 3. Closing call: the tamga, one line, the same two ways in. */}
      <section
        aria-labelledby="cta"
        className="relative isolate mt-24 flex flex-col items-center overflow-hidden px-2 pt-14 pb-6 text-center sm:mt-32"
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full bg-[radial-gradient(45%_55%_at_50%_30%,rgb(255_106_42/0.1),transparent)]"
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-x-[15%] top-0 h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent" aria-hidden />
        <Tamga tone="gradient" size={56} className="opacity-90" />
        <h2 id="cta" className="mt-6 font-display text-5xl leading-none font-normal text-foreground sm:text-6xl">
          Season 0 is <span className="text-gradient-ember pr-[0.08em] italic">live</span>
        </h2>
        <p className="mt-4 text-base text-muted-foreground">Three games, one leaderboard.</p>
        {/* The landing top 3: renders nothing until three real players have Season points. */}
        <SeasonTop className="mt-5" />
        <div className="mt-8 flex w-full max-w-sm flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
          <SessionSwitch signedIn={<ContinueTour />} signedOut={<ConnectButton size="lg" className={BIG} />} />
          <SessionSwitch
            signedIn={
              <Link href="/predictions" className={OUTLINE}>
                Make a prediction
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            }
            signedOut={
              <Link href="/start" className={OUTLINE}>
                Take the tour
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            }
          />
        </div>
      </section>
    </div>
  );
}
