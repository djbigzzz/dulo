"use client";

import { useEffect } from "react";
import { Tamga } from "@/components/brand/Tamga";

/**
 * Last-resort boundary for a crash in the root layout itself. It replaces <html>, so neither
 * globals.css nor the next/font variables can be relied on: everything is inline, in the
 * Broadcast palette (ink ground, cream text and tamga, a serif title, the one gold retry with its cut).
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
          background: "#0b0b0c",
          color: "#f3f0e8",
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          textAlign: "center",
          colorScheme: "dark",
        }}
      >
        <main role="alert" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, maxWidth: 440 }}>
          <Tamga size={64} tone="gradient" title="Dulo" />
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "#a3a199" }}>Dulo hit an error</p>
          <h1
            style={{
              margin: 0,
              fontFamily: '"Instrument Serif", "Times New Roman", ui-serif, Georgia, serif',
              fontWeight: 400,
              fontSize: 48,
              lineHeight: 1,
              letterSpacing: "-0.012em",
            }}
          >
            Something went <em style={{ fontStyle: "normal", color: "#a3a199" }}>wrong</em>
          </h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#a3a199" }}>
            Your Points and wallet are untouched. Reload to pick up where you left off.
          </p>
          {error.digest ? (
            <p style={{ margin: 0, fontSize: 13, color: "#a3a199", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              Ref {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 8,
              height: 48,
              padding: "0 28px 0 24px",
              border: 0,
              borderRadius: 0,
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 600,
              color: "#161100",
              // The gold with its slanted bottom-right cut, drawn by the background (a clip-path would clip the focus outline).
              background: "linear-gradient(315deg, transparent 7px, #ffd23c 7px)",
              outlineColor: "#8cc8ff",
              outlineOffset: 2,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
