import type { Metadata } from "next";
import { Tamga } from "@/components/brand/Tamga";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false },
};

const DISPLAY = 'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * Served by public/sw.js when a navigation fails offline. Kept dependency-free and given
 * inline style fallbacks (near-black panel, accent tamga, heavy sans title) so it still reads as Dulo
 * when the hashed CSS chunk or the web font is not in the cache yet.
 */
export default function OfflinePage() {
  return (
    <section
      className="flex min-h-[60dvh] flex-col items-center justify-center py-12 text-center"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60dvh", padding: "3rem 0", textAlign: "center" }}
    >
      <div
        className="relative flex w-full max-w-xl flex-col items-center gap-6 overflow-hidden rounded-2xl border border-white/[0.08] bg-card px-6 py-12 sm:px-10 sm:py-16"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          width: "100%",
          maxWidth: 576,
          borderRadius: "0.9rem",
          border: "1px solid rgb(255 255 255 / 0.08)",
          background: "#0f0f11",
          color: "#fafafa",
        }}
      >
        {/* The accent is an inline SVG stroke, so the mark keeps its colour without any stylesheet. */}
        <Tamga size={64} tone="gradient" title="Dulo" />
        <p
          className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase"
          style={{ margin: 0, fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "#a1a1aa" }}
        >
          No connection
        </p>
        <h1
          className="font-display text-3xl leading-[1.05] font-semibold tracking-[-0.04em] text-foreground sm:text-4xl"
          style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.05 }}
        >
          You are{" "}
          <span className="text-muted-foreground" style={{ color: "#a1a1aa" }}>
            offline
          </span>
        </h1>
        <p
          className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground sm:text-base"
          style={{ margin: 0, maxWidth: 384, color: "#a1a1aa", lineHeight: 1.6 }}
        >
          Dulo reads your on-chain activity live. Reconnect and your quests, paper trades and predictions will pick up where
          they left off.
        </p>
        {/* A plain anchor (not next/link) so the retry is a real navigation the service worker can serve. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- intentional full navigation */}
        <a href="/" className={buttonVariants({ size: "lg", className: "mt-2 h-11 rounded-lg px-5" })}>
          Try again
        </a>
      </div>
    </section>
  );
}
