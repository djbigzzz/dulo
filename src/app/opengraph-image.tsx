import { ImageResponse } from "next/og";
import { TAMGA_PATHS, TAMGA_STROKE } from "@/components/brand/Tamga";

// Only default/alt/size/contentType are exported: Next re-exports every named export of this file
// into the generated image route.

export const alt = "Dulo: The entertainment layer for xStocks.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#09090b";
const WHITE = "#fafafa";
const GREY = "#a1a1aa";
const ACCENT = "#3b82f6";

const WORDMARK = "Dulo";
const TAGLINE = "The entertainment layer for xStocks.";
const EYEBROW = "Season 0 · Solana mainnet";
const FOOTER = "Predictions · Competition (virtual cash) · Quests · Points only";

/** Unique characters of the strings, for Google Fonts' `text=` subsetting (plus upper case for text-transform). */
function glyphs(...parts: string[]): string {
  return [...new Set([...parts.join(""), ...parts.join("").toUpperCase()])].join("");
}

/**
 * One weight of a Google font as an ArrayBuffer for Satori, subset to `text`. The css2 API answers a
 * client without a browser User-Agent with a TrueType `src: url(...)` (Satori cannot read woff2).
 * This route is static, so it runs once at build; any failure (offline CI, Google down) returns null
 * and the card falls back to next/og's bundled Noto Sans rather than failing the build.
 */
async function loadGoogleFont(family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}&text=${encodeURIComponent(text)}`;
    const cssRes = await fetch(cssUrl, { signal: AbortSignal.timeout(5_000) });
    if (!cssRes.ok) return null;
    const css = await cssRes.text();
    const src = /src:\s*url\((['"]?)([^'")]+)\1\)\s*format\((['"])(?:truetype|opentype)\3\)/.exec(css)?.[2];
    if (!src) return null;
    const fontRes = await fetch(src, { signal: AbortSignal.timeout(5_000) });
    if (!fontRes.ok) return null;
    return await fontRes.arrayBuffer();
  } catch {
    return null;
  }
}

type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: "normal" };

/** Geist (the app's only face) at 500 and 600. Without it the card falls back to next/og's bundled sans. */
async function loadFonts(): Promise<OgFont[] | undefined> {
  const [sans500, sans600] = await Promise.all([
    loadGoogleFont("Geist", 500, glyphs(EYEBROW, FOOTER)),
    loadGoogleFont("Geist", 600, glyphs(TAGLINE, WORDMARK)),
  ]);
  if (!sans500 || !sans600) return undefined;
  return [
    { name: "Geist", data: sans500, weight: 500, style: "normal" },
    { name: "Geist", data: sans600, weight: 600, style: "normal" },
  ];
}

/** Social card, 1200x630: flat near-black ground, the accent tamga, a heavy tight "Dulo", the positioning line. */
export default async function OpenGraphImage() {
  const fonts = await loadFonts();
  const sansFamily = fonts ? "Geist" : "sans serif";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 88px",
          backgroundColor: INK,
          color: WHITE,
          fontFamily: sansFamily,
        }}
      >
        <div style={{ display: "flex", fontSize: 24, fontWeight: 500, letterSpacing: 4, textTransform: "uppercase", color: GREY }}>
          {EYEBROW}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
            <svg width={168} height={168} viewBox="0 0 64 64" fill="none">
              {TAMGA_PATHS.map((d) => (
                <path key={d} d={d} stroke={ACCENT} strokeWidth={TAMGA_STROKE} strokeLinecap="square" strokeLinejoin="miter" />
              ))}
            </svg>
            <div
              style={{
                display: "flex",
                fontFamily: sansFamily,
                fontWeight: 600,
                fontSize: 170,
                lineHeight: 1,
                letterSpacing: -8,
                color: WHITE,
                paddingBottom: 12,
              }}
            >
              {WORDMARK}
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 50, fontWeight: 600, letterSpacing: -1.5, color: WHITE }}>{TAGLINE}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              width: "100%",
              height: 1,
              backgroundColor: "rgba(255,255,255,0.14)",
            }}
          />
          <div style={{ display: "flex", fontSize: 26, fontWeight: 500, color: GREY }}>{FOOTER}</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
