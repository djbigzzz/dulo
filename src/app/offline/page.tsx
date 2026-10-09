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
 * Served by public/sw.js when a navigation fails offline. Kept dependency-free and given
 * inline style fallbacks (ink panel, cream tamga, serif title) so it still reads as Dulo
 * when the hashed CSS chunk or the web font is not in the cache yet.
 */
export default function OfflinePage() {
  return (
    <section
      className="flex min-h-[60dvh] flex-col items-center justify-center py-12 text-center"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60dvh", padding: "3rem 0", textAlign: "center" }}
    >
      <div
        className="relative flex w-full max-w-xl flex-col items-center gap-6 overflow-hidden rounded-md border border-rule bg-card px-6 py-12 sm:px-10 sm:py-16"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          width: "100%",
          maxWidth: 576,
          borderRadius: 2,
          border: "1px solid rgb(243 240 232 / 0.085)",
          background: "#121214",
          color: "#f3f0e8",
        }}
      >
        {/* The cream is an inline SVG stroke, so the mark keeps its colour without any stylesheet. */}
        <Tamga size={64} tone="gradient" title="Dulo" />
        <p className="text-sm font-medium text-muted-foreground" style={{ margin: 0, fontSize: 14, color: "#a3a199" }}>
          No connection
        </p>
        <h1
          className="font-display text-[2.75rem] leading-none font-normal tracking-[-0.012em] text-foreground sm:text-[3.5rem]"
          style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 400, letterSpacing: "-0.012em", lineHeight: 1 }}
        >
          You are{" "}
          <span className="text-muted-foreground" style={{ color: "#a3a199" }}>
            offline
          </span>
        </h1>
        <p
          className="mx-auto max-w-sm text-[0.9375rem] leading-relaxed text-muted-foreground sm:text-base"
          style={{ margin: 0, maxWidth: 384, color: "#a3a199", lineHeight: 1.6 }}
        >
          Dulo reads your on-chain activity live. Reconnect and your quests, paper trades and predictions will pick up where
          they left off.
        </p>
        {/* A plain anchor (not next/link) so the retry is a real navigation the service worker can serve. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- intentional full navigation */}
        <a href="/" className={buttonVariants({ size: "lg", className: "mt-2 h-11 px-6" })}>
          Try again
        </a>
      </div>
    </section>
  );
}
