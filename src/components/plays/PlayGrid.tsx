"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, Clock, Gamepad2, SearchX, WalletCards } from "lucide-react";
import { cn } from "cn";
import type { PartnerGroup, PartnerSummary, PlayView } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PartnerLogo } from "@/components/common/PartnerLogo";
import { COMPLIANCE_LINE, PRE_IPO_COMPLIANCE_LINE } from "@/components/common/compliance";
import { formatPoints } from "@/components/common/format";
import { isPreIpoQuest } from "@/components/common/issuer";
import { PlayCard, PlayCardSkeleton } from "@/components/plays/PlayCard";
import { matchesFilter, partnerPageHref, questKind, type PlayFilter } from "@/components/plays/play-meta";

export interface PlayGridProps {
  groups: PartnerGroup[];
  signedIn: boolean;
  filter?: PlayFilter;
  onProof?: (play: PlayView) => void;
  className?: string;
}

const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";
const TILE = "flex shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] shadow-[inset_0_1px_0_rgb(255_245_230/0.06)]";
const DIVIDER = "h-px bg-gradient-to-r from-white/[0.12] via-white/[0.05] to-transparent";

/** Group headings on the board. */
export const IN_PLATFORM_HEADING = "In-platform quests: points and virtual cash";
export const ON_CHAIN_HEADING = "On-chain quests, verified from your wallet";
export const COMING_SOON_HEADING = "Coming soon: planned partner quests";

interface SoonRow {
  partner: PartnerSummary;
  play: PlayView;
}

interface KindGroup {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  plays: PlayView[];
  /** Listed Partners whose quests sit in this group, in board order (the house Partner has no page). */
  partners: PartnerSummary[];
}

/**
 * The /quests board, grouped by quest kind:
 *  1. In-platform quests (points and virtual cash), completed inside Dulo;
 *  2. On-chain quests verified from the wallet;
 *  3. every partner quest still coming soon, folded into one compact list at the bottom;
 * then, once for the whole board, the compliance line (and the pre-IPO line beside it when a quest
 * fenced to PreStocks is on screen), whenever an on-chain quest is shown.
 * A coming-soon quest that was completed before it was retired stays as an on-chain card, so
 * earned points remain visible. No card links to a buy.
 */
export function PlayGrid({ groups, signedIn, filter = "all", onProof, className }: PlayGridProps) {
  const soon: SoonRow[] = [];
  const inPlatform: PlayView[] = [];
  const onChain: PlayView[] = [];
  const onChainPartners: PartnerSummary[] = [];
  for (const { partner, campaigns } of groups) {
    for (const c of campaigns) {
      for (const play of c.plays) {
        if (!matchesFilter(play, filter)) continue;
        if (play.comingSoon && play.status !== "complete") {
          soon.push({ partner, play });
        } else if (questKind(play) === "in-platform") {
          inPlatform.push(play);
        } else {
          onChain.push(play);
          if (partnerPageHref(partner.slug) && !onChainPartners.some((p) => p.slug === partner.slug)) onChainPartners.push(partner);
        }
      }
    }
  }

  const live: KindGroup[] = [
    {
      id: "quests-in-platform",
      title: IN_PLATFORM_HEADING,
      icon: Gamepad2,
      plays: inPlatform,
      partners: [],
    },
    {
      id: "quests-on-chain",
      title: ON_CHAIN_HEADING,
      icon: WalletCards,
      plays: onChain,
      partners: onChainPartners,
    },
  ].filter((g) => g.plays.length > 0);

  if (live.length === 0 && soon.length === 0) {
    return (
      <div
        role="status"
        className={cn(
          "flex flex-col items-center gap-3 rounded-2xl border border-white/[0.07] bg-card px-4 py-10 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        <span className={cn(TILE, "size-10 text-gold")} aria-hidden>
          <SearchX className="size-4" />
        </span>
        No quests match this filter yet.
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-10 sm:gap-12", className)}>
      {live.map((group) => (
        <section key={group.id} data-quest-group={group.id} aria-labelledby={group.id} className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className={cn(TILE, "size-11 text-gold")} aria-hidden>
                <group.icon className="size-4" />
              </span>
              <div className="min-w-48 flex-1">
                <h2 id={group.id} className="text-lg leading-tight font-semibold tracking-tight text-balance">
                  {group.title}
                </h2>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {group.plays.length} {group.plays.length === 1 ? "quest" : "quests"}
                </p>
              </div>
              {group.partners.map((partner) => (
                <Link
                  key={partner.slug}
                  href={partnerPageHref(partner.slug)!}
                  aria-label={`${partner.name} partner page`}
                  className={cn(buttonVariants({ variant: "ghost" }), "group/link h-10 shrink-0 gap-2 sm:h-8")}
                >
                  <PartnerLogo name={partner.name} logoUrl={partner.logoUrl} size={18} className="rounded-md ring-0" />
                  {partner.name}
                  <ArrowRight data-icon="inline-end" className="transition-transform group-hover/link:translate-x-0.5" aria-hidden />
                </Link>
              ))}
            </header>
            <div className={DIVIDER} aria-hidden />
          </div>
          <ul className={GRID}>
            {group.plays.map((play) => (
              <li key={play.key} className="min-w-0">
                <PlayCard play={play} signedIn={signedIn} onProof={onProof} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {soon.length > 0 ? (
        <section aria-labelledby="coming-soon" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <header className="flex items-center gap-3">
              <span className={cn(TILE, "size-11 text-gold")} aria-hidden>
                <Clock className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="coming-soon" className="text-lg leading-tight font-semibold tracking-tight">
                  {COMING_SOON_HEADING}
                </h2>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {soon.length} {soon.length === 1 ? "quest" : "quests"}
                </p>
              </div>
            </header>
            <div className={DIVIDER} aria-hidden />
          </div>
          <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.07] bg-card">
            {soon.map(({ partner, play }) => (
              <li key={play.key}>
                <SoonRowLink
                  href={partnerPageHref(partner.slug)}
                  className="group/row flex min-h-16 items-center gap-3 px-4 py-3 outline-none transition-colors duration-200 hover:bg-white/[0.03] focus-visible:bg-white/[0.04] sm:gap-4 sm:px-5"
                >
                  <PartnerLogo
                    name={partner.name}
                    logoUrl={partner.logoUrl}
                    size={36}
                    className="opacity-70 grayscale-[0.7] transition duration-300 group-hover/row:opacity-100 group-hover/row:grayscale-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground/90">{play.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{partner.name}</span>
                  </span>
                  <span className="shrink-0 text-sm font-medium text-muted-foreground tabular-nums">+{formatPoints(play.points)}</span>
                  <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-gold/20 bg-gold/[0.06] px-2 text-xs font-medium text-gold">
                    Soon
                  </span>
                  <ChevronRight
                    className="hidden size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover/row:translate-x-0.5 group-hover/row:text-foreground sm:block"
                    aria-hidden
                  />
                </SoonRowLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* On-chain quests read tokens held in the wallet: the compliance line prints once for the board,
          at its foot, and the pre-IPO line beside it whenever a quest fenced to PreStocks is on screen. */}
      {onChain.length > 0 ? (
        <div data-slot="board-compliance" className="flex flex-col gap-1">
          <p className="text-xs text-pretty text-muted-foreground">{COMPLIANCE_LINE}</p>
          {onChain.some(isPreIpoQuest) ? (
            <p data-slot="pre-ipo-compliance" className="text-xs text-pretty text-muted-foreground">
              {PRE_IPO_COMPLIANCE_LINE}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A coming-soon row links to its Partner page; a hidden Partner (no page) renders the same row unlinked. */
function SoonRowLink({ href, className, children }: { href: string | null; className: string; children: ReactNode }) {
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

export function PlayGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div role="status" className="flex flex-col gap-4" aria-busy aria-label="Loading quests">
      <div className="flex flex-col gap-3">
        <header className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-xl bg-white/[0.05]" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-5 w-32 bg-white/[0.05]" />
            <Skeleton className="h-3 w-14 bg-white/[0.05]" />
          </div>
        </header>
        <div className={DIVIDER} aria-hidden />
      </div>
      <div className={GRID}>
        {Array.from({ length: cards }).map((_, i) => (
          <PlayCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export default PlayGrid;
