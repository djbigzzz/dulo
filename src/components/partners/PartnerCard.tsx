"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Clock, Mail, Plus } from "lucide-react";
import { cn } from "cn";
import type { PartnerListItem } from "@/lib/api-client";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PartnerLogo } from "@/components/common/PartnerLogo";
import { partnerListingLabel, type PartnerListingLabel } from "@/components/plays/play-meta";

export interface PartnerCardProps {
  partner: PartnerListItem;
  className?: string;
}

/** Shown wherever Partner logos are listed: a logo on Dulo is not an endorsement. Defined in components/common/compliance. */
export { PARTNER_MARKS_NOTICE } from "@/components/common/compliance";

/** One Partner per row on 1px rules: logo, name and listing, the blurb, the quest count, the way in. */
export const PARTNER_ROW =
  "group grid min-h-[5.5rem] grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-4 border-t border-rule py-4 outline-none transition-colors duration-200 hover:bg-white/[0.025] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset motion-reduce:transition-none sm:grid-cols-[3rem_minmax(0,14rem)_minmax(0,1fr)_auto_auto] sm:gap-x-6 sm:px-2";

/**
 * "Quests live" as a cream ruled tag with a check; "Coming soon" as a muted dashed tag. Never a hue:
 * a listing is a fact, not a gain.
 */
export function ListingPill({ label, className }: { label: PartnerListingLabel; className?: string }) {
  const soon = label === "Coming soon";
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit items-center gap-1 border px-1.5 text-xs font-semibold whitespace-nowrap",
        soon ? "border-dashed border-[rgb(243_240_232/0.38)] text-muted-foreground" : "border-rule-2 text-foreground",
        className,
      )}
    >
      {soon ? <Clock className="size-3" aria-hidden /> : <Check className="size-3" strokeWidth={2.75} aria-hidden />}
      {label}
    </span>
  );
}

/** A partner logo in the round ink well, greyscale (docs/DESIGN.md "Logos"). */
export function PartnerMark({ name, logoUrl, size = 48, className }: { name: string; logoUrl: string | null; size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 [&_img]:logo-greyscale", className)}>
      <PartnerLogo name={name} logoUrl={logoUrl} size={size} />
    </span>
  );
}

/** One Partner on /partners, as a row of the list. The whole row links to the Partner page. */
export function PartnerCard({ partner, className }: PartnerCardProps) {
  const label = partnerListingLabel(partner.livePlayCount);
  const plays = `${partner.playCount} ${partner.playCount === 1 ? "quest" : "quests"}`;

  return (
    <Link href={`/partners/${encodeURIComponent(partner.slug)}`} className={cn(PARTNER_ROW, className)}>
      <PartnerMark name={partner.name} logoUrl={partner.logoUrl} />
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <p className="w-full truncate text-[1.125rem] leading-tight font-semibold">{partner.name}</p>
        <ListingPill label={label} />
      </div>
      <p className="col-span-full col-start-2 line-clamp-2 text-[0.9375rem] leading-relaxed text-muted-foreground sm:col-span-1 sm:col-start-auto">{partner.blurb}</p>
      <p className="col-start-3 row-start-1 text-right text-[0.9375rem] font-semibold tabular-nums sm:col-start-auto sm:row-start-auto">
        {plays}
        {partner.livePlayCount > 0 && partner.livePlayCount < partner.playCount ? (
          <span className="block text-[0.8125rem] font-normal text-muted-foreground">{partner.livePlayCount} live</span>
        ) : null}
      </p>
      <ArrowRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none sm:block" aria-hidden />
    </Link>
  );
}

/** The open seat at the end of the list, for projects that want to list quests (the dashed "Your slot" row). */
export function ListProjectCard({ className }: { className?: string }) {
  return (
    <a
      href="#list"
      className={cn(
        "group my-1 grid min-h-[5.5rem] grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-4 border border-dashed border-[rgb(243_240_232/0.38)] px-3 py-4 outline-none transition-colors duration-200 hover:bg-white/[0.025] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none sm:gap-x-6 sm:px-2",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full border-[1.5px] border-dashed border-muted-foreground text-muted-foreground" aria-hidden>
        <Plus className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-[1.125rem] leading-tight font-semibold">List your project</span>
        <span className="text-[0.9375rem] leading-relaxed text-muted-foreground">An on-chain quest is one JSON rule. List one and Dulo players find your project.</span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-[0.9375rem] font-semibold">
        <span className="hidden sm:inline">How listing works</span>
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none" aria-hidden />
      </span>
    </a>
  );
}

/**
 * The "Talk to us" link from NEXT_PUBLIC_PARTNER_CONTACT: a `mailto:` address or an `https:` URL.
 * Anything else (empty, http:, javascript:, a bare address) returns null and the button is not rendered.
 */
export function partnerContactHref(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") return url.pathname.includes("@") ? value : null;
  if (url.protocol === "https:") return url.hostname ? value : null;
  return null;
}

export interface ListProjectSectionProps {
  className?: string;
  /** Validated contact link; defaults to NEXT_PUBLIC_PARTNER_CONTACT. `null` hides the button. */
  contactHref?: string | null;
}

/** How a project would list: three steps as lanes on 1px rules, numbered in the scoreboard cut. */
export function ListProjectSection({
  className,
  contactHref = partnerContactHref(process.env.NEXT_PUBLIC_PARTNER_CONTACT),
}: ListProjectSectionProps) {
  const external = contactHref?.startsWith("https:") ?? false;
  const points = [
    "Describe the on-chain action as one JSON rule: hold, deposit, trade or keep a position.",
    "Dulo checks it against players' own wallets when they sign in and again through the day. Nothing to deploy.",
    "Your quests sit on the board with your logo and a page of their own.",
  ];
  return (
    <section id="list" aria-labelledby="list-title" className={cn("flex scroll-mt-6 flex-col gap-4", className)}>
      <div className="flex flex-col gap-2 pb-1">
        <p className="text-[0.9375rem] font-medium text-muted-foreground">For projects</p>
        <h2 id="list-title" className="font-display text-[2rem] leading-none font-normal tracking-[-0.012em] sm:text-[2.5rem]">
          List your project
        </h2>
      </div>
      <ol className="grid border-b border-rule md:grid-cols-3 md:gap-x-8">
        {points.map((p, i) => (
          <li key={p} className="flex items-start gap-4 border-t border-rule py-5 text-[0.9375rem] leading-relaxed text-muted-foreground">
            <span className="figure w-5 shrink-0 text-[2rem] leading-[0.8] text-foreground" aria-hidden>
              {i + 1}
            </span>
            <span>{p}</span>
          </li>
        ))}
      </ol>
      {contactHref ? (
        <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">Tell us the on-chain action you want players to do.</p>
          <a
            href={contactHref}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full px-4 sm:w-auto")}
          >
            {external ? <ArrowUpRight data-icon="inline-start" aria-hidden /> : <Mail data-icon="inline-start" aria-hidden />}
            Talk to us
            {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
          </a>
        </div>
      ) : null}
    </section>
  );
}

export function PartnerCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(PARTNER_ROW, "hover:bg-transparent", className)} aria-hidden>
      <Skeleton className="size-12 rounded-full" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="col-span-full col-start-2 h-4 w-full sm:col-span-1 sm:col-start-auto" />
      <Skeleton className="col-start-3 row-start-1 h-4 w-16 sm:col-start-auto sm:row-start-auto" />
    </div>
  );
}

export default PartnerCard;
