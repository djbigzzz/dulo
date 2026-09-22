"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, SearchX } from "lucide-react";
import { cn } from "cn";
import { apiGet, type PartnerDetail } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { COMPLIANCE_LINE, PRE_IPO_COMPLIANCE_LINE, PRE_IPO_TOKEN_2022_NOTE } from "@/components/common/compliance";
import { isPreIpoQuest, PRESTOCKS_PARTNER_SLUG } from "@/components/common/issuer";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { StatStrip } from "@/components/common/StatStrip";
import { useApiQuery } from "@/components/common/useApiQuery";
import { formatPoints } from "@/components/common/format";
import { PARTNER_MARKS_NOTICE } from "@/components/partners/PartnerCard";
import { PartnerHeader, PartnerHeaderSkeleton } from "@/components/partners/PartnerHeader";
import { PlayCard, PlayCardSkeleton } from "@/components/plays/PlayCard";
import { questKind } from "@/components/plays/play-meta";

export interface PartnerViewProps {
  slug: string;
}

const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

/** The Partner page body: header, a few honest totals, and the Partner's quests as cards. */
export function PartnerView({ slug }: PartnerViewProps) {
  const q = useApiQuery((signal) => apiGet<PartnerDetail>(`/api/v1/partners/${encodeURIComponent(slug)}`, { signal }), slug);

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <Link
        href="/partners"
        className={cn(buttonVariants({ variant: "ghost" }), "group/back -ml-2.5 h-10 w-fit sm:h-8")}
      >
        <ArrowLeft data-icon="inline-start" className="transition-transform group-hover/back:-translate-x-0.5" aria-hidden />
        All Partners
      </Link>

      {q.loading ? (
        <>
          <PartnerHeaderSkeleton />
          <div className={GRID} aria-hidden>
            {Array.from({ length: 3 }).map((_, i) => (
              <PlayCardSkeleton key={i} />
            ))}
          </div>
        </>
      ) : q.errorStatus === 404 || q.errorStatus === 400 ? (
        <EmptyState
          icon={<SearchX aria-hidden />}
          title="Partner not found"
          description={`No Partner is listed at "${slug}".`}
          action={
            <Link href="/partners" className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
              <ArrowLeft data-icon="inline-start" aria-hidden />
              Back to Partners
            </Link>
          }
        />
      ) : q.error || !q.data ? (
        <ErrorState title="Couldn't load this Partner" message={q.error} onRetry={q.refetch} />
      ) : (
        <PartnerBody detail={q.data} />
      )}
    </div>
  );
}

/** The PreStocks Partner page, or any Partner page that lists a quest fenced to pre-IPO tokens. */
export function isPreIpoPartner(slug: string, plays: ReadonlyArray<{ key: string; assetSource?: string | null }>): boolean {
  return slug === PRESTOCKS_PARTNER_SLUG || plays.some(isPreIpoQuest);
}

/** Exported for tests. */
export function PartnerBody({ detail }: { detail: PartnerDetail }) {
  const plays = detail.campaigns.flatMap((c) => c.plays);
  const live = plays.filter((p) => !p.comingSoon);
  const livePoints = live.reduce((n, p) => n + p.points, 0);
  const campaigns = detail.campaigns.filter((c) => c.plays.length > 0);
  // Partner quests are on-chain quests (live or coming soon): the compliance line prints once when the page lists any.
  const listsOnChain = plays.some((play) => questKind(play) !== "in-platform");
  // The PreStocks page (or any page listing a pre-IPO quest) carries the pre-IPO line too, and its
  // outbound links lead to a pre-IPO swap, so the Token-2022 authority note sits under them.
  const preIpo = isPreIpoPartner(detail.partner.slug, plays);

  return (
    <>
      <PartnerHeader partner={detail.partner} livePlays={live.length} notice={preIpo ? PRE_IPO_TOKEN_2022_NOTE : null} />

      {live.length > 0 ? (
        <StatStrip
          stats={[
            {
              label: "Live quests",
              value: live.length,
              hint: plays.length > live.length ? `${plays.length - live.length} more coming soon` : undefined,
            },
            {
              label: "Points on offer",
              value: formatPoints(livePoints),
              tone: "ember",
              hint: detail.totals.completions > 0 ? `${formatPoints(detail.totals.completions)} completions so far` : undefined,
            },
          ]}
        />
      ) : null}

      <section aria-labelledby="partner-plays" className="flex flex-col gap-5 pt-2">
        <div className="flex flex-col gap-4">
          <div className="flex items-end justify-between gap-4">
            <h2 id="partner-plays" className="font-display text-3xl leading-none font-normal sm:text-4xl">
              Quests
            </h2>
            <Link href="/quests" className={cn(buttonVariants({ variant: "ghost" }), "group/link h-10 shrink-0 sm:h-8")}>
              Your progress
              <ArrowRight data-icon="inline-end" className="transition-transform group-hover/link:translate-x-0.5" aria-hidden />
            </Link>
          </div>
          <div className="h-px bg-gradient-to-r from-white/[0.12] via-white/[0.05] to-transparent" aria-hidden />
        </div>

        {plays.length === 0 ? (
          <EmptyState title="No quests listed yet." description="This Partner's quests are on the way." />
        ) : (
          campaigns.map((campaign) => (
            <div key={campaign.id} className="flex flex-col gap-3">
              {campaigns.length > 1 ? (
                <h3 className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">{campaign.title}</h3>
              ) : null}
              <ul className={GRID}>
                {campaign.plays.map((play) => (
                  <li key={play.key} className="min-w-0">
                    <PlayCard play={play} showStatus={false} />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        {/* One compliance line for the section, as the on-chain group on /quests prints it; the pre-IPO line beside it on the PreStocks page. */}
        {listsOnChain || preIpo ? <p className="text-xs text-pretty text-muted-foreground">{COMPLIANCE_LINE}</p> : null}
        {preIpo ? (
          <p data-slot="pre-ipo-compliance" className="text-xs text-pretty text-muted-foreground">
            {PRE_IPO_COMPLIANCE_LINE}
          </p>
        ) : null}
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">{PARTNER_MARKS_NOTICE}</p>
    </>
  );
}

export default PartnerView;
