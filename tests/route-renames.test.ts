import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import nextConfig, { ROUTE_RENAMES } from "../next.config";
import { MOBILE_TABS, NAV_ITEMS } from "@/components/layout/nav";

// Page routes moved to plain names on 15 Sep 2026; Rewards became Quests and Paper trading became
// Competition on 16 Sep. Old links (shared URLs, SIWS resources, bookmarks) must land on the current
// page in one hop, and nothing in the app should still point at an old path.

const ROOT = path.resolve(__dirname, "..");

const MOVES = [
  { from: "/plays", to: "/quests", dir: "quests" },
  { from: "/rewards", to: "/quests", dir: "quests" },
  { from: "/league", to: "/competition", dir: "competition" },
  { from: "/paper-trading", to: "/competition", dir: "competition" },
  { from: "/calls", to: "/predictions", dir: "predictions" },
  { from: "/mirror", to: "/copy", dir: "copy" },
];

describe("route renames", () => {
  it("permanently redirects each old path and its subpaths to the new one", async () => {
    const rules = await nextConfig.redirects!();
    for (const { from, to } of MOVES) {
      expect(rules, from).toContainEqual({ source: from, destination: to, permanent: true });
      expect(rules, `${from}/:path*`).toContainEqual({ source: `${from}/:path*`, destination: `${to}/:path*`, permanent: true });
    }
    expect(rules).toHaveLength(MOVES.length * 2);
    expect(ROUTE_RENAMES.map((r) => r.from)).toEqual(MOVES.map((m) => m.from));
  });

  it("never chains redirects: no destination is also a source", async () => {
    const rules = await nextConfig.redirects!();
    const sources = new Set(rules.map((r) => r.source));
    for (const rule of rules) expect(sources.has(rule.destination), `${rule.source} -> ${rule.destination}`).toBe(false);
    const froms = new Set(ROUTE_RENAMES.map((r) => r.from));
    for (const { to } of ROUTE_RENAMES) expect(froms.has(to), to).toBe(false);
  });

  it("never redirects an API route", async () => {
    const rules = await nextConfig.redirects!();
    for (const rule of rules) expect(rule.source.startsWith("/api")).toBe(false);
  });

  it("serves the pages at the new folders and not the old ones", () => {
    for (const { from, dir } of MOVES) {
      expect(existsSync(path.join(ROOT, "src/app", dir, "page.tsx")), dir).toBe(true);
      expect(existsSync(path.join(ROOT, "src/app", from.slice(1))), from).toBe(false);
    }
    expect(existsSync(path.join(ROOT, "src/app/copy/[wallet]/page.tsx"))).toBe(true);
  });

  it("nav links point at the new paths", () => {
    const old = new Set(MOVES.map((m) => m.from));
    for (const item of [...NAV_ITEMS, ...MOBILE_TABS]) expect(old.has(item.href), item.href).toBe(false);
  });
});
