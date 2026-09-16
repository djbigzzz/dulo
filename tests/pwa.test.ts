import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import manifest from "@/app/manifest";
import OfflinePage, { metadata as offlineMetadata } from "@/app/offline/page";
import { TAMGA_PATHS } from "@/components/brand/Tamga";
import { POSITIONING } from "@/lib/config";

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

describe("manifest.webmanifest", () => {
  const m = manifest();

  it("has the Dulo identity and standalone PWA fields", () => {
    expect(m.name).toBe("Dulo");
    expect(m.short_name).toBe("Dulo");
    expect(m.description).toBe(POSITIONING);
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.background_color).toBe("#0a0908");
    expect(m.theme_color).toBe("#0a0908");
  });

  it("points every icon at an existing file in public/", () => {
    expect(m.icons?.length).toBeGreaterThanOrEqual(2);
    for (const icon of m.icons ?? []) {
      expect(["image/svg+xml", "image/png"]).toContain(icon.type);
      expect(icon.src.startsWith("/")).toBe(true);
      expect(existsSync(path.join(PUBLIC, icon.src))).toBe(true);
    }
    expect(m.icons?.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("ships PNG launcher icons (iOS and older launchers ignore SVG), 512 also maskable", () => {
    const pngs = (m.icons ?? []).filter((i) => i.type === "image/png");
    expect(pngs.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    // Next types `purpose` as a single value, so 512 is listed once per purpose.
    const big512 = pngs.filter((i) => i.sizes === "512x512").map((i) => i.purpose);
    expect(big512).toEqual(expect.arrayContaining(["any", "maskable"]));
    // Every PNG really is a PNG (signature check), not an SVG with the wrong extension.
    for (const icon of pngs) {
      const head = readFileSync(path.join(PUBLIC, icon.src)).subarray(0, 8);
      expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });
});

describe("manifest colours", () => {
  it("match the obsidian ground and the layout's theme-color", () => {
    const layout = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
    const theme = layout.match(/const THEME_COLOR = "(#[0-9a-f]{6})"/i)?.[1];
    expect(theme).toBe("#0a0908");
    expect(manifest().theme_color).toBe(theme);
    expect(manifest().background_color).toBe(theme);
  });
});

describe("/offline page", () => {
  it("is on the design system: gold-gradient tamga, serif title, one ember full-navigation retry, inline fallbacks", () => {
    const html = renderToStaticMarkup(createElement(OfflinePage));
    // Tamga tone="gradient": the gold stops live inside the SVG, so they render without any stylesheet.
    expect(html).toContain('stop-color="#f0d9a4"');
    expect(html).toContain('stop-color="#d8b46a"');
    for (const d of TAMGA_PATHS) expect(html).toContain(`d="${d}"`);
    expect(html).toMatch(/<h1 class="font-display[^"]*"[^>]*font-family:var\(--font-instrument-serif\)[^>]*>You are /);
    expect(html).toContain("offline</span>");
    // A real <a href="/"> so the service worker can serve the retry; exactly one link/button.
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toMatch(/<a href="\/"[^>]*>Try again<\/a>/);
    expect(offlineMetadata.robots).toEqual({ index: false });
  });
});

describe("apple touch icon", () => {
  it("is a real 180x180 PNG (iOS ignores SVG touch icons)", () => {
    const buf = readFileSync(path.join(PUBLIC, "icons/apple-touch-icon.png"));
    expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR: width at bytes 16..20, height at 20..24, big-endian.
    expect(buf.readUInt32BE(16)).toBe(180);
    expect(buf.readUInt32BE(20)).toBe(180);
    // Colour type byte 25: 2 = RGB, 3 = palette. Never 6 (RGBA): iOS wants no transparency.
    expect([2, 3]).toContain(buf[25]);
  });
});

describe("public/sw.js", () => {
  const sw = readFileSync(path.join(PUBLIC, "sw.js"), "utf8");

  it("handles install, activate and fetch", () => {
    for (const evt of ["install", "activate", "fetch"]) {
      expect(sw).toContain(`addEventListener("${evt}"`);
    }
  });

  it("precaches the offline page and icons, and only those routes are cache-first", () => {
    expect(sw).toContain('"/offline"');
    expect(sw).toContain('"/icons/icon-192.svg"');
    expect(sw).toContain('"/icons/apple-touch-icon.png"');
    expect(sw).not.toContain('"/icons/apple-touch-icon.svg"');
    expect(sw).toMatch(/pathname\.startsWith\("\/icons\/"\)/);
  });

  it("never caches API responses, even when they arrive as navigations", () => {
    // Prices and balances must be live: /api/* bails out before the navigate branch.
    const fetchHandler = sw.slice(sw.indexOf('addEventListener("fetch"'));
    const apiGuard = fetchHandler.indexOf('url.pathname.startsWith("/api/")');
    const navigateBranch = fetchHandler.indexOf('request.mode === "navigate"');
    expect(apiGuard).toBeGreaterThan(-1);
    expect(navigateBranch).toBeGreaterThan(-1);
    expect(apiGuard).toBeLessThan(navigateBranch);
    expect(fetchHandler.slice(apiGuard, apiGuard + 60)).toMatch(/startsWith\("\/api\/"\)\) return;/);
    // The precache list must not pull anything from /api.
    const list = sw.match(/const PRECACHE = \[([\s\S]*?)\];/)?.[1] ?? "";
    expect(list).not.toMatch(/\/api\//);
  });

  it("uses network-first for navigations with an offline fallback", () => {
    expect(sw).toMatch(/request\.mode === "navigate"/);
    expect(sw).toContain("networkFirstNavigation");
    expect(sw).toMatch(/cache\.match\(OFFLINE_URL\)/);
  });

  it("every precached path exists (offline is a Next route, the rest are files)", () => {
    const list = sw.match(/const PRECACHE = \[([\s\S]*?)\];/)?.[1] ?? "";
    const urls = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(urls).toContain("/offline");
    for (const u of urls.filter((u) => u !== "/offline")) {
      expect(existsSync(path.join(PUBLIC, u))).toBe(true);
    }
    expect(existsSync(path.join(ROOT, "src/app/offline/page.tsx"))).toBe(true);
  });
});

describe("no leftover create-next-app assets", () => {
  it("removed the sample SVGs and the ICO favicon", () => {
    for (const f of ["file.svg", "globe.svg", "next.svg", "vercel.svg", "window.svg"]) {
      expect(existsSync(path.join(PUBLIC, f))).toBe(false);
    }
    expect(existsSync(path.join(ROOT, "src/app/favicon.ico"))).toBe(false);
    expect(existsSync(path.join(PUBLIC, "favicon.svg"))).toBe(true);
  });
});
