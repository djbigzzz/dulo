import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CallMarketView, LeagueLeaderboardRow, PlayView, PlaysResponse } from "@/lib/api-client";
import type { PlayRule } from "@/lib/plays/rules";
import { STARTING_CASH_USD } from "@/lib/games/league";
import { VIRTUAL_CASH_USD } from "@/lib/games/ledger-policy";
import {
  GAME_TILE_ORDER,
  STRIKE_NOTE,
  TILE_COPY,
  TILE_PLACEHOLDER,
  competitionLaneFigure,
  competitionTileFigure,
  createSharedReads,
  crowdLead,
  flattenPlays,
  gapLabel,
  gaugePosition,
  nextQuestCheck,
  offerParts,
  onChainQuestTileStat,
  pickHeroMarkets,
  pickLiveMarkets,
  predictionsLaneFigure,
  predictionsTileFigure,
  questTileFigure,
  utcStamp,
  verbParts,
  type LandingWeek,
} from "@/components/landing/game-tiles";
import { WELCOME_OFFER_LINE } from "@/lib/games/ledger-policy";
import { NEXT_WEEK_MARKETS_COPY } from "@/components/calls/calls-format";
import { GameTiles, LivePredictions, SeasonTop } from "@/components/landing/ScoreboardPreview";

/**
 * The landing's three game tiles and the live prediction cards (approved wireframe, 16 Sep 2026).
 * Every number on them is read from /api/v1; nothing is ever made up while a read is pending.
 */

const ROOT = path.resolve(__dirname, "..");
const repoFile = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const NOW = Date.parse("2026-09-16T22:00:00.000Z");
const LOCKS = "2026-09-18T20:00:00.000Z";
const SETTLES = "2026-09-18T20:05:00.000Z";

function market(over: Partial<CallMarketView> & { total?: number } = {}): CallMarketView {
  const { total = 0, ...rest } = over;
  return {
    id: rest.id ?? `m-${rest.ticker ?? "NVDA"}`,
    ticker: "NVDA",
    symbol: "NVDAx",
    strike: 210,
    settleAt: SETTLES,
    locksAt: LOCKS,
    status: "open",
    yesPool: 0,
    noPool: 0,
    odds: { yesPool: 0, noPool: 0, total, yesProb: 0.5, noProb: 0.5, yesMultiplier: null, noMultiplier: null },
    settledPrice: null,
    outcome: null,
    source: null,
    quote: null,
    ...rest,
  };
}

function leader(over: Partial<LeagueLeaderboardRow> = {}): LeagueLeaderboardRow {
  return { rank: 1, userId: "u1", handle: null, address: null, equityUsd: 10_180, pnlPct: 1.8, isBot: false, delta: null, isMe: false, ...over };
}

function play(key: string, rule: PlayRule, comingSoon = false): PlayView {
  return {
    key,
    title: key,
    desc: "",
    points: 100,
    badgeKey: null,
    rule,
    status: "locked",
    completedAt: null,
    proof: null,
    completions: 0,
    comingSoon,
  };
}

function board(groups: PlayView[][]): PlaysResponse {
  return {
    season: null,
    signedIn: false,
    groups: groups.map((plays, i) => ({
      partner: { slug: `p${i}`, name: `P${i}`, logoUrl: null, blurb: "", links: {} },
      campaigns: [{ id: `c${i}`, title: `C${i}`, plays }],
    })),
  };
}

const HOLD: PlayRule = { type: "hold_any", minUsd: 5 };
const INTERNAL: PlayRule = { type: "internal_event", event: "call_placed", count: 1 };

/** Betting words and retired nouns never reach this copy. */
const BANNED = /\bstakes?\b|\bodds\b|\bpayouts?\b|\bbets?\b|prediction markets?|\bplays?\b|\bleague\b|probability/i;

describe("game tiles — copy", () => {
  it("lists Predictions, Competition and On-chain quests in nav order, each with one button", () => {
    expect(GAME_TILE_ORDER).toEqual(["predictions", "competition", "quests"]);
    expect(TILE_COPY.predictions).toMatchObject({ title: "Predictions", cta: "Make a prediction", href: "/predictions" });
    expect(TILE_COPY.competition).toMatchObject({ title: "Competition", cta: "Start with $10,000 virtual cash", href: "/competition" });
    expect(TILE_COPY.quests).toMatchObject({ title: "On-chain quests", cta: "See quests", href: "/quests" });
    for (const key of GAME_TILE_ORDER) expect(TILE_COPY[key].key).toBe(key);
  });

  it("keeps the virtual cash honest: the button matches the policy and the account's starting cash", () => {
    expect(VIRTUAL_CASH_USD).toBe(STARTING_CASH_USD);
    expect(TILE_COPY.competition.cta).toContain("$10,000");
    expect(TILE_COPY.competition.cta).toContain("virtual");
    expect(TILE_COPY.competition.note).toContain("virtual cash");
  });

  it("uses no betting or retired words", () => {
    for (const key of GAME_TILE_ORDER) {
      const { title, cta, note } = TILE_COPY[key];
      expect(`${title} ${cta} ${note}`, key).not.toMatch(BANNED);
    }
    for (const fig of [
      predictionsTileFigure([market({ total: 50 })], NOW),
      predictionsTileFigure([], NOW),
      competitionTileFigure({ leaderboard: [leader({ isBot: true })] }),
      competitionTileFigure({ leaderboard: [] }),
      questTileFigure({ value: "3 quests live", liveCount: 3, comingSoonCount: 2 }),
    ]) {
      expect(`${fig?.figure} ${fig?.line}`).not.toMatch(BANNED);
    }
  });
});

describe("predictionsTileFigure — points in this week's predictions", () => {
  it("sums the points in open and locked predictions only", () => {
    const markets = [
      market({ ticker: "NVDA", total: 500 }),
      market({ ticker: "SPY", total: 650 }),
      market({ ticker: "TSLA", total: 500, status: "locked" }),
      market({ ticker: "AAPL", total: 900, status: "settled", outcome: "yes" }),
      market({ ticker: "MSFT", total: 300, status: "void", outcome: "void" }),
    ];
    expect(predictionsTileFigure(markets, NOW)).toEqual({ figure: "1,650", line: "points in this week, incl. bot seed" });
  });

  it("says the total includes the house bots' seed, in the same words as the hero card", () => {
    // With one real account most of the pool is the bots' seed: the tile never reads as player activity.
    expect(predictionsTileFigure([market({ total: 1_900 })], NOW)?.line).toMatch(/incl\. bot seed$/);
    expect(repoFile("src/components/landing/ScoreboardPreview.tsx")).toContain("points in, incl. bot seed. Points only.");
  });

  it("still counts a prediction whose entries closed since the server answered", () => {
    const afterLock = Date.parse(LOCKS) + 60_000;
    expect(predictionsTileFigure([market({ total: 400 })], afterLock)?.figure).toBe("400");
  });

  it("reads 0 on a live board with nothing in yet, and skips a malformed total", () => {
    expect(predictionsTileFigure([market({ total: 0 })], NOW)?.figure).toBe("0");
    expect(predictionsTileFigure([market({ total: Number.NaN }), market({ ticker: "SPY", total: 25 })], NOW)?.figure).toBe("25");
  });

  it("says when the next board opens between weeks, never a stale total", () => {
    const between = { figure: "Between weeks", line: NEXT_WEEK_MARKETS_COPY };
    expect(predictionsTileFigure([], NOW)).toEqual(between);
    expect(predictionsTileFigure([market({ total: 900, status: "settled", outcome: "yes" })], NOW)).toEqual(between);
  });

  it("returns null while loading or after a failed read, never a made-up number", () => {
    expect(predictionsTileFigure(null, NOW)).toBeNull();
    expect(predictionsTileFigure(undefined, NOW)).toBeNull();
  });
});

describe("pickLiveMarkets — the hero's prediction cards", () => {
  it("shows up to three live predictions, open first, most points in first, ticker as the tie-break", () => {
    const markets = [
      market({ ticker: "TSLA", total: 500, status: "locked" }),
      market({ ticker: "NVDA", total: 500 }),
      market({ ticker: "SPY", total: 650 }),
      market({ ticker: "AMD", total: 500 }),
      market({ ticker: "AAPL", total: 999, status: "settled" }),
    ];
    const { shown, count } = pickLiveMarkets(markets, NOW);
    expect(shown.map((m) => m.ticker)).toEqual(["SPY", "AMD", "NVDA"]);
    expect(count).toBe(4);
    expect(pickLiveMarkets(markets, NOW, 1).shown.map((m) => m.ticker)).toEqual(["SPY"]);
  });

  it("is empty between Friday's settle and next week's board, and while loading", () => {
    expect(pickLiveMarkets([market({ status: "settled" })], NOW)).toEqual({ shown: [], count: 0 });
    expect(pickLiveMarkets(null, NOW)).toEqual({ shown: [], count: 0 });
  });
});

describe("pickHeroMarkets — the hero's stage and tabs (Broadcast, 9 Oct 2026)", () => {
  // The week of Mon 14 Sep 2026; NOW is Wed 16 Sep 22:00 UTC, Friday's close is 18 Sep 20:00 UTC.
  const MON = Date.parse("2026-09-14T00:00:00.000Z");
  const WEEK: LandingWeek = { monday: MON, nextMonday: MON + 7 * 86_400_000, weekend: false };

  it("during the week shows this week's live predictions, as pickLiveMarkets", () => {
    const markets = [market({ ticker: "SPY", total: 650 }), market({ ticker: "NVDA", total: 750 }), market({ ticker: "AAPL", total: 999, status: "settled" })];
    const pick = pickHeroMarkets(markets, NOW, WEEK);
    expect(pick.final).toBe(false);
    expect(pick.shown.map((m) => m.ticker)).toEqual(["NVDA", "SPY"]);
    expect(pick).toMatchObject(pickLiveMarkets(markets, NOW));
  });

  it("from Friday's close replays the week that just closed as final, not next week's open board", () => {
    const weekend = { ...WEEK, weekend: true };
    const after = Date.parse("2026-09-19T11:00:00.000Z");
    const closed = [
      market({ id: "a", ticker: "TSLA", total: 500, status: "settled", outcome: "no" }),
      market({ id: "b", ticker: "NVDA", total: 500, status: "settled", outcome: "yes" }),
      market({ id: "c", ticker: "SPY", total: 650, status: "settled", outcome: "no" }),
    ];
    const nextWeek = market({ id: "n", ticker: "NVDA", total: 300, settleAt: "2026-09-25T20:05:00.000Z", locksAt: "2026-09-24T20:00:00.000Z" });
    const pick = pickHeroMarkets([...closed, nextWeek], after, weekend);
    expect(pick.final).toBe(true);
    expect(pick.shown.map((m) => m.id)).toEqual(["c", "b", "a"]);
    expect(pick.count).toBe(3);
    // Nothing in the closed week (or no week known yet): the live board, never an empty hero.
    expect(pickHeroMarkets([nextWeek], after, weekend)).toEqual({ shown: [nextWeek], count: 1, final: false });
    expect(pickHeroMarkets([nextWeek], after, null).final).toBe(false);
    expect(pickHeroMarkets(null, after, weekend)).toEqual({ shown: [], count: 0, final: false });
  });
});

describe("the hero's price track — the live price against the line it has to beat", () => {
  it("puts the line in the middle and the price between 20% and 80% of the track", () => {
    expect(gaugePosition(234.25, 234.25)).toEqual({ p: 50, gap: 0 });
    const below = gaugePosition(234.01, 234.25)!;
    expect(below.gap).toBeCloseTo(-0.24, 6);
    expect(below.p).toBeLessThan(50);
    expect(below.p).toBeGreaterThan(20);
    const far = gaugePosition(774.81, 769.33)!;
    expect(far.p).toBeCloseTo(80, 6);
    expect(gaugePosition(1, 1_000)!.p).toBeCloseTo(20, 6);
  });

  it("draws no price it does not have", () => {
    expect(gaugePosition(null, 234.25)).toBeNull();
    expect(gaugePosition(undefined, 234.25)).toBeNull();
    expect(gaugePosition(Number.NaN, 234.25)).toBeNull();
    expect(gaugePosition(234, 0)).toBeNull();
  });

  it("says the gap in dollars, and calls the strike what it is", () => {
    expect(gapLabel(-0.24)).toBe("$0.24 below");
    expect(gapLabel(5.4807)).toBe("$5.48 above");
    expect(gapLabel(0.001)).toBe("At the line");
    // The strike is the price when the prediction opened (lib/games/calls STRIKE_LABEL), never "last Friday's close".
    expect(STRIKE_NOTE).toBe("price when it opened");
    expect(repoFile("src/lib/games/calls.ts")).toContain('STRIKE_LABEL = "price when the market opened"');
  });

  it("names the side most points are on, and says an empty pool or an even split in words", () => {
    expect(crowdLead({ total: 750, yesProb: 320 / 750 })).toEqual({ side: "no", pct: "57%" });
    expect(crowdLead({ total: 650, yesProb: 400 / 650 })).toEqual({ side: "yes", pct: "62%" });
    expect(crowdLead({ total: 0, yesProb: 0.5 })).toBeNull();
    expect(crowdLead({ total: 200, yesProb: 0.5 })).toBeNull();
    const src = repoFile("src/components/landing/ScoreboardPreview.tsx");
    expect(src).toContain('"No points in yet"');
    expect(src).toContain('"An even split"');
  });

  it("stamps times in UTC, as the week track does", () => {
    expect(utcStamp("2026-10-08T20:00:00.000Z")).toBe("Thu 8 Oct · 20:00 UTC");
    expect(utcStamp("nope")).toBe("");
  });
});

describe("the hero's tabs and copy", () => {
  it("names each tab by its visible text (WCAG 2.5.3) and draws an empty pool neutral, never as 50 / 50", () => {
    const src = repoFile("src/components/landing/ScoreboardPreview.tsx");
    const tabs = src.slice(src.indexOf("function MarketTabs"), src.indexOf("function TabsSkeleton"));
    expect(tabs).toContain('role="tab"');
    expect(tabs).toContain("aria-selected={on}");
    expect(tabs).toContain("tabIndex={on ? 0 : -1}");
    expect(tabs).not.toContain("aria-label={");
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) expect(tabs).toContain(`"${key}"`);
    const split = src.slice(src.indexOf("function SplitBar"), src.indexOf("const SOURCES"));
    expect(split).toContain('empty ? "bg-ink-4" : "bg-yes"');
    expect(split).toContain('{empty ? "Yes" : `${yes} Yes`}');
  });

  it("keeps the headline, the verbs and the welcome line byte-identical while it colours them", () => {
    expect(verbParts("Predict. Compete. Complete on-chain quests.")).toEqual({ lead: "Predict. Compete. ", rest: "Complete on-chain quests." });
    const offer = offerParts(WELCOME_OFFER_LINE);
    expect(offer.strong).toBe("1,000 starter points and $10,000 of virtual cash");
    expect(`${offer.lead}${offer.strong}${offer.rest}`).toBe(WELCOME_OFFER_LINE);
    // A line that does not have the expected shape renders whole, never cut.
    expect(offerParts("Points only.")).toEqual({ lead: "Points only.", strong: "", rest: "" });
  });
});

describe("the lanes — each game on the week", () => {
  const MON = Date.parse("2026-09-14T00:00:00.000Z");
  const WEEKEND: LandingWeek = { monday: MON, nextMonday: MON + 7 * 86_400_000, weekend: true };

  it("Predictions: this week's points in, or the week that just closed once it is final", () => {
    const markets = [
      market({ ticker: "NVDA", total: 500, status: "settled", outcome: "yes" }),
      market({ ticker: "SPY", total: 650, status: "settled", outcome: "no" }),
      market({ ticker: "TSLA", total: 300, status: "void", outcome: "void" }),
      market({ ticker: "AAPL", total: 999, settleAt: "2026-09-25T20:05:00.000Z", locksAt: "2026-09-24T20:00:00.000Z" }),
    ];
    expect(predictionsLaneFigure(markets, NOW, WEEKEND)).toEqual({ figure: "1,150", line: "points in, week of 14 Sep, incl. bot seed" });
    expect(predictionsLaneFigure(markets, NOW, { ...WEEKEND, weekend: false })).toEqual(predictionsTileFigure(markets, NOW));
    expect(predictionsLaneFigure(null, NOW, WEEKEND)).toBeNull();
  });

  it("Competition: the standings and how many are house bots, always with virtual cash", () => {
    const rows = [leader({ isBot: true }), leader({ rank: 2 }), leader({ rank: 3, isBot: true })];
    expect(competitionLaneFigure({ leaderboard: rows, lastSettled: null }, false)).toEqual({
      figure: "3",
      line: "on this week's virtual-cash standings, 2 of them house bots",
    });
    expect(competitionLaneFigure({ leaderboard: [leader({ isBot: true })], lastSettled: null }, false)?.line).toBe("on this week's virtual-cash standings, a house bot");
    expect(competitionLaneFigure({ leaderboard: [leader({ isBot: true }), leader({ isBot: true })], lastSettled: null }, false)?.line).toMatch(/all house bots$/);
    expect(competitionLaneFigure({ leaderboard: [], lastSettled: null }, false)).toEqual({ figure: "$10,000", line: "virtual cash to start" });
    const full = Array.from({ length: 50 }, (_, i) => leader({ rank: i + 1, isBot: i > 0 }));
    expect(competitionLaneFigure({ leaderboard: full, lastSettled: null }, false)).toEqual({ figure: "50+", line: "on this week's virtual-cash standings, house bots included" });
    // From Friday's close: the final #1 of the week that just closed.
    const lastSettled = { id: "l", weekStart: "", weekEnd: "", top: [leader({ isBot: true, pnlPct: 1.755 })] };
    expect(competitionLaneFigure({ leaderboard: [], lastSettled }, true)).toEqual({ figure: "+1.8%", line: "#1 at Friday's close · house bot · virtual cash" });
    expect(competitionLaneFigure(null, false)).toBeNull();
    for (const league of [{ leaderboard: rows, lastSettled: null }, { leaderboard: [], lastSettled }]) {
      expect(competitionLaneFigure(league, true)?.line).toMatch(/virtual/);
      expect(competitionLaneFigure(league, false)?.line).toMatch(/virtual/);
    }
  });

  it("Quests: the next check names the first live on-chain xStocks quest not yet complete", () => {
    const catalogue = board([
      [play("oracle", INTERNAL), { ...play("first_position", HOLD), title: "First Position", status: "complete" }, { ...play("diversified", HOLD), title: "Diversified", points: 250 }],
      [{ ...play("pre_ipo_position", HOLD), title: "Pre-IPO Position", assetSource: "prestocks" }],
    ]);
    expect(nextQuestCheck(catalogue)).toEqual({ title: "Diversified", points: 250 });
    expect(nextQuestCheck(board([[{ ...play("pre_ipo_position", HOLD), assetSource: "prestocks" }]]))).toBeNull();
    expect(nextQuestCheck(null)).toBeNull();
  });
});

describe("competitionTileFigure — the weekly competition leader (virtual cash)", () => {
  it("labels a house bot leader", () => {
    expect(competitionTileFigure({ leaderboard: [leader({ isBot: true, pnlPct: 0.79622 })] })).toEqual({
      figure: "+0.8%",
      line: "#1 this week · house bot · virtual cash",
    });
  });

  it("shows a real leader without the bot label, and a loss with a minus sign", () => {
    expect(competitionTileFigure({ leaderboard: [leader({ pnlPct: 1.8 }), leader({ rank: 2, isBot: true })] })).toEqual({
      figure: "+1.8%",
      line: "#1 this week · virtual cash",
    });
    expect(competitionTileFigure({ leaderboard: [leader({ pnlPct: -0.42 })] })?.figure).toBe("−0.4%");
  });

  it("offers the starting virtual cash when nobody has traded this week", () => {
    expect(competitionTileFigure({ leaderboard: [] })).toEqual({ figure: "$10,000", line: "virtual cash to start" });
  });

  it("returns null while loading or after a failed read", () => {
    expect(competitionTileFigure(null)).toBeNull();
    expect(competitionTileFigure(undefined)).toBeNull();
  });

  it("always says virtual cash beside the figure", () => {
    for (const league of [{ leaderboard: [] }, { leaderboard: [leader()] }, { leaderboard: [leader({ isBot: true })] }]) {
      expect(competitionTileFigure(league)?.line).toMatch(/virtual cash/);
    }
  });
});

describe("onChainQuestTileStat — quests verified from a wallet", () => {
  const catalogue = board([
    [
      play("first_position", HOLD),
      play("diversified", { type: "diversified", minAssets: 3, minSectors: 2 }),
      play("mirror", { type: "mirror_match", tolerance: 0.2 }),
    ],
    [play("jupiter_dca", { type: "hold_any", minUsd: 1, partnerAssetIds: [] }, true)],
    [play("kamino_collateral", { type: "hold_any", minUsd: 1, partnerAssetIds: [] }, true)],
    [play("oracle", INTERNAL), play("scout", { type: "internal_event", event: "league_trade", count: 3 })],
  ]);

  it("counts live on-chain quests and never the coming-soon or in-platform ones", () => {
    expect(onChainQuestTileStat(catalogue)).toEqual({ value: "3 quests live", liveCount: 3, comingSoonCount: 2 });
    expect(questTileFigure(onChainQuestTileStat(catalogue))).toEqual({ figure: "3", line: "quests live, verified from your wallet" });
  });

  it("counts a quest listed under two partners once", () => {
    const twice = board([[play("first_position", HOLD)], [play("first_position", HOLD)]]);
    expect(flattenPlays(twice)).toHaveLength(1);
    expect(onChainQuestTileStat(twice)).toEqual({ value: "1 quest live", liveCount: 1, comingSoonCount: 0 });
    expect(questTileFigure(onChainQuestTileStat(twice))).toEqual({ figure: "1", line: "quest live, verified from your wallet" });
  });

  it("reads 0 when only in-platform quests exist, and null while loading", () => {
    expect(onChainQuestTileStat(board([[play("oracle", INTERNAL)]]))?.value).toBe("0 quests live");
    expect(questTileFigure(onChainQuestTileStat(board([[play("oracle", INTERNAL)]])))?.figure).toBe("0");
    expect(onChainQuestTileStat(null)).toBeNull();
    expect(onChainQuestTileStat(undefined)).toBeNull();
    expect(questTileFigure(null)).toBeNull();
  });
});

describe("createSharedReads — one request per endpoint per page load", () => {
  it("shares a pending request between the hero cards and the tiles", async () => {
    const reads = createSharedReads(30_000);
    const fetcher = vi.fn(async () => ({ ok: 1 }));
    const [a, b] = await Promise.all([reads.get("calls", fetcher), reads.get("calls", fetcher)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    // Other endpoints are separate requests.
    await reads.get("league", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reuses a settled read inside the window and reads again after it", async () => {
    let now = 1_000;
    const reads = createSharedReads(30_000, () => now);
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    expect(await reads.get("plays", fetcher)).toBe(1);
    now += 29_999;
    expect(await reads.get("plays", fetcher)).toBe(1);
    now += 1;
    expect(await reads.get("plays", fetcher)).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    reads.clear();
    expect(await reads.get("plays", fetcher)).toBe(3);
  });

  it("drops a failed read at once so a retry starts a new request", async () => {
    const reads = createSharedReads(30_000);
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValueOnce("fresh");
    const first = reads.get("board", fetcher);
    const shared = reads.get("board", fetcher);
    await expect(first).rejects.toThrow("500");
    await expect(shared).rejects.toThrow("500");
    expect(await reads.get("board", fetcher)).toBe("fresh");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("turns a fetcher that throws synchronously into a rejected read", async () => {
    const reads = createSharedReads(30_000);
    await expect(
      reads.get("x", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("wires every landing endpoint through the shared reads exactly once", () => {
    const src = repoFile("src/components/landing/ScoreboardPreview.tsx");
    expect(src).toContain("const SHARED_READS = createSharedReads(");
    for (const call of ['"/api/v1/plays"', '"/api/v1/leaderboard?limit=3"']) {
      expect(src.split(call).length - 1, call).toBe(1);
    }
    // /calls and /league are the shell's shared reads (the week track under the header draws on the
    // same two requests): the landing takes them from WeekData once each and never fetches them itself.
    for (const call of ["useCallsQuery(", "useLeagueQuery("]) expect(src.split(call).length - 1, call).toBe(1);
    for (const call of ["api.calls(", "leagueApi.overview("]) expect(src, call).not.toContain(call);
    const shared = repoFile("src/components/layout/WeekData.tsx");
    for (const call of ["api.calls({ signal })", "leagueApi.overview({ signal })"]) expect(shared.split(call).length - 1, call).toBe(1);
    expect(repoFile("src/components/layout/AppShell.tsx")).toContain("<WeekDataProvider>");
    // The hero ranking card was cut on 9 Oct 2026; the Season top 3 moved to the closing section.
    expect(src).not.toContain("export function RankCard");
    expect(src).toContain("export function SeasonTop");
    // No per-component fetch helpers left behind.
    expect(src).not.toMatch(/\buseLoad\(/);
  });
});

describe("GameTiles and the hero cards — first frame, before any read", () => {
  it("prints an em dash for every tile number while loading, never a figure", () => {
    const html = renderToStaticMarkup(createElement(GameTiles));
    expect(TILE_PLACEHOLDER).toBe("—");
    expect(html.split(`>${TILE_PLACEHOLDER}<`).length - 1).toBe(3);
    expect(html).not.toContain("pts in this week");
    expect(html).not.toContain("quests live");
    expect(html).not.toContain("#1");
    for (const key of GAME_TILE_ORDER) {
      expect(html).toContain(TILE_COPY[key].title);
      expect(html).toContain(`href="${TILE_COPY[key].href}"`);
    }
    expect(html).toContain("Make a prediction");
    expect(html).toContain("Start with $10,000 virtual cash");
    expect(html).toContain("See quests");
    expect(html).toContain("tabular-nums");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toMatch(BANNED);
  });

  it("shows one featured-card skeleton while loading, never a figure", () => {
    const cards = renderToStaticMarkup(createElement(LivePredictions));
    expect(cards).toContain('aria-busy="true"');
    expect(cards.match(/data-slot="skeleton"/g)?.length ?? 0).toBeGreaterThan(0);
    // The placeholder holds the three tabs of a normal week too, so the hero keeps its height (and
    // nothing under it jumps) when the board arrives.
    expect(cards.match(/data-slot="tab-skeleton"/g)?.length ?? 0).toBe(3);
    expect(cards).not.toContain("points in");
    expect(cards).not.toContain("Locks in");
    // No split figure in the text while the board loads.
    expect(cards).not.toMatch(/>\d+%</);
    // The Season top 3 renders nothing while it loads: never an empty board or a skeleton.
    expect(renderToStaticMarkup(createElement(SeasonTop))).toBe("");
  });

  it("draws the focus ring on every landing link that turns the global outline off", () => {
    for (const rel of ["src/components/landing/ScoreboardPreview.tsx", "src/app/page.tsx"]) {
      const src = repoFile(rel);
      const links = [...src.matchAll(/<Link\s[^>]*?className=(?:"([^"]*)"|\{cn\(\s*"([^"]*)")/g)].map((m) => m[1] ?? m[2]);
      expect(links.length, rel).toBeGreaterThan(0);
      for (const cls of links.filter((c) => /\boutline-none\b/.test(c))) {
        expect(cls, rel).toContain("focus-visible:ring-2 focus-visible:ring-[var(--focus)]");
      }
    }
  });

  it("keeps the stage's header whole on a narrow phone and says what changes once entries close", () => {
    const src = repoFile("src/components/landing/ScoreboardPreview.tsx");
    const stage = src.slice(src.indexOf("function Stage("), src.indexOf("function StageSkeleton"));
    // The kick's items never break mid-phrase.
    expect(stage).toContain('<b className="font-semibold whitespace-nowrap text-foreground">');
    expect(stage).toContain('<span className="whitespace-nowrap">');
    // Locked or final, the action is the board, never one nobody can take until next week.
    expect(stage).toContain('final ? "See all results" : status === "open" ? "Make a prediction" : "See predictions"');
    // The clock counts to the lock, then says Locked, Settling, or the result; it shows its time in UTC.
    const clock = src.slice(src.indexOf("function Clock("), src.indexOf("function Crowd("));
    for (const word of [">Locks in<", '"Locked"', '"Settling"', '"Result"', '"Entries closed"']) expect(clock).toContain(word);
    expect(clock).toContain('role="timer"');
  });

  it("keeps every animation and transition behind motion-reduce (Broadcast: no entrance animations)", () => {
    for (const rel of ["src/components/landing/ScoreboardPreview.tsx", "src/app/page.tsx", "src/components/landing/CheckWalletBox.tsx"]) {
      const src = repoFile(rel);
      for (const list of src.match(/"[^"]*\banimate-(?:in|ping|pulse|spin)\b[^"]*"/g) ?? []) expect(list, rel).toContain("motion-reduce:animate-none");
      for (const list of src.match(/"[^"]*\btransition-(?:colors|opacity|transform|\[[^\]]*\])[^"]*"/g) ?? []) expect(list, rel).toContain("motion-reduce:transition-none");
    }
    // The shared Skeleton pulses; the landing's wrapper turns it off for reduced motion.
    expect(repoFile("src/components/landing/ScoreboardPreview.tsx")).toMatch(/<Skeleton className=\{cn\("[^"]*motion-reduce:animate-none/);
    // Under reduced motion the lock clock drops its seconds and ticks once a minute, as the week track does.
    expect(repoFile("src/components/landing/ScoreboardPreview.tsx")).toContain("reduced ? 60_000 : 1_000");
  });

  it("keeps gold to the hero's one primary action and the 'now' marks, and greys every logo", () => {
    const src = repoFile("src/components/landing/ScoreboardPreview.tsx");
    // Gold only on the "now" tag above the lanes and the "now" line through them.
    expect(src.match(/\bbg-signal\b/g)).toHaveLength(2);
    expect(src).not.toMatch(/buttonVariants\(\{\s*(variant: "default"|size)/);
    // The page itself: one gold way in per sign-in state (the hero's), the closing band's in cream.
    const page = repoFile("src/app/page.tsx");
    const connects = page.match(/<ConnectButton\b[^>]*\/>/g) ?? [];
    expect(connects.filter((c) => !/variant="(?:secondary|outline)"/.test(c))).toHaveLength(1);
    const tours = page.match(/<ContinueTour\b[^>]*\/>/g) ?? [];
    expect(tours.filter((t) => !/variant="secondary"/.test(t))).toHaveLength(1);
    // Every xStock logo goes through the shared well, which draws it in greyscale.
    expect(src).toContain('import { XStockLogo } from "@/components/common/XStockLogo"');
    expect(src).not.toMatch(/<img\b/);
    expect(repoFile("src/components/common/XStockLogo.tsx")).toContain("logo-greyscale");
    // Green and red only mean Yes / No.
    expect(src).not.toMatch(/emerald|rose-|text-green|text-red/);
  });
});
