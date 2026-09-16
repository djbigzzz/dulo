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
  TILE_COPY,
  TILE_PLACEHOLDER,
  competitionTileStat,
  createSharedReads,
  flattenPlays,
  onChainQuestTileStat,
  pickLiveMarkets,
  predictionsTileStat,
  questTileNote,
} from "@/components/landing/game-tiles";
import { GameTiles, LivePredictions, RankCard } from "@/components/landing/ScoreboardPreview";

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
    expect(questTileNote(null)).not.toMatch(BANNED);
  });
});

describe("predictionsTileStat — points in this week's predictions", () => {
  it("sums the points in open and locked predictions only", () => {
    const markets = [
      market({ ticker: "NVDA", total: 500 }),
      market({ ticker: "SPY", total: 650 }),
      market({ ticker: "TSLA", total: 500, status: "locked" }),
      market({ ticker: "AAPL", total: 900, status: "settled", outcome: "yes" }),
      market({ ticker: "MSFT", total: 300, status: "void", outcome: "void" }),
    ];
    expect(predictionsTileStat(markets, NOW)).toBe("1,650 pts in this week");
  });

  it("still counts a prediction whose entries closed since the server answered", () => {
    const afterLock = Date.parse(LOCKS) + 60_000;
    expect(predictionsTileStat([market({ total: 400 })], afterLock)).toBe("400 pts in this week");
  });

  it("reads 0 on a live board with nothing in yet, and skips a malformed total", () => {
    expect(predictionsTileStat([], NOW)).toBe("0 pts in this week");
    expect(predictionsTileStat([market({ total: 0 })], NOW)).toBe("0 pts in this week");
    expect(predictionsTileStat([market({ total: Number.NaN }), market({ ticker: "SPY", total: 25 })], NOW)).toBe("25 pts in this week");
  });

  it("returns null while loading or after a failed read, never a made-up number", () => {
    expect(predictionsTileStat(null, NOW)).toBeNull();
    expect(predictionsTileStat(undefined, NOW)).toBeNull();
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

describe("competitionTileStat — the weekly competition leader (virtual cash)", () => {
  it("labels a house bot leader", () => {
    expect(competitionTileStat({ leaderboard: [leader({ isBot: true, pnlPct: 0.79622 })] })).toEqual({
      value: "#1 +0.8% this week",
      note: "virtual cash · house bot",
    });
  });

  it("shows a real leader without the bot label, and a loss with a minus sign", () => {
    expect(competitionTileStat({ leaderboard: [leader({ pnlPct: 1.8 }), leader({ rank: 2, isBot: true })] })).toEqual({
      value: "#1 +1.8% this week",
      note: "virtual cash",
    });
    expect(competitionTileStat({ leaderboard: [leader({ pnlPct: -0.42 })] })?.value).toBe("#1 −0.4% this week");
  });

  it("offers the starting virtual cash when nobody has traded this week", () => {
    expect(competitionTileStat({ leaderboard: [] })).toEqual({ value: "$10,000", note: "virtual cash to start" });
  });

  it("returns null while loading or after a failed read", () => {
    expect(competitionTileStat(null)).toBeNull();
    expect(competitionTileStat(undefined)).toBeNull();
  });

  it("always says virtual cash next to the number", () => {
    for (const league of [{ leaderboard: [] }, { leaderboard: [leader()] }, { leaderboard: [leader({ isBot: true })] }]) {
      expect(competitionTileStat(league)?.note).toMatch(/^virtual cash/);
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
    expect(questTileNote(onChainQuestTileStat(catalogue))).toBe("Verified from your wallet · 2 coming soon");
  });

  it("counts a quest listed under two partners once", () => {
    const twice = board([[play("first_position", HOLD)], [play("first_position", HOLD)]]);
    expect(flattenPlays(twice)).toHaveLength(1);
    expect(onChainQuestTileStat(twice)).toEqual({ value: "1 quest live", liveCount: 1, comingSoonCount: 0 });
    expect(questTileNote(onChainQuestTileStat(twice))).toBe("Verified from your wallet");
  });

  it("reads 0 when only in-platform quests exist, and null while loading", () => {
    expect(onChainQuestTileStat(board([[play("oracle", INTERNAL)]]))?.value).toBe("0 quests live");
    expect(onChainQuestTileStat(null)).toBeNull();
    expect(onChainQuestTileStat(undefined)).toBeNull();
    expect(questTileNote(null)).toBe("Verified from your wallet");
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
    for (const call of ["api.calls()", "leagueApi.overview()", '"/api/v1/plays"', '"/api/v1/leaderboard?limit=3"']) {
      expect(src.split(call).length - 1, call).toBe(1);
    }
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

  it("shows prediction skeletons (one below lg) and a neutral ranking skeleton while loading", () => {
    const cards = renderToStaticMarkup(createElement(LivePredictions));
    expect(cards).toContain('aria-busy="true"');
    expect(cards.match(/data-slot="skeleton"/g)?.length ?? 0).toBeGreaterThan(0);
    expect(cards.split("hidden lg:flex").length - 1).toBe(2);
    expect(cards).not.toContain("pts in");
    const rank = renderToStaticMarkup(createElement(RankCard));
    expect(rank).toContain("Leaderboard");
    expect(rank).not.toContain("quality_screen");
  });

  it("keeps every animation behind motion-reduce", () => {
    for (const rel of ["src/components/landing/ScoreboardPreview.tsx", "src/app/page.tsx"]) {
      const src = repoFile(rel);
      const classLists = src.match(/"[^"]*\banimate-(?:in|ping|pulse|spin)\b[^"]*"/g) ?? [];
      expect(classLists.length, rel).toBeGreaterThan(0);
      for (const list of classLists) expect(list, rel).toContain("motion-reduce:animate-none");
    }
    // The shared Skeleton pulses; the landing's wrapper turns it off for reduced motion.
    expect(repoFile("src/components/landing/ScoreboardPreview.tsx")).toMatch(/<Skeleton className=\{cn\("[^"]*motion-reduce:animate-none/);
  });
});
