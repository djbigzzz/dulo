import type { Metadata } from "next";
import { Tamga } from "@/components/brand/Tamga";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false },
};

const SERIF = 'var(--font-instrument-serif), "Iowan Old Style", "Palatino Linotype", Georgia, serif';

/**
 * Served by public/sw.js when a navigation fails offline. Kept dependency-free and given
 * inline style fallbacks (obsidian panel, gold tamga, serif title) so it still reads as Dulo
 * when the hashed CSS chunk or the web font is not in the cache yet.
 */
export default function OfflinePage() {
  return (
    <section
      className="flex min-h-[60dvh] flex-col items-center justify-center py-12 text-center"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60dvh", padding: "3rem 0", textAlign: "center" }}
    >
      <div
        className="relative flex w-full max-w-xl flex-col items-center gap-6 overflow-hidden rounded-3xl border-gradient bg-card px-6 py-12 ember-glow sm:px-10 sm:py-16"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: "100%", maxWidth: 576, borderRadius: 24, color: "#f4f1ea" }}
      >
        {/* The gradient is an inline SVG <linearGradient>, so the gold survives without any stylesheet. */}
        <Tamga size={64} tone="gradient" title="Dulo" />
        <p
          className="text-xs font-medium tracking-[0.14em] text-gold uppercase"
          style={{ margin: 0, fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "#d8b46a" }}
        >
          No connection
        </p>
        <h1
          className="font-display text-4xl leading-[1.02] font-normal tracking-[-0.01em] text-foreground sm:text-5xl"
          style={{ margin: 0, fontFamily: SERIF, fontWeight: 400, lineHeight: 1.02 }}
        >
          You are <span className="italic text-gradient-ember" style={{ fontStyle: "italic" }}>offline</span>
        </h1>
        <p
          className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground sm:text-base"
          style={{ margin: 0, maxWidth: 384, color: "#a9a299", lineHeight: 1.6 }}
        >
          Dulo reads your on-chain activity live. Reconnect and your quests, paper trades and predictions will pick up where
          they left off.
        </p>
        {/* A plain anchor (not next/link) so the retry is a real navigation the service worker can serve. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- intentional full navigation */}
        <a href="/" className={buttonVariants({ size: "lg", className: "mt-2" })}>
          Try again
        </a>
      </div>
    </section>
  );
}
