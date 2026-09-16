import { describe, expect, it } from "vitest";
import {
  US_EARLY_CLOSES_2026,
  US_MARKET_HOLIDAYS_2026,
  easternWallClockToUtc,
  isMarketOpen,
  isTradingDay,
  nextMarketClose,
  nextMarketOpen,
  toEasternWallClock,
} from "@/lib/prices/calendar";

// DST 2026: EDT (UTC-4) from Sun 8 Mar 02:00 ET, EST (UTC-5) from Sun 1 Nov 02:00 ET.
const utc = (s: string) => new Date(s);

describe("toEasternWallClock", () => {
  it("converts a summer instant (EDT, UTC-4)", () => {
    const w = toEasternWallClock(utc("2026-03-10T14:00:00Z"));
    expect(w).toMatchObject({ dateKey: "2026-03-10", hour: 10, minute: 0, weekday: 2, minutesOfDay: 600 });
  });
  it("converts a winter instant (EST, UTC-5)", () => {
    const w = toEasternWallClock(utc("2026-02-10T14:00:00Z"));
    expect(w).toMatchObject({ dateKey: "2026-02-10", hour: 9, minute: 0, weekday: 2 });
  });
  it("rolls the calendar date across midnight ET", () => {
    // 03:00Z on 11 Mar is 23:00 ET on 10 Mar.
    const w = toEasternWallClock(utc("2026-03-11T03:00:00Z"));
    expect(w.dateKey).toBe("2026-03-10");
    expect(w.hour).toBe(23);
  });
  it("normalises midnight to hour 0", () => {
    const w = toEasternWallClock(utc("2026-03-10T04:00:00Z"));
    expect(w.hour).toBe(0);
    expect(w.dateKey).toBe("2026-03-10");
  });
});

describe("easternWallClockToUtc", () => {
  it("maps 09:30 ET to 13:30Z in EDT and 14:30Z in EST", () => {
    expect(easternWallClockToUtc(2026, 6, 22, 9, 30).toISOString()).toBe("2026-06-22T13:30:00.000Z");
    expect(easternWallClockToUtc(2026, 2, 9, 9, 30).toISOString()).toBe("2026-02-09T14:30:00.000Z");
  });
  it("is correct on the DST switch days themselves", () => {
    // Monday after spring-forward: EDT.
    expect(easternWallClockToUtc(2026, 3, 9, 9, 30).toISOString()).toBe("2026-03-09T13:30:00.000Z");
    // Friday before spring-forward: still EST.
    expect(easternWallClockToUtc(2026, 3, 6, 9, 30).toISOString()).toBe("2026-03-06T14:30:00.000Z");
    // Monday after fall-back: EST.
    expect(easternWallClockToUtc(2026, 11, 2, 9, 30).toISOString()).toBe("2026-11-02T14:30:00.000Z");
    // Friday before fall-back: still EDT.
    expect(easternWallClockToUtc(2026, 10, 30, 16, 0).toISOString()).toBe("2026-10-30T20:00:00.000Z");
  });
});

describe("isMarketOpen — regular session", () => {
  it("Tuesday 10:00 ET in March (DST) is open", () => {
    expect(isMarketOpen(utc("2026-03-10T14:00:00Z"))).toBe(true);
  });
  it("15:59 ET is open, 16:00 ET is closed", () => {
    expect(isMarketOpen(utc("2026-03-10T19:59:00Z"))).toBe(true);
    expect(isMarketOpen(utc("2026-03-10T19:59:59Z"))).toBe(true);
    expect(isMarketOpen(utc("2026-03-10T20:00:00Z"))).toBe(false);
  });
  it("pre-market 09:29 ET is closed, 09:30 ET is open", () => {
    expect(isMarketOpen(utc("2026-03-10T13:29:00Z"))).toBe(false);
    expect(isMarketOpen(utc("2026-03-10T13:30:00Z"))).toBe(true);
  });
  it("Sunday is closed", () => {
    expect(isMarketOpen(utc("2026-03-15T15:00:00Z"))).toBe(false);
  });
  it("Saturday is closed", () => {
    expect(isMarketOpen(utc("2026-03-14T15:00:00Z"))).toBe(false);
  });
  it("handles DST correctly at the open on either side of the transitions", () => {
    // EST Friday 6 Mar: 13:30Z is 08:30 ET (closed); 14:30Z is 09:30 ET (open).
    expect(isMarketOpen(utc("2026-03-06T13:30:00Z"))).toBe(false);
    expect(isMarketOpen(utc("2026-03-06T14:30:00Z"))).toBe(true);
    // EDT Monday 9 Mar: 13:30Z is 09:30 ET (open).
    expect(isMarketOpen(utc("2026-03-09T13:29:00Z"))).toBe(false);
    expect(isMarketOpen(utc("2026-03-09T13:30:00Z"))).toBe(true);
    // EST Monday 2 Nov: 13:30Z is 08:30 ET (closed); 14:30Z is open; 21:00Z is 16:00 ET (closed).
    expect(isMarketOpen(utc("2026-11-02T13:30:00Z"))).toBe(false);
    expect(isMarketOpen(utc("2026-11-02T14:30:00Z"))).toBe(true);
    expect(isMarketOpen(utc("2026-11-02T20:59:00Z"))).toBe(true);
    expect(isMarketOpen(utc("2026-11-02T21:00:00Z"))).toBe(false);
  });
});

describe("isMarketOpen — holidays and early closes", () => {
  it("Thanksgiving (Thu 26 Nov 2026) is closed all day", () => {
    expect(isMarketOpen(utc("2026-11-26T17:00:00Z"))).toBe(false);
  });
  it("MLK Day (Mon 19 Jan 2026) is closed", () => {
    expect(isMarketOpen(utc("2026-01-19T17:00:00Z"))).toBe(false);
  });
  it("Good Friday (3 Apr 2026) and 3 Jul 2026 (observed) are closed", () => {
    expect(isMarketOpen(utc("2026-04-03T15:00:00Z"))).toBe(false);
    expect(isMarketOpen(utc("2026-07-03T15:00:00Z"))).toBe(false);
  });
  it("Fri 27 Nov 2026 closes early: 12:59 ET open, 13:00 ET closed", () => {
    // EST: 12:59 ET = 17:59Z
    expect(isMarketOpen(utc("2026-11-27T17:59:00Z"))).toBe(true);
    expect(isMarketOpen(utc("2026-11-27T18:00:00Z"))).toBe(false);
  });
  it("Thu 24 Dec 2026 closes early at 13:00 ET", () => {
    expect(isMarketOpen(utc("2026-12-24T17:59:00Z"))).toBe(true);
    expect(isMarketOpen(utc("2026-12-24T18:00:00Z"))).toBe(false);
  });
  it("2027 runway: 1 Jan and 18 Jan 2027 are closed, 4 Jan 2027 is open", () => {
    expect(isMarketOpen(utc("2027-01-01T15:00:00Z"))).toBe(false);
    expect(isMarketOpen(utc("2027-01-18T15:00:00Z"))).toBe(false);
    expect(isMarketOpen(utc("2027-01-04T15:00:00Z"))).toBe(true);
  });
});

describe("nextMarketOpen", () => {
  it("from a summer Saturday returns Monday 09:30 ET = 13:30Z (EDT)", () => {
    expect(nextMarketOpen(utc("2026-06-20T12:00:00Z")).toISOString()).toBe("2026-06-22T13:30:00.000Z");
  });
  it("from a winter Saturday returns Monday 09:30 ET = 14:30Z (EST)", () => {
    expect(nextMarketOpen(utc("2026-02-07T12:00:00Z")).toISOString()).toBe("2026-02-09T14:30:00.000Z");
  });
  it("skips a Monday holiday (Labor Day) to Tuesday", () => {
    expect(nextMarketOpen(utc("2026-09-05T12:00:00Z")).toISOString()).toBe("2026-09-08T13:30:00.000Z");
  });
  it("from pre-market on a trading day returns that day's open", () => {
    expect(nextMarketOpen(utc("2026-03-10T12:00:00Z")).toISOString()).toBe("2026-03-10T13:30:00.000Z");
  });
  it("from inside a session returns the following session's open", () => {
    expect(nextMarketOpen(utc("2026-03-10T15:00:00Z")).toISOString()).toBe("2026-03-11T13:30:00.000Z");
  });
  it("from Wednesday evening before Thanksgiving skips to Friday", () => {
    expect(nextMarketOpen(utc("2026-11-25T22:00:00Z")).toISOString()).toBe("2026-11-27T14:30:00.000Z");
  });
  it("is strictly after the input even at exactly 09:30 ET", () => {
    expect(nextMarketOpen(utc("2026-03-10T13:30:00Z")).toISOString()).toBe("2026-03-11T13:30:00.000Z");
  });
});

describe("nextMarketClose", () => {
  it("inside a session returns today's 16:00 ET", () => {
    expect(nextMarketClose(utc("2026-03-10T15:00:00Z")).toISOString()).toBe("2026-03-10T20:00:00.000Z");
  });
  it("on an early-close day returns 13:00 ET", () => {
    expect(nextMarketClose(utc("2026-11-27T15:00:00Z")).toISOString()).toBe("2026-11-27T18:00:00.000Z");
  });
  it("from a Saturday returns Monday's close", () => {
    expect(nextMarketClose(utc("2026-06-20T12:00:00Z")).toISOString()).toBe("2026-06-22T20:00:00.000Z");
  });
});

describe("exported lists", () => {
  it("contain the NYSE 2026 closures and early closes", () => {
    expect(US_MARKET_HOLIDAYS_2026).toEqual(
      expect.arrayContaining([
        "2026-01-01",
        "2026-01-19",
        "2026-02-16",
        "2026-04-03",
        "2026-05-25",
        "2026-06-19",
        "2026-07-03",
        "2026-09-07",
        "2026-11-26",
        "2026-12-25",
        "2027-01-01",
        "2027-01-18",
      ]),
    );
    expect(US_EARLY_CLOSES_2026).toEqual(["2026-11-27", "2026-12-24"]);
  });
  it("isTradingDay agrees with the lists and weekends", () => {
    expect(isTradingDay("2026-11-26")).toBe(false);
    expect(isTradingDay("2026-11-27")).toBe(true);
    expect(isTradingDay("2026-11-28")).toBe(false); // Saturday
    expect(() => isTradingDay("garbage")).toThrow();
  });
});
