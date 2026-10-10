import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ROUTE_RENAMES } from "../next.config";
import type { CallPositionView, LeagueTradeView, PartnerGroup, PlaysResponse, PlayView } from "@/lib/api-client";
import { MIN_TRADES_FOR_WEEKLY_POINTS } from "@/lib/games/ledger-policy";
import { SEASON0_PLAYS, activePlays, playAssetSource } from "@/lib/plays/catalogue";
import { findScoutPlay } from "@/components/league/scout";
import { competitionLine } from "@/components/start/share";
import { TourProgress, TourStep } from "@/components/start/TourStep";
import { BoardStepBody, QuestsStepBody, TourFinish } from "@/components/start/TourBodies";
import {
  TOUR_COPY,
  TOUR_HREFS,
  TOUR_ORDER,
  TOUR_QUICK_BUY_USD,
  TOUR_STEP_TEASER,
  TOUR_STEP_TITLE,
  TOUR_TRADES_TARGET,
  TOUR_TRADE_SOURCES,
  WEEK_TRADES_SHOWN,
  boardLine,
  boardSummary,
  completeLine,
  competeUnavailableLine,
  completedQuests,
  deriveTour,
  findFirstHoldingQuest,
  findFirstPredictionQuest,
  latestPick,
  nextUpLine,
  nextUpQuests,
  openStepKey,
  predictionSummary,
  questsSummary,
  showFinish,
  shownStepState,
  tourHeading,
  tradesSummary,
  walkReveal,
  walletLine,
  walletReadState,
  type TourInput,
  type TourState,
} from "@/components/start/tour";

/**
 * The /start tour (8 Oct 2026): four steps (Predict, Compete, Quests, Board) derived from server
 * data only, plus the copy, the components and the page's wiring. No mocks: the logic is pure, the
 * components are presentational, and the page is read as source.
 */

const ROOT = path.resolve(__dirname, "..");
const repoFile = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const NOW = "2026-10-08T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const ago = (sec: number) => new Date(NOW_MS - sec * 1000).toISOString();

// ---------------------------------------------------------------------------
// Fixture: the Season 0 board as GET /api/v1/plays sends it to a signed-in player
// ---------------------------------------------------------------------------

type Over = Partial<Pick<PlayView, "status" | "proof" | "completedAt" | "assetSource">>;

function board(over: Record<string, Over> = {}, drop: readonly string[] = []): PlaysResponse {
  const groups = new Map<string, PartnerGroup>();
  for (const p of SEASON0_PLAYS) {
    if (drop.includes(p.key)) continue;
    const view: PlayView = {
      key: p.key,
      title: p.title,
      desc: p.desc,
      points: p.points,
      badgeKey: p.badgeKey ?? null,
      rule: p.rule,
      // Coming-soon rows are always "locked"; every live row is "in_progress" until complete.
      status: p.comingSoon ? "locked" : "in_progress",
      completedAt: null,
      proof: null,
      completions: 0,
      comingSoon: p.comingSoon === true,
      assetSource: playAssetSource(p),
      ...over[p.key],
    };
    let group = groups.get(p.partnerSlug);
    if (!group) {
      group = { partner: { slug: p.partnerSlug, name: p.partnerSlug, logoUrl: null, blurb: "", links: {} }, campaigns: [{ id: `c-${p.partnerSlug}`, title: p.campaignTitle, plays: [] }] };
      groups.set(p.partnerSlug, group);
    }
    group.campaigns[0].plays.push(view);
  }
  return { season: null, signedIn: true, groups: [...groups.values()] };
}

const complete = (at: string, proof: unknown = {}): Over => ({ status: "complete", completedAt: at, proof });
const progress = (current: number, target: number): Over => ({ proof: { reason: "not_enough_events", progress: { current, target, unit: "events" } } });
const play = (data: PlaysResponse, key: string): PlayView => {
  const found = data.groups.flatMap((g) => g.campaigns.flatMap((c) => c.plays)).find((p) => p.key === key);
  if (!found) throw new Error(`no ${key} on the fixture board`);
  return found;
};
const catalogue = (key: string) => {
  const p = SEASON0_PLAYS.find((x) => x.key === key);
  if (!p) throw new Error(`no ${key} in the catalogue`);
  return p;
};

function position(marketId: string, side: "yes" | "no", points: number, createdAt: string): CallPositionView {
  return { marketId, side, points, potentialPayout: points * 2, result: "pending", payout: null, createdAt };
}

function trades(n: number): LeagueTradeView[] {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i}`, symbol: "TSLAx", side: "buy" as const, qty: 1, price: 400, priceSource: "jupiter", ts: ago(60 * (i + 1)) }));
}

const WALLET_READ: Over = { proof: { reason: "no_in_scope_holding", takenAt: ago(30), minUsd: 5 } };

const BASE: TourInput = {
  signedIn: true,
  predictionOpen: true,
  positions: [],
  plays: board(),
  league: { open: true },
  leagueMe: null,
  points: { seasonPoints: 0, rank: null },
};
const tour = (over: Partial<TourInput> = {}): TourState => deriveTour({ ...BASE, ...over });
const states = (t: TourState) => t.steps.map((s) => s.state);

/** Everything done: a prediction, three trades, the wallet read, a rank. */
const ALL_DONE: Partial<TourInput> = {
  positions: [position("m1", "yes", 100, ago(600))],
  plays: board({ first_position: WALLET_READ, scout: complete(ago(300)), oracle: complete(ago(600)) }),
  leagueMe: { trades: trades(3) },
  points: { seasonPoints: 175, rank: 1 },
};

// ---------------------------------------------------------------------------
// deriveTour
// ---------------------------------------------------------------------------

describe("deriveTour", () => {
  it("signed out with a prediction open: step 1 is current, the rest later, nothing done", () => {
    const t = deriveTour({ ...BASE, signedIn: false, plays: null, points: null });
    expect(t.steps.map((s) => s.key)).toEqual(["predict", "compete", "quests", "board"]);
    expect(TOUR_ORDER).toEqual(["predict", "compete", "quests", "board"]);
    expect(states(t)).toEqual(["current", "todo", "todo", "todo"]);
    expect(t).toMatchObject({ signedIn: false, current: "predict", done: 0, total: 4, actionsDone: false });
    // Signed out, nothing counts, whatever the inputs say.
    expect(deriveTour({ ...BASE, ...ALL_DONE, signedIn: false }).done).toBe(0);
  });

  it("signed out while predictions are locked (Thursday to Friday's settle): step 1 is not open, and stays the open row", () => {
    const t = deriveTour({ ...BASE, signedIn: false, predictionOpen: false, plays: null });
    expect(states(t)).toEqual(["unavailable", "todo", "todo", "todo"]);
    expect(t.current).toBeNull();
    expect(openStepKey(t, null, false)).toBe("predict");
    expect(showFinish(t, "end")).toBe(false);
  });

  it("fresh sign-in: step 1 is current", () => {
    const t = tour();
    expect(states(t)).toEqual(["current", "todo", "todo", "todo"]);
    expect(t).toMatchObject({ current: "predict", done: 0, actionsDone: false });
    expect(openStepKey(t, null, true)).toBe("predict");
  });

  it("a position counts even while First Prediction is still in progress (the inline check timed out)", () => {
    const t = tour({ positions: [position("m1", "no", 100, ago(5))] });
    expect(play(BASE.plays!, "oracle").status).toBe("in_progress");
    expect(states(t).slice(0, 2)).toEqual(["done", "current"]);
    expect(t.current).toBe("compete");
  });

  it("First Prediction complete with no position this Season still counts", () => {
    expect(states(tour({ plays: board({ oracle: complete(ago(86_400 * 7)) }) }))[0]).toBe("done");
  });

  it("step 2: three paper trades this week, or First Paper Trades complete after the weekly reset", () => {
    expect(states(tour({ leagueMe: { trades: trades(2) } }))[1]).not.toBe("done");
    expect(states(tour({ leagueMe: { trades: trades(3) } }))[1]).toBe("done");
    // Rollover: `me` is null in the new week, the quest stays complete.
    expect(states(tour({ leagueMe: null, plays: board({ scout: complete(ago(86_400 * 3)) }) }))[1]).toBe("done");
    expect(TOUR_TRADES_TARGET).toBe(MIN_TRADES_FOR_WEEKLY_POINTS);
    expect((catalogue("scout").rule as { count: number }).count).toBe(TOUR_TRADES_TARGET);
  });

  it("step 2 is not open while the competition takes no paper trades; with step 1 done the actions are done", () => {
    const closed = tour({ league: { open: false } });
    expect(states(closed)[1]).toBe("unavailable");
    expect(closed.actionsDone).toBe(false);
    const t = tour({ league: { open: false }, positions: [position("m1", "yes", 100, ago(5))] });
    expect(states(t).slice(0, 2)).toEqual(["done", "unavailable"]);
    expect(t.actionsDone).toBe(true);
    expect(t.current).toBe("quests");
    // Predictions locked too: the walk starts at once, from step 3.
    const both = tour({ league: { open: false }, predictionOpen: false });
    expect(both.actionsDone).toBe(true);
    expect(openStepKey(both, null, false)).toBe("quests");
  });

  it("predictions locked: step 1 is not open right now and the tour starts with step 2", () => {
    const t = tour({ predictionOpen: false });
    expect(states(t)).toEqual(["unavailable", "current", "todo", "todo"]);
    expect(openStepKey(t, null, false)).toBe("compete");
    expect(tourHeading(t, false)).toBe(TOUR_COPY.headingTour);
  });

  it("step 3 ticks once Solana has been read for the holding quest, whatever it found", () => {
    const quests = (o: Over | null, drop: string[] = []) => states(tour({ plays: board(o ? { first_position: o } : {}, drop) }))[2];
    expect(quests({ proof: null })).not.toBe("done");
    expect(quests({ proof: { reason: "no_snapshots" } })).not.toBe("done");
    expect(quests(WALLET_READ)).toBe("done");
    expect(quests({ proof: { reason: "below_min_usd", symbol: "NVDAx", usd: 3.2, minUsd: 5, takenAt: ago(30) } })).toBe("done");
    expect(quests(complete(ago(30), { symbol: "TSLAx", usd: 400, priceSource: "jupiter", takenAt: ago(30) }))).toBe("done");
    // No holding quest seeded at all: nothing to wait for.
    expect(quests(null, ["first_position", "thousand_club"])).toBe("done");
    // No board yet (loading or failed): not done.
    expect(states(tour({ plays: null }))[2]).not.toBe("done");
  });

  it("step 4 ticks with a rank and Season points above zero", () => {
    expect(states(tour({ points: { seasonPoints: 0, rank: null } }))[3]).not.toBe("done");
    expect(states(tour({ points: { seasonPoints: 50, rank: 1 } }))[3]).toBe("done");
    expect(states(tour({ points: { seasonPoints: 0, rank: 1 } }))[3]).not.toBe("done");
    expect(states(tour({ points: null }))[3]).not.toBe("done");
    expect(states(tour({ points: undefined }))[3]).not.toBe("done");
  });

  it("counts the done steps; everything done leaves no current step", () => {
    const t = tour(ALL_DONE);
    expect(states(t)).toEqual(["done", "done", "done", "done"]);
    expect(t).toMatchObject({ done: 4, current: null, actionsDone: true });
    expect(tour({ positions: [position("m1", "yes", 100, ago(5))] }).done).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The open step, the walk and the finish card
// ---------------------------------------------------------------------------

describe("openStepKey and showFinish", () => {
  const done = tour(ALL_DONE);
  // The two actions done, steps 3 and 4 not yet ticked: the walk is what opens them.
  const walking = tour({ ...ALL_DONE, plays: board({ scout: complete(ago(300)) }), points: { seasonPoints: 0, rank: null } });

  it("before the actions are done the current step opens and no reveal applies", () => {
    const t = tour();
    expect(openStepKey(t, "quests", false)).toBe("predict");
    expect(showFinish(t, "end")).toBe(false);
    expect(showFinish(deriveTour({ ...BASE, signedIn: false }), null)).toBe(false);
  });

  it("the walk opens step 3, then step 4, even when they are already done", () => {
    expect(openStepKey(done, "quests", false)).toBe("quests");
    expect(openStepKey(done, "board", false)).toBe("board");
    expect(openStepKey(walking, "quests", false)).toBe("quests");
    expect(showFinish(done, "quests")).toBe(false);
    expect(showFinish(done, "board")).toBe(false);
  });

  it('"end" shows the finish card, and opens step 1 only for an unanswered featured question', () => {
    expect(showFinish(done, "end")).toBe(true);
    expect(openStepKey(done, "end", false)).toBeNull();
    expect(openStepKey(done, "end", true)).toBe("predict");
    // Finished early: steps 3 and 4 not ticked yet, the finish card still shows after "end".
    expect(showFinish(walking, "end")).toBe(true);
    expect(tourHeading(walking, true)).toBe(TOUR_COPY.headingFinished);
  });

  it("a returning player with everything done gets the finish card straight away; a new featured question opens step 1", () => {
    expect(showFinish(done, null)).toBe(true);
    expect(openStepKey(done, null, false)).toBeNull();
    expect(openStepKey(done, null, true)).toBe("predict");
    // Not everything done and not walking: the first open step, no finish card.
    expect(showFinish(walking, null)).toBe(false);
    expect(openStepKey(walking, null, false)).toBe("quests");
  });

  it("the walk opens step 3 in the same render the actions turn done: the finish card never flashes first", () => {
    // The demo path: a prediction (First Prediction gives a rank), the wallet read at sign-in, then
    // the third trade. Steps 1, 3 and 4 are already done, so step 2 completing leaves no current step.
    const trading = tour({ ...ALL_DONE, leagueMe: { trades: trades(2) }, plays: board({ first_position: WALLET_READ, oracle: complete(ago(600)) }) });
    expect(states(trading)).toEqual(["done", "current", "done", "done"]);
    expect(trading.actionsDone).toBe(false);
    expect(walkReveal(trading, null, null)).toBeNull();
    // The first board to answer after the trade (the other still refetching) shows step 2 done.
    expect(done.current).toBeNull();
    const shown = walkReveal(done, null, false);
    expect(shown).toBe("quests");
    expect(showFinish(done, shown)).toBe(false);
    expect(openStepKey(done, shown, false)).toBe("quests");
    expect(tourHeading(done, showFinish(done, shown))).toBe(TOUR_COPY.headingTour);
    // Arrived (or signed in, or switched account) with both done: no walk, the finish card.
    expect(walkReveal(done, null, null)).toBeNull();
    expect(walkReveal(done, null, true)).toBeNull();
    expect(showFinish(done, walkReveal(done, null, null))).toBe(true);
    // A walk already under way keeps its place.
    expect(walkReveal(done, "board", false)).toBe("board");
    expect(walkReveal(done, "end", false)).toBe("end");
    expect(walkReveal(deriveTour({ ...BASE, ...ALL_DONE, signedIn: false }), null, false)).toBeNull();
  });

  it("a step opened or closed by hand wins while signed in, and never once signed out", () => {
    const t = tour();
    expect(openStepKey(t, null, true, { key: "board" })).toBe("board");
    expect(openStepKey(t, null, true, { key: null })).toBeNull();
    expect(openStepKey(done, "quests", false, { key: "predict" })).toBe("predict");
    expect(openStepKey(t, null, true, null)).toBe("predict");
    // Signed out on the same tab: step 1 (this week's MarketCard) is the open row again.
    const out = deriveTour({ ...BASE, signedIn: false, plays: null });
    expect(openStepKey(out, null, false, { key: "board" })).toBe("predict");
    expect(openStepKey(out, null, false, { key: null })).toBe("predict");
  });

  it("once the finish card is up, no step reads as your next step", () => {
    // Finished early with the wallet unread: step 3 is still "current" underneath.
    const unread = tour({ ...ALL_DONE, plays: board({ scout: complete(ago(300)), oracle: complete(ago(600)) }) });
    expect(states(unread)).toEqual(["done", "done", "current", "done"]);
    expect(showFinish(unread, "end")).toBe(true);
    expect(unread.steps.map((s) => shownStepState(s.state, true))).toEqual(["done", "done", "todo", "done"]);
    expect(unread.steps.map((s) => shownStepState(s.state, false))).toEqual(states(unread));
    expect(shownStepState("unavailable", true)).toBe("unavailable");
  });

  it("the heading follows the tour", () => {
    expect(tourHeading(deriveTour({ ...BASE, signedIn: false }), false)).toBe("Make your first prediction");
    expect(tourHeading(tour(), false)).toBe("Make your first prediction");
    expect(tourHeading(tour({ positions: [position("m1", "yes", 100, ago(5))] }), false)).toBe("Your tour of Dulo");
    expect(tourHeading(done, true)).toBe("You've seen all of Dulo");
  });
});

// ---------------------------------------------------------------------------
// Quests are found by rule, never by key
// ---------------------------------------------------------------------------

describe("finding quests by rule", () => {
  it("First Prediction is oracle, not Three or Five Predictions", () => {
    expect(findFirstPredictionQuest(board())?.key).toBe("oracle");
    expect(findFirstPredictionQuest(board({}, ["oracle"]))).toBeNull();
    expect(findFirstPredictionQuest(null)).toBeNull();
  });

  it("the holding quest is first_position, never Thousand Club, Index Holder, Pre-IPO Position or a partner quest", () => {
    expect(findFirstHoldingQuest(board())?.key).toBe("first_position");
    // Without it, the next xStocks hold_any by minUsd; never a scoped, pre-IPO or partner one.
    expect(findFirstHoldingQuest(board({}, ["first_position"]))?.key).toBe("thousand_club");
    expect(findFirstHoldingQuest(board({}, ["first_position", "thousand_club"]))).toBeNull();
    // An older payload without assetSource: Pre-IPO Position (minUsd 0) is still skipped, by its key.
    expect(findFirstHoldingQuest(board({ pre_ipo_position: { assetSource: undefined } }))?.key).toBe("first_position");
    // Partner quests stay skipped even if they went live (their asset list is a partner list).
    const live = board({}, ["first_position", "thousand_club"]);
    for (const g of live.groups) for (const c of g.campaigns) for (const p of c.plays) p.comingSoon = false;
    expect(findFirstHoldingQuest(live)).toBeNull();
  });

  it("First Paper Trades is scout", () => {
    expect(findScoutPlay(board())?.key).toBe("scout");
  });

  it("reads the wallet state off the proof", () => {
    const fp = (o: Over) => play(board({ first_position: o }), "first_position");
    expect(walletReadState(null)).toBe("none");
    expect(walletReadState(fp({ proof: null }))).toBe("unread");
    expect(walletReadState(fp({ proof: { reason: "no_snapshots" } }))).toBe("unread");
    expect(walletReadState(fp(WALLET_READ))).toBe("empty");
    expect(walletReadState(fp({ proof: { reason: "below_min_usd" } }))).toBe("below");
    expect(walletReadState(fp(complete(ago(5))))).toBe("complete");
  });
});

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

describe("lists", () => {
  it("completedQuests drops the pre-IPO quests and orders by completion", () => {
    const data = board({
      oracle: complete(ago(100)),
      scout: complete(ago(200)),
      pre_ipo_position: complete(ago(300)),
      first_preipo_trade: complete(ago(250)),
      first_position: complete(ago(50)),
    });
    expect(completedQuests(data).map((p) => p.key)).toEqual(["scout", "oracle", "first_position"]);
    expect(completedQuests(null)).toEqual([]);
  });

  it("nextUpQuests reads proof.progress, skips untouched, complete, on-chain and pre-IPO quests, and caps at 3", () => {
    const data = board({
      paper_portfolio_five: progress(3, 5),
      three_predictions: progress(1, 3),
      game_days: progress(1, 3),
      five_predictions: progress(1, 5),
      ten_paper_trades: progress(0, 10),
      scout: { ...complete(ago(5)), proof: { progress: { current: 3, target: 3 } } },
      preipo_trio: progress(2, 3),
      diversified: { proof: { reason: "too_few_assets", progress: { current: 2, target: 3 } } },
    });
    const next = nextUpQuests(data, 3);
    expect(next).toEqual([
      { title: "Five-Stock Paper Portfolio", current: 3, target: 5 },
      { title: "Three Predictions", current: 1, target: 3 },
      { title: "Three Game Days", current: 1, target: 3 },
    ]);
    expect(nextUpLine(next)).toBe("Next up: Five-Stock Paper Portfolio 3/5 · Three Predictions 1/3 · Three Game Days 1/3");
    expect(nextUpQuests(data, 10).map((n) => n.title)).toEqual(["Five-Stock Paper Portfolio", "Three Predictions", "Three Game Days", "Five Predictions"]);
    expect(nextUpLine([])).toBeNull();
    expect(nextUpQuests(board())).toEqual([]);
  });

  it("latestPick is the newest position, joined to its question", () => {
    const markets = [
      { id: "m1", ticker: "NVDA", strike: 224.94 },
      { id: "m2", ticker: "TSLA", strike: 410 },
    ];
    const positions = [position("m1", "yes", 100, ago(3600)), position("m2", "no", 250, ago(60))];
    expect(latestPick(positions, markets)).toEqual({ ticker: "TSLA", strike: 410, side: "no", points: 250 });
    expect(latestPick([position("gone", "yes", 10, ago(1)), ...positions], markets)?.ticker).toBe("TSLA");
    expect(latestPick([], markets)).toBeNull();
  });

  it("latestPick skips a settled prediction: never 'points in' or 'this Friday' for last week's question", () => {
    const markets = [
      { id: "last-week", ticker: "NVDA", strike: 224.94 },
      { id: "this-week", ticker: "TSLA", strike: 410 },
    ];
    const settled = (marketId: string, result: "won" | "lost" | "refunded", createdAt: string): CallPositionView => ({
      ...position(marketId, "yes", 100, createdAt),
      result,
      payout: result === "lost" ? 0 : 180,
    });
    // A returning player whose only position is last week's, now settled: no pick, no share link.
    for (const result of ["won", "lost", "refunded"] as const) expect(latestPick([settled("last-week", result, ago(60))], markets)).toBeNull();
    const firstPrediction = { title: "First Prediction", status: "complete" as const };
    expect(predictionSummary(latestPick([settled("last-week", "won", ago(60))], markets), firstPrediction)).toBe("First Prediction complete");
    // A newer settled one never hides an older one still open.
    const open = position("this-week", "no", 250, ago(3600));
    expect(latestPick([settled("last-week", "won", ago(60)), open], markets)).toEqual({ ticker: "TSLA", strike: 410, side: "no", points: 250 });
  });

  it("completeLine lists the complete quests with their points", () => {
    expect(completeLine([])).toBe("No quest complete yet.");
    const data = board({ oracle: complete(ago(100)), scout: complete(ago(50)) });
    expect(completeLine(completedQuests(data))).toBe("Complete: First Prediction +50 · First Paper Trades +50");
  });
});

// ---------------------------------------------------------------------------
// Line builders
// ---------------------------------------------------------------------------

const FP = play(board(), "first_position");
const withProof = (proof: unknown) => ({ ...FP, proof });

describe("line builders", () => {
  it("walletLine says what Solana read, for every state and both nouns", () => {
    const verified = withProof({ symbol: "TSLAx", usd: 412.5, priceSource: "jupiter", takenAt: ago(120), qty: 1.1 });
    expect(walletLine(verified, "complete", 1, NOW_MS)).toBe(
      "Verified on-chain 2m ago: your wallet holds TSLAx worth $412.50 (Jupiter price). First Position complete, +100.",
    );
    expect(walletLine(verified, "complete", 2, NOW_MS)).toBe(
      "Verified on-chain 2m ago: your connected wallets hold TSLAx worth $412.50 (Jupiter price). First Position complete, +100.",
    );
    expect(walletLine(withProof({ reason: "no_in_scope_holding", takenAt: ago(2), minUsd: 5 }), "empty", 1, NOW_MS)).toBe(
      "Read from Solana just now: your wallet holds no xStock. On-chain quests check every connected wallet when you sign in and again through the day; there is nothing to submit.",
    );
    const below = walletLine(withProof({ reason: "below_min_usd", symbol: "NVDAx", usd: 3.21, minUsd: 5, takenAt: ago(300) }), "below", 3, NOW_MS);
    expect(below).toBe("Read from Solana 5m ago: your connected wallets hold NVDAx, below the $5.00 that First Position reads.");
    expect(below).not.toContain("3.21");
    expect(walletLine(withProof(null), "unread", 1, NOW_MS)).toBe("Waiting for the first read of your wallet from Solana.");
    expect(walletLine(withProof({ reason: "no_snapshots" }), "unread", 2, NOW_MS)).toBe("Waiting for the first read of your connected wallets from Solana.");
    expect(walletLine(null, "none", 1, NOW_MS)).toBeNull();
  });

  it("walletLine leaves the age out when the proof has no takenAt", () => {
    expect(walletLine(withProof({ reason: "no_in_scope_holding" }), "empty", 1, NOW_MS)).toBe(
      "Read from Solana: your wallet holds no xStock. On-chain quests check every connected wallet when you sign in and again through the day; there is nothing to submit.",
    );
    expect(walletLine(withProof({ symbol: "SPYx", usd: 20, priceSource: "pyth" }), "complete", 1, NOW_MS)).toBe(
      "Verified on-chain: your wallet holds SPYx worth $20.00 (Pyth price). First Position complete, +100.",
    );
  });

  it("predictionSummary for YES and NO, and the quest when no position is left this Season", () => {
    expect(predictionSummary({ ticker: "NVDA", strike: 224.94, side: "yes", points: 100 }, null)).toBe("You said YES: NVDA closes above $224.94 · 100 points in");
    expect(predictionSummary({ ticker: "TSLA", strike: 410, side: "no", points: 1250 }, null)).toBe("You said NO: TSLA stays below $410.00 · 1,250 points in");
    expect(predictionSummary(null, { title: "First Prediction", status: "complete" })).toBe("First Prediction complete");
    expect(predictionSummary(null, { title: "First Prediction", status: "in_progress" })).toBeNull();
  });

  it("tradesSummary for 1, 3 and 20+ paper trades, with and without a rank", () => {
    const scout = play(board(), "scout");
    expect(tradesSummary({ trades: trades(1), cashUsd: 9000, rank: 4 }, scout)).toBe("1 paper trade this week · $9,000.00 virtual cash left · #4 this week");
    expect(tradesSummary({ trades: trades(3), cashUsd: 7000, rank: null }, scout)).toBe("3 paper trades this week · $7,000.00 virtual cash left");
    expect(tradesSummary({ trades: trades(WEEK_TRADES_SHOWN), cashUsd: 12.5, rank: 1 }, scout)).toBe("20+ paper trades this week · $12.50 virtual cash left · #1 this week");
    expect(tradesSummary(null, { ...scout, status: "complete" })).toBe("First Paper Trades complete");
    expect(tradesSummary(null, scout)).toBeNull();
    // "20+" is the server's trade cap; read as source, so nothing server-only is imported.
    expect(repoFile("src/lib/games/league.ts")).toContain(`RECENT_TRADES_LIMIT = ${WEEK_TRADES_SHOWN};`);
  });

  it("boardLine and boardSummary: Season points and a rank, never an 'of N'", () => {
    expect(boardLine({ seasonPoints: 175, rank: 1 })).toBe("You: 175 Season points · Rank #1");
    expect(boardLine({ seasonPoints: 0, rank: null })).toBe("You: 0 Season points · Not ranked yet");
    expect(boardSummary({ seasonPoints: 1250, rank: 12 })).toBe("1,250 Season points · Rank #12");
    expect(boardLine(null)).toBeNull();
    expect(boardSummary(undefined)).toBeNull();
    for (const s of [boardLine({ seasonPoints: 175, rank: 1 }), boardSummary({ seasonPoints: 0, rank: null })]) expect(s).not.toMatch(/\bof\b/);
  });

  it("questsSummary counts the complete quests and says where the wallet stands", () => {
    expect(questsSummary(2, "complete")).toBe("2 quests complete · wallet verified on-chain");
    expect(questsSummary(1, "empty")).toBe("1 quest complete · wallet read from Solana");
    expect(questsSummary(0, "below")).toBe("0 quests complete · wallet read from Solana");
    expect(questsSummary(3, "unread")).toBe("3 quests complete · wallet not read yet");
    expect(questsSummary(1, "none")).toBe("1 quest complete");
  });

  it("competeUnavailableLine: when the next week opens, else the Season line", () => {
    const weekend = { open: false, closesIn: null, opensIn: 26 * 3_600_000 };
    expect(competeUnavailableLine(weekend)).toBe(competitionLine(weekend));
    expect(competeUnavailableLine({ open: false, closesIn: null, opensIn: null })).toBe(TOUR_COPY.competeUnavailable);
    expect(competeUnavailableLine(null)).toBe(TOUR_COPY.competeUnavailable);
  });
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** Copied from tests/plain-names.test.ts BANNED (lines 28-42). */
const BANNED: RegExp[] = [
  /(?<!\b(?:to|you|we|they) )\bplays?\b/i,
  /\bleagues?\b/i,
  /\bmirror(?:s|ed|ing)?\b/i,
  /\bcalls?\b/i,
  /\bscout\b/i,
  /\boracle\b/i,
  /\bDCA streak\b/i,
  /\bstakes?\b|\bstaked\b|\bstaking\b/i,
  /\bodds\b/i,
  /\bpayouts?\b/i,
  /\bbets?\b|\bbetting\b/i,
  /\bprediction markets?\b/i,
  /every transaction is a play/i,
  /\brewards?\b/i,
];

function copyValues(): string[] {
  const out: string[] = [];
  for (const v of Object.values(TOUR_COPY)) {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") out.push(v(2));
    else out.push(...Object.values(v as Record<string, string>));
  }
  return out;
}

function generatedLines(): string[] {
  const fp = play(board(), "first_position");
  const scout = play(board(), "scout");
  const data = board({ oracle: complete(ago(100)), scout: complete(ago(50)), paper_portfolio_five: progress(3, 5), three_predictions: progress(1, 3) });
  return [
    predictionSummary({ ticker: "NVDA", strike: 224.94, side: "yes", points: 100 }, null),
    predictionSummary({ ticker: "NVDA", strike: 224.94, side: "no", points: 100 }, null),
    predictionSummary(null, { title: "First Prediction", status: "complete" }),
    tradesSummary({ trades: trades(1), cashUsd: 9000, rank: 4 }, scout),
    tradesSummary({ trades: trades(25), cashUsd: 9000, rank: null }, scout),
    tradesSummary(null, { ...scout, status: "complete" }),
    completeLine([]),
    completeLine(completedQuests(data)),
    nextUpLine(nextUpQuests(data)),
    walletLine({ ...fp, proof: { symbol: "TSLAx", usd: 400, priceSource: "jupiter", takenAt: ago(10) } }, "complete", 1, NOW_MS),
    walletLine({ ...fp, proof: { reason: "no_in_scope_holding", takenAt: ago(10) } }, "empty", 2, NOW_MS),
    walletLine({ ...fp, proof: { reason: "below_min_usd", symbol: "NVDAx", minUsd: 5, takenAt: ago(10) } }, "below", 1, NOW_MS),
    walletLine({ ...fp, proof: null }, "unread", 1, NOW_MS),
    ...(["complete", "empty", "below", "unread", "none"] as const).map((s) => questsSummary(1, s)),
    boardLine({ seasonPoints: 175, rank: 1 }),
    boardSummary({ seasonPoints: 0, rank: null }),
    competeUnavailableLine({ open: false, closesIn: null, opensIn: 3_600_000 }),
    competeUnavailableLine(null),
  ].filter((s): s is string => typeof s === "string");
}

/** Quest titles are proper names ("First Paper Trades", "Paper Portfolio"); the rules below apply to the running copy around them. */
const TITLES = [...SEASON0_PLAYS.map((p) => p.title)].sort((a, b) => b.length - a.length);
const withoutTitles = (s: string) => TITLES.reduce((t, title) => t.split(title).join(" "), s);

describe("tour copy", () => {
  const all = [...copyValues(), ...generatedLines(), ...Object.values(TOUR_STEP_TITLE), ...Object.values(TOUR_STEP_TEASER).filter((s): s is string => s !== null)];

  it("is the verbatim copy", () => {
    expect(TOUR_COPY.headingStart).toBe("Make your first prediction");
    expect(TOUR_COPY.progress(3)).toBe("3 of 4 done");
    expect(TOUR_COPY.predictLocked).toBe("This week's predictions are locked. Next week's predictions open right after Friday's settle.");
    expect(TOUR_COPY.stateLabel).toEqual({ done: "done", current: "your next step", todo: "later", unavailable: "not open right now" });
    expect(TOUR_COPY.finishCopy).toBe("Copy a wallet's portfolio");
    expect(all.length).toBeGreaterThan(60);
  });

  it("passes the plain-names ban: no Play, League, Call, Mirror, Scout, Oracle or betting word", () => {
    for (const s of all) for (const re of BANNED) expect(re.test(s), `${re} in ${JSON.stringify(s)}`).toBe(false);
  });

  it("never says buy or tradable, and never names a pre-IPO token", () => {
    for (const s of all) {
      expect(s, s).not.toMatch(/\bbuy\b/i);
      expect(s, s).not.toMatch(/tradable/i);
      expect(s, s).not.toMatch(/pre-IPO|PreStocks/i);
    }
  });

  it("puts virtual cash beside every mention of the competition or a paper trade", () => {
    let checked = 0;
    for (const s of all) {
      const running = withoutTitles(s);
      if (!/competition/i.test(running) && !/paper/i.test(running)) continue;
      checked++;
      expect(running, s).toMatch(/virtual[- ]cash/i);
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("quotes the catalogue's points", () => {
    const pts = (key: string) => catalogue(key).points;
    expect(TOUR_COPY.competeBody).toContain(`First Paper Trades (+${pts("scout")})`);
    expect(TOUR_COPY.finishBody).toContain(`Three Game Days (+${pts("game_days")})`);
    expect(TOUR_COPY.competeHint).toContain(`$${TOUR_QUICK_BUY_USD.toLocaleString("en-US")}`);
    // Every quest the tour names by title is live in the catalogue.
    const live = new Set(activePlays().map((p) => p.title));
    for (const title of ["First Paper Trades", "Three Game Days"]) expect(live.has(title), title).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Renders
// ---------------------------------------------------------------------------

const noop = () => undefined;
const PINNED = /\b(fixed|sticky)\b/;
const classTokens = (h: string) => [...h.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));

describe("renders", () => {
  it("a current step is the open, expanded one", () => {
    const h = html(createElement(TourStep, { index: 1, stepKey: "predict", title: "Make a prediction", state: "current", open: true, onToggle: noop }, createElement("p", null, "body")));
    expect(h).toContain('aria-current="step"');
    expect(h).toContain('aria-expanded="true"');
    expect(h).toContain('aria-controls="tour-step-predict"');
    expect(h).toContain('id="tour-step-predict"');
    expect(h).toContain(", your next step");
    expect(h).toContain("<p>body</p>");
    expect(h).toMatch(/<h2[^>]*><button type="button"/);
  });

  it("a done step folds to its summary", () => {
    const summary = "You said YES: NVDA closes above $224.94 · 100 points in";
    const h = html(createElement(TourStep, { index: 1, stepKey: "predict", title: "Make a prediction", state: "done", open: false, summary, onToggle: noop }, createElement("p", null, "body")));
    expect(h).toContain(summary);
    expect(h).toContain('aria-expanded="false"');
    expect(h).not.toContain("aria-controls");
    expect(h).not.toContain("<p>body</p>");
    expect(h).not.toContain("aria-current");
    expect(h).toContain(", done");
    // Open, the summary gives way to the body.
    const opened = html(createElement(TourStep, { index: 1, stepKey: "predict", title: "Make a prediction", state: "done", open: true, summary, onToggle: noop }, createElement("p", null, "body")));
    expect(opened).not.toContain(summary);
  });

  it("without onToggle it is a static row: no button", () => {
    const h = html(createElement(TourStep, { index: 3, stepKey: "quests", title: TOUR_COPY.questsTitle, state: "todo", open: false, summary: TOUR_COPY.questsTeaser, onToggle: null }));
    expect(h).not.toContain("<button");
    expect(h).toContain(TOUR_COPY.questsTeaser);
    expect(h).toContain(">3<");
    expect(h).toContain(", later");
    const locked = html(createElement(TourStep, { index: 1, stepKey: "predict", title: "Make a prediction", state: "unavailable", open: false, onToggle: null }));
    expect(locked).toContain(", not open right now");
    expect(locked).not.toContain(">1<");
  });

  it("QuestsStepBody offers Read my wallet now only while the wallet is unread", () => {
    const props = { completeLine: "Complete: First Prediction +50", nextUpLine: null, walletLine: "Waiting for the first read of your wallet from Solana.", showReadNow: true, reading: false, onReadNow: noop, onNext: null, loading: false, error: null, onRetry: noop };
    const h = html(createElement(QuestsStepBody, props));
    expect(h).toContain("Read my wallet now");
    expect(h).toContain("Complete: First Prediction +50");
    expect(h).toContain('href="/quests"');
    expect(h).toContain(TOUR_COPY.questsAll);
    expect(h).not.toContain(TOUR_COPY.questsNext);
    expect(html(createElement(QuestsStepBody, { ...props, showReadNow: false }))).not.toContain("Read my wallet now");
    expect(html(createElement(QuestsStepBody, { ...props, reading: true }))).toContain("Reading your wallet");
    expect(html(createElement(QuestsStepBody, { ...props, onNext: noop }))).toContain("Next: the leaderboard");
    const failed = html(createElement(QuestsStepBody, { ...props, error: "Request failed (500)" }));
    expect(failed).toContain(TOUR_COPY.questsLoadError);
    expect(failed).not.toContain("Complete: First Prediction +50");
    expect(html(createElement(QuestsStepBody, { ...props, loading: true }))).not.toContain("Complete: First Prediction +50");
  });

  it("BoardStepBody shows the line, the Finish button only on the walk, and the leaderboard link", () => {
    const h = html(createElement(BoardStepBody, { line: "You: 175 Season points · Rank #1", onFinish: null }));
    expect(h).toContain("You: 175 Season points · Rank #1");
    expect(h).toContain(TOUR_COPY.boardBody);
    expect(h).toContain('href="/leaderboard"');
    expect(h).not.toContain(TOUR_COPY.boardFinish);
    expect(html(createElement(BoardStepBody, { line: null, onFinish: noop }))).toContain(TOUR_COPY.boardFinish);
  });

  it("TourFinish leads with Copy a wallet's portfolio, links the games, and is never pinned to the viewport", () => {
    const h = html(createElement(TourFinish, { rankShareUrl: null }));
    expect(h).toContain('href="/copy"');
    expect(h).toContain('href="/predictions"');
    expect(h).toContain('href="/competition"');
    expect(h.indexOf('href="/copy"')).toBeLessThan(h.indexOf('href="/predictions"'));
    expect(h).toContain(TOUR_COPY.finishTitle);
    // Focusable by script only: the page moves focus here when the card opens on its own.
    expect(h).toMatch(/<h2 id="tour-finish-title" tabindex="-1"/);
    expect(h).not.toContain(TOUR_COPY.finishRankShare);
    const shared = html(createElement(TourFinish, { rankShareUrl: "https://x.com/intent/post?text=hi" }));
    expect(shared).toMatch(/<a href="https:\/\/x\.com\/intent\/post\?text=hi" target="_blank" rel="noopener noreferrer"/);
    expect(shared).toContain(TOUR_COPY.finishRankShare);
    for (const markup of [h, shared, html(createElement(TourStep, { index: 2, stepKey: "compete", title: "t", state: "current", open: true, onToggle: noop }))]) {
      expect(classTokens(markup).filter((t) => PINNED.test(t))).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Source pins: the page's wiring, the routes it links to, the footer link
// ---------------------------------------------------------------------------

describe("source pins", () => {
  const page = repoFile("src/app/start/page.tsx");
  const tourFiles = ["src/app/start/page.tsx", "src/components/start/tour.ts", "src/components/start/TourStep.tsx", "src/components/start/TourBodies.tsx"];

  it("step 2 embeds the competition's own form, fenced to xStocks, with the $1,000 chip", () => {
    expect(page).toContain("sources={TOUR_TRADE_SOURCES}");
    expect(page).toContain("quickBuyUsd={TOUR_QUICK_BUY_USD}");
    expect(TOUR_TRADE_SOURCES).toEqual(["xstocks"]);
    expect(TOUR_QUICK_BUY_USD).toBe(1000);
  });

  it("keeps the sign-in intent, the dialog and the footer line, and reads /plays only when signed in", () => {
    expect(page).toContain("useSignInIntent<CallSide>(refetch)");
    expect(page).toContain("<PlaceCallDialog");
    expect(page).toContain("{CALLS_LOCK_COPY} Points only, no cash value.");
    expect(page).toContain('["start:league", sessionKey]');
    expect(page).toMatch(/sessionKey \? apiGet<PlaysResponse>\("\/api\/v1\/plays", \{ signal \}\) : Promise\.resolve\(null\)/);
    expect(page).toContain('["start:plays", sessionKey]');
    expect(page).toContain("refetchOnFocus: false");
    expect(page).toContain("TOUR_LATE_REFETCH_MS");
    expect(page).toContain("api.refreshPlays()");
  });

  it("decides the walk during render and keeps the hand-set step and the walk to one account", () => {
    expect(page).toContain("const shownReveal = walkReveal(tour, reveal, actionsBefore);");
    expect(page).toContain("openStepKey(tour, shownReveal, featuredUnanswered, override)");
    expect(page).toContain("showFinish(tour, shownReveal)");
    expect(page).toContain("React.useEffect(() => setOverride(null), [currentKey, shownReveal, sessionKey]);");
    expect(page).toContain("walkBase.current.session === sessionKey ? walkBase.current.actions : null");
    expect(page).toContain("}, [sessionKey, signedIn, ready, tour.actionsDone]);");
    expect(page).toContain("state={state}");
    expect(page).toContain("const state = shownStepState(step.state, finished);");
  });

  it("is signed in by the session until /calls answers, and keeps loaded data on a failed refetch", () => {
    expect(page).toContain("const signedIn = q.data ? me !== null : session !== null;");
    expect(page).toContain("if (q.error && !q.data) {");
    expect(page).toContain(") : lq.error && !lq.data ? (");
    expect(page).toContain("error={plays.data ? null : plays.error}");
    expect(page).not.toMatch(/\bif \(q\.error\) \{|\) : lq\.error \? \(|error=\{plays\.error\}/);
  });

  it("after the walk a folded step 3 says the wallet is not read yet, and focus follows the step that opens", () => {
    expect(page).toContain('if (key === "quests" && tour.actionsDone && playsData) return questsSummary(complete.length, walletState);');
    expect(page.indexOf("questsSummary(complete.length, walletState)")).toBeLessThan(page.indexOf("return TOUR_STEP_TEASER[key];"));
    expect(page).toContain("if (!active || active === document.body) {");
    expect(page).toContain('el.querySelector<HTMLElement>("#tour-finish-title")');
    expect(page).toContain('el.querySelector<HTMLElement>("h2 > button")');
    expect(page).toContain("focusTo?.focus({ preventScroll: true });");
    // Focus moves before the in-view check, so it moves even when no scroll is needed.
    expect(page.indexOf("focusTo?.focus(")).toBeLessThan(page.indexOf("const top = el.getBoundingClientRect().top;"));
  });

  it("the progress bar only animates without reduced motion", () => {
    // Cream, not gold: gold is the primary action and "now" only.
    expect(repoFile("src/components/ui/progress.tsx")).toContain('"h-full bg-foreground transition-all motion-reduce:transition-none"');
    // The tour's own running-order strip: every segment that changes colour stops changing under reduced motion.
    const strip = html(createElement(TourProgress, { steps: [{ key: "predict", state: "done" }, { key: "compete", state: "current" }, { key: "quests", state: "todo" }, { key: "board", state: "unavailable" }], done: 1, signedIn: true }));
    const animated = [...strip.matchAll(/class="([^"]*)"/g)].map((m) => m[1]).filter((c) => /\btransition-/.test(c));
    expect(animated.length).toBeGreaterThanOrEqual(4);
    for (const c of animated) expect(c).toContain("motion-reduce:transition-none");
    expect(strip).not.toMatch(/\bbg-signal\b|\bbg-primary\b/);
  });

  it("the running-order strip is the tour's progress bar signed in, and says nothing signed out", () => {
    const steps = [
      { key: "predict", state: "done" },
      { key: "compete", state: "current" },
      { key: "quests", state: "todo" },
      { key: "board", state: "todo" },
    ] as const;
    const inside = html(createElement(TourProgress, { steps, done: 1, signedIn: true }));
    expect(inside).toContain('role="progressbar"');
    expect(inside).toContain(`aria-label="${TOUR_COPY.progressAria}"`);
    expect(inside).toContain('aria-valuenow="1"');
    expect(inside).toContain('aria-valuemax="4"');
    expect(inside).toContain(`aria-valuetext="${TOUR_COPY.progress(1)}"`);
    expect(inside).toMatch(new RegExp(`<p aria-live="polite"[^>]*>${TOUR_COPY.progress(1)}</p>`));
    const outside = html(createElement(TourProgress, { steps, done: 0, signedIn: false }));
    expect(outside).not.toContain("progressbar");
    expect(outside).not.toContain("aria-live");
    expect(outside).not.toContain(TOUR_COPY.progress(0));
  });

  it("saves nothing in the browser and never imports the server-only competition module", () => {
    for (const rel of tourFiles) {
      const src = repoFile(rel);
      expect(src, rel).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
      expect(src, rel).not.toMatch(/from "@\/lib\/games\/league"/);
      expect(src, rel).not.toMatch(/from "@\/lib\/server\//);
    }
  });

  it("every tour link is a real page, never an old path that redirects", () => {
    const hrefs = new Set<string>(Object.values(TOUR_HREFS));
    for (const rel of tourFiles) for (const m of repoFile(rel).matchAll(/href="(\/[^"]*)"/g)) hrefs.add(m[1]);
    expect(hrefs.size).toBeGreaterThanOrEqual(5);
    const renamed = new Set(ROUTE_RENAMES.map((r) => r.from));
    for (const href of hrefs) {
      const seg = href.replace(/^\//, "").split(/[/?#]/)[0];
      expect(existsSync(path.join(ROOT, "src/app", seg, "page.tsx")), href).toBe(true);
      expect(renamed.has(href), href).toBe(false);
    }
  });

  it("the footer offers the tour first, and the layout describes it", () => {
    const shell = repoFile("src/components/layout/AppShell.tsx");
    expect(shell).toContain('href="/start"');
    const footer = shell.slice(shell.indexOf('<nav aria-label="Footer"'));
    expect(footer.indexOf('href="/start"')).toBeLessThan(footer.indexOf('href="/check"'));
    expect(footer).toMatch(/href="\/start" className=\{FOOTER_LINK\}>\s*Take the tour\s*</);
    const layout = repoFile("src/app/start/layout.tsx");
    expect(layout).toContain('title: "Make your first prediction"');
    expect(layout).toContain(
      "Make your first prediction, three paper trades with virtual cash, your quests and the Season leaderboard: a four-step tour. Sign in free with 1,000 starter points. Points only, no cash value.",
    );
  });
});
