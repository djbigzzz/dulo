"use client";

import { useEffect } from "react";
import { Tamga } from "@/components/brand/Tamga";

/**
 * Last-resort boundary for a crash in the root layout itself. It replaces <html>, so neither
 * globals.css nor the next/font variables can be relied on: everything is inline, in the
 * Mono palette (near-black, white action, system sans set heavy and tight).
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
          background: "#09090b",
          color: "#fafafa",
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          textAlign: "center",
          colorScheme: "dark",
        }}
      >
        <main role="alert" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, maxWidth: 440 }}>
          <Tamga size={64} tone="gradient" title="Dulo" />
          <p style={{ margin: 0, fontSize: 12, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "#a1a1aa" }}>
            Dulo hit an error
          </p>
          <h1
            style={{
              margin: 0,
              fontWeight: 600,
              fontSize: 40,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
            }}
          >
            Something went <em style={{ fontStyle: "normal", color: "#a1a1aa" }}>wrong</em>
          </h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#a1a1aa" }}>
            Your Points and wallet are untouched. Reload to pick up where you left off.
          </p>
          {error.digest ? (
            <p style={{ margin: 0, fontSize: 12, color: "#a1a1aa", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
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
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 600,
              color: "#09090b",
              background: "#fafafa",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
