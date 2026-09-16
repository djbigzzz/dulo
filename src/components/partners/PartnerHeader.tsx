"use client";

import { BookOpen, ExternalLink, Globe } from "lucide-react";
import { cn } from "cn";
import type { PartnerDetail } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PartnerLogo } from "@/components/common/PartnerLogo";
import { chainLabel } from "@/components/common/format";
import { partnerListingLabel } from "@/components/plays/play-meta";
import { ListingPill } from "@/components/partners/PartnerCard";

export interface PartnerHeaderProps {
  partner: PartnerDetail["partner"];
  /** Plays verifiable now; drives "Plays live" vs "Coming soon". */
  livePlays: number;
  className?: string;
}

const HERO = "border-gradient relative flex flex-col gap-6 overflow-hidden rounded-3xl bg-card ember-glow p-6 sm:p-10";
const LOGO_TILE =
  "flex shrink-0 items-center justify-center rounded-[1.4rem] border border-white/[0.1] bg-white/[0.04] p-1.5 shadow-[inset_0_1px_0_rgb(255_245_230/0.08),0_16px_40px_-16px_rgb(0_0_0/0.8)]";

/** Simple X wordmark; lucide dropped brand icons. */
function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M17.53 3h3.02l-6.6 7.55L21.7 21h-6.08l-4.76-6.23L5.4 21H2.38l7.06-8.07L2 3h6.23l4.3 5.7L17.53 3Zm-1.06 16.2h1.67L7.6 4.7H5.8l10.67 14.5Z" />
    </svg>
  );
}

/** Partner masthead: logo, name, listing chip, blurb, link buttons. */
export function PartnerHeader({ partner, livePlays, className }: PartnerHeaderProps) {
  const label = partnerListingLabel(livePlays);
  const links: Array<{ key: string; href: string; label: string; icon: React.ReactNode }> = [];
  if (partner.links.website) links.push({ key: "website", href: partner.links.website, label: "Website", icon: <Globe data-icon="inline-start" aria-hidden /> });
  if (partner.links.x) links.push({ key: "x", href: partner.links.x, label: "X", icon: <XMark className="size-3.5" /> });
  if (partner.links.docs) links.push({ key: "docs", href: partner.links.docs, label: "Docs", icon: <BookOpen data-icon="inline-start" aria-hidden /> });

  return (
    <header className={cn(HERO, className)}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
        <span className={cn(LOGO_TILE, "w-fit")}>
          <PartnerLogo name={partner.name} logoUrl={partner.logoUrl} size={64} className="rounded-2xl ring-0" />
        </span>
        <div className="flex min-w-0 flex-col items-start gap-3">
          <h1 className="font-display text-4xl leading-[1.02] font-normal tracking-[-0.015em] text-foreground sm:text-5xl">{partner.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <ListingPill label={label} />
            {partner.chainIds.length > 0 ? (
              <span className="inline-flex h-6 items-center rounded-full border border-white/[0.08] bg-white/[0.03] px-2 text-xs text-muted-foreground">
                on {partner.chainIds.map(chainLabel).join(", ")}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <p className="max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">{partner.blurb}</p>
      {links.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {links.map((l) => (
            <a
              key={l.key}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-xl px-3.5 backdrop-blur-sm")}
            >
              {l.icon}
              {l.label}
              <ExternalLink className="size-3 text-muted-foreground" data-icon="inline-end" aria-hidden />
            </a>
          ))}
        </div>
      ) : null}
    </header>
  );
}

export function PartnerHeaderSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(HERO, className)} aria-hidden>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
        <Skeleton className="size-[78px] rounded-[1.4rem] bg-white/[0.05]" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-11 w-48 bg-white/[0.05]" />
          <Skeleton className="h-6 w-28 rounded-full bg-white/[0.05]" />
        </div>
      </div>
      <Skeleton className="h-4 w-full max-w-2xl bg-white/[0.05]" />
      <Skeleton className="h-4 w-2/3 max-w-2xl bg-white/[0.05]" />
    </div>
  );
}

export default PartnerHeader;
