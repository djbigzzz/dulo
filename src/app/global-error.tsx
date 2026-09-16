"use client";

import { useEffect } from "react";
import { Tamga } from "@/components/brand/Tamga";

/**
 * Last-resort boundary for a crash in the root layout itself. It replaces <html>, so neither
 * globals.css nor the next/font variables can be relied on: everything is inline, in the
 * Obsidian & Khan's Gold palette, with a system serif standing in for Instrument Serif.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "3rem 1rem",
          boxSizing: "border-box",
          background: "radial-gradient(60% 45% at 50% 0%, rgba(255,106,42,0.14), transparent 70%), #0a0908",
          color: "#f4f1ea",
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          textAlign: "center",
          colorScheme: "dark",
        }}
      >
        <main role="alert" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, maxWidth: 440 }}>
          <Tamga size={64} tone="gradient" title="Dulo" />
          <p style={{ margin: 0, fontSize: 12, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "#d8b46a" }}>
            Dulo hit an error
          </p>
          <h1
            style={{
              margin: 0,
              fontFamily: '"Instrument Serif", "Iowan Old Style", "Palatino Linotype", Georgia, serif',
              fontWeight: 400,
              fontSize: 44,
              lineHeight: 1.02,
              letterSpacing: "-0.01em",
            }}
          >
            Something went <em style={{ color: "#ff6a2a" }}>wrong</em>
          </h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#a9a299" }}>
            Your Points and wallet are untouched. Reload to pick up where you left off.
          </p>
          {error.digest ? (
            <p style={{ margin: 0, fontSize: 12, color: "#a9a299", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              Ref {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 8,
              height: 44,
              padding: "0 22px",
              border: 0,
              borderRadius: 12,
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 600,
              color: "#fff",
              background: "linear-gradient(180deg, #ff9452 0%, #ff6a2a 55%, #e2471a 100%)",
              boxShadow: "0 8px 24px -8px rgba(255,106,42,0.6)",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
