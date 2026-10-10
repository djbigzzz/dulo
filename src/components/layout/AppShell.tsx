import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { Dulo, Tamga } from "@/components/brand/Tamga";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { NavLinks } from "@/components/layout/NavLinks";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { WeekDataProvider } from "@/components/layout/WeekData";
import { WeekTrack } from "@/components/layout/WeekTrack";
import { COMPLIANCE_LINE } from "@/components/common/compliance";
import { MarketSessionChip } from "@/components/common/MarketSessionChip";
import { POSITIONING, SEASON_NAME } from "@/lib/config";
import { cn } from "@/lib/utils";

/** "Stocks Season 0" in the header (the mockup's right side): plain text, the number in cream; "Season 0" under sm. */
export function SeasonChip({ className }: { className?: string }) {
  return (
    <span
      data-slot="season-chip"
      className={cn("inline-flex h-6 items-center gap-1.5 text-sm leading-none font-medium whitespace-nowrap text-muted-foreground", className)}
    >
      <span className="hidden sm:inline">{SEASON_NAME}</span>
      <span className="sm:hidden">Season</span>
      <b className="font-semibold text-foreground">0</b>
    </span>
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

/** The positioning line's two sentences, for the footer's line break (the text itself is never changed). */
const POSITIONING_LINES: [string, string | undefined] = (() => {
  const at = POSITIONING.indexOf(". ");
  return at === -1 ? [POSITIONING, undefined] : [POSITIONING.slice(0, at + 1), POSITIONING.slice(at + 2)];
})();

const FOOTER_LINK = "inline-flex min-h-10 items-center gap-1 transition-colors hover:text-foreground motion-reduce:transition-none md:min-h-0";

/**
 * App chrome, Broadcast (docs/DESIGN.md "Shell"): an opaque sticky header (the serif wordmark, the
 * desktop nav with a cream underline on the active section, the Season and a quiet Connect wallet),
 * the week track under it on every page, the page in a 1312px column, the footer (the positioning
 * line in serif, the compliance line, the links) and the mobile tab bar.
 * Server component; the nav, the week track and the wallet button are the client parts. The week
 * data provider wraps all of it, so the track and the page share one read of /league and /calls.
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
      <WeekDataProvider>
        <header className="sticky top-0 z-40 border-b border-rule bg-background">
          <div className="page-wrap flex h-14 items-center gap-3 lg:h-16 lg:gap-10 xl:gap-11">
            <Link
              href="/"
              className="flex shrink-0 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label="Dulo home"
            >
              <Dulo size={24} className="lg:hidden" />
              <Dulo size={26} className="hidden lg:inline-flex" />
            </Link>
            <NavLinks />
            <div className="ml-auto flex shrink-0 items-center gap-4 xl:gap-[22px]">
              <SeasonChip className="hidden shrink-0 min-[400px]:inline-flex lg:hidden xl:inline-flex" />
              {/*
                In the only band where it fits. Measured 16 Sep: at lg the row is logo + nav + Connect, so
                the Season chip steps aside there and comes back at xl. Under sm there are only ~84px
                spare. So this chip shows from 680px until md, and the same chip rides with the copy on
                /predictions and /competition, where it is read.
                No `nowIso`: this shell is statically rendered, so a build-time instant would be a wrong
                first frame. The chip renders its placeholder until it mounts instead.
              */}
              <MarketSessionChip className="hidden shrink-0 min-[680px]:inline-flex md:hidden" compact />
              {/* Outline: each page owns its one gold primary action (DESIGN.md rule 1), its own Connect included. */}
              <ConnectButton variant="outline" />
            </div>
          </div>
        </header>
        <WeekTrack />

        <main className="page-wrap flex-1 pt-6 pb-10 md:pt-8 md:pb-14">{children}</main>

        {/* Visible on phones too (the links matter to judges); the shell's own bottom padding keeps it clear of the tab bar. */}
        <footer className="border-t border-rule bg-background">
          <div className="page-wrap grid gap-6 pt-7 pb-8 text-sm text-muted-foreground md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start md:gap-9 md:pt-9 md:pb-12">
            <Tamga size={36} className="hidden text-foreground md:block" />
            <div className="flex min-w-0 flex-col gap-3">
              <p className="font-display text-[1.4375rem] leading-[1.15] text-pretty text-foreground md:text-[1.625rem]">
                {/* POSITIONING verbatim; from md it breaks after its first sentence, as in the mockup. */}
                {POSITIONING_LINES[0]}
                {POSITIONING_LINES[1] ? (
                  <>
                    {" "}
                    <br className="hidden md:inline" />
                    {POSITIONING_LINES[1]}
                  </>
                ) : null}
              </p>
              <p className="text-[0.8125rem] leading-normal text-pretty text-muted-foreground">
                Points only, no cash value. Named after the House of Dulo, the founding Bulgar dynasty. Built on Solana.
                <br />
                {COMPLIANCE_LINE}
              </p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[0.9375rem] font-medium md:grid md:grid-cols-[auto_auto] md:gap-x-9 md:gap-y-3">
              <Link href="/start" className={FOOTER_LINK}>
                Take the tour
              </Link>
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
      </WeekDataProvider>

      <MobileTabBar />
    </div>
  );
}

export default AppShell;
