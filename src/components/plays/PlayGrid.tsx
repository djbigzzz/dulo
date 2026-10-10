"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Clock, SearchX } from "lucide-react";
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
import { SECTION_TITLE } from "@/components/common/SectionHeading";

export interface PlayGridProps {
  groups: PartnerGroup[];
  signedIn: boolean;
  filter?: PlayFilter;
  onProof?: (play: PlayView) => void;
  className?: string;
}

/**
 * The segment board: every quest draws its own 1px rule and each cell pulls back by one pixel, so
 * neighbouring rules overlap into one ruled board (no gaps, no boxes in boxes), on every column count.
 */
export const SEGMENT_GRID = "grid pt-px pl-px sm:grid-cols-2 lg:grid-cols-3 [&>li]:-mt-px [&>li]:-ml-px";

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
  plays: PlayView[];
  /** Listed Partners whose quests sit in this group, in board order (the house Partner has no page). */
  partners: PartnerSummary[];
}

/**
 * The group's quests as one segmented track, the week track's elapsed bar in miniature: a segment
 * per quest, cream once complete, half-lit while in progress. Decorative: the count beside it says it.
 */
function SegmentTrack({ plays, signedIn }: { plays: PlayView[]; signedIn: boolean }) {
  const done = plays.filter((p) => p.status === "complete").length;
  return (
    <div className="flex items-center gap-4">
      <div className="flex h-1.5 min-w-0 flex-1 gap-[3px]" aria-hidden>
        {plays.map((p) => (
          <span
            key={p.key}
            className={cn("h-full flex-1", p.status === "complete" ? "bg-foreground" : p.status === "in_progress" ? "bg-[rgb(243_240_232/0.42)]" : "bg-ink-4")}
          />
        ))}
      </div>
      <p className="shrink-0 text-[0.9375rem] text-muted-foreground tabular-nums">
        {signedIn ? (
          <>
            <span className="font-semibold text-foreground">{done}</span> of {plays.length} complete
          </>
        ) : (
          `${plays.length} ${plays.length === 1 ? "quest" : "quests"}`
        )}
      </p>
    </div>
  );
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
    { id: "quests-in-platform", title: IN_PLATFORM_HEADING, plays: inPlatform, partners: [] },
    { id: "quests-on-chain", title: ON_CHAIN_HEADING, plays: onChain, partners: onChainPartners },
  ].filter((g) => g.plays.length > 0);

  if (live.length === 0 && soon.length === 0) {
    return (
      <div role="status" className={cn("flex flex-col items-center gap-3 border border-rule px-4 py-12 text-center text-[0.9375rem] text-muted-foreground", className)}>
        <span className="flex size-10 items-center justify-center rounded-full bg-ink-4 text-foreground ring-1 ring-rule-2 ring-inset" aria-hidden>
          <SearchX className="size-4" />
        </span>
        No quests match this filter yet.
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-14 sm:gap-16", className)}>
      {live.map((group) => (
        <section key={group.id} data-quest-group={group.id} aria-labelledby={group.id} className="flex flex-col gap-5">
          <header className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <h2 id={group.id} className={SECTION_TITLE}>
                {group.title}
              </h2>
              {group.partners.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {group.partners.map((partner) => (
                    <Link
                      key={partner.slug}
                      href={partnerPageHref(partner.slug)!}
                      aria-label={`${partner.name} partner page`}
                      className={cn(buttonVariants({ variant: "link" }), "group/link min-h-10 gap-2 sm:min-h-0 [&_img]:logo-greyscale")}
                    >
                      <PartnerLogo name={partner.name} logoUrl={partner.logoUrl} size={18} />
                      {partner.name}
                      <ArrowRight data-icon="inline-end" className="transition-transform group-hover/link:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
            <SegmentTrack plays={group.plays} signedIn={signedIn} />
          </header>
          <ul className={SEGMENT_GRID}>
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
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <h2 id="coming-soon" className={SECTION_TITLE}>
              {COMING_SOON_HEADING}
            </h2>
            <p className="text-[0.9375rem] text-muted-foreground tabular-nums">
              {soon.length} {soon.length === 1 ? "quest" : "quests"}
            </p>
          </header>
          <ul className="border-b border-rule">
            {soon.map(({ partner, play }) => (
              <li key={play.key} className="border-t border-rule">
                <SoonRowLink
                  href={partnerPageHref(partner.slug)}
                  className="group/row flex min-h-16 items-center gap-3 py-3 outline-none transition-colors duration-200 hover:bg-white/[0.025] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset motion-reduce:transition-none sm:gap-4 sm:px-2 [&_img]:logo-greyscale"
                >
                  <PartnerLogo name={partner.name} logoUrl={partner.logoUrl} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-semibold text-foreground">{play.title}</span>
                    <span className="block truncate text-[0.84375rem] text-muted-foreground">{partner.name}</span>
                  </span>
                  <span className="shrink-0 text-right leading-none">
                    <span className="figure text-[1.5rem] text-muted-foreground">+{formatPoints(play.points)}</span>
                  </span>
                  <span className="inline-flex h-6 shrink-0 items-center gap-1 border border-dashed border-[rgb(243_240_232/0.38)] px-2 text-xs font-medium text-muted-foreground">
                    <Clock className="size-3" aria-hidden />
                    Soon
                  </span>
                  <ArrowRight
                    className="hidden size-4 shrink-0 text-muted-foreground transition-transform group-hover/row:translate-x-0.5 group-hover/row:text-foreground motion-reduce:transition-none sm:block"
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
          <p className="text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">{COMPLIANCE_LINE}</p>
          {onChain.some(isPreIpoQuest) ? (
            <p data-slot="pre-ipo-compliance" className="text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">
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
    <div role="status" className="flex flex-col gap-5" aria-busy aria-label="Loading quests">
      <header className="flex flex-col gap-4">
        <Skeleton className="h-8 w-72 max-w-full" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-1.5 flex-1" />
          <Skeleton className="h-4 w-20" />
        </div>
      </header>
      <div className={cn(SEGMENT_GRID, "[&>div]:-mt-px [&>div]:-ml-px")}>
        {Array.from({ length: cards }).map((_, i) => (
          <PlayCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export default PlayGrid;
