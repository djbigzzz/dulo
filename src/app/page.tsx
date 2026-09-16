import Link from "next/link";
import {
  ActivityIcon,
  ArrowRightIcon,
  AwardIcon,
  BadgeCheckIcon,
  ClockIcon,
  CopyIcon,
  EyeIcon,
  GiftIcon,
  KeyRoundIcon,
  ScaleIcon,
  ShieldCheckIcon,
  TargetIcon,
  TrophyIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { buttonVariants } from "@/components/ui/button";
import { Tamga } from "@/components/brand/Tamga";
import { GameTiles, LivePredictions, RankCard, ScoreboardPreview } from "@/components/landing/ScoreboardPreview";
import { PartnersRow } from "@/components/landing/PartnersRow";
import { CheckWalletBox } from "@/components/landing/CheckWalletBox";
import { MarketSessionChip } from "@/components/common/MarketSessionChip";
import { COMPLIANCE_LINE, PARTNER_MARKS_NOTICE } from "@/components/common/compliance";
import { formatPoints } from "@/components/common/format";
import { formatUsdWhole } from "@/components/league/format";
import { MIN_TRADES_FOR_WEEKLY_POINTS, STARTER_POINTS, VIRTUAL_CASH_USD, WELCOME_OFFER_LINE } from "@/lib/games/ledger-policy";
import { SEASON_NAME } from "@/lib/config";
import { cn } from "@/lib/utils";

const VIRTUAL_CASH = formatUsdWhole(VIRTUAL_CASH_USD);

const STEPS: { title: string; body: string }[] = [
  { title: "Connect", body: "Sign a message to prove the wallet is yours. No transaction, nothing to approve." },
  {
    title: `Start with ${formatPoints(STARTER_POINTS)} starter points and ${VIRTUAL_CASH} virtual cash`,
    body: "Starter points go into predictions. The grant itself isn't ranked; settled predictions are. Virtual cash is for the weekly competition, not real money.",
  },
  {
    title: "Predict, compete, complete quests",
    body: "All three games count toward one Season leaderboard. Points only, no cash value.",
  },
];

interface Tile {
  href: string;
  title: string;
  body: string;
  stat: string;
  icon: LucideIcon;
}

/** The three games, Predictions first (it leads in the nav too). */
const GAMES: Tile[] = [
  {
    href: "/predictions",
    title: "Predictions",
    icon: TargetIcon,
    stat: "Yes or No",
    body: "Yes or No on where a stock closes, for points, settled from the Friday close, source shown on the card.",
  },
  {
    href: "/competition",
    title: "Competition",
    icon: TrophyIcon,
    stat: `${VIRTUAL_CASH} virtual cash`,
    body: `A fresh week every Monday with virtual cash at real xStock prices. Top 10 with ${MIN_TRADES_FOR_WEEKLY_POINTS}+ trades earn points.`,
  },
  {
    href: "/quests",
    title: "Quests",
    icon: ZapIcon,
    stat: "+50 to +500 pts",
    body: "In-platform quests with points and virtual cash, and on-chain quests verified from your wallet.",
  },
];

/** Beside the games: a tool (no points of its own) and the Badges some quests mint. */
const EXTRAS: Tile[] = [
  {
    href: "/copy",
    title: "Copy a portfolio",
    icon: CopyIcon,
    stat: "A tool, not a game",
    body: "See a leader's allocation and open the same legs in Jupiter from your own wallet.",
  },
  { href: "/profile", title: "Badges", icon: AwardIcon, stat: "Soulbound", body: "Bigger quests mint a Badge to your wallet that can't be sold." },
];

const WHY_SOLANA: { title: string; body: string; icon: LucideIcon }[] = [
  {
    icon: EyeIcon,
    title: "Holdings are public",
    body: "xStocks live in Token-2022 accounts, so on-chain quests verify straight from the chain. No broker login.",
  },
  {
    icon: ScaleIcon,
    title: "Balances stay correct",
    body: "Splits and dividends are normalised with the token's multiplier, so a split never breaks a quest.",
  },
  {
    icon: ClockIcon,
    title: "Prices show their age",
    body: "Every price carries its source and how old it is, even when the US market is closed.",
  },
  {
    icon: BadgeCheckIcon,
    title: "Badges can't be traded",
    body: "Badges are non-transferable Token-2022 tokens: proof you did it, not something to flip.",
  },
];

const TRUST: { icon: LucideIcon; label: string; sr?: string }[] = [
  { icon: ShieldCheckIcon, label: "Points only", sr: ", no cash value" },
  { icon: KeyRoundIcon, label: "No transaction to sign in" },
  { icon: ActivityIcon, label: "Live on Solana mainnet" },
];

/**
 * Hero / featured surface. Kept out of cn(): tailwind-merge reads bg-card and bg-ember-glow as the same
 * utility group and would drop bg-card (and with it the glass sheen).
 */
const GLOW_PANEL = "border-gradient bg-card bg-ember-glow";

const ENTER = "animate-in fade-in-0 slide-in-from-bottom-2 duration-500 fill-mode-both motion-reduce:animate-none";

const ICON_TILE =
  "flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] shadow-[inset_0_1px_0_rgb(255_245_230/0.06)]";

const TILE_LINK =
  "group relative flex h-full overflow-hidden rounded-2xl outline-none transition-all duration-300 hover:-translate-y-0.5 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

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

function TileArrow() {
  return (
    <ArrowRightIcon
      className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
      aria-hidden
    />
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
            <p className="max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg lg:text-base">
              800,000+ Solana addresses hold a tokenized stock (Blockworks via Solana Compass, 12 Sep 2026). Dulo gives them three
              games on one Season leaderboard: Yes or No on Friday&apos;s close, a weekly competition with virtual cash at real
              xStock prices, and quests you complete in Dulo or on-chain.
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
          <SectionTitle id="check-title" eyebrow="No sign-in needed">
            Check <span className="italic">any wallet</span>
          </SectionTitle>
          <p className="max-w-md text-base leading-relaxed text-muted-foreground">
            Paste a Solana address. Dulo reads its xStocks straight from Token-2022 balances, multiplier-correct, and shows which
            on-chain quests that wallet already meets. Nothing is stored or scored.
          </p>
        </div>
        <CheckWalletBox />
      </section>

      {/* 3. How it works */}
      <section aria-labelledby="how" className={cn("mt-20 flex flex-col gap-10 sm:mt-28 sm:gap-14", ENTER)}>
        <SectionTitle id="how" eyebrow="Three steps">
          How it <span className="italic">works</span>
        </SectionTitle>
        <ol className="grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative flex flex-col gap-4">
              <div className="flex items-center gap-5">
                <span
                  className="font-display text-gradient-gold pr-[0.06em] text-5xl leading-none font-normal sm:text-6xl"
                  aria-hidden
                >
                  0{i + 1}
                </span>
                {i < STEPS.length - 1 ? (
                  <span
                    className="hidden h-px flex-1 bg-gradient-to-r from-gold/45 via-ember/20 to-transparent md:block"
                    aria-hidden
                  />
                ) : null}
              </div>
              <div className="flex max-w-xs flex-col gap-2">
                <h3 className="text-lg leading-snug font-semibold tracking-tight text-balance text-foreground">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 4. The games */}
      <section aria-labelledby="mechanics" className={cn("mt-20 flex flex-col gap-10 sm:mt-28 sm:gap-12", ENTER)}>
        <SectionTitle id="mechanics" eyebrow="Points only, no cash value">
          Three games, <span className="italic">one Season leaderboard</span>
        </SectionTitle>
        <div className="flex flex-col gap-4">
          <ul className="grid gap-4 lg:grid-cols-3">
            {GAMES.map(({ href, title, body, stat, icon: Icon }, i) => {
              const featured = i === 0;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={`${featured ? `${GLOW_PANEL} glow-ember` : "bg-card"} ${cn(
                      TILE_LINK,
                      "flex-col gap-6 p-5 sm:p-7",
                      !featured && "border border-white/[0.07] hover:border-white/[0.12] hover:bg-white/[0.04]",
                    )}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={ICON_TILE} aria-hidden>
                        <Icon className={cn("size-5", featured ? "text-ember" : "text-gold")} />
                      </span>
                      <TileArrow />
                    </div>
                    <div className="mt-auto flex flex-col gap-2">
                      <h3 className="font-display text-4xl leading-none font-normal text-foreground">{title}</h3>
                      <p
                        className={cn(
                          "text-xl font-semibold tracking-tight sm:text-2xl",
                          featured ? "text-gradient-ember" : "text-foreground",
                        )}
                      >
                        {stat}
                      </p>
                      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <ul className="grid gap-4 sm:grid-cols-2">
            {EXTRAS.map(({ href, title, body, stat, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    TILE_LINK,
                    "items-start gap-4 border border-white/[0.07] bg-card p-5 hover:border-white/[0.12] hover:bg-white/[0.04]",
                  )}
                >
                  <span className={ICON_TILE} aria-hidden>
                    <Icon className="size-5 text-gold" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h3 className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-base font-semibold tracking-tight text-foreground">
                      {title}
                      <span className="text-xs font-medium text-muted-foreground">{stat}</span>
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
                  </div>
                  <TileArrow />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 5. Why Solana */}
      <section
        aria-labelledby="why-solana"
        className={cn("mt-20 grid gap-10 sm:mt-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14", ENTER)}
      >
        <div className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
          <SectionTitle id="why-solana" eyebrow="Why Solana">
            Why it works <span className="italic">on Solana</span>
          </SectionTitle>
          <p className="max-w-md text-base leading-relaxed text-muted-foreground">
            Dulo reads the chain, not a broker. Four properties of Solana and Token-2022 are what make every on-chain quest verifiable.
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {WHY_SOLANA.map(({ title, body, icon: Icon }) => (
            <li
              key={title}
              className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-white/[0.07] bg-card p-5 sm:p-6"
            >
              <span
                className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent"
                aria-hidden
              />
              <span className={ICON_TILE} aria-hidden>
                <Icon className="size-5 text-gold" />
              </span>
              <div className="flex flex-col gap-1.5">
                <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 6. Partners */}
      <section aria-labelledby="partners" className={cn("mt-20 flex flex-col gap-10 sm:mt-28", ENTER)}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionTitle id="partners" eyebrow="Listed projects">
            Partners
          </SectionTitle>
          <Link
            href="/partners"
            className="group flex min-h-10 items-center gap-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
          >
            All Partners
            <ArrowRightIcon className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
          </Link>
        </div>
        <div className="flex flex-col gap-4">
          <PartnersRow />
          <p className="text-xs leading-relaxed text-muted-foreground">{PARTNER_MARKS_NOTICE}</p>
        </div>
      </section>

      {/* 7. Closing CTA */}
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
              <p className="max-w-md text-base leading-relaxed text-muted-foreground">
                Sign in once. Predictions, the weekly competition (virtual cash) and quests all count toward one Season
                leaderboard. Points only, no cash value.
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row md:shrink-0">
            <ConnectButton size="lg" className="h-11 px-5 text-base" />
            <Link href="/predictions" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 px-5 text-base")}>
              Make a prediction
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
