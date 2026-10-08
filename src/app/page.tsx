import Link from "next/link";
import {
  ActivityIcon,
  ArrowRightIcon,
  GiftIcon,
  KeyRoundIcon,
  RocketIcon,
  type LucideIcon,
} from "lucide-react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { buttonVariants } from "@/components/ui/button";
import { Tamga } from "@/components/brand/Tamga";
import { GameTiles, LivePredictions, RankCard, ScoreboardPreview } from "@/components/landing/ScoreboardPreview";
import { CheckWalletBox } from "@/components/landing/CheckWalletBox";
import { MarketSessionChip } from "@/components/common/MarketSessionChip";
import { COMPLIANCE_LINE } from "@/components/common/compliance";
import { WELCOME_OFFER_LINE } from "@/lib/games/ledger-policy";
import { SEASON_NAME } from "@/lib/config";
import { cn } from "@/lib/utils";

const TRUST: { icon: LucideIcon; label: string; sr?: string }[] = [
  { icon: KeyRoundIcon, label: "No transaction to sign in" },
  { icon: ActivityIcon, label: "Live on Solana mainnet" },
];

/**
 * Hero / featured surface. Kept out of cn(): tailwind-merge reads bg-card and bg-ember-glow as the same
 * utility group and would drop bg-card (and with it the glass sheen).
 */
const GLOW_PANEL = "border-gradient bg-card bg-ember-glow";

const ENTER = "animate-in fade-in-0 slide-in-from-bottom-2 duration-500 fill-mode-both motion-reduce:animate-none";

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-center gap-2 text-xs font-medium tracking-[0.18em] text-gold uppercase", className)}>
      <span className="h-px w-6 shrink-0 bg-gradient-to-r from-gold/0 to-gold/80" aria-hidden />
      {children}
    </p>
  );
}

function SectionTitle({
  id,
  eyebrow,
  children,
  className,
}: {
  id: string;
  eyebrow: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="font-display text-3xl leading-[1.02] font-normal text-balance text-foreground sm:text-5xl">
        {children}
      </h2>
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col">
      {/* 1. Hero: the pitch and the way in on the left, live predictions on the right. */}
      <section
        aria-labelledby="hero-title"
        className={`${GLOW_PANEL} ${cn(
          "relative overflow-hidden rounded-3xl px-5 pt-7 pb-7 sm:px-10 sm:pt-10 sm:pb-10 lg:px-10 lg:pt-6 lg:pb-5",
          ENTER,
        )}`}
      >
        {/* A faint top-edge light. */}
        <div
          className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent"
          aria-hidden
        />
        {/*
          Phones and tablets read top to bottom: pitch, session and trust, then the live cards.
          From lg the pitch and the cards sit side by side and the session and trust row runs under both,
          so the three game tiles below still land on the first 1280x800 screen.
        */}
        <div className="grid gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,23.5rem)] lg:gap-x-10 lg:gap-y-3">
          <div className="flex min-w-0 flex-col gap-4 sm:gap-5 lg:col-start-1 lg:row-start-1 lg:gap-3 lg:self-center">
            <Eyebrow>
              Season 0 · {SEASON_NAME}
              <span className="-ml-2 hidden min-[420px]:inline">&nbsp;on Solana</span>
            </Eyebrow>
            <h1
              id="hero-title"
              className="font-display text-4xl leading-[0.98] font-normal tracking-[-0.02em] text-foreground sm:text-7xl sm:text-balance lg:text-6xl"
            >
              The entertainment layer for{" "}
              <span className="text-gradient-ember pr-[0.08em] whitespace-nowrap italic">xStocks.</span>
            </h1>
            <p className="font-display text-2xl leading-tight font-normal text-balance text-foreground/85 sm:text-3xl lg:-mt-1 lg:text-2xl">
              Predict. Compete. Complete on-chain quests.
            </p>
            {/* The welcome offer, stated before sign-in. */}
            <p className="flex max-w-xl items-start gap-2.5 rounded-xl border border-gold/20 bg-gold/[0.06] px-3.5 py-2 text-sm leading-snug lg:mt-1 lg:py-1.5 text-pretty text-foreground/90 shadow-[inset_0_1px_0_rgb(255_245_230/0.05)] sm:w-fit">
              <GiftIcon className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
              <span>{WELCOME_OFFER_LINE}</span>
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:mt-1">
              <ConnectButton size="lg" className="h-11 px-5 text-base" />
              <Link
                href="#check"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 px-5 text-base")}
              >
                Check a wallet
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2 lg:col-span-2 lg:row-start-2">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <MarketSessionChip />
              {/* The one pre-IPO hook on the landing (22 Sep): the same size as the trust line, beside the session chip. */}
              <Link
                href="/prestocks"
                className="group/preipo flex items-center gap-1.5 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
              >
                <RocketIcon className="size-3.5 text-gold/80" aria-hidden />
                Pre-IPO tokens trade 24/7
                <ArrowRightIcon className="size-3 transition-transform duration-300 group-hover/preipo:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
              </Link>
              <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                {TRUST.map(({ icon: Icon, label, sr }) => (
                  <li key={label} className="flex items-center gap-1.5">
                    <Icon className="size-3.5 text-gold/80" aria-hidden />
                    {label}
                    {sr ? <span className="sr-only">{sr}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs leading-snug text-pretty text-muted-foreground/80">{COMPLIANCE_LINE}</p>
          </div>

          <ScoreboardPreview className="min-w-0 lg:col-start-2 lg:row-start-1 lg:self-start">
            <LivePredictions />
            {/* From lg the ranking needs a tall screen: at 1280x800 the three prediction cards and the tiles come first. */}
            <RankCard className="lg:hidden lg:[@media(min-height:1100px)]:flex" />
          </ScoreboardPreview>
        </div>
      </section>

      {/* The three games, one live number and one button each, on the first desktop screen. */}
      <GameTiles className={cn("mt-3", ENTER)} />

      {/* 2. Check any wallet (no sign-in: a live read, nothing stored, never scored) */}
      <section
        id="check"
        aria-labelledby="check-title"
        className={cn("mt-16 grid scroll-mt-24 gap-8 sm:mt-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-14", ENTER)}
      >
        <div className="flex flex-col gap-5">
          <SectionTitle id="check-title" eyebrow="No sign-in">
            Check <span className="italic">any wallet</span>
          </SectionTitle>
          <p className="max-w-md text-base leading-relaxed text-muted-foreground">
            See any wallet&apos;s xStocks and the quests it already meets. Nothing stored.
          </p>
        </div>
        <CheckWalletBox />
      </section>

      {/* 3. Closing CTA (the long explainer sections were cut on 2 Oct 2026: the hero, the game tiles and each page say it once) */}
      <section
        aria-labelledby="cta"
        className={`${GLOW_PANEL} ${cn(
          "relative mt-20 overflow-hidden rounded-3xl px-6 py-10 sm:mt-28 sm:px-10 sm:py-14 lg:px-14",
          ENTER,
        )}`}
      >
        <div
          className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent"
          aria-hidden
        />
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
            <div className="relative flex size-28 shrink-0 items-center justify-center" aria-hidden>
              <span className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,rgb(216_180_106/0.16),transparent)]" />
              <Tamga tone="gradient" size={96} className="relative opacity-90" />
            </div>
            <div className="flex flex-col gap-3">
              <Eyebrow>{SEASON_NAME}</Eyebrow>
              <h2 id="cta" className="font-display text-4xl leading-[1.02] font-normal text-foreground sm:text-5xl">
                Season 0 is <span className="text-gradient-ember pr-[0.08em] italic">live</span>
              </h2>
              <p className="max-w-md text-base leading-relaxed text-muted-foreground">Three games, one leaderboard.</p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row md:shrink-0">
            <ConnectButton size="lg" className="h-11 px-5 text-base" />
            <Link href="/start" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 px-5 text-base")}>
              Take the tour
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
