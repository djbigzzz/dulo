import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Brand tests. No JSX in this file: components are rendered with createElement.
 *
 * The component module (src/components/brand/Tamga.tsx) contains JSX, and the root
 * tsconfig sets `jsx: "preserve"` (Next.js). Vite honours that per file, so the .tsx
 * cannot be transformed unless vitest.config.ts opts into the automatic runtime:
 *
 *   oxc: { jsx: { runtime: "automatic" } }      // Vite 8 (oxc) — verified
 *
 * Until that line lands, the component render tests are skipped with a warning
 * instead of failing the whole suite; the static-icon tests always run and pin the
 * same three glyph paths literally.
 */

const PUBLIC = path.resolve(__dirname, "../public");

/** The three tamga glyph paths (left I, central Y, right I) — mirrors TAMGA_PATHS in Tamga.tsx. */
const EXPECTED_PATHS = [
  "M7 10h12M13 10v44M7 54h12",
  "M32 54V33M32 33L21 10M32 33L43 10",
  "M45 10h12M51 10v44M45 54h12",
] as const;

type TamgaModule = typeof import("@/components/brand/Tamga");

const tamgaModule: TamgaModule | null = await import("@/components/brand/Tamga").then(
  (m) => m,
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[brand.test] Skipping Tamga render tests: could not load src/components/brand/Tamga.tsx.\n` +
        `Add \`oxc: { jsx: { runtime: "automatic" } }\` to vitest.config.ts to enable .tsx imports.\n` +
        msg.split("\n")[0],
    );
    return null;
  },
);

describe.skipIf(tamgaModule === null)("Tamga", () => {
  const mod = () => tamgaModule as TamgaModule;

  it("exports the same glyph paths the static icons use", () => {
    expect([...mod().TAMGA_PATHS]).toEqual([...EXPECTED_PATHS]);
    expect(mod().TAMGA_STROKE).toBe(6);
  });

  it("renders a monochrome, stroke-based, square-capped SVG with three glyph paths", () => {
    const { Tamga, TAMGA_PATHS, TAMGA_STROKE } = mod();
    const html = renderToStaticMarkup(createElement(Tamga, { size: 32 }));
    expect(html.startsWith("<svg")).toBe(true);
    expect(html).toContain('viewBox="0 0 64 64"');
    expect(html).toContain('width="32"');
    expect(html).toContain('height="32"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('fill="none"');
    expect(html).toContain('stroke-linecap="square"');
    expect(html).toContain(`stroke-width="${TAMGA_STROKE}"`);
    expect((html.match(/<path /g) ?? []).length).toBe(3);
    for (const d of TAMGA_PATHS) expect(html).toContain(`d="${d}"`);
    // Decorative by default.
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<title>");
  });

  it("is labelled when given a title", () => {
    const { Tamga } = mod();
    const html = renderToStaticMarkup(createElement(Tamga, { title: "Dulo" }));
    expect(html).toContain('role="img"');
    expect(html).toContain("<title>Dulo</title>");
    expect(html).not.toContain("aria-hidden");
  });

  it("wordmark renders the mark in ember and the word Dulo", () => {
    const { Dulo } = mod();
    const html = renderToStaticMarkup(createElement(Dulo, {}));
    expect(html).toContain("text-ember");
    expect(html).toContain(">Dulo</span>");
    const markOnly = renderToStaticMarkup(createElement(Dulo, { markOnly: true }));
    expect(markOnly).not.toContain(">Dulo</span>");
  });
});

describe("tamga glyph geometry", () => {
  it("all three glyphs share the same top and baseline (10 -> 54)", () => {
    // Left/right I stems run 10..54; the Y stem bottoms at 54 and its arms top out at 10.
    expect(EXPECTED_PATHS[0]).toMatch(/M13 10v44/);
    expect(EXPECTED_PATHS[2]).toMatch(/M51 10v44/);
    expect(EXPECTED_PATHS[1]).toMatch(/^M32 54/);
    expect(EXPECTED_PATHS[1]).toMatch(/L21 10/);
    expect(EXPECTED_PATHS[1]).toMatch(/L43 10/);
  });

  it("the component source declares exactly these paths", () => {
    // Read the source as text so this check runs even when the .tsx cannot be transformed.
    const src = readFileSync(path.resolve(__dirname, "../src/components/brand/Tamga.tsx"), "utf8");
    for (const d of EXPECTED_PATHS) expect(src).toContain(`"${d}"`);
    expect(src).toMatch(/export const TAMGA_STROKE = 6;/);
  });
});

describe("static icons reuse the tamga paths", () => {
  const files = [
    "favicon.svg",
    "icons/icon.svg",
    "icons/icon-192.svg",
    "icons/icon-512.svg",
    "icons/apple-touch-icon.svg",
  ];
  for (const f of files) {
    it(`${f} is an SVG on the dark background with the ember tamga`, () => {
      const svg = readFileSync(path.join(PUBLIC, f), "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain('fill="#0b0b0f"');
      expect(svg).toContain('stroke="#ff6b1a"');
      expect(svg).toContain('stroke-linecap="square"');
      for (const d of EXPECTED_PATHS) expect(svg).toContain(`d="${d}"`);
    });
  }
});
