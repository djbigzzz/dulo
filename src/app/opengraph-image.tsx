import { ImageResponse } from "next/og";
import { TAMGA_PATHS, TAMGA_STROKE } from "@/components/brand/Tamga";

// Only default/alt/size/contentType are exported: Next re-exports every named export of this file
// into the generated image route.

export const alt = "Dulo: The entertainment layer for xStocks.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const OBSIDIAN = "#0a0908";
const WARM_WHITE = "#f4f1ea";
const WARM_GREY = "#a9a299";
const GOLD = "#d8b46a";

const WORDMARK = "Dulo";
const TAGLINE = "The entertainment layer for xStocks.";
const EYEBROW = "Stocks Season · Season 0";
const FOOTER = "Predictions · Competition (virtual cash) · Quests · Copy a portfolio. Points only.";

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
 * Instrument Serif for the wordmark, Geist (the app's UI face) for everything else. Passing `fonts`
 * replaces next/og's bundled sans, so the serif is only used when Geist loaded too; otherwise the
 * "Dulo" subset would be the only font and leak its glyphs into the sans lines.
 */
async function loadFonts(): Promise<{ fonts: OgFont[] | undefined; serif: boolean }> {
  const [serif, sans500, sans600] = await Promise.all([
    loadGoogleFont("Instrument Serif", 400, glyphs(WORDMARK)),
    loadGoogleFont("Geist", 500, glyphs(EYEBROW, FOOTER)),
    loadGoogleFont("Geist", 600, glyphs(TAGLINE)),
  ]);
  if (!sans500 || !sans600) return { fonts: undefined, serif: false };
  const fonts: OgFont[] = [
    { name: "Geist", data: sans500, weight: 500, style: "normal" },
    { name: "Geist", data: sans600, weight: 600, style: "normal" },
  ];
  if (serif) fonts.push({ name: "Instrument Serif", data: serif, weight: 400, style: "normal" });
  return { fonts, serif: Boolean(serif) };
}

/** Social card, 1200x630: obsidian ground with a low ember glow, gold-gradient tamga, serif "Dulo", the positioning line. */
export default async function OpenGraphImage() {
  const { fonts, serif } = await loadFonts();
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
          backgroundColor: OBSIDIAN,
          backgroundImage:
            "radial-gradient(circle at 88% -10%, rgba(255,106,42,0.26) 0%, rgba(255,106,42,0) 52%), radial-gradient(circle at 0% 110%, rgba(216,180,106,0.12) 0%, rgba(216,180,106,0) 46%)",
          color: WARM_WHITE,
          fontFamily: sansFamily,
        }}
      >
        <div style={{ display: "flex", fontSize: 24, fontWeight: 500, letterSpacing: 4, textTransform: "uppercase", color: GOLD }}>
          {EYEBROW}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
            <svg width={168} height={168} viewBox="0 0 64 64" fill="none">
              <defs>
                <linearGradient id="og-tamga" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#f0d9a4" />
                  <stop offset="55%" stopColor={GOLD} />
                  <stop offset="100%" stopColor="#b8893f" />
                </linearGradient>
              </defs>
              {TAMGA_PATHS.map((d) => (
                <path key={d} d={d} stroke="url(#og-tamga)" strokeWidth={TAMGA_STROKE} strokeLinecap="square" strokeLinejoin="miter" />
              ))}
            </svg>
            <div
              style={{
                display: "flex",
                fontFamily: serif ? "Instrument Serif" : sansFamily,
                fontWeight: serif ? 400 : 600,
                fontSize: serif ? 210 : 170,
                lineHeight: 1,
                letterSpacing: serif ? -4 : -6,
                color: WARM_WHITE,
                paddingBottom: 12,
              }}
            >
              {WORDMARK}
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 50, fontWeight: 600, letterSpacing: -1, color: WARM_WHITE }}>{TAGLINE}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              width: "100%",
              height: 2,
              backgroundImage: "linear-gradient(90deg, rgba(216,180,106,0.55) 0%, rgba(255,106,42,0.55) 50%, rgba(255,106,42,0) 100%)",
            }}
          />
          <div style={{ display: "flex", fontSize: 26, fontWeight: 500, color: WARM_GREY }}>{FOOTER}</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
