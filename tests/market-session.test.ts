import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MarketSessionChip,
  SESSION_PLACEHOLDER,
  SESSION_TICK_MS,
  formatSessionCountdown,
  marketSession,
  sessionLabel,
  sessionShortLabel,
  sessionTitle,
  sessionVerb,
} from "@/components/common/MarketSessionChip";

/**
 * The header's market session chip. Every session fact is the US calendar's (tests/calendar.test.ts
 * owns the holidays, early closes and DST); this file owns the countdown wording, the early-close
 * wording and the first frame the server renders.
 *
 * DST 2026: EDT (UTC-4) from 8 Mar, EST (UTC-5) from 1 Nov.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const utc = (s: string) => new Date(s);

describe("marketSession — open", () => {
  it("counts down to today's 16:00 ET close", () => {
    // Tue 10 Mar 2026, 12:55 ET (EDT). Close is 20:00Z.
    const s = marketSession(utc("2026-03-10T16:55:00Z"));
    expect(s.open).toBe(true);
    expect(s.earlyClose).toBe(false);
    expect(s.at.toISOString()).toBe("2026-03-10T20:00:00.000Z");
    expect(s.msUntil).toBe((3 * 60 + 5) * 60_000);
    expect(sessionLabel(s)).toBe("US market open · closes in 3h 05m");
    expect(sessionShortLabel(s)).toBe("Open · 3h 05m");
    expect(sessionTitle(s)).toBe(
      "The US regular session closes at 16:00 ET. Solana never closes, so every price carries its source and age.",
    );
  });

  it("is open at the bell itself and counts the whole session", () => {
    const s = marketSession(utc("2026-03-10T13:30:00Z")); // 09:30 ET
    expect(s.open).toBe(true);
    expect(sessionLabel(s)).toBe("US market open · closes in 6h 30m");
  });

  it("turns over the moment the session ends", () => {
    const s = marketSession(utc("2026-03-10T20:00:00Z")); // 16:00 ET exactly
    expect(s.open).toBe(false);
    expect(s.at.toISOString()).toBe("2026-03-11T13:30:00.000Z");
    expect(sessionLabel(s)).toBe("US market closed · opens in 17h 30m");
  });
});

describe("marketSession — closed", () => {
  it("counts down to the next open on a weekday evening", () => {
    // Tue 10 Mar 2026, 19:08 ET. Next open is Wed 09:30 ET = 13:30Z.
    const s = marketSession(utc("2026-03-10T23:08:00Z"));
    expect(s.open).toBe(false);
    expect(s.earlyClose).toBe(false);
    expect(s.msUntil).toBe((14 * 60 + 22) * 60_000);
    expect(sessionLabel(s)).toBe("US market closed · opens in 14h 22m");
    expect(sessionShortLabel(s)).toBe("Closed · 14h 22m");
    expect(sessionTitle(s)).toBe(
      "The US regular session opens Wednesday at 09:30 ET. Solana never closes, so every price carries its source and age.",
    );
  });

  it("crosses a weekend to Monday's open", () => {
    const s = marketSession(utc("2026-06-20T12:00:00Z")); // Saturday
    expect(s.open).toBe(false);
    expect(s.at.toISOString()).toBe("2026-06-22T13:30:00.000Z");
    expect(sessionLabel(s)).toBe("US market closed · opens in 2d 1h");
    expect(sessionTitle(s)).toContain("opens Monday at 09:30 ET");
  });

  it("skips a full-day holiday", () => {
    const s = marketSession(utc("2026-12-25T15:00:00Z")); // Christmas Day, a Friday
    expect(s.open).toBe(false);
    expect(s.at.toISOString()).toBe("2026-12-28T14:30:00.000Z"); // Monday, EST
    expect(sessionLabel(s)).toBe("US market closed · opens in 2d 23h");
  });
});

describe("marketSession — early closes", () => {
  it("says early close while a 13:00 ET day is running", () => {
    // Fri 27 Nov 2026 (day after Thanksgiving), 11:55 ET in EST. Close is 13:00 ET = 18:00Z.
    const s = marketSession(utc("2026-11-27T16:55:00Z"));
    expect(s.open).toBe(true);
    expect(s.earlyClose).toBe(true);
    expect(sessionVerb(s)).toBe("early close in");
    expect(sessionLabel(s)).toBe("US market open · early close in 1h 05m");
    expect(sessionTitle(s)).toBe(
      "The US regular session closes early today at 13:00 ET. Solana never closes, so every price carries its source and age.",
    );
  });

  it("flags an early close that has not started yet", () => {
    // Thanksgiving (closed all day); the next session is the early one.
    const s = marketSession(utc("2026-11-26T18:00:00Z"));
    expect(s.open).toBe(false);
    expect(s.earlyClose).toBe(true);
    expect(s.at.toISOString()).toBe("2026-11-27T14:30:00.000Z");
    // The chip stays short; the early close is spelled out in the tooltip.
    expect(sessionLabel(s)).toBe("US market closed · opens in 20h 30m");
    expect(sessionTitle(s)).toBe(
      "The US regular session opens Friday at 09:30 ET and closes early that day at 13:00 ET. Solana never closes, so every price carries its source and age.",
    );
  });

  it("is a normal close on an ordinary day of the same week", () => {
    const s = marketSession(utc("2026-11-30T16:55:00Z")); // Monday 11:55 ET
    expect(s.open).toBe(true);
    expect(s.earlyClose).toBe(false);
    expect(sessionVerb(s)).toBe("closes in");
  });
});

describe("formatSessionCountdown", () => {
  it("shows whole units down to the minute", () => {
    expect(formatSessionCountdown(0)).toBe("under a minute");
    expect(formatSessionCountdown(59_000)).toBe("under a minute");
    expect(formatSessionCountdown(60_000)).toBe("1m");
    expect(formatSessionCountdown(22 * 60_000)).toBe("22m");
    expect(formatSessionCountdown(65 * 60_000)).toBe("1h 05m");
    expect(formatSessionCountdown((3 * 60 + 5) * 60_000)).toBe("3h 05m");
    expect(formatSessionCountdown((14 * 60 + 22) * 60_000)).toBe("14h 22m");
    expect(formatSessionCountdown(24 * 3_600_000)).toBe("1d 0h");
    expect(formatSessionCountdown(49 * 3_600_000)).toBe("2d 1h");
  });

  it("pads the minutes so the digits do not jump on the tick", () => {
    expect(formatSessionCountdown(3 * 3_600_000 + 5 * 60_000)).toMatch(/^\dh \d\dm$/);
  });

  it("never renders a negative or a broken clock", () => {
    expect(formatSessionCountdown(-1)).toBe("under a minute");
    expect(formatSessionCountdown(Number.NaN)).toBe("under a minute");
    expect(formatSessionCountdown(Number.POSITIVE_INFINITY)).toBe("under a minute");
  });
});

describe("MarketSessionChip — first frame", () => {
  it("renders a stable placeholder with no session claim when it has no instant", () => {
    const html = renderToStaticMarkup(createElement(MarketSessionChip, {}));
    expect(html).toContain(SESSION_PLACEHOLDER);
    expect(html).not.toContain("closes in");
    expect(html).not.toContain("opens in");
    expect(html).not.toContain("title=");
    // Two renders of the same props are byte-identical: nothing here reads a clock at render time.
    expect(renderToStaticMarkup(createElement(MarketSessionChip, {}))).toBe(html);
  });

  it("renders the session from a passed-in ISO instant, deterministically", () => {
    const nowIso = "2026-03-10T16:55:00.000Z";
    const html = renderToStaticMarkup(createElement(MarketSessionChip, { nowIso }));
    expect(html).toContain("3h 05m");
    expect(html).toContain("closes in");
    expect(html).toContain("closes at 16:00 ET");
    expect(html).not.toContain(SESSION_PLACEHOLDER);
    expect(renderToStaticMarkup(createElement(MarketSessionChip, { nowIso }))).toBe(html);
  });

  it("falls back to the placeholder on an unparseable instant", () => {
    const html = renderToStaticMarkup(createElement(MarketSessionChip, { nowIso: "not a date" }));
    expect(html).toContain(SESSION_PLACEHOLDER);
  });

  it("keeps the long form for md and up and a short one below it", () => {
    const html = renderToStaticMarkup(createElement(MarketSessionChip, { nowIso: "2026-03-10T23:08:00.000Z" }));
    // 276px of sentence only where there is room for it; 147px of "Closed · 14h 22m" below that.
    expect(html).toContain('class="hidden md:inline"');
    expect(html).not.toContain('class="hidden sm:inline"');
    expect(html).toContain("14h 22m");
    expect(html).toContain("opens in");
  });
});

describe("MarketSessionChip — one clock, one calendar", () => {
  const src = read("src/components/common/MarketSessionChip.tsx");

  it("reads the shared US calendar and never repeats a date of its own", () => {
    expect(src).toContain('from "@/lib/prices/calendar"');
    for (const helper of ["isMarketOpen", "nextMarketOpen", "nextMarketClose", "isEarlyClose", "toEasternWallClock"]) {
      expect(src, helper).toContain(helper);
    }
    // No second holiday list, no hand-rolled session hours.
    expect(src).not.toMatch(/20\d\d-\d\d-\d\d/);
    expect(src).not.toMatch(/America\/New_York/);
  });

  it("ticks once a minute and clears the interval on unmount", () => {
    expect(SESSION_TICK_MS).toBe(60_000);
    expect(src.match(/setInterval\(/g)).toHaveLength(1);
    expect(src).toContain("return () => window.clearInterval(id)");
  });

  it("guards its transition for reduced motion and never animates by default", () => {
    expect(src).toContain("motion-reduce:transition-none");
    expect(src).not.toContain("animate-");
  });
});

describe("where the chip and its explanation appear", () => {
  it("sits beside the Season chip in the header, only in the band where the row has room", () => {
    const shell = read("src/components/layout/AppShell.tsx");
    expect(shell).toContain("<MarketSessionChip");
    expect(shell.indexOf("<MarketSessionChip")).toBeGreaterThan(shell.indexOf("<SeasonChip"));
    const cls = shell.match(/<MarketSessionChip className="([^"]+)"/)![1].split(" ");
    // Measured 16 Sep: the header row is full from md up, and has ~84px spare on a phone, so the
    // only band that holds the 147px chip is the one between the two.
    expect(cls).toEqual(expect.arrayContaining(["hidden", "shrink-0", "min-[680px]:inline-flex", "md:hidden"]));
    // A statically rendered shell must not bake its build time into the first frame.
    expect(shell).not.toMatch(/<MarketSessionChip[^>]*nowIso/);
  });

  it("predictions and the competition both carry the chip and say why a closed market is fine", () => {
    for (const rel of ["src/app/predictions/page.tsx", "src/app/competition/page.tsx"]) {
      const page = read(rel);
      expect(page, rel).toContain("<MarketSessionChip />");
      expect(page, rel).toContain("Wall Street is closed outside market hours. Solana is not,");
      // The sentence runs to "source and age", and carries no em dash.
      const line = page.slice(page.indexOf("Wall Street is closed")).split("\n")[0];
      expect(line, rel).toMatch(/carries its source and age\.$/);
      expect(line.includes("—"), rel).toBe(false);
    }
  });
});
