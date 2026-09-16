import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Accessibility focus ring, mobile tab bar and the partners "Talk to us" button (C19).
 * No JSX in this file: components are rendered with createElement (see tests/brand.test.ts).
 */

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

import { MOBILE_TABS, NAV_ITEMS } from "@/components/layout/nav";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { NavLinks } from "@/components/layout/NavLinks";
import { Button, buttonVariants } from "@/components/ui/button";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "cn";
import { ListProjectSection, partnerContactHref } from "@/components/partners/PartnerCard";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SOLID_RING = ["focus-visible:ring-2", "focus-visible:ring-[var(--focus)]", "focus-visible:ring-offset-2", "focus-visible:ring-offset-background"];

afterEach(() => {
  vi.unstubAllEnvs();
  pathname.current = "/";
});

describe("focus token", () => {
  const css = read("src/app/globals.css");

  it("defines a solid --focus colour and points --ring at it", () => {
    expect(css).toMatch(/--focus:\s*#f0d9a4;/);
    expect(css).toMatch(/\.dark\s*\{[^}]*--ring:\s*var\(--focus\);/);
  });

  it("uses the token for the base-layer outline, with no alpha", () => {
    expect(css).not.toMatch(/outline-ring\/50/);
    expect(css).toMatch(/outline-color:\s*var\(--focus\);/);
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--focus\);\s*outline-offset:\s*2px;/);
  });

  it("has at least 3:1 non-text contrast against the page background", () => {
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (lum("#f0d9a4") + 0.05) / (lum("#0a0908") + 0.05);
    expect(ratio).toBeGreaterThan(14);
  });
});

describe("ui primitives focus ring", () => {
  it("no primitive keeps the translucent ring-ring/50", () => {
    const dir = path.join(ROOT, "src/components/ui");
    for (const file of readdirSync(dir)) {
      expect(readFileSync(path.join(dir, file), "utf8"), file).not.toMatch(/ring-ring\/50/);
    }
  });

  it.each(["src/components/ui/button.tsx", "src/components/ui/input.tsx", "src/components/ui/badge.tsx", "src/components/ui/tabs.tsx"])(
    "%s draws a solid, offset ring",
    (file) => {
      const src = read(file);
      for (const cls of SOLID_RING) expect(src).toContain(cls);
    },
  );

  it("every Button variant keeps the solid ring after tailwind-merge (destructive included)", () => {
    for (const variant of ["default", "outline", "secondary", "ghost", "destructive", "link"] as const) {
      const classes = cn(buttonVariants({ variant })).split(" ");
      for (const cls of SOLID_RING) expect(classes, variant).toContain(cls);
      expect(classes.some((c) => /^(dark:)?focus-visible:ring-(ring|destructive)\//.test(c)), variant).toBe(false);
    }
    const html = renderToStaticMarkup(createElement(Button, { variant: "destructive" }, "Delete"));
    expect(html).toContain("focus-visible:ring-[var(--focus)]");
  });

  it("the destructive Badge keeps the solid ring", () => {
    const classes = cn(badgeVariants({ variant: "destructive" })).split(" ");
    for (const cls of SOLID_RING) expect(classes).toContain(cls);
  });
});

describe("mobile tab bar", () => {
  it("has five tabs: the three games, the board and Profile", () => {
    expect(MOBILE_TABS.map((t) => t.href)).toEqual(["/predictions", "/competition", "/quests", "/leaderboard", "/profile"]);
    // Short labels: five tabs share a phone's width, so the full desktop names would be ellipsized.
    expect(MOBILE_TABS.map((t) => t.label)).toEqual(["Predict", "Compete", "Quests", "Board", "Profile"]);
    for (const tab of MOBILE_TABS) expect(tab.label.length, tab.label).toBeLessThanOrEqual(7);
    // "Predictions" is ellipsized at 375 px; the desktop nav keeps the full name.
    expect(NAV_ITEMS.find((n) => n.href === "/predictions")?.label).toBe("Predictions");
  });

  it("every tab except Profile is a section the desktop nav also has", () => {
    const desktop = new Set(NAV_ITEMS.map((n) => n.href));
    for (const tab of MOBILE_TABS) {
      if (tab.href === "/profile") continue;
      expect(desktop.has(tab.href), tab.href).toBe(true);
    }
  });

  it("Profile stays reachable from the signed-in account menu", () => {
    expect(read("src/components/wallet/ConnectButton.tsx")).toMatch(/<Link href="\/profile" \/>/);
  });

  it("marks Quests active on the Quests page and draws an inset focus ring on every tab", () => {
    pathname.current = "/quests";
    const html = renderToStaticMarkup(createElement(MobileTabBar));
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/quests"|<a[^>]*href="\/quests"[^>]*aria-current="page"/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html.match(/focus-visible:ring-inset/g)).toHaveLength(5);
    expect(html.match(/focus-visible:ring-\[var\(--focus\)\]/g)).toHaveLength(5);
    expect(html).toContain('href="/profile"');
  });

  it("shows under lg, where the desktop nav is hidden", () => {
    const src = read("src/components/layout/MobileTabBar.tsx");
    expect(src).toContain("lg:hidden");
    expect(src).not.toContain("md:hidden");
  });
});

describe("desktop nav links", () => {
  it("draw an inset solid focus ring, not the translucent one", () => {
    pathname.current = "/quests";
    const html = renderToStaticMarkup(createElement(NavLinks));
    expect(html.match(/focus-visible:ring-inset/g)).toHaveLength(NAV_ITEMS.length);
    expect(html.match(/focus-visible:ring-\[var\(--focus\)\]/g)).toHaveLength(NAV_ITEMS.length);
    expect(html).not.toContain("ring-ring/50");
  });

  it("keep every label on one line", () => {
    pathname.current = "/quests";
    const html = renderToStaticMarkup(createElement(NavLinks));
    expect(html.match(/whitespace-nowrap/g)).toHaveLength(NAV_ITEMS.length);
  });

  it("start at lg and never shrink, so the header row never wraps or scrolls sideways", () => {
    const src = read("src/components/layout/NavLinks.tsx");
    const nav = src.match(/<nav aria-label="Primary" className=\{cn\("([^"]+)"/);
    expect(nav).not.toBeNull();
    const cls = nav![1].split(" ");
    expect(cls).toContain("shrink-0");
    expect(cls).toContain("lg:flex");
    expect(cls).not.toContain("md:flex");
  });
});

describe("header layout", () => {
  const shell = read("src/components/layout/AppShell.tsx");

  it("drops the Season arc from the header", () => {
    expect(shell).not.toContain("<SeasonArcLive");
  });

  it("hides the Season chip at lg, where the nav needs the room, and brings it back at xl", () => {
    const chip = shell.match(/<SeasonChip className="([^"]+)"/);
    expect(chip).not.toBeNull();
    const cls = chip![1].split(" ");
    expect(cls).toContain("lg:hidden");
    expect(cls).toContain("xl:inline-flex");
  });

  it("clears the tab bar under the footer until lg", () => {
    expect(shell).toContain("pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0");
  });
});

describe("partners Talk to us", () => {
  it("accepts mailto: addresses and https: URLs, trimmed", () => {
    expect(partnerContactHref("mailto:partners@dulo.fun")).toBe("mailto:partners@dulo.fun");
    expect(partnerContactHref("  https://t.me/dulofun  ")).toBe("https://t.me/dulofun");
    expect(partnerContactHref("https://cal.com/dulo/partners?x=1")).toBe("https://cal.com/dulo/partners?x=1");
  });

  it("rejects everything else", () => {
    for (const bad of [undefined, null, "", "   ", "partners@dulo.fun", "mailto:", "mailto:nobody", "http://dulo.fun", "javascript:alert(1)", "https://", "ftp://dulo.fun", "not a url"]) {
      expect(partnerContactHref(bad), String(bad)).toBeNull();
    }
  });

  it("renders nothing when the contact is not set", () => {
    const html = renderToStaticMarkup(createElement(ListProjectSection, { contactHref: null }));
    expect(html).toContain("List your project");
    expect(html).not.toContain("Talk to us");
  });

  it("renders a mailto button in the same tab", () => {
    const html = renderToStaticMarkup(createElement(ListProjectSection, { contactHref: "mailto:partners@dulo.fun" }));
    expect(html).toContain('href="mailto:partners@dulo.fun"');
    expect(html).toContain("Talk to us");
    expect(html).not.toContain('target="_blank"');
    expect(html).toContain("focus-visible:ring-[var(--focus)]");
  });

  it("opens an https contact in a new tab without an opener", () => {
    const html = renderToStaticMarkup(createElement(ListProjectSection, { contactHref: "https://t.me/dulofun" }));
    expect(html).toContain('href="https://t.me/dulofun"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("reads NEXT_PUBLIC_PARTNER_CONTACT by default and ignores an unsafe value", () => {
    vi.stubEnv("NEXT_PUBLIC_PARTNER_CONTACT", "mailto:partners@dulo.fun");
    expect(renderToStaticMarkup(createElement(ListProjectSection))).toContain('href="mailto:partners@dulo.fun"');
    vi.stubEnv("NEXT_PUBLIC_PARTNER_CONTACT", "javascript:alert(1)");
    expect(renderToStaticMarkup(createElement(ListProjectSection))).not.toContain("Talk to us");
    vi.stubEnv("NEXT_PUBLIC_PARTNER_CONTACT", "");
    expect(renderToStaticMarkup(createElement(ListProjectSection))).not.toContain("Talk to us");
  });
});
