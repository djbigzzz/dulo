import { describe, expect, it } from "vitest";
import { START_PATH, competitionLine, competitionLineParts, rankShareOnXUrl, rankShareText, shareOnXUrl, shareText } from "@/components/start/share";

// /start share post: the prefilled X text a player can post after a prediction. Plain names only
// (points only, no betting words), and the link back to /start.

const URL_ = "https://projectdulo.com/start";

describe("/start share", () => {
  it("states the pick, says points only, and links back", () => {
    const yes = shareText({ ticker: "NVDA", strike: 224.94, side: "yes" }, URL_);
    expect(yes).toBe("I said YES: NVDA closes above $224.94 this Friday. Free, points only, on Dulo. What's your pick? " + URL_);
    expect(shareText({ ticker: "TSLA", strike: 410, side: "no" }, URL_)).toContain("TSLA stays below $410.00");
  });

  it("never uses betting words", () => {
    const t = shareText({ ticker: "SPY", strike: 600, side: "yes" }, URL_);
    expect(t).not.toMatch(/\b(bet|bets|betting|odds|stake|staked|payout|wager|prediction market)\b/i);
  });

  it("builds an X compose link with the text encoded", () => {
    const u = new URL(shareOnXUrl({ ticker: "NVDA", strike: 224.94, side: "yes" }, URL_));
    expect(u.origin + u.pathname).toBe("https://x.com/intent/post");
    expect(u.searchParams.get("text")).toContain(URL_);
    expect(START_PATH).toBe("/start");
  });
});

describe("rank share and the competition line", () => {
  it("states rank and return with virtual cash beside it, points only", () => {
    const t = rankShareText(3, 1.23, URL_);
    expect(t).toBe(`I'm #3 in this week's Dulo competition, trading xStocks with $10,000 of virtual cash (+1.23%). Points only. Can you beat me? ${URL_}`);
    expect(rankShareText(7, -0.4, URL_)).toContain("(-0.40%)");
    expect(new URL(rankShareOnXUrl(3, 1.23, URL_)).searchParams.get("text")).toBe(t);
    expect(t).not.toMatch(/\b(bet|odds|stake|payout|wager)\b/i);
  });

  it("says how long is left, or when next week opens, and nothing otherwise", () => {
    expect(competitionLine({ open: true, closesIn: 3 * 86400_000 + 4 * 3600_000, opensIn: null })).toBe("This week's competition (virtual cash) is live: 3d 4h left.");
    expect(competitionLine({ open: false, closesIn: null, opensIn: 26 * 3600_000 })).toBe("Next week's competition (virtual cash) opens in 1d 2h. Sign in now and start with $10,000 of virtual cash.");
    expect(competitionLine({ open: false, closesIn: null, opensIn: null })).toBeNull();
    expect(competitionLine(null)).toBeNull();
    // /start renders the same line in runs, so the countdown never breaks across two lines in its pill.
    expect(competitionLineParts({ open: true, closesIn: 3 * 3600_000 + 3 * 60_000, opensIn: null })).toEqual({
      before: "This week's competition (virtual cash) is live: ",
      countdown: "3h 03m",
      after: " left.",
      live: true,
    });
    expect(competitionLineParts({ open: false, closesIn: null, opensIn: 26 * 3600_000 })).toMatchObject({ countdown: "1d 2h", live: false });
    expect(competitionLineParts(null)).toBeNull();
  });

  it("names next week's competition on the weekend, when the API's open League starts after now", () => {
    // Sat 10 Oct: the League of 12 Oct already takes trades and closes Fri 16 Oct.
    const nextWeek = { open: true, closesIn: 6 * 86400_000 + 18 * 3600_000, opensIn: null, weekStart: "2026-10-12T00:00:00.000Z" };
    expect(competitionLine(nextWeek, "2026-10-10T01:00:00.000Z")).toBe("Next week's competition (virtual cash) is open: 6d 18h left. Weekend trades count.");
    // Once the week has started (or without the server's clock) it is this week's.
    expect(competitionLine(nextWeek, "2026-10-12T09:00:00.000Z")).toBe("This week's competition (virtual cash) is live: 6d 18h left.");
    expect(competitionLine(nextWeek)).toBe("This week's competition (virtual cash) is live: 6d 18h left.");
    expect(competitionLineParts(nextWeek, "2026-10-10T01:00:00.000Z")).toMatchObject({ countdown: "6d 18h", live: true });
  });
});
