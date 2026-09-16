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

const LOGO_TILE =
  "flex shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1 shadow-[inset_0_1px_0_rgb(255_245_230/0.06),0_8px_20px_-12px_rgb(0_0_0/0.7)]";
const DIVIDER = "h-px bg-gradient-to-r from-transparent via-white/10 to-transparent";

/** "Quests live" as a gold pill with a check; "Coming soon" as a muted dashed pill. */
export function ListingPill({ label, className }: { label: PartnerListingLabel; className?: string }) {
  const soon = label === "Coming soon";
  return (
    <span
      className={cn(
        "inline-flex h-6 w-fit items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        soon ? "border-dashed border-white/15 text-muted-foreground" : "border-gold/20 bg-gold/[0.06] text-gold",
        className,
      )}
    >
      {soon ? <Clock className="size-3" aria-hidden /> : <Check className="size-3" strokeWidth={2.75} aria-hidden />}
      {label}
    </span>
  );
}

/** One Partner on /partners. The whole card links to the Partner page. */
export function PartnerCard({ partner, className }: PartnerCardProps) {
  const label = partnerListingLabel(partner.livePlayCount);
  const soon = label === "Coming soon";
  const plays = `${partner.playCount} ${partner.playCount === 1 ? "quest" : "quests"}`;

  return (
    <Link
      href={`/partners/${encodeURIComponent(partner.slug)}`}
      className={cn(
        "group flex h-full flex-col gap-4 rounded-2xl border border-white/[0.07] bg-card p-5 outline-none transition-all duration-300 hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-white/[0.04] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-6",
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <span className={LOGO_TILE}>
          <PartnerLogo name={partner.name} logoUrl={partner.logoUrl} size={48} className={cn("rounded-xl ring-0", soon && "opacity-80")} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
          <p className="w-full truncate text-base font-semibold tracking-tight">{partner.name}</p>
          <ListingPill label={label} />
        </div>
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/[0.07] text-muted-foreground transition-all duration-300 group-hover:border-white/15 group-hover:text-foreground"
          aria-hidden
        >
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
      <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{partner.blurb}</p>
      <div className="mt-auto flex flex-col gap-3">
        <div className={DIVIDER} aria-hidden />
        <p className="text-sm font-medium tabular-nums">
          {plays}
          {partner.livePlayCount > 0 && partner.livePlayCount < partner.playCount ? (
            <span className="font-normal text-muted-foreground"> · {partner.livePlayCount} live</span>
          ) : null}
        </p>
      </div>
    </Link>
  );
}

/** Call-to-action card for projects that want to list quests. */
export function ListProjectCard({ className }: { className?: string }) {
  return (
    <a
      href="#list"
      className={cn(
        "border-gradient group flex h-full flex-col gap-4 rounded-2xl bg-card p-5 outline-none transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/[0.04] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-6",
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <span
          className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-gold/25 bg-gold/[0.06] text-gold shadow-[inset_0_1px_0_rgb(255_245_230/0.08),0_0_24px_-8px_rgb(216_180_106/0.5)]"
          aria-hidden
        >
          <Plus className="size-5" />
        </span>
        <p className="text-base font-semibold tracking-tight">List your project</p>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">An on-chain quest is one JSON rule. List one and Dulo players find your project.</p>
      <div className="mt-auto flex flex-col gap-3">
        <div className={DIVIDER} aria-hidden />
        <p className="inline-flex items-center gap-1.5 text-sm font-medium">
          How listing works
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
        </p>
      </div>
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

export function ListProjectSection({
  className,
  contactHref = partnerContactHref(process.env.NEXT_PUBLIC_PARTNER_CONTACT),
}: ListProjectSectionProps) {
  const external = contactHref?.startsWith("https:") ?? false;
  const points = [
    "Describe the on-chain action as one JSON rule: hold, deposit, trade or keep a position.",
    "Dulo checks it against players' own wallets every 5 minutes. Nothing to deploy.",
    "Your quests sit on the board with your logo and a page of their own.",
  ];
  return (
    <section
      id="list"
      aria-labelledby="list-title"
      className={cn("scroll-mt-24 rounded-2xl border border-white/[0.07] bg-card p-6 sm:p-8", className)}
    >
      <p className="flex items-center gap-2 text-xs font-medium tracking-[0.18em] text-gold uppercase">
        <span className="h-px w-5 bg-gradient-to-r from-gold/0 to-gold/80" aria-hidden />
        For projects
      </p>
      <h2 id="list-title" className="mt-3 font-display text-3xl leading-tight font-normal sm:text-4xl">
        List your project
      </h2>
      <div className={cn(DIVIDER, "my-6")} aria-hidden />
      <ul className="grid gap-5 md:grid-cols-3 md:gap-6">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground">
            <span
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-gold/25 bg-gold/[0.08] text-gold shadow-[0_0_14px_-4px_rgb(216_180_106/0.5)]"
              aria-hidden
            >
              <Check className="size-3.5" strokeWidth={2.75} />
            </span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
      {contactHref ? (
        <>
          <div className={cn(DIVIDER, "my-6")} aria-hidden />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-relaxed text-muted-foreground">Tell us the on-chain action you want players to do.</p>
            <a
              href={contactHref}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-10 w-full px-4 sm:w-auto")}
            >
              {external ? <ArrowUpRight data-icon="inline-start" aria-hidden /> : <Mail data-icon="inline-start" aria-hidden />}
              Talk to us
              {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
            </a>
          </div>
        </>
      ) : null}
    </section>
  );
}

export function PartnerCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full flex-col gap-4 rounded-2xl border border-white/[0.07] bg-card p-5 sm:p-6", className)} aria-hidden>
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-2xl bg-white/[0.05]" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-28 bg-white/[0.05]" />
          <Skeleton className="h-5 w-24 rounded-full bg-white/[0.05]" />
        </div>
      </div>
      <Skeleton className="h-4 w-full bg-white/[0.05]" />
      <Skeleton className="h-4 w-3/4 bg-white/[0.05]" />
      <div className={DIVIDER} />
      <Skeleton className="h-4 w-16 bg-white/[0.05]" />
    </div>
  );
}

export default PartnerCard;
