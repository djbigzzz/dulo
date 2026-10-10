import type { Metadata } from "next";
import { Tamga } from "@/components/brand/Tamga";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false },
};

/** Instrument Serif (the next/font variable) first, then a system serif: the title reads as Broadcast without the web font. */
const DISPLAY = 'var(--font-instrument-serif), "Times New Roman", ui-serif, Georgia, serif';

/**
 * Served by public/sw.js when a navigation fails offline. Laid out as the 404 is (on the page, a
 * strong rule on top, no panel), kept dependency-free and given inline style fallbacks (ink ground,
 * cream tamga, serif title, the muted grey) so it still reads as Dulo when the hashed CSS chunk or
 * the web font is not in the cache yet.
 */
export default function OfflinePage() {
  return (
    <section
      className="flex min-h-[60dvh] flex-col justify-center py-10 sm:py-14"
      style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "60dvh", padding: "2.5rem 0" }}
    >
      <div
        className="flex max-w-3xl flex-col gap-6 border-t border-rule-2 pt-8"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          maxWidth: 768,
          borderTop: "1px solid rgb(243 240 232 / 0.17)",
          paddingTop: 32,
          color: "#f3f0e8",
        }}
      >
        {/* The cream is an inline SVG stroke, so the mark keeps its colour without any stylesheet. */}
        <Tamga size={40} tone="gradient" title="Dulo" />
        <p className="text-[0.9375rem] font-medium text-muted-foreground" style={{ margin: 0, fontSize: 15, color: "#a3a199" }}>
          No connection
        </p>
        <h1
          className="font-display text-[2.75rem] leading-none font-normal tracking-[-0.012em] text-foreground sm:text-[4.25rem]"
          style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 400, letterSpacing: "-0.012em", lineHeight: 1 }}
        >
          You are{" "}
          <span className="text-muted-foreground" style={{ color: "#a3a199" }}>
            offline
          </span>
        </h1>
        <p
          className="max-w-lg text-base leading-relaxed text-muted-foreground sm:text-[1.0625rem]"
          style={{ margin: 0, maxWidth: 512, color: "#a3a199", lineHeight: 1.6 }}
        >
          Dulo reads your on-chain activity live. Reconnect and your quests, paper trades and predictions will pick up where
          they left off.
        </p>
        {/* A plain anchor (not next/link) so the retry is a real navigation the service worker can serve. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- intentional full navigation */}
        <a href="/" className={buttonVariants({ size: "xl", className: "mt-2 w-fit" })}>
          Try again
        </a>
      </div>
    </section>
  );
}
