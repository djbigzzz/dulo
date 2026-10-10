import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LeagueLeaderboardRow } from "@/lib/api-client";
import { LeagueLeaderboard, houseBotLegend, openSeatPlace } from "@/components/league/LeagueLeaderboard";
import { settledWeekTitle } from "@/components/league/LastWeek";
import { leagueClockLabel } from "@/components/league/LeagueCountdown";
import { formatUtcDayDotTime, formatUtcWeekday, ordinal, pnlClass } from "@/components/league/format";

/**
 * The competition's standings in the Broadcast look (9 Oct 2026): the board is the hero, house
 * bots are dimmed and carry the bot mark (the legend says once how many there are), the open seat
 * ("Your slot") sits where a new player would start at 0.00%, and a cream rule under 10th marks the
 * places that earn Season points. Static renders only; no network, no DB.
 */

const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const BANNED = /\b(stakes?|odds|payouts?|bets?|betting|league|mirror|calls?|plays?)\b/i;

function row(rank: number, pnlPct: number, over: Partial<LeagueLeaderboardRow> = {}): LeagueLeaderboardRow {
  return {
    rank,
    userId: `u${rank}`,
    handle: `bot_${rank}`,
    address: `Addr${String(rank).padStart(40, "1")}`,
    equityUsd: 10_000 * (1 + pnlPct / 100),
    pnlPct,
    isBot: true,
    delta: 0,
    isMe: false,
    ...over,
  };
}

/** The 8 Oct board: seven bots up, the one real player at 8th just under zero, the rest down. */
const BOARD: LeagueLeaderboardRow[] = [
  ...[1.76, 0.77, 0.52, 0.46, 0.37, 0.13, 0.03].map((p, i) => row(i + 1, p)),
  row(8, -0.027317, { handle: null, address: "G6Miqs4m2maHwj91YBCboEwY5NoasLVwL3woVXh2gXjM", isBot: false, userId: "real" }),
  row(9, -0.22, { delta: 1 }),
  row(10, -0.5, { delta: -1 }),
  row(11, -0.53, { delta: 2 }),
  row(12, -2.16, { delta: null }),
];

describe("the open seat and the legend", () => {
  it("puts a new player after every return at or above 0.00% (at the 2 decimals the board prints)", () => {
    expect(openSeatPlace(BOARD)).toBe(8);
    expect(openSeatPlace([])).toBe(1);
    expect(openSeatPlace([row(1, 0.5), row(2, 0.1)])).toBe(3);
    expect(openSeatPlace([row(1, -0.1)])).toBe(1);
    // -0.004% prints as 0.00%, so the seat lands after it, never above a row that reads the same.
    expect(openSeatPlace([row(1, 0.004), row(2, -0.004), row(3, -0.01)])).toBe(3);
  });

  it("says once how many of the players are house bots, counted from the board", () => {
    expect(houseBotLegend(BOARD, 50)).toBe("11 of 12 are house bots");
    expect(houseBotLegend(BOARD.filter((r) => r.isBot), 50)).toBe("All 11 are house bots");
    expect(houseBotLegend([row(1, 0, { isBot: false })], 50)).toBeNull();
    expect(houseBotLegend(Array.from({ length: 50 }, (_, i) => row(i + 1, 0, { isBot: i % 2 === 0 })), 50)).toBe("25 of the top 50 are house bots");
  });

  it("formats the places, the clock line and the settled week by hand (no locale commas)", () => {
    expect([1, 2, 3, 4, 8, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "8th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
    expect(formatUtcDayDotTime("2026-10-09T20:00:00.000Z")).toBe("Fri 9 Oct · 20:00 UTC");
    expect(formatUtcWeekday("2026-09-04T20:00:00.000Z")).toBe("Fri 4 Sep");
    expect(formatUtcDayDotTime("nonsense")).toBe("");
    expect(settledWeekTitle({ weekStart: "2026-09-28T00:00:00.000Z" }, "2026-10-05T00:00:00.000Z")).toBe("Last week");
    expect(settledWeekTitle({ weekStart: "2026-09-28T00:00:00.000Z" }, null)).toBe("Week of 28 Sep");
    expect(settledWeekTitle({ weekStart: "2026-09-21T00:00:00.000Z" }, "2026-10-05T00:00:00.000Z")).toBe("Week of 21 Sep");
  });

  it("words the page clock for the week, the weekend and a settling week", () => {
    const week = { open: true, weekStart: "2026-10-05T00:00:00.000Z" };
    expect(leagueClockLabel(week, "2026-10-08T13:58:00.000Z")).toBe("Closes in");
    expect(leagueClockLabel({ open: true, weekStart: "2026-10-12T00:00:00.000Z" }, "2026-10-09T22:00:00.000Z")).toBe("Next week closes in");
    expect(leagueClockLabel({ open: false, weekStart: "2026-10-05T00:00:00.000Z" }, "2026-10-09T20:00:05.000Z")).toBe("Next week opens in");
  });

  it("colours gains green and losses red with the Broadcast tokens, flat muted", () => {
    expect(pnlClass(1.2)).toBe("text-yes");
    expect(pnlClass(-0.3)).toBe("text-no");
    expect(pnlClass(0.001)).toBe("text-muted-foreground");
    expect(pnlClass(null)).toBe("text-muted-foreground");
  });
});

describe("the standings board", () => {
  const board = (props: Partial<React.ComponentProps<typeof LeagueLeaderboard>> = {}) =>
    html(
      createElement(LeagueLeaderboard, {
        rows: BOARD,
        chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        seat: { signedIn: false, action: createElement("button", { type: "button" }, "Connect wallet") },
        pointsCut: 10,
        pointsNote: "Top 10 with 3+ paper trades earn Season points",
        ...props,
      }),
    );

  it("is a labelled table whose open seat sits where 0.00% would rank, carrying Connect", () => {
    const h = board();
    expect(h).toContain('role="table" aria-label="This week\'s standings"');
    expect(h.match(/role="columnheader"/g)).toHaveLength(5);
    const seat = h.indexOf('data-slot="league-open-seat"');
    expect(seat).toBeGreaterThan(h.indexOf('data-user-id="u7"'));
    expect(seat).toBeLessThan(h.indexOf('data-user-id="real"'));
    const seatHtml = h.slice(seat, h.indexOf('data-user-id="real"'));
    expect(seatHtml).toContain("Your slot");
    expect(seatHtml).toContain("$10,000 virtual cash, you would start 8th at 0.00%");
    expect(seatHtml).toContain("Connect wallet");
    // Signed in before a first trade: the same seat, saying where that trade lands.
    expect(board({ seat: { signedIn: true } })).toContain("$10,000 virtual cash, your first trade starts you 8th");
    expect(board({ seat: null })).not.toContain('data-slot="league-open-seat"');
  });

  it("dims and marks every house bot, lights the real player, and tags the caller as You", () => {
    const h = board();
    expect(h.match(/data-bot=""/g)).toHaveLength(11);
    expect(h.match(/aria-label="House bot, never earns points"/g)).toHaveLength(11);
    // Bots below the points line are dimmed further; real players never are.
    expect(h).toMatch(/data-user-id="u11" data-bot=""[^>]*class="[^"]*opacity-70/);
    const real = h.slice(h.indexOf('data-user-id="real"'), h.indexOf('data-user-id="u9"'));
    expect(real).toContain("G6Mi…gXjM");
    expect(real).toContain("Player");
    expect(real).toContain("before:bg-foreground");
    expect(real).not.toContain("opacity-70");
    // The address opens the explorer in a new tab.
    expect(real).toMatch(/<a href="[^"]+G6Miqs4m2maHwj91YBCboEwY5NoasLVwL3woVXh2gXjM[^"]*" target="_blank" rel="noopener noreferrer"/);
    const mine = board({ rows: BOARD.map((r) => (r.userId === "real" ? { ...r, isMe: true } : r)), seat: null });
    const me = mine.slice(mine.indexOf('data-user-id="real"'), mine.indexOf('data-user-id="u9"'));
    expect(me).toContain('aria-current="true"');
    expect(me).toContain(">You<");
    expect(me).not.toContain(">Player<");
  });

  it("draws the points line under 10th only, and the moves without dashes", () => {
    const h = board();
    const line = h.indexOf('data-slot="league-points-line"');
    expect(line).toBeGreaterThan(h.indexOf('data-user-id="u10"'));
    expect(line).toBeLessThan(h.indexOf('data-user-id="u11"'));
    expect(text(h)).toContain("In the points Top 10 with 3+ paper trades earn Season points");
    expect(board({ rows: BOARD.slice(0, 9) })).not.toContain('data-slot="league-points-line"');
    // ▲ / ▼ with the places moved; nothing at all for no move or no previous rank.
    expect(text(h)).toContain("▲1");
    expect(text(h)).toContain("▼1");
    expect(text(h)).not.toMatch(/ – /);
    expect(h).toContain("up 2");
  });

  it("prints every return from one zero line, signed, and keeps the bars out of the table", () => {
    const h = board();
    expect(text(h)).toContain("+1.76%");
    expect(text(h)).toContain("−0.03%");
    expect(text(h)).toContain("−2.16%");
    // The zero line's head and bars are decorative (every number they draw is in Return).
    expect(h).toMatch(/<span class="[^"]*md:flex" aria-hidden="true">vs \$10,000<\/span>/);
    expect(h.match(/<i class="[^"]*(bg-yes|bg-no)/g)?.length).toBe(BOARD.length);
    // The widest move spans half the column, so 2.16% draws at 50%.
    expect(h).toContain('style="width:50.00%"');
    // Green and red mean gain and loss only: no other hue on the board.
    expect(h).not.toMatch(/emerald|rose-|amber|sky-|blue-/);
  });

  it("appends the caller's own row when it ranks below the board the page holds", () => {
    const extra = row(57, -0.9, { userId: "me:1", handle: null, isBot: false, isMe: true });
    const h = board({ seat: null, extraMe: extra });
    expect(h.indexOf('data-user-id="me:1"')).toBeGreaterThan(h.indexOf('data-user-id="u12"'));
    expect(text(h)).toContain("Rank 57");
  });

  it("uses plain names and no betting words", () => {
    const t = text(board());
    expect(t).not.toMatch(BANNED);
    expect(t).toContain("virtual cash");
  });
});
