import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Broadcast week track (9 Oct 2026): one Monday-to-Friday band under the header on every page,
 * built from the shell's two shared reads. No JSX in this file (see tests/brand.test.ts).
 *
 * Pinned: positions on the track, the predictions lock and the competition close come from the
 * data (never a hard-coded hour), the weekend replays the closed week, each page counts to the
 * clock it does not already show large, the first frame never shifts the layout, and the track
 * adds no request to a page that already reads /league or /calls.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import {
  DAY_MS,
  WEEKDAYS_SHARE,
  formatTrackClock,
  mondayUtc,
  readoutFocusFor,
  spokenTrackClock,
  trackX,
  utcDayTime,
  weekLabels,
  weekReadout,
  weekTrackLabel,
  weekTrackModel,
} from "@/components/layout/week-track";
import { WeekTrack } from "@/components/layout/WeekTrack";
import { readWithRetry } from "@/components/layout/WeekData";
import { ApiClientError } from "@/lib/api-client";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// The 8 Oct 2026 13:58 UTC snapshot the Broadcast mockups were drawn from (calls.json, league.json).
const NOW = Date.parse("2026-10-08T13:58:15Z");
const SEASON = { id: "season-0", name: "Stocks Season", chainScope: [], startsAt: "2026-09-14T00:00:00.000Z", endsAt: "2026-12-31T23:59:59.000Z", phase: "active" as const };
const THIS_WEEK = { weekStart: "2026-10-05T00:00:00.000Z", weekEnd: "2026-10-09T20:00:00.000Z", opensIn: null };
const market = (locksAt: string, settleAt: string) => ({ locksAt, settleAt });
const MARKETS = [
  // Last week's three, settled Fri 2 Oct.
  market("2026-10-01T20:00:00.000Z", "2026-10-02T20:05:00.000Z"),
  market("2026-10-01T20:00:00.000Z", "2026-10-02T20:05:00.000Z"),
  // This week's three.
  market("2026-10-08T20:00:00.000Z", "2026-10-09T20:05:00.000Z"),
  market("2026-10-08T20:00:00.000Z", "2026-10-09T20:05:00.000Z"),
  market("2026-10-08T20:00:00.000Z", "2026-10-09T20:05:00.000Z"),
];

describe("week track geometry", () => {
  it("finds Monday 00:00 UTC from any instant, Sunday included", () => {
    expect(mondayUtc(NOW)).toBe(Date.parse("2026-10-05T00:00:00Z"));
    expect(mondayUtc(Date.parse("2026-10-11T23:59:59Z"))).toBe(Date.parse("2026-10-05T00:00:00Z"));
    expect(mondayUtc(Date.parse("2026-10-12T00:00:00Z"))).toBe(Date.parse("2026-10-12T00:00:00Z"));
  });

  it("lays Monday to Friday over 88% of the track and the weekend over the rest", () => {
    const mon = Date.parse("2026-10-05T00:00:00Z");
    expect(trackX(mon, mon)).toBe(0);
    expect(trackX(mon + 4 * DAY_MS, mon)).toBeCloseTo((4 / 5) * WEEKDAYS_SHARE, 6);
    expect(trackX(mon + 5 * DAY_MS, mon)).toBeCloseTo(WEEKDAYS_SHARE, 6);
    expect(trackX(mon + 7 * DAY_MS, mon)).toBe(1);
    // Clamped either side, and safe on a broken clock.
    expect(trackX(mon - DAY_MS, mon)).toBe(0);
    expect(trackX(mon + 9 * DAY_MS, mon)).toBe(1);
    expect(trackX(Number.NaN, mon)).toBe(0);
  });
});

describe("weekTrackModel", () => {
  it("reads this week's lock from the markets and the close from the League (the mockup's Thursday)", () => {
    const m = weekTrackModel({ nowMs: NOW, league: THIS_WEEK, calls: { markets: MARKETS, season: SEASON } });
    expect(m.monday).toBe(Date.parse("2026-10-05T00:00:00Z"));
    expect(m.lockAt).toBe(Date.parse("2026-10-08T20:00:00Z"));
    expect(m.closeAt).toBe(Date.parse("2026-10-09T20:00:00Z"));
    expect(m.weekend).toBe(false);
    expect(m.seasonWeek).toBe(4);
    expect(weekLabels(m)).toEqual({ title: "Week of 5 Oct", sub: "Season 0 · week 4" });
    expect(utcDayTime(m.lockAt!)).toBe("Thu 20:00");
    expect(utcDayTime(m.closeAt!)).toBe("Fri 20:00");
    expect(weekTrackLabel(m)).toBe(
      "Week of 5 Oct: predictions lock Thursday 20:00 UTC; the virtual-cash competition closes Friday 20:00 UTC.",
    );
  });

  it("follows the data, not a fixed hour: a winter lock at Thu 21:00 UTC lands at 21:00", () => {
    const now = Date.parse("2026-12-02T10:00:00Z");
    const m = weekTrackModel({
      nowMs: now,
      league: { weekStart: "2026-11-30T00:00:00.000Z", weekEnd: "2026-12-04T20:00:00.000Z", opensIn: null },
      calls: { markets: [market("2026-12-03T21:00:00.000Z", "2026-12-04T21:05:00.000Z")] },
    });
    expect(utcDayTime(m.lockAt!)).toBe("Thu 21:00");
    expect(m.seasonWeek).toBeNull();
  });

  it("on the weekend replays the closed week as final: the API's League is already next week's", () => {
    const sat = Date.parse("2026-10-03T11:00:00Z");
    const m = weekTrackModel({ nowMs: sat, league: THIS_WEEK, calls: { markets: MARKETS, season: SEASON } });
    expect(m.monday).toBe(Date.parse("2026-09-28T00:00:00Z"));
    expect(m.closeAt).toBe(Date.parse("2026-10-02T20:00:00Z"));
    expect(m.lockAt).toBe(Date.parse("2026-10-01T20:00:00Z"));
    expect(m.weekend).toBe(true);
    expect(weekLabels(m)).toEqual({ title: "Week of 28 Sep", sub: "Final · week 3" });
    expect(weekReadout(m, "close")).toEqual({ kind: "next-week", at: Date.parse("2026-10-05T00:00:00Z") });
    expect(weekTrackLabel(m)).toContain("final: predictions locked Thursday 20:00 UTC; the virtual-cash competition closed Friday 20:00 UTC");
  });

  it("counts to the next League's opening only if the API ever sends one", () => {
    const sat = Date.parse("2026-10-03T11:00:00Z");
    const m = weekTrackModel({ nowMs: sat, league: { ...THIS_WEEK, opensIn: 3_600_000 }, leagueNow: "2026-10-03T11:00:00.000Z", calls: null });
    expect(weekReadout(m, "next")).toEqual({ kind: "opens", at: sat + 3_600_000 });
  });

  it("draws no pin it has no data for", () => {
    const m = weekTrackModel({ nowMs: NOW, league: null, calls: null });
    expect(m.lockAt).toBeNull();
    expect(m.closeAt).toBeNull();
    expect(m.weekend).toBe(false);
    expect(weekReadout(m, "next")).toEqual({ kind: "none", at: null });
    expect(weekTrackLabel(m)).toBe("Week of 5 Oct.");
    // A League window that does not fall in the week on the track is ignored, not guessed.
    const stray = weekTrackModel({ nowMs: NOW, league: { weekStart: "2026-10-05T00:00:00.000Z", weekEnd: "2026-10-20T20:00:00.000Z", opensIn: null } });
    expect(stray.closeAt).toBeNull();
  });
});

describe("the readout: each clock once per page", () => {
  const m = weekTrackModel({ nowMs: NOW, league: THIS_WEEK, calls: { markets: MARKETS, season: SEASON } });
  const lock = Date.parse("2026-10-08T20:00:00Z");
  const close = Date.parse("2026-10-09T20:00:00Z");

  it("routes: the landing, predictions and the tour count to the close; the competition to the lock", () => {
    expect(readoutFocusFor("/")).toBe("close");
    expect(readoutFocusFor("/predictions")).toBe("close");
    expect(readoutFocusFor("/start")).toBe("close");
    expect(readoutFocusFor("/competition")).toBe("lock");
    for (const p of ["/quests", "/leaderboard", "/prestocks", "/copy", "/profile", null]) expect(readoutFocusFor(p)).toBe("next");
    // A prefix is not a section.
    expect(readoutFocusFor("/predictionsx")).toBe("next");
  });

  it("picks the focused clock, and falls back to the other once it has passed", () => {
    expect(weekReadout(m, "close")).toEqual({ kind: "close", at: close });
    expect(weekReadout(m, "lock")).toEqual({ kind: "lock", at: lock });
    expect(weekReadout(m, "next")).toEqual({ kind: "lock", at: lock });
    const afterLock = { ...m, nowMs: lock + 1 };
    expect(weekReadout(afterLock, "lock")).toEqual({ kind: "close", at: close });
    expect(weekReadout(afterLock, "next")).toEqual({ kind: "close", at: close });
  });

  it("formats like the mockup: total hours up to two days, then days; no seconds under reduced motion", () => {
    expect(formatTrackClock(lock - NOW)).toBe("6:01:45");
    expect(formatTrackClock(close - NOW)).toBe("30:01:45");
    expect(formatTrackClock(4 * DAY_MS + 20 * 3_600_000 + 61_000)).toBe("4d 20:01:01");
    expect(formatTrackClock(close - NOW, false)).toBe("30h 01m");
    expect(formatTrackClock(4 * DAY_MS + 20 * 3_600_000 + 61_000, false)).toBe("4d 20h 01m");
    expect(formatTrackClock(-5)).toBe("0:00:00");
    expect(formatTrackClock(Number.NaN)).toBe("0:00:00");
    expect(spokenTrackClock(close - NOW)).toBe("30 hours 1 minute 45 seconds");
    expect(spokenTrackClock(close - NOW, false)).toBe("30 hours 1 minute");
  });
});

describe("WeekTrack first frame", () => {
  it("server-renders the ticks it already knows in the final box: no clock, no now marker, no pins", () => {
    const html = renderToStaticMarkup(createElement(WeekTrack));
    // The same 50px (phone) / 60px (desktop) row the loaded track uses, so nothing below it moves.
    expect(html).toContain("h-[50px]");
    expect(html).toContain("lg:h-[60px]");
    for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat–Sun"]) expect(html).toContain(`>${d}<`);
    expect(html).not.toContain('data-slot="week-now"');
    expect(html).not.toContain(">Lock<");
    expect(html).toContain('role="img"');
    // Two renders are byte-identical: nothing reads a clock during render.
    expect(renderToStaticMarkup(createElement(WeekTrack))).toBe(html);
  });

  it("guards every transition and the pulse for reduced motion, and ticks once a minute there", () => {
    const src = read("src/components/layout/WeekTrack.tsx");
    expect(src).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    expect(src).toContain("reduced ? 60_000 : 1_000");
    // Every class string that animates also stands it down under reduced motion.
    const animated = (src.match(/className="[^"]*\btransition-[^"]*"/g) ?? []);
    expect(animated.length).toBeGreaterThanOrEqual(2);
    for (const cls of animated) expect(cls).toContain("motion-reduce:transition-none");
    expect(src).toContain("motion-reduce:animate-none");
  });

  it("uses gold only for the now marker", () => {
    const src = read("src/components/layout/WeekTrack.tsx");
    expect(src.match(/bg-signal\b/g)?.length).toBe(2); // the bar and its diamond
    expect(src).not.toContain("bg-primary");
  });
});

describe("one read per endpoint per page", () => {
  it("the shell mounts the provider around the header, the track, the page and the footer", () => {
    const shell = read("src/components/layout/AppShell.tsx");
    const open = shell.indexOf("<WeekDataProvider>");
    const close = shell.indexOf("</WeekDataProvider>");
    expect(open).toBeGreaterThan(-1);
    for (const tag of ["<header", "<WeekTrack />", "<main", "<footer"]) {
      const at = shell.indexOf(tag);
      expect(at, tag).toBeGreaterThan(open);
      expect(at, tag).toBeLessThan(close);
    }
    // Directly under the header, on every page.
    expect(shell.indexOf("<WeekTrack />")).toBeGreaterThan(shell.indexOf("</header>"));
    expect(shell.indexOf("<WeekTrack />")).toBeLessThan(shell.indexOf("<main"));
  });

  it("every page that reads /league or /calls takes the shared read instead of its own", () => {
    for (const rel of ["src/app/competition/page.tsx", "src/app/predictions/page.tsx", "src/app/start/page.tsx", "src/components/prestocks/PreStocksView.tsx", "src/components/landing/ScoreboardPreview.tsx"]) {
      const src = read(rel);
      expect(src, rel).not.toContain("leagueApi.overview(");
      expect(src, rel).not.toContain("api.calls(");
      expect(src, rel).toMatch(/use(League|Calls)Query\(/);
    }
    // And nothing else under src/ fetches them on its own.
    const shared = read("src/components/layout/WeekData.tsx");
    expect(shared.split("leagueApi.overview(").length - 1).toBe(1);
    expect(shared.split("api.calls(").length - 1).toBe(1);
  });

  it("a component outside the shell still reads on its own, under the caller's key, and is parked inside it", () => {
    const shared = read("src/components/layout/WeekData.tsx");
    expect(shared).toContain("useApiQuery(readLeague, key, { enabled: shared === null })");
    expect(shared).toContain("useApiQuery(readCalls, key, { enabled: shared === null })");
    const hook = read("src/components/common/useApiQuery.ts");
    expect(hook).toContain("if (!enabled) return noop;");
    expect(hook).toContain("const loading = enabled && inFlight && data === null;");
  });

  it("retries a 5xx or a network error twice, never a 4xx or an abort", async () => {
    const fail500 = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new ApiClientError("boom", 503)).mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce("ok");
    expect(await readWithRetry(fail500, undefined, [0, 0])).toBe("ok");
    expect(fail500).toHaveBeenCalledTimes(3);

    const always500 = vi.fn(async () => Promise.reject(new ApiClientError("boom", 500)));
    await expect(readWithRetry(always500, undefined, [0, 0])).rejects.toThrow("boom");
    expect(always500).toHaveBeenCalledTimes(3);

    const notFound = vi.fn(async () => Promise.reject(new ApiClientError("nope", 404)));
    await expect(readWithRetry(notFound, undefined, [0, 0])).rejects.toThrow("nope");
    expect(notFound).toHaveBeenCalledTimes(1);

    const ac = new AbortController();
    ac.abort();
    const aborted = vi.fn(async () => Promise.reject(new Error("aborted")));
    await expect(readWithRetry(aborted, ac.signal, [0, 0])).rejects.toThrow("aborted");
    expect(aborted).toHaveBeenCalledTimes(1);
  });
});

describe("Broadcast colour jobs", () => {
  const css = read("src/app/globals.css");

  it("gold is the primary and the signal token only; Yes / No are green / red", () => {
    const golds = css.match(/#ffd23c/gi) ?? [];
    expect(golds).toHaveLength(2); // --signal and --primary
    expect(css).toMatch(/--signal: #ffd23c;/);
    expect(css).toMatch(/--primary: #ffd23c;/);
    expect(css).toMatch(/--yes: #3ad08a;/);
    expect(css).toMatch(/--no: #ff5d6c;/);
    // The legacy accent names resolve to cream, never a hue.
    expect(css).toMatch(/--ember: var\(--paper\);/);
    expect(css).toMatch(/--gold: var\(--paper\);/);
  });

  it("the muted grey every small must-read line uses is AA on the ink and on cards", () => {
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    expect(css).toMatch(/--muted-foreground: #a3a199;/);
    for (const ground of ["#0b0b0c", "#121214", "#1a1a1d"]) expect(ratio("#a3a199", ground)).toBeGreaterThan(6.5);
    // Dim is for secondary labels only, and still clears 4.5:1 on the ink and on cards.
    for (const ground of ["#0b0b0c", "#121214"]) expect(ratio("#87857e", ground)).toBeGreaterThan(4.5);
    // The gold's own ink on it, and ink on the cream secondary.
    expect(ratio("#161100", "#ffd23c")).toBeGreaterThan(7);
    expect(ratio("#0b0b0c", "#f3f0e8")).toBeGreaterThan(7);
  });

  it("the primary button keeps its cut on ::before so the focus ring is never clipped", () => {
    const button = read("src/components/ui/button.tsx");
    expect(button).toMatch(/default:\s*"cut-corner [^"]*before:bg-primary[^"]*"/);
    expect(button).not.toMatch(/clip-path/);
    expect(css).toMatch(/@utility cut-corner \{\s*&::before \{\s*clip-path:/);
  });
});
