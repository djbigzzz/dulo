"use client";

import { ArrowUpRight, BookOpen, Globe } from "lucide-react";
import { cn } from "cn";
import type { PartnerDetail } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { chainLabel } from "@/components/common/format";
import { partnerListingLabel } from "@/components/plays/play-meta";
import { ListingPill, PartnerMark } from "@/components/partners/PartnerCard";

export interface PartnerHeaderProps {
  partner: PartnerDetail["partner"];
  /** Plays verifiable now; drives "Plays live" vs "Coming soon". */
  livePlays: number;
  /** A risk sentence printed under the outbound links (the Token-2022 note on the PreStocks page). */
  notice?: string | null;
  className?: string;
}

/** Simple X wordmark; lucide dropped brand icons. */
function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M17.53 3h3.02l-6.6 7.55L21.7 21h-6.08l-4.76-6.23L5.4 21H2.38l7.06-8.07L2 3h6.23l4.3 5.7L17.53 3Zm-1.06 16.2h1.67L7.6 4.7H5.8l10.67 14.5Z" />
    </svg>
  );
}

/**
 * Partner masthead, on the page (no panel): the greyscale logo in its round well, the name as the
 * serif page title, the honest listing tag and chain, the blurb, the outbound links as quiet
 * buttons, and the risk note under them. A strong rule closes it, as under every page title.
 */
export function PartnerHeader({ partner, livePlays, notice = null, className }: PartnerHeaderProps) {
  const label = partnerListingLabel(livePlays);
  const links: Array<{ key: string; href: string; label: string; icon: React.ReactNode }> = [];
  if (partner.links.website) links.push({ key: "website", href: partner.links.website, label: "Website", icon: <Globe data-icon="inline-start" aria-hidden /> });
  if (partner.links.x) links.push({ key: "x", href: partner.links.x, label: "X", icon: <XMark className="size-3.5" /> });
  if (partner.links.docs) links.push({ key: "docs", href: partner.links.docs, label: "Docs", icon: <BookOpen data-icon="inline-start" aria-hidden /> });

  return (
    <header className={cn("flex flex-col gap-5 border-b border-rule-2 pb-6", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <PartnerMark name={partner.name} logoUrl={partner.logoUrl} size={72} />
        <div className="flex min-w-0 flex-col items-start gap-3">
          <h1 className="font-display text-[2.25rem] leading-none font-normal tracking-[-0.012em] text-balance text-foreground sm:text-5xl lg:text-[3.625rem]">
            {partner.name}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ListingPill label={label} />
            {partner.chainIds.length > 0 ? <span className="text-[0.9375rem] text-muted-foreground">on {partner.chainIds.map(chainLabel).join(", ")}</span> : null}
          </div>
        </div>
      </div>
      <p className="max-w-2xl text-base leading-[1.45] text-pretty text-muted-foreground sm:text-[1.0625rem]">{partner.blurb}</p>
      {links.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {links.map((l) => (
            <a key={l.key} href={l.href} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "px-3.5")}>
              {l.icon}
              {l.label}
              <ArrowUpRight className="size-3.5 text-muted-foreground" data-icon="inline-end" aria-hidden />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ))}
        </div>
      ) : null}
      {notice ? (
        <p data-slot="partner-notice" className="max-w-2xl text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </header>
  );
}

export function PartnerHeaderSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-5 border-b border-rule-2 pb-6", className)} aria-hidden>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <Skeleton className="size-[72px] rounded-full" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-56" />
          <Skeleton className="h-5 w-28" />
        </div>
      </div>
      <Skeleton className="h-4 w-full max-w-2xl" />
      <Skeleton className="h-4 w-2/3 max-w-2xl" />
    </div>
  );
}

export default PartnerHeader;
