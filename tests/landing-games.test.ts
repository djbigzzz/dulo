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
  COMPACT_ROW_EMPTY,
  GAME_TILE_ORDER,
  TILE_COPY,
  TILE_PLACEHOLDER,
  compactRowCopy,
  competitionTileFigure,
  createSharedReads,
  flattenPlays,
  onChainQuestTileStat,
  pickLiveMarkets,
  predictionsTileFigure,
  questTileFigure,
} from "@/components/landing/game-tiles";
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
    expect(repoFile("src/components/landing/ScoreboardPreview.tsx")).toContain("pts in, incl. bot seed");
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

describe("compactRowCopy — the hero card's other predictions", () => {
  const row = (over: Partial<CallMarketView> & { total?: number; yesProb?: number } = {}) => {
    const { yesProb = 0.5, ...rest } = over;
    const m = market(rest);
    return { ...m, odds: { ...m.odds, yesProb, noProb: 1 - yesProb } };
  };

  it("names the row by its visible text first (WCAG 2.5.3), then the full question", () => {
    const copy = compactRowCopy(row({ ticker: "TSLA", strike: 400, total: 500, yesProb: 0.64 }));
    expect(copy.label).toBe("TSLA above $400.00");
    expect(copy.split).toBe("64% Yes");
    expect(copy.name.startsWith("TSLA above $400.00, 64% Yes. ")).toBe(true);
    expect(copy.name).toMatch(/Will TSLA close above \$400\.00 on .+\?$/);
  });

  it("says an empty pool instead of drawing a 50/50, on screen and in the name alike", () => {
    const copy = compactRowCopy(row({ ticker: "SPY", strike: 769.33, total: 0 }));
    expect(COMPACT_ROW_EMPTY).toBe("No points yet");
    expect(copy.split).toBe(COMPACT_ROW_EMPTY);
    expect(copy.name.startsWith("SPY above $769.33, No points yet. ")).toBe(true);
    expect(copy.name).not.toContain("50%");
    expect(`${copy.label} ${copy.split}`).not.toMatch(BANNED);
  });

  it("draws an empty pool's row track neutral and gives the strike the room below 400px", () => {
    const src = repoFile("src/components/landing/ScoreboardPreview.tsx");
    const rowSrc = src.slice(src.indexOf("function CompactRow"), src.indexOf("function LiveLabel"));
    expect(rowSrc).toContain('empty ? "bg-white/[0.06]" : "bg-rose-400/40"');
    expect(rowSrc).toContain("min-[400px]:flex");
    expect(rowSrc).not.toContain("min-[360px]:flex");
    expect(rowSrc).toContain("aria-label={name}");
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
    // The placeholder holds the two compact rows of a normal week too, so the card keeps its height
    // (and the hero does not jump) when the board arrives.
    expect(cards.match(/class="flex min-h-12 items-center/g)?.length ?? 0).toBe(2);
    expect(cards).not.toContain("pts in");
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

  it("keeps the locked card's header whole on a narrow phone: two items that wrap, never mid-phrase", () => {
    const src = repoFile("src/components/landing/ScoreboardPreview.tsx");
    expect(src).toContain('<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">');
    expect(src).toMatch(/whitespace-nowrap text-muted-foreground tabular-nums">\{lockLabel\(market, now\)\}/);
    const label = src.slice(src.indexOf("function LiveLabel"), src.indexOf("const CARD_ACTION"));
    expect(label.match(/inline-flex items-center gap-2 text-xs font-medium whitespace-nowrap/g)).toHaveLength(2);
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
