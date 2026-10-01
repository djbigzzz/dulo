import { describe, expect, it } from "vitest";
import { START_PATH, shareOnXUrl, shareText } from "@/components/start/share";

// /start share post: the prefilled X text a player can post after a prediction. Plain names only
// (points only, no betting words), and the link back to /start.

const URL_ = "https://dulo-iota.vercel.app/start";

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
