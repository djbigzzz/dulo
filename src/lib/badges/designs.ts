/**
 * Badge artwork: five inline SVGs built from the Dulo tamga geometry (the IYI paths in
 * src/components/brand/Tamga.tsx), one accent treatment per Badge:
 *
 *   first_position   ember   rising ember particles, warm glow
 *   diamond_hands    ice     diamond facets behind the mark, frost sparkles
 *   earnings_holder  gold    coin rings with calendar ticks
 *   mirror           violet  the mark and its squashed reflection on a mirror line
 *   league_top3      laurel  laurel wreath around the mark
 *
 * Deterministic strings (no randomness, no Date), 512x512, dark ground, so the same
 * bytes serve /api/v1/badges/[key]/image.svg, the profile grid and the on-chain
 * metadata image. Client-safe: no server imports.
 */
import { TAMGA_PATHS, TAMGA_STROKE } from "@/components/brand/Tamga";
import { BADGES, BADGE_KEYS, isBadgeKey, type BadgeAccent, type BadgeInfo, type BadgeKey } from "./keys";

export { BADGES, BADGE_KEYS, isBadgeKey, type BadgeInfo, type BadgeKey };

export const BADGE_SIZE = 512;
/** DESIGN.md page colour (obsidian). */
const GROUND = "#0a0908";
const INK = "#fafafa";
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

/** Tamga placement shared by every design: 64-unit paths scaled x4, centred horizontally. */
const MARK_SCALE = 4;
const MARK_X = 128;
const MARK_Y = 96;
/** Vertical centre of the mark (paths run y=10..54 in the 64 viewBox). */
const MARK_CY = MARK_Y + 32 * MARK_SCALE;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function n(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
}

function tamga(color: string, opacity = 1): string {
  const paths = TAMGA_PATHS.map((d) => `<path d="${d}"/>`).join("");
  return `<g transform="translate(${MARK_X} ${MARK_Y}) scale(${MARK_SCALE})" fill="none" stroke="${color}" stroke-width="${TAMGA_STROKE}" stroke-linecap="square" stroke-linejoin="miter"${opacity < 1 ? ` opacity="${n(opacity)}"` : ""}>${paths}</g>`;
}

function ground(color: string, id: string): string {
  return [
    `<defs>`,
    `<radialGradient id="${id}-glow" cx="50%" cy="46%" r="55%"><stop offset="0" stop-color="${color}" stop-opacity="0.5"/><stop offset="0.55" stop-color="${color}" stop-opacity="0.1"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
    `</defs>`,
    `<rect width="${BADGE_SIZE}" height="${BADGE_SIZE}" rx="96" fill="${GROUND}"/>`,
    `<rect x="14" y="14" width="${BADGE_SIZE - 28}" height="${BADGE_SIZE - 28}" rx="84" fill="none" stroke="${color}" stroke-opacity="0.35" stroke-width="2"/>`,
    `<circle cx="256" cy="${n(MARK_CY)}" r="210" fill="url(#${id}-glow)"/>`,
  ].join("");
}

function caption(info: BadgeInfo): string {
  return [
    `<text x="256" y="424" text-anchor="middle" font-family="${SANS}" font-size="30" font-weight="600" fill="${INK}" letter-spacing="0.5">${esc(info.title)}</text>`,
    `<text x="256" y="458" text-anchor="middle" font-family="${MONO}" font-size="15" fill="${info.color}" letter-spacing="4">DULO · STOCKS SEASON</text>`,
  ].join("");
}

/** Deterministic pseudo-random in [0,1) from an integer seed (for particle layouts). */
function hash01(seed: number): number {
  let x = (seed * 374761393 + 668265263) | 0;
  x = (x ^ (x >>> 13)) * 1274126177;
  x = x ^ (x >>> 16);
  return ((x >>> 0) % 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// Motifs
// ---------------------------------------------------------------------------

function emberMotif(color: string): string {
  const parts: string[] = [];
  for (let i = 0; i < 26; i += 1) {
    const x = 96 + hash01(i * 3 + 1) * 320;
    const y = 70 + hash01(i * 3 + 2) * 280;
    const r = 1.5 + hash01(i * 3 + 3) * 4;
    const o = 0.25 + hash01(i * 7) * 0.6;
    parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${color}" fill-opacity="${n(o)}"/>`);
  }
  // Warm hearth under the mark.
  parts.push(`<ellipse cx="256" cy="${n(MARK_CY + 130)}" rx="150" ry="18" fill="${color}" fill-opacity="0.18"/>`);
  return parts.join("");
}

function iceMotif(color: string): string {
  const cy = MARK_CY;
  const facets = [
    `<polygon points="256,${n(cy - 190)} ${n(256 + 196)},${n(cy)} 256,${n(cy + 190)} ${n(256 - 196)},${n(cy)}" fill="${color}" fill-opacity="0.06" stroke="${color}" stroke-opacity="0.55" stroke-width="3"/>`,
    `<polygon points="256,${n(cy - 190)} ${n(256 + 196)},${n(cy)} ${n(256 - 196)},${n(cy)}" fill="none" stroke="${color}" stroke-opacity="0.25" stroke-width="1.5"/>`,
    `<line x1="256" y1="${n(cy - 190)}" x2="256" y2="${n(cy + 190)}" stroke="${color}" stroke-opacity="0.18" stroke-width="1.5"/>`,
    `<line x1="${n(256 - 196)}" y1="${n(cy)}" x2="${n(256 + 196)}" y2="${n(cy)}" stroke="${color}" stroke-opacity="0.18" stroke-width="1.5"/>`,
  ];
  const sparkles: string[] = [];
  const spots: Array<[number, number, number]> = [
    [92, 96, 9],
    [430, 120, 7],
    [110, 350, 6],
    [418, 332, 10],
    [256, 48, 6],
  ];
  for (const [x, y, s] of spots) {
    sparkles.push(
      `<path d="M${n(x)} ${n(y - s)}L${n(x + s * 0.28)} ${n(y - s * 0.28)}L${n(x + s)} ${n(y)}L${n(x + s * 0.28)} ${n(y + s * 0.28)}L${n(x)} ${n(y + s)}L${n(x - s * 0.28)} ${n(y + s * 0.28)}L${n(x - s)} ${n(y)}L${n(x - s * 0.28)} ${n(y - s * 0.28)}Z" fill="${color}" fill-opacity="0.85"/>`,
    );
  }
  return facets.join("") + sparkles.join("");
}

function goldMotif(color: string): string {
  const cy = MARK_CY;
  const parts = [
    `<circle cx="256" cy="${n(cy)}" r="186" fill="none" stroke="${color}" stroke-opacity="0.9" stroke-width="6"/>`,
    `<circle cx="256" cy="${n(cy)}" r="170" fill="none" stroke="${color}" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="6 10"/>`,
    `<circle cx="256" cy="${n(cy)}" r="150" fill="${color}" fill-opacity="0.05"/>`,
  ];
  // Twelve calendar ticks around the coin: the earnings date is a date on a ring.
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const r1 = 186;
    const r2 = i % 3 === 0 ? 200 : 194;
    const x1 = 256 + Math.cos(a) * r1;
    const y1 = cy + Math.sin(a) * r1;
    const x2 = 256 + Math.cos(a) * r2;
    const y2 = cy + Math.sin(a) * r2;
    parts.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${color}" stroke-opacity="0.8" stroke-width="${i % 3 === 0 ? 4 : 2}" stroke-linecap="round"/>`);
  }
  // A filled marker at "the date".
  const a = (2.5 / 12) * Math.PI * 2 - Math.PI / 2;
  parts.push(`<circle cx="${n(256 + Math.cos(a) * 186)}" cy="${n(cy + Math.sin(a) * 186)}" r="9" fill="${color}"/>`);
  return parts.join("");
}

function violetMotif(color: string): string {
  const lineY = MARK_Y + 54 * MARK_SCALE + 10; // just under the mark
  const paths = TAMGA_PATHS.map((d) => `<path d="${d}"/>`).join("");
  // Squashed reflection: y' = y0 - 1.2 * y, spanning lineY+6 .. lineY+60.
  const y0 = lineY + 6 + 54 * 1.2;
  return [
    `<line x1="72" y1="${n(lineY)}" x2="440" y2="${n(lineY)}" stroke="${color}" stroke-opacity="0.7" stroke-width="2"/>`,
    `<line x1="72" y1="${n(lineY)}" x2="440" y2="${n(lineY)}" stroke="${color}" stroke-opacity="0.25" stroke-width="10"/>`,
    `<g transform="translate(${MARK_X} ${n(y0)}) scale(${MARK_SCALE} -1.2)" fill="none" stroke="${color}" stroke-width="${TAMGA_STROKE}" stroke-linecap="square" stroke-linejoin="miter" opacity="0.3">${paths}</g>`,
    `<rect x="60" y="${n(lineY + 2)}" width="392" height="70" fill="${GROUND}" fill-opacity="0.35"/>`,
  ].join("");
}

function laurelMotif(color: string): string {
  const cy = MARK_CY;
  const parts: string[] = [];
  const r = 196;
  const leaves = 9;
  for (const side of [-1, 1]) {
    // From the bottom (100°) up to about 10° past horizontal, leaves alternate along the arc.
    for (let i = 0; i < leaves; i += 1) {
      const t = i / (leaves - 1);
      const a = Math.PI / 2 + side * (0.2 + t * 1.45); // 0.2 rad past bottom, sweeping up the side
      const x = 256 + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const deg = (a * 180) / Math.PI + 90 * side;
      const len = 26 - t * 6;
      parts.push(`<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(len / 2)}" ry="${n(len / 5)}" transform="rotate(${n(deg)} ${n(x)} ${n(y)})" fill="${color}" fill-opacity="${n(0.55 + t * 0.35)}"/>`);
    }
    const a0 = Math.PI / 2 + side * 0.2;
    const a1 = Math.PI / 2 + side * 1.65;
    const large = 0;
    const sweep = side > 0 ? 1 : 0;
    parts.push(
      `<path d="M${n(256 + Math.cos(a0) * r)} ${n(cy + Math.sin(a0) * r)}A${r} ${r} 0 ${large} ${sweep} ${n(256 + Math.cos(a1) * r)} ${n(cy + Math.sin(a1) * r)}" fill="none" stroke="${color}" stroke-opacity="0.6" stroke-width="3" stroke-linecap="round"/>`,
    );
  }
  // Bow at the bottom.
  parts.push(`<circle cx="256" cy="${n(cy + r)}" r="7" fill="${color}"/>`);
  return parts.join("");
}

const MOTIFS: Record<BadgeAccent, (color: string) => string> = {
  ember: emberMotif,
  ice: iceMotif,
  gold: goldMotif,
  violet: violetMotif,
  laurel: laurelMotif,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Render the SVG for a badge. Deterministic. */
export function renderBadgeSvg(info: BadgeInfo): string {
  const id = `b-${info.key}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BADGE_SIZE} ${BADGE_SIZE}" width="${BADGE_SIZE}" height="${BADGE_SIZE}" role="img" aria-labelledby="${id}-t ${id}-d">`,
    `<title id="${id}-t">${esc(info.name)}</title>`,
    `<desc id="${id}-d">${esc(info.description)}</desc>`,
    ground(info.color, id),
    MOTIFS[info.accent](info.color),
    tamga(info.color),
    caption(info),
    `</svg>`,
  ].join("");
}

/** Every design, pre-rendered once at module load. */
export const BADGE_SVGS: Readonly<Record<BadgeKey, string>> = Object.freeze(
  Object.fromEntries(BADGE_KEYS.map((key) => [key, renderBadgeSvg(BADGES[key])])) as Record<BadgeKey, string>,
);

export interface BadgeMeta extends BadgeInfo {
  svg: string;
}

/** Copy + artwork for a badge key; null for an unknown key. */
export function badgeMeta(key: string): BadgeMeta | null {
  if (!isBadgeKey(key)) return null;
  return { ...BADGES[key], svg: BADGE_SVGS[key] };
}

/**
 * The off-chain metadata document served at /api/v1/badges/[key]/metadata.json
 * (the `uri` on the Token-2022 mint). `appUrl` is the public origin, no trailing slash.
 */
export function badgeMetadataJson(key: BadgeKey, appUrl: string) {
  const info = BADGES[key];
  const base = appUrl.replace(/\/+$/, "");
  return {
    name: info.name,
    symbol: "DULO",
    description: info.description,
    image: `${base}/api/v1/badges/${key}/image.svg`,
    external_url: `${base}/quests`,
    attributes: [
      { trait_type: "Season", value: "Stocks Season" },
      { trait_type: "Badge", value: info.title },
      { trait_type: "Accent", value: info.accent },
      { trait_type: "Soulbound", value: "yes" },
    ],
    properties: {
      category: "image",
      files: [{ uri: `${base}/api/v1/badges/${key}/image.svg`, type: "image/svg+xml" }],
    },
  };
}
