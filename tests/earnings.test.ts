import { describe, expect, it } from "vitest";
import { evaluatePlay, type EvalContext } from "@/lib/plays/engine";
import { calendarDatesFor, earningsDatesFor, getCalendar, type PlayRule } from "@/lib/plays/rules";
import calendarFile from "@/lib/plays/earnings-2026.json";
import { SOLANA_MAINNET, type AssetId } from "@/lib/core/caip";
import type { Holding, HoldingsSnapshot } from "@/lib/core/types";

/**
 * M13 (docs/REVIEW-2026-09-14.md): the earnings calendar must be right for every company that
 * reports inside the Season 0 judging window. Earnings Holder (400 pts + the gold badge) awards
 * on the D-1 / D day-end snapshots around these dates and prints them in the Proof drawer, so a
 * wrong date is a visibly false completion.
 */

const WINDOW_START = "2026-09-14";
const WINDOW_END = "2026-10-02";

/** Verified against each company's own announcement; the URL sits in the file's _sources map. */
const IN_WINDOW: Readonly<Record<string, string>> = {
  LEN: "2026-09-16", // after the close
  AZO: "2026-09-22", // before the open
  GIS: "2026-09-23", // before the open
  CTAS: "2026-09-23", // before the open
  PAYX: "2026-09-23", // before the open
  DRI: "2026-09-24", // before the open
  MU: "2026-09-30", // after the close
  ACN: "2026-10-01", // 08:00 ET
  NKE: "2026-10-01", // after the close
};

/** The dates the review found wrong; they must not come back. */
const STALE: ReadonlyArray<[string, string]> = [
  ["MU", "2026-09-23"],
  ["ACN", "2026-09-24"],
  ["NKE", "2026-09-29"],
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** True only for a real calendar day: rejects "2026-02-30" and "2026-9-30" alike. */
const isCalendarDay = (d: string): boolean => ISO_DATE.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

const file = calendarFile as unknown as Record<string, unknown>;
const META_KEYS = new Set(["_note", "_sources", "asOf"]);
const rawTickers = Object.entries(file).filter(([k]) => !META_KEYS.has(k));

// ---------------------------------------------------------------------------
// The file itself. parseEarningsCalendar() silently drops malformed dates and sorts, so the
// raw JSON is checked directly: a typo here would otherwise vanish instead of failing.
// ---------------------------------------------------------------------------

describe("earnings-2026.json (raw file)", () => {
  it("has a verified (not estimated) note, keeps asOf, and lists sources", () => {
    expect(typeof file._note).toBe("string");
    expect(file._note as string).not.toMatch(/estimat/i);
    expect(file.asOf).toBe("2026-09-14");
    expect(file._sources && typeof file._sources === "object").toBe(true);
  });

  it("every ticker entry is an array of real ISO dates in 2026, on or after asOf, unique and ascending", () => {
    expect(rawTickers.length).toBeGreaterThan(50);
    for (const [ticker, value] of rawTickers) {
      expect(ticker, ticker).toMatch(/^[A-Z][A-Z.]*$/);
      expect(Array.isArray(value), ticker).toBe(true);
      const dates = value as unknown[];
      expect(dates.length, ticker).toBeGreaterThan(0);
      for (let i = 0; i < dates.length; i++) {
        const d = dates[i];
        expect(typeof d, `${ticker}[${i}]`).toBe("string");
        expect(isCalendarDay(d as string), `${ticker}[${i}] = ${String(d)}`).toBe(true);
        expect((d as string).startsWith("2026-"), `${ticker}[${i}]`).toBe(true);
        expect((d as string) >= (file.asOf as string), `${ticker} ${String(d)} is before asOf`).toBe(true);
        if (i > 0) expect((d as string) > (dates[i - 1] as string), `${ticker} dates must be strictly ascending`).toBe(true);
      }
    }
  });

  it("_sources names an https URL for every in-window reporter, and only for tickers in the calendar", () => {
    const sources = file._sources as Record<string, unknown>;
    for (const ticker of Object.keys(IN_WINDOW)) {
      expect(typeof sources[ticker], ticker).toBe("string");
      expect(sources[ticker] as string, ticker).toMatch(/^https:\/\/\S+$/);
    }
    for (const ticker of Object.keys(sources)) expect(file[ticker], `_sources.${ticker} has no calendar entry`).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The parsed calendar the engine reads.
// ---------------------------------------------------------------------------

describe("earnings calendar (parsed)", () => {
  const cal = getCalendar("earnings");

  it("does not turn metadata into tickers", () => {
    for (const key of Object.keys(cal.dates)) expect(key).toMatch(/^[A-Z][A-Z.]*$/);
    expect(cal.dates._SOURCES).toBeUndefined();
    expect(cal.dates._NOTE).toBeUndefined();
    expect(cal.dates.ASOF).toBeUndefined();
    expect(cal.note).not.toMatch(/estimat/i);
    expect(cal.asOf).toBe("2026-09-14");
  });

  it("carries the verified date, first, for every in-window reporter", () => {
    for (const [ticker, date] of Object.entries(IN_WINDOW)) {
      expect(cal.dates[ticker], ticker).toBeDefined();
      expect(cal.dates[ticker][0], ticker).toBe(date);
    }
  });

  it("has exactly these ticker/date pairs inside 14 Sep - 2 Oct 2026", () => {
    const inWindow = Object.entries(cal.dates)
      .flatMap(([ticker, dates]) => dates.filter((d) => d >= WINDOW_START && d <= WINDOW_END).map((d) => `${ticker} ${d}`))
      .sort();
    const expected = Object.entries(IN_WINDOW)
      .map(([ticker, d]) => `${ticker} ${d}`)
      .sort();
    expect(inWindow).toEqual(expected);
  });

  it("no longer carries the dates the review found wrong", () => {
    for (const [ticker, d] of STALE) expect(cal.dates[ticker], `${ticker} ${d}`).not.toContain(d);
  });

  it("keeps every ticker's dates valid and strictly ascending after parsing", () => {
    for (const [ticker, dates] of Object.entries(cal.dates)) {
      for (let i = 0; i < dates.length; i++) {
        expect(isCalendarDay(dates[i]), `${ticker}[${i}]`).toBe(true);
        if (i > 0) expect(dates[i] > dates[i - 1], ticker).toBe(true);
      }
    }
  });

  it("resolves the xStocks symbols a judge would hold", () => {
    expect(earningsDatesFor("MUx")[0]).toBe("2026-09-30");
    expect(earningsDatesFor("ACNx")[0]).toBe("2026-10-01");
    expect(earningsDatesFor("NKEx")[0]).toBe("2026-10-01");
    expect(earningsDatesFor("LENx")).toEqual(["2026-09-16"]);
    expect(calendarDatesFor("earnings", "azo")).toEqual(["2026-09-22"]);
    expect(earningsDatesFor("PAYXx")).toEqual(["2026-09-23"]);
  });
});

// ---------------------------------------------------------------------------
// Proof drawer hold-by hint: the engine names D-1 next to the next earnings date, so the
// client never needs the calendar in its bundle.
// ---------------------------------------------------------------------------

const MUX_ID: AssetId = `${SOLANA_MAINNET}/token:XsQLZycSZ7QnBBdBXQaTbQdiUcbRqjNJgyBGAMzhHav`;

function muHolding(usd: number): Holding {
  return { assetId: MUX_ID, symbol: "MUx", raw: "100000000", multiplier: 1, qty: 1, price: usd, priceSource: "pyth", usd };
}

/** Day-end snapshot (23:55Z) on the given UTC day. */
function snapshot(day: string, holdings: Holding[]): HoldingsSnapshot {
  return { walletId: "w1", takenAt: new Date(`${day}T23:55:00.000Z`), holdings };
}

function ctx(now: string, snapshots: HoldingsSnapshot[]): EvalContext {
  return {
    now: new Date(now),
    snapshots,
    events: [],
    earnings: getCalendar("earnings").dates,
    sectorOf: () => "Technology",
    underlyingOf: (assetId) => (assetId === MUX_ID ? "MU" : null),
  };
}

const RULE: PlayRule = { type: "hold_through_date", calendarKey: "earnings" };

describe("hold_through_date proof names the hold-by day (D-1) for the next earnings date", () => {
  it("MUx held on 14 Sep: next is 30 Sep, hold by 29 Sep", () => {
    const res = evaluatePlay(RULE, ctx("2026-09-14T12:00:00.000Z", [snapshot("2026-09-13", [muHolding(6)])]));
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({
      reason: "earnings_upcoming",
      nextEarningsSymbol: "MUx",
      nextEarningsUnderlying: "MU",
      nextEarningsDate: "2026-09-30",
      nextEarningsHoldBy: "2026-09-29",
    });
    // The drawer stores proof as JSON: it must round-trip losslessly.
    expect(JSON.parse(JSON.stringify(res.proof))).toEqual(res.proof);
  });

  it("on the earnings day itself, before the after-snapshot exists, still points at D-1", () => {
    const res = evaluatePlay(
      RULE,
      ctx("2026-09-30T12:00:00.000Z", [snapshot("2026-09-28", [muHolding(6)]), snapshot("2026-09-29", [muHolding(6)])]),
    );
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({ nextEarningsDate: "2026-09-30", nextEarningsHoldBy: "2026-09-29" });
  });

  it("completes on the D day-end snapshot and carries no hold-by hint once complete", () => {
    const res = evaluatePlay(
      RULE,
      ctx("2026-10-01T12:00:00.000Z", [snapshot("2026-09-29", [muHolding(6)]), snapshot("2026-09-30", [muHolding(6)])]),
    );
    expect(res.complete).toBe(true);
    expect(res.proof).toMatchObject({ symbol: "MUx", earningsDate: "2026-09-30", before: { day: "2026-09-29" }, after: { day: "2026-09-30" } });
    expect(res.proof.nextEarningsHoldBy).toBeUndefined();
  });

  it("omits the hint when nothing is held", () => {
    const res = evaluatePlay(RULE, ctx("2026-09-14T12:00:00.000Z", [snapshot("2026-09-13", [])]));
    expect(res.complete).toBe(false);
    expect(res.proof.nextEarningsHoldBy).toBeUndefined();
  });
});
