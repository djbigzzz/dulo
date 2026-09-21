import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Repo hygiene a judge (or a fresh clone, or Vercel) sees first: docs/REVIEW-2026-09-14.md
// M1, M14, L2, L15 and H6's LICENSE, plus the C13 build/deploy hardening (WIN-PLAN §6):
// headers, APP_URL guard, error pages, robots, the /api/v1 404 envelope, partner 404s and the OG card.

const routeMocks = vi.hoisted(() => ({
  getPartner: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/server/queries", () => ({ getPartner: routeMocks.getPartner }));
vi.mock("next/navigation", () => ({ notFound: routeMocks.notFound }));
vi.mock("@/components/partners/PartnerView", () => ({ PartnerView: () => null }));
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(
      public element: unknown,
      public options: Record<string, unknown>,
    ) {}
  },
}));

type FakeImageResponse = { element: unknown; options: Record<string, unknown> };

import nextConfig, { SECURITY_HEADERS, productionAppUrlProblem } from "../next.config";
import { isLocalAppUrl, resolveAppUrl } from "@/lib/config";
import GlobalError from "@/app/global-error";
import robots from "@/app/robots";
import * as apiFallback from "@/app/api/v1/[...slug]/route";
import PartnerPage, { generateMetadata as generatePartnerMetadata } from "@/app/partners/[slug]/page";
import OpenGraphImage, { alt as ogAlt, contentType as ogContentType, size as ogSize } from "@/app/opengraph-image";
import * as twitterImage from "@/app/twitter-image";
import { TAMGA_PATHS } from "@/components/brand/Tamga";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const lines = (rel: string) => read(rel).split(/\r?\n/);

describe("vercel.json", () => {
  /**
   * The deployment is on Hobby, which refuses any cron that runs more than once a day, so Vercel
   * keeps a single daily tick and .github/workflows/tick.yml carries the 5-minute cadence.
   *
   * 20:10 UTC is not arbitrary: Friday's markets settle at 20:05 UTC, so the daily run lands five
   * minutes after that, inside the void window, and settles the week even if the pinger is down.
   */
  it("keeps one daily tick that lands just after the Friday settle (Hobby: the Actions pinger runs every 5 min)", () => {
    const cfg = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(cfg.crons).toEqual([{ path: "/api/cron/tick", schedule: "10 20 * * *" }]);
  });

  it("pins functions to iad1, next to the us-east-1 Supabase", () => {
    const cfg = JSON.parse(read("vercel.json")) as { regions?: string[] };
    expect(cfg.regions).toEqual(["iad1"]);
  });
});

describe("next.config.ts", () => {
  it("drops X-Powered-By, keeps the dev indicator off, and sends the security headers on every path", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(nextConfig.devIndicators).toBe(false);
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    const byKey = Object.fromEntries(rules[0].headers.map((h) => [h.key.toLowerCase(), h.value]));
    expect(byKey).toEqual({
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    });
    // Nothing that would clobber the badge image/metadata routes' own CORS or cache headers.
    expect(Object.keys(byKey).some((k) => k.startsWith("access-control-") || k === "cache-control")).toBe(false);
    expect(SECURITY_HEADERS).toBe(rules[0].headers);
  });

  it("refuses a Vercel production build without a public NEXT_PUBLIC_APP_URL, and only there", () => {
    expect(productionAppUrlProblem({ VERCEL_ENV: "production" })).toMatch(/missing/);
    expect(productionAppUrlProblem({ VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "  " })).toMatch(/missing/);
    expect(productionAppUrlProblem({ VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toMatch(/localhost/);
    expect(productionAppUrlProblem({ VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000" })).toMatch(/localhost/);
    expect(productionAppUrlProblem({ VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "dulo.fun" })).toMatch(/not a URL/);
    expect(productionAppUrlProblem({ VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "https://dulo.fun" })).toBeNull();
    expect(productionAppUrlProblem({ VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "https://dulo.vercel.app" })).toBeNull();
    // Preview deploys, CI (no VERCEL_ENV) and local builds are not blocked.
    expect(productionAppUrlProblem({ VERCEL_ENV: "preview" })).toBeNull();
    expect(productionAppUrlProblem({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toBeNull();
  });
});

describe("lib/config APP_URL", () => {
  it("prefers NEXT_PUBLIC_APP_URL, then https://VERCEL_PROJECT_PRODUCTION_URL, then localhost", () => {
    expect(resolveAppUrl({ NEXT_PUBLIC_APP_URL: "https://dulo.fun/", VERCEL_PROJECT_PRODUCTION_URL: "dulo.vercel.app" })).toBe("https://dulo.fun");
    expect(resolveAppUrl({ NEXT_PUBLIC_APP_URL: "", VERCEL_PROJECT_PRODUCTION_URL: "dulo.vercel.app" })).toBe("https://dulo.vercel.app");
    expect(resolveAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: "https://dulo.vercel.app/" })).toBe("https://dulo.vercel.app");
    expect(resolveAppUrl({})).toBe("http://localhost:3000");
  });

  it("recognises local origins", () => {
    for (const u of ["http://localhost:3000", "http://app.localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", "http://0.0.0.0", "nope"]) {
      expect(isLocalAppUrl(u), u).toBe(true);
    }
    for (const u of ["https://dulo.fun", "https://dulo.vercel.app", "https://localhostess.com"]) expect(isLocalAppUrl(u), u).toBe(false);
  });
});

describe("root layout metadata", () => {
  // Source assertions: importing layout.tsx needs next/font and globals.css, which only exist inside Next.
  it("uses a large Twitter card, per-route canonical and og:url, and no duplicate mobile-web-app-capable", () => {
    const layout = read("src/app/layout.tsx");
    const metadata = layout.slice(layout.indexOf("export const metadata"), layout.indexOf("export const viewport"));
    expect(metadata).toMatch(/twitter: \{\s*card: "summary_large_image"/);
    expect(metadata).toContain('alternates: { canonical: "./" }');
    expect(metadata).toMatch(/openGraph: \{[\s\S]*url: "\.\/",[\s\S]*\}/);
    // Next 15 prints mobile-web-app-capable from appleWebApp.capable; a manual `other` entry doubled it.
    expect(metadata).toContain("capable: true");
    expect(metadata).not.toMatch(/^\s*other: \{/m);
    expect(metadata).not.toMatch(/"mobile-web-app-capable": "yes"/);
    expect(layout).toContain('const THEME_COLOR = "#0a0908"');
  });
});

describe("error pages and robots", () => {
  it("ships a branded not-found, a client error boundary with reset, and a global-error that owns <html>", () => {
    const notFound = read("src/app/not-found.tsx");
    expect(notFound).toContain('tone="gradient"');
    expect(notFound).toContain("font-display");
    const error = read("src/app/error.tsx");
    expect(error.startsWith('"use client";')).toBe(true);
    expect(error).toMatch(/onClick=\{\(\) => reset\(\)\}/);
    const globalError = read("src/app/global-error.tsx");
    expect(globalError.startsWith('"use client";')).toBe(true);
    expect(globalError).toContain("<html");
  });

  it("global-error renders standalone on obsidian with a retry", () => {
    const html = renderToStaticMarkup(createElement(GlobalError, { error: Object.assign(new Error("x"), { digest: "d1" }), reset: () => undefined }));
    expect(html).toMatch(/^<html lang="en"/);
    expect(html).toContain("#0a0908");
    expect(html).toContain("Try again");
    expect(html).toContain("Ref d1");
    for (const d of TAMGA_PATHS) expect(html).toContain(`d="${d}"`);
  });

  it("robots.txt allows pages and keeps cron, auth and the offline shell out", () => {
    expect(robots()).toEqual({ rules: [{ userAgent: "*", allow: "/", disallow: ["/api/cron/", "/api/v1/auth/", "/offline"] }] });
  });
});

describe("/api/v1 catch-all", () => {
  it("answers every method with the 404 envelope", async () => {
    const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
    for (const m of methods) {
      const fn = apiFallback[m];
      expect(typeof fn, m).toBe("function");
      const res = await fn();
      expect(res.status, m).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: false, error: "Not found" });
    }
  });
});

describe("partners/[slug] page", () => {
  const props = (slug: string) => ({ params: Promise.resolve({ slug }) });

  beforeEach(() => {
    routeMocks.getPartner.mockReset();
    routeMocks.notFound.mockReset();
    routeMocks.notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("404s an unknown slug and renders the client view for a known one", async () => {
    routeMocks.getPartner.mockResolvedValue(null);
    await expect(PartnerPage(props("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await generatePartnerMetadata(props("nope"))).toEqual({ title: "Partner not found", robots: { index: false } });

    routeMocks.getPartner.mockResolvedValue({ partner: { name: "xStocks", blurb: "Tokenized stocks." } });
    const el = (await PartnerPage(props("xstocks"))) as { props: { slug: string } };
    expect(el.props.slug).toBe("xstocks");
    expect(await generatePartnerMetadata(props("xstocks"))).toEqual({ title: "xStocks", description: "Tokenized stocks." });
  });

  it("a DB error degrades (slug title, client view) instead of a 404 or a crash", async () => {
    routeMocks.getPartner.mockRejectedValue(new Error("db down"));
    const el = (await PartnerPage(props("stocklana-builder-1"))) as { props: { slug: string } };
    expect(el.props.slug).toBe("stocklana-builder-1");
    expect(routeMocks.notFound).not.toHaveBeenCalled();
    expect(await generatePartnerMetadata(props("stocklana-builder-1"))).toEqual({ title: "Stocklana Builder 1" });
  });

  it("gives up on a lookup slower than 1.5 s", async () => {
    vi.useFakeTimers();
    routeMocks.getPartner.mockReturnValue(new Promise(() => undefined));
    const meta = generatePartnerMetadata(props("kamino"));
    const page = PartnerPage(props("kamino"));
    await vi.advanceTimersByTimeAsync(1_499);
    let settled = false;
    void meta.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await meta).toEqual({ title: "Kamino" });
    expect(((await page) as { props: { slug: string } }).props.slug).toBe("kamino");
    expect(routeMocks.notFound).not.toHaveBeenCalled();
  });
});

describe("opengraph-image / twitter-image", () => {
  const CSS = "@font-face { font-family: 'X'; src: url(https://fonts.gstatic.com/l/font?kit=abc) format('truetype'); }";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function texts(node: unknown): string[] {
    if (typeof node === "string") return [node];
    if (Array.isArray(node)) return node.flatMap(texts);
    if (node && typeof node === "object" && "props" in node) return texts((node as { props: { children?: unknown } }).props.children);
    return [];
  }

  it("renders 1200x630 on obsidian with the tamga, serif Dulo and the positioning line, fonts from Google as ArrayBuffers", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return url.startsWith("https://fonts.googleapis.com/") ? new Response(CSS) : new Response(new Uint8Array([0, 1, 0, 0]));
      }),
    );
    const img = (await OpenGraphImage()) as unknown as FakeImageResponse;
    expect(ogSize).toEqual({ width: 1200, height: 630 });
    expect(ogContentType).toBe("image/png");
    expect(img.options).toMatchObject({ width: 1200, height: 630 });
    const fonts = img.options.fonts as { name: string; weight: number; data: ArrayBuffer }[];
    expect(fonts.map((f) => [f.name, f.weight])).toEqual([
      ["Geist", 500],
      ["Geist", 600],
      ["Instrument Serif", 400],
    ]);
    for (const f of fonts) expect(f.data).toBeInstanceOf(ArrayBuffer);
    expect(urls.some((u) => u.includes("family=Instrument+Serif:wght@400&text="))).toBe(true);

    const root = img.element as { props: { style: Record<string, string> } };
    expect(root.props.style.backgroundColor).toBe("#0a0908");
    expect(root.props.style.backgroundImage).toMatch(/radial-gradient\(.*rgba\(255,106,42/);
    const all = texts(img.element);
    expect(all).toContain("Dulo");
    expect(all).toContain("The entertainment layer for xStocks.");
    const svg = JSON.stringify(img.element);
    for (const d of TAMGA_PATHS) expect(svg).toContain(d);
    expect(svg).toContain('"fontFamily":"Instrument Serif"');
  });

  it("falls back to the bundled sans (no custom fonts) when Google Fonts is unreachable, never throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const img = (await OpenGraphImage()) as unknown as FakeImageResponse;
    expect(img.options.fonts).toBeUndefined();
    expect(texts(img.element)).toContain("Dulo");
    expect(JSON.stringify(img.element)).not.toContain("Instrument Serif");
  });

  it("twitter-image is the same card with the same size and alt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(twitterImage.size).toEqual(ogSize);
    expect(twitterImage.alt).toBe(ogAlt);
    expect(twitterImage.contentType).toBe("image/png");
    const img = (await twitterImage.default()) as unknown as FakeImageResponse;
    expect(texts(img.element)).toContain("The entertainment layer for xStocks.");
  });
});

describe("package.json", () => {
  const pkg = JSON.parse(read("package.json")) as {
    license?: string;
    engines?: { node?: string };
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it("declares MIT and Node >= 20", () => {
    expect(pkg.license).toBe("MIT");
    expect(pkg.engines?.node).toBe(">=20");
  });

  it("declares @solana/spl-token-metadata (imported by lib/badges/mint) at the installed 0.1.x", () => {
    expect(pkg.dependencies["@solana/spl-token-metadata"]).toBe("^0.1.6");
    const installed = JSON.parse(read("node_modules/@solana/spl-token-metadata/package.json")) as { version: string };
    expect(installed.version.startsWith("0.1.")).toBe(true);
  });

  it("keeps the shadcn CLI out of runtime dependencies", () => {
    expect(pkg.dependencies.shadcn).toBeUndefined();
    expect(pkg.devDependencies.shadcn).toBeDefined();
  });
});

describe("LICENSE", () => {
  it("is MIT, 2026, The Dulo contributors", () => {
    const text = read("LICENSE");
    expect(text.startsWith("MIT License")).toBe(true);
    expect(text).toContain("Copyright (c) 2026 The Dulo contributors");
    expect(text).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });
});

describe(".gitignore and .env.example", () => {
  it("ignores every .env* file except the template, with the exception directly after the rule", () => {
    const ls = lines(".gitignore").map((l) => l.trim());
    const rule = ls.indexOf(".env*");
    const allow = ls.indexOf("!.env.example");
    expect(rule).toBeGreaterThanOrEqual(0);
    expect(allow).toBeGreaterThan(rule);
    // No later rule may re-ignore it (a bare `.env` pattern does not match `.env.example`, but `.env*` would).
    expect(ls.slice(allow + 1)).not.toContain(".env*");
    expect(ls.slice(allow + 1)).not.toContain(".env.example");
    // The redundant duplicate block is gone.
    expect(ls.filter((l) => l === ".env" || l === ".env.local")).toEqual([]);
  });

  it("covers every key lib/server/env.ts reads plus NEXT_PUBLIC_APP_NAME", () => {
    const schema = read("src/lib/server/env.ts");
    // `z\s*\.` also matches a chained schema that starts on the next line (`CRON_SECRET: z\n .string()...`).
    const keys = [...schema.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*z\s*\./gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(12);
    const example = read(".env.example");
    for (const key of [...keys, "NEXT_PUBLIC_APP_NAME"]) {
      expect(example, `${key} missing from .env.example`).toMatch(new RegExp(`^${key}=`, "m"));
    }
  });

  it("ships working placeholders: a real public RPC, a CRON_SECRET the schema accepts, and the deploy notes", () => {
    const example = read(".env.example");
    const value = (key: string) => /^\s*"?(.*?)"?\s*(#.*)?$/.exec(example.match(new RegExp(`^${key}=(.*)$`, "m"))![1])![1];
    expect(value("NEXT_PUBLIC_RPC")).toBe("https://api.mainnet-beta.solana.com");
    expect(value("CRON_SECRET").length).toBeGreaterThanOrEqual(16);
    expect(example).toMatch(/DATABASE_URL[\s\S]*6543[\s\S]*pgbouncer=true/);
    expect(example).toMatch(/DIRECT_URL[\s\S]*5432/i);
    expect(example).toMatch(/PYTH_API_KEY=.*optional/i);
    expect(example).toContain("https://pythdata.app/signup");
    expect(example).toMatch(/SERVER_WALLET_SECRET=.*0\.3 SOL/);
  });

  it("documents the optional env-gated public links (footer GitHub/X/video, partners Talk to us), empty by default", () => {
    const example = read(".env.example");
    for (const key of ["NEXT_PUBLIC_GITHUB_URL", "NEXT_PUBLIC_X_URL", "NEXT_PUBLIC_VIDEO_URL", "NEXT_PUBLIC_PARTNER_CONTACT"]) {
      expect(example, `${key} missing from .env.example`).toMatch(new RegExp(`^${key}=""`, "m"));
    }
    expect(example).toMatch(/NEXT_PUBLIC_PARTNER_CONTACT=.*mailto:/);
  });
});

describe("GitHub Actions", () => {
  it("ci.yml runs lint, typecheck (after next typegen), tests and the build on Node 24 with a dummy env", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("node-version: 24");
    // npm ci, not npm install, so a lockfile that disagrees with package.json fails the build
    // instead of being silently reconciled. The step wraps it to copy npm's error into the job
    // summary on failure, so the exact formatting is not pinned.
    expect(ci).toMatch(/\bnpm ci\b/);
    expect(ci).toContain("run: npm run lint");
    expect(ci).toMatch(/npx next typegen \|\|/);
    expect(ci).toContain("run: npm run typecheck");
    expect(ci).toContain("run: npm test");
    // C13: the build runs last, under the same job env (so the dummy secrets apply to it too).
    expect(ci).toContain("run: npm run build");
    expect(ci.indexOf("run: npm run build")).toBeGreaterThan(ci.indexOf("run: npm test"));
    // VERCEL_ENV stays unset in CI so next.config's production APP_URL guard does not fire on the dummy localhost URL.
    expect(ci).not.toMatch(/^\s*VERCEL_ENV:/m);
    expect(ci).toMatch(/JWT_SECRET: .{32,}/);
    expect(ci).toMatch(/CRON_SECRET: .{16,}/);
    expect(ci).toMatch(/DATABASE_URL: postgresql:\/\//);
  });

  it("tick.yml is the Hobby fallback: every 5 minutes, Bearer header, all steps ok, inert until enabled in repo settings", () => {
    const tick = read(".github/workflows/tick.yml");
    expect(tick).toContain('cron: "*/5 * * * *"');
    expect(tick).toContain("workflow_dispatch");
    expect(tick).toContain('-H "Authorization: Bearer $CRON_SECRET"');
    expect(tick).toContain('"$APP_URL/api/cron/tick"');
    expect(tick).toContain("jq -e '.data.steps | all(.ok)'");
    expect(tick).toContain("if: ${{ vars.TICK_PINGER_ENABLED == 'true' }}");
    expect(tick).not.toMatch(/secret=/);
    expect(tick.toLowerCase()).toContain("hobby fallback");
    expect(tick.toLowerCase()).toContain("disabled unless enabled");
  });
});

describe("tracked template", () => {
  it(".env.example exists on disk (the README's cp step depends on it)", () => {
    expect(existsSync(path.join(ROOT, ".env.example"))).toBe(true);
  });
});
