import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { Dulo } from "@/components/brand/Tamga";
import { Badge } from "@/components/ui/badge";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { NavLinks } from "@/components/layout/NavLinks";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { COMPLIANCE_LINE } from "@/components/common/compliance";
import { MarketSessionChip } from "@/components/common/MarketSessionChip";
import { SEASON_NAME } from "@/lib/config";
import { cn } from "@/lib/utils";

/** Season chip shown in the header: "Stocks Season · Season 0" (short form under sm). */
export function SeasonChip({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-6 gap-1.5 rounded-full border-gold/20 bg-gold/[0.06] px-2.5 text-xs font-medium tracking-wide text-muted-foreground",
        className,
      )}
    >
      <span className="relative flex size-1.5" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-ember/60" />
        <span className="relative inline-flex size-1.5 rounded-full bg-ember" />
      </span>
      <span className="hidden sm:inline">{SEASON_NAME} ·&nbsp;</span>
      <span className="text-foreground">Season 0</span>
    </Badge>
  );
}

export interface FooterLink {
  href: string;
  label: string;
}

/**
 * External footer links (GitHub, X, demo video), each shown only when its URL is set to an
 * https URL. The caller passes process.env.NEXT_PUBLIC_GITHUB_URL / _X_URL / _VIDEO_URL.
 */
export function footerLinks(env: { github?: string | null; x?: string | null; video?: string | null }): FooterLink[] {
  const out: FooterLink[] = [];
  const add = (url: string | null | undefined, label: string) => {
    const href = url?.trim();
    if (href && /^https:\/\/[^\s]+$/i.test(href)) out.push({ href, label });
  };
  add(env.github, "GitHub");
  add(env.x, "X");
  add(env.video, "Watch the demo");
  return out;
}

const FOOTER_LINK = "inline-flex min-h-10 items-center gap-1 transition-colors hover:text-foreground md:min-h-0";

/**
 * App chrome: sticky header (wordmark, season chip, desktop nav, wallet button),
 * a max-w-6xl main container, the footer and the mobile bottom tab bar.
 * Server component; only the nav (active state) and wallet button are client.
 */
export function AppShell({ children }: { children: ReactNode }) {
  // Literal process.env reads so Next inlines the NEXT_PUBLIC_* values at build time.
  const external = footerLinks({
    github: process.env.NEXT_PUBLIC_GITHUB_URL,
    x: process.env.NEXT_PUBLIC_X_URL,
    video: process.env.NEXT_PUBLIC_VIDEO_URL,
  });

  return (
    // Under lg the fixed tab bar covers the bottom 4rem (plus the iOS home indicator), so the whole
    // shell, main and footer alike, ends above it: no page needs its own clearance and no last row or
    // footer link ever sits behind the bar.
    <div className="relative isolate flex min-h-dvh flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
      <div className="app-backdrop" aria-hidden />
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#0a0908]/70 backdrop-blur-xl backdrop-saturate-150">
        {/* A hairline of ember light along the bottom edge of the header. */}
        <div className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-ember/35 to-transparent" aria-hidden />
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label="Dulo home"
          >
            <Dulo size={26} />
          </Link>
          <SeasonChip className="hidden shrink-0 min-[400px]:inline-flex lg:hidden xl:inline-flex" />
          {/*
            Beside the Season chip, in the only band where it fits. Measured 16 Sep: the five nav links
            need about 524px on one line (whitespace-nowrap). At lg the row is logo + nav + Connect,
            about 780 of 977px, so the Season chip steps aside there. At xl the row is logo +
            SeasonChip + nav + Connect, about 984 of 1120px signed out, which leaves room for the xl
            points chip. Under sm there are only ~84px spare. So this chip shows from 680px until md,
            and the same chip rides with the copy on /predictions and /competition, where it is read.
            No `nowIso`: this shell is statically rendered, so a build-time instant would be a wrong
            first frame. The chip renders its placeholder until it mounts instead.
          */}
          <MarketSessionChip className="hidden shrink-0 min-[680px]:inline-flex md:hidden" />
          <NavLinks className="ml-1" />
          <div className="ml-auto flex shrink-0 items-center">
            <ConnectButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-10 md:pb-12">{children}</main>

      {/* Visible on phones too (the links matter to judges); the shell's own bottom padding keeps it clear of the tab bar. */}
      <footer className="border-t border-white/[0.06] bg-[#0a0908]/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 text-sm text-muted-foreground md:flex-row md:flex-wrap md:items-center md:justify-between">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <Dulo size={18} />
              <span className="text-pretty">Points only. No cash value. Built on Solana for the Stocklana hackathon.</span>
            </div>
            <p className="text-xs text-pretty text-muted-foreground/80">{COMPLIANCE_LINE}</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/check" className={FOOTER_LINK}>
              Check a wallet
            </Link>
            <Link href="/partners" className={FOOTER_LINK}>
              Partners
            </Link>
            <Link href="/copy" className={FOOTER_LINK}>
              Copy a portfolio
            </Link>
            <Link href="/profile" className={FOOTER_LINK}>
              Profile
            </Link>
            {external.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK}>
                {l.label}
                <ArrowUpRightIcon className="size-3.5" aria-hidden />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ))}
          </nav>
        </div>
      </footer>

      <MobileTabBar />
    </div>
  );
}

export default AppShell;
