"use client";

import { Handshake } from "lucide-react";
import { apiGet, type PartnersResponse } from "@/lib/api-client";
import { PageHeader } from "@/components/common/PageHeader";
import { StatStrip } from "@/components/common/StatStrip";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { useApiQuery } from "@/components/common/useApiQuery";
import { ListProjectCard, ListProjectSection, PARTNER_MARKS_NOTICE, PartnerCard, PartnerCardSkeleton } from "@/components/partners/PartnerCard";

const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

export default function PartnersPage() {
  const q = useApiQuery((signal) => apiGet<PartnersResponse>("/api/v1/partners", { signal }));
  const partners = q.data?.partners ?? [];
  const livePlays = partners.reduce((n, p) => n + p.livePlayCount, 0);
  const soonPlays = partners.reduce((n, p) => n + p.playCount - p.livePlayCount, 0);

  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <PageHeader
        className="mb-0"
        eyebrow="Season 0"
        title="Partners"
        description="Projects on Solana with quests on Dulo today, and how a project would list its own. The plan: projects list on-chain quests and pay per verified completion. No partner has signed yet."
        stats={
          q.data && partners.length > 0 ? (
            <StatStrip
              stats={[
                { label: "Partners", value: partners.length },
                { label: "Live quests", value: livePlays, tone: "ember", hint: soonPlays > 0 ? `${soonPlays} more coming soon` : undefined },
              ]}
            />
          ) : null
        }
      />

      {q.loading ? (
        <div role="status" className={GRID} aria-busy aria-label="Loading Partners">
          {Array.from({ length: 6 }).map((_, i) => (
            <PartnerCardSkeleton key={i} />
          ))}
        </div>
      ) : q.error ? (
        <ErrorState title="Couldn't load Partners" message={q.error} onRetry={q.refetch} />
      ) : partners.length === 0 ? (
        <EmptyState icon={<Handshake aria-hidden />} title="No Partners listed yet." description="Season 0 is being seeded." />
      ) : (
        <ul className={GRID}>
          {partners.map((p) => (
            <li key={p.slug} className="min-w-0">
              <PartnerCard partner={p} />
            </li>
          ))}
          <li className="min-w-0">
            <ListProjectCard />
          </li>
        </ul>
      )}

      <ListProjectSection />

      <p className="text-xs leading-relaxed text-muted-foreground">{PARTNER_MARKS_NOTICE}</p>
    </div>
  );
}
