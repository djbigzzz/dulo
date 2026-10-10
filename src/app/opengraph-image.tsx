import { ImageResponse } from "next/og";
import { TAMGA_PATHS, TAMGA_STROKE } from "@/components/brand/Tamga";

// Only default/alt/size/contentType are exported: Next re-exports every named export of this file
// into the generated image route.

export const alt = "Dulo: The entertainment layer for xStocks.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The Broadcast palette (docs/DESIGN.md): ink ground, cream text and tamga, muted grey, one rule.
const INK = "#0b0b0c";
const CREAM = "#f3f0e8";
const GREY = "#a3a199";
const RULE = "rgba(243,240,232,0.17)";

const WORDMARK = "Dulo";
const TAGLINE = "The entertainment layer for xStocks.";
const EYEBROW = "Stocks Season 0 · Solana mainnet";
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

/**
 * Archivo 500 for the small lines and Instrument Serif (its one weight, 400) for the wordmark and
 * the line. Without them the card falls back to next/og's bundled sans.
 */
async function loadFonts(): Promise<OgFont[] | undefined> {
  const [sans500, serif400] = await Promise.all([
    loadGoogleFont("Archivo", 500, glyphs(EYEBROW, FOOTER)),
    loadGoogleFont("Instrument Serif", 400, glyphs(TAGLINE, WORDMARK)),
  ]);
  if (!sans500 || !serif400) return undefined;
  return [
    { name: "Archivo", data: sans500, weight: 500, style: "normal" },
    { name: "Instrument Serif", data: serif400, weight: 400, style: "normal" },
  ];
}

/** Social card, 1200x630: the ink ground, the cream tamga, "Dulo" and the positioning line in the serif. */
export default async function OpenGraphImage() {
  const fonts = await loadFonts();
  const sansFamily = fonts ? "Archivo" : "sans serif";
  const serifFamily = fonts ? "Instrument Serif" : "sans serif";

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
          color: CREAM,
          fontFamily: sansFamily,
        }}
      >
        <div style={{ display: "flex", fontSize: 26, fontWeight: 500, color: GREY }}>{EYEBROW}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
            <svg width={156} height={156} viewBox="0 0 64 64" fill="none">
              {TAMGA_PATHS.map((d) => (
                <path key={d} d={d} stroke={CREAM} strokeWidth={TAMGA_STROKE} strokeLinecap="square" strokeLinejoin="miter" />
              ))}
            </svg>
            <div
              style={{
                display: "flex",
                fontFamily: serifFamily,
                fontWeight: 400,
                fontSize: 200,
                lineHeight: 1,
                letterSpacing: 1,
                color: CREAM,
                paddingBottom: 8,
              }}
            >
              {WORDMARK}
            </div>
          </div>
          <div style={{ display: "flex", fontFamily: serifFamily, fontSize: 66, fontWeight: 400, lineHeight: 1, letterSpacing: -0.8, color: CREAM }}>
            {TAGLINE}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", width: "100%", height: 1, backgroundColor: RULE }} />
          <div style={{ display: "flex", fontSize: 26, fontWeight: 500, color: GREY }}>{FOOTER}</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
