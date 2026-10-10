/**
 * The /start tour (8 Oct 2026): four steps in mobile-tab order (Predict, Compete, Quests, Board).
 * Steps 1 and 2 are actions, steps 3 and 4 are reveals; every tick comes from server data the page
 * already reads (/calls, /league, /plays and /auth/me). Nothing is saved in the browser.
 *
 * Client-safe, no React state. Never import lib/games/league.ts here: it is server-only.
 */

import type {
  CallMarketView,
  CallPositionView,
  LeagueAccountView,
  LeagueSymbolSource,
  LeagueView,
  PlayView,
  PlaysResponse,
} from "@/lib/api-client";
import type { PointsSummary } from "@/lib/games/ledger-policy";
import type { PriceSourceName } from "@/lib/core";
import { ageSeconds, formatAge, formatPoints, formatUsd } from "@/components/common/format";
import { priceSourceLabel } from "@/components/common/PriceChip";
import { isPreIpoQuest, questAssetSource } from "@/components/common/issuer";
import { WALLET_CHECK_TIMING } from "@/components/plays/play-meta";
import { NEXT_WEEK_MARKETS_COPY } from "@/components/calls/calls-format";
import { findScoutPlay } from "@/components/league/scout";
import { rankLabel } from "@/hooks/session-helpers";
import { competitionLine, type SharePrediction } from "./share";

export type TourStepKey = "predict" | "compete" | "quests" | "board";
export type TourStepState = "done" | "current" | "todo" | "unavailable";
/** Where the post-action walk is: step 3, step 4, the finish card, or not walking. React state only. */
export type TourReveal = "quests" | "board" | "end" | null;
export type WalletReadState = "complete" | "empty" | "below" | "unread" | "none";

export const TOUR_ORDER: readonly TourStepKey[] = Object.freeze(["predict", "compete", "quests", "board"] as TourStepKey[]);
export const TOUR_TOTAL = 4 as const;
/** First Paper Trades' count; also MIN_TRADES_FOR_WEEKLY_POINTS. */
export const TOUR_TRADES_TARGET = 3;
/** The TradeForm chip on step 2: a $1,000 paper trade with virtual cash. */
export const TOUR_QUICK_BUY_USD = 1000;
/** Second refetch after an action or a sign-in: covers the inline quest checks and the sign-in wallet read. */
export const TOUR_LATE_REFETCH_MS = 3000;
/** LeagueAccountView.trades cap (RECENT_TRADES_LIMIT on the server). */
export const WEEK_TRADES_SHOWN = 20;
/** Step 2 trades xStocks only: no pre-IPO token on /start, so no pre-IPO line is needed there. */
export const TOUR_TRADE_SOURCES: readonly LeagueSymbolSource[] = Object.freeze(["xstocks"] as LeagueSymbolSource[]);

/** Every page the tour links to. Each one is a real route (tests/start-tour.test.ts). */
export const TOUR_HREFS = Object.freeze({
  predictions: "/predictions",
  competition: "/competition",
  quests: "/quests",
  leaderboard: "/leaderboard",
  copy: "/copy",
});

const STATE_LABEL: Readonly<Record<TourStepState, string>> = Object.freeze({
  done: "done",
  current: "your next step",
  todo: "later",
  unavailable: "not open right now",
});

/** Every sentence the tour shows. Plain names only; virtual cash beside every competition mention. */
export const TOUR_COPY = Object.freeze({
  eyebrow: "This week on Dulo",
  headingStart: "Make your first prediction",
  headingTour: "Your tour of Dulo",
  headingFinished: "You've seen all of Dulo",
  listLabel: "Tour of Dulo",
  progressAria: "Tour progress",
  progress: (done: number) => `${done} of ${TOUR_TOTAL} done`,
  /** Screen readers only, after the step title as ", {label}". */
  stateLabel: STATE_LABEL,

  predictTitle: "Make a prediction",
  predictBody: "Pick Yes or No. Sign in with one message, no transaction, and get 1,000 starter points.",
  predictLocked: `This week's predictions are locked. ${NEXT_WEEK_MARKETS_COPY}`,
  predictLockedSignIn: "Meanwhile, sign in and start with step 2.",
  predictLockedCompetition: "Try the weekly competition (virtual cash)",
  predictLoadError: "Couldn't load this week's predictions",
  predictShare: "Post your pick on X",
  predictMore: "See this week's other predictions",
  /** The weekend: the open markets are next week's (they settle the Friday after). */
  predictMoreNextWeek: "See next week's other predictions",

  competeTitle: "Make 3 paper trades with virtual cash",
  competeTeaser: "$10,000 of virtual cash in this week's competition. Not real money.",
  competeBody: "$10,000 of virtual cash, not real money. Three paper trades complete First Paper Trades (+50).",
  competeHint: "Tap $1,000 to fill in a $1,000 paper trade with virtual cash.",
  competeLink: "Open the weekly competition (virtual cash)",
  competeUnavailable: "The weekly competition (virtual cash) opens as soon as the Season starts.",
  competeLoadError: "Couldn't load the weekly competition (virtual cash)",

  questsTitle: "See your quests",
  questsTeaser: "Some complete inside Dulo, some are verified from your own wallet.",
  questsBody: "In-platform quests complete from your predictions and paper trades with virtual cash. On-chain quests are verified from your own wallet.",
  questsNoneComplete: "No quest complete yet.",
  questsReadNow: "Read my wallet now",
  questsReading: "Reading your wallet",
  questsReadError: "Couldn't read your wallet",
  questsLoadError: "Couldn't load your quests",
  questsAll: "See all quests",
  questsNext: "Next: the leaderboard",

  boardTitle: "Find yourself on the leaderboard",
  boardTeaser: "Your Season points and rank.",
  boardBody: "Quests, settled predictions and top-10 finishes in the virtual-cash competition count. Starter points don't.",
  boardOpen: "Open the leaderboard",
  boardFinish: "Finish the tour",

  finishTitle: "That's the tour.",
  finishBody: "Predictions settle after Friday's close. Predict or paper trade with virtual cash on 3 different days to complete Three Game Days (+150).",
  finishCopy: "Copy a wallet's portfolio",
  finishCopyBody: "A tool, not a game: see how any Solana wallet's xStocks are split.",
  finishPredictions: "See this week's other predictions",
  finishPredictionsNextWeek: "See next week's other predictions",
  finishCompetition: "Open the weekly competition (virtual cash)",
  finishRankShare: "Post your rank on X",
});

/** Step titles and the teasers shown on a folded row that is still to come. */
export const TOUR_STEP_TITLE: Readonly<Record<TourStepKey, string>> = Object.freeze({
  predict: TOUR_COPY.predictTitle,
  compete: TOUR_COPY.competeTitle,
  quests: TOUR_COPY.questsTitle,
  board: TOUR_COPY.boardTitle,
});

export const TOUR_STEP_TEASER: Readonly<Record<TourStepKey, string | null>> = Object.freeze({
  predict: null,
  compete: TOUR_COPY.competeTeaser,
  quests: TOUR_COPY.questsTeaser,
  board: TOUR_COPY.boardTeaser,
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface TourInput {
  /** CallsResponse.me !== null (as /start has always read it). */
  signedIn: boolean;
  /** This week's featured prediction is open. */
  predictionOpen: boolean;
  /** Every position this Season (CallsMeView.positions). */
  positions: readonly CallPositionView[];
  /** Null while signed out, loading or failed. */
  plays: PlaysResponse | null;
  league: Pick<LeagueView, "open"> | null;
  leagueMe: Pick<LeagueAccountView, "trades"> | null;
  points: Pick<PointsSummary, "seasonPoints" | "rank"> | null | undefined;
}

export interface TourStep {
  key: TourStepKey;
  state: TourStepState;
}

export interface TourState {
  signedIn: boolean;
  steps: TourStep[];
  /** The first step that is neither done nor unavailable; null when there is none. */
  current: TourStepKey | null;
  done: number;
  total: typeof TOUR_TOTAL;
  /** Steps 1 and 2 are each done or not open right now: the walk through steps 3 and 4 can start. */
  actionsDone: boolean;
}

/** Every quest on the board, flattened (groups -> campaigns -> quests). */
export function allQuests(data: PlaysResponse | null | undefined): PlayView[] {
  return (data?.groups ?? []).flatMap((g) => g.campaigns.flatMap((c) => c.plays));
}

function ruleOf(play: Pick<PlayView, "rule">): Record<string, unknown> {
  const r = play.rule as unknown;
  return r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : {};
}

const nonEmpty = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

const finiteOr = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** The issuer a quest is fenced to; the Season 0 default (xStocks) when the payload names none. */
function sourceOf(play: Pick<PlayView, "key" | "assetSource">): string {
  return questAssetSource(play) ?? "xstocks";
}

/**
 * First Prediction, found by rule: a live internal_event call_placed quest with no distinctBy and
 * no symbol fence. The lowest count wins (oracle today, not Three or Five Predictions).
 */
export function findFirstPredictionQuest(plays: PlaysResponse | null | undefined): PlayView | null {
  let best: PlayView | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const p of allQuests(plays)) {
    if (p.comingSoon) continue;
    const r = ruleOf(p);
    if (r.type !== "internal_event" || r.event !== "call_placed") continue;
    if (r.distinctBy !== undefined || nonEmpty(r.assetSymbols)) continue;
    const count = finiteOr(r.count, 1);
    if (count < bestCount) {
      best = p;
      bestCount = count;
    }
  }
  return best;
}

/**
 * First Position, found by rule: a live hold_any quest over any xStock (no symbol, asset or partner
 * scope, fenced to xStocks). The lowest minUsd wins; Thousand Club, Index Holder, Pre-IPO Position
 * and the partner quests are skipped.
 */
export function findFirstHoldingQuest(plays: PlaysResponse | null | undefined): PlayView | null {
  let best: PlayView | null = null;
  let bestMin = Number.POSITIVE_INFINITY;
  for (const p of allQuests(plays)) {
    if (p.comingSoon) continue;
    const r = ruleOf(p);
    if (r.type !== "hold_any") continue;
    // A partner asset list, even an empty one ("listing pending"), is a partner quest.
    if (nonEmpty(r.assetSymbols) || nonEmpty(r.assetIds) || Array.isArray(r.partnerAssetIds)) continue;
    if (sourceOf(p) !== "xstocks") continue;
    const min = finiteOr(r.minUsd, 0);
    if (min < bestMin) {
      best = p;
      bestMin = min;
    }
  }
  return best;
}

function proofObj(proof: unknown): Record<string, unknown> | null {
  return proof && typeof proof === "object" && !Array.isArray(proof) ? (proof as Record<string, unknown>) : null;
}

function proofString(proof: unknown, key: string): string | null {
  const v = proofObj(proof)?.[key];
  return typeof v === "string" && v.trim() ? v : null;
}

function proofNumber(proof: unknown, key: string): number | null {
  const v = proofObj(proof)?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** proof.progress {current, target} as the evaluator stores it; null when absent or malformed. */
export function proofProgress(proof: unknown): { current: number; target: number } | null {
  const progress = proofObj(proofObj(proof)?.progress);
  if (!progress) return null;
  const current = progress.current;
  const target = progress.target;
  if (typeof current !== "number" || !Number.isFinite(current) || typeof target !== "number" || !Number.isFinite(target)) return null;
  return { current, target };
}

/** What Solana last said about the holding quest's wallet state. */
export function walletReadState(play: Pick<PlayView, "status" | "proof"> | null): WalletReadState {
  if (!play) return "none";
  if (play.status === "complete") return "complete";
  const reason = proofString(play.proof, "reason");
  if (reason === "no_in_scope_holding") return "empty";
  if (reason === "below_min_usd") return "below";
  return "unread";
}

export function deriveTour(input: TourInput): TourState {
  if (!input.signedIn) {
    const predict: TourStepState = input.predictionOpen ? "current" : "unavailable";
    return {
      signedIn: false,
      steps: TOUR_ORDER.map((key) => ({ key, state: key === "predict" ? predict : "todo" })),
      current: input.predictionOpen ? "predict" : null,
      done: 0,
      total: TOUR_TOTAL,
      actionsDone: false,
    };
  }

  const firstPrediction = findFirstPredictionQuest(input.plays);
  const scout = findScoutPlay(input.plays);
  const holding = findFirstHoldingQuest(input.plays);
  const points = input.points;

  const isDone: Record<TourStepKey, boolean> = {
    predict: input.positions.length > 0 || firstPrediction?.status === "complete",
    compete: scout?.status === "complete" || (input.leagueMe?.trades.length ?? 0) >= TOUR_TRADES_TARGET,
    quests: input.plays !== null && walletReadState(holding) !== "unread",
    board: !!points && typeof points.rank === "number" && points.seasonPoints > 0,
  };
  const available: Record<TourStepKey, boolean> = {
    predict: input.predictionOpen,
    compete: input.league?.open === true,
    quests: true,
    board: true,
  };

  let current: TourStepKey | null = null;
  const steps: TourStep[] = TOUR_ORDER.map((key) => {
    let state: TourStepState;
    if (isDone[key]) state = "done";
    else if (!available[key]) state = "unavailable";
    else if (current === null) {
      state = "current";
      current = key;
    } else state = "todo";
    return { key, state };
  });

  const settled = (k: TourStepKey) => isDone[k] || !available[k];
  return {
    signedIn: true,
    steps,
    current,
    done: steps.filter((s) => s.state === "done").length,
    total: TOUR_TOTAL,
    actionsDone: settled("predict") && settled("compete"),
  };
}

/** A step the player opened (key) or closed (null) by hand. React state only. */
export type TourOverride = { key: TourStepKey | null };

/**
 * The one step that is open (unfolded): the one opened or closed by hand, else the default. Signed
 * out, step 1 is always the open row, whatever was opened by hand before a sign-out.
 */
export function openStepKey(tour: TourState, reveal: TourReveal, featuredUnanswered: boolean, override: TourOverride | null = null): TourStepKey | null {
  if (!tour.signedIn) return "predict";
  if (override) return override.key;
  if (!tour.actionsDone) return tour.current;
  if (reveal === "quests" || reveal === "board") return reveal;
  if (reveal === "end") return featuredUnanswered ? "predict" : null;
  return tour.current ?? (featuredUnanswered ? "predict" : null);
}

/**
 * The reveal to show. `actionsBefore` is whether the two actions were done at the last read of
 * fresh data for this account (null before the first one). The moment the data shows them done,
 * the walk opens step 3 in that same render, even while another board is still refetching, so the
 * finish card never flashes before the walk. A player who arrives with both done is not walked.
 */
export function walkReveal(tour: TourState, reveal: TourReveal, actionsBefore: boolean | null): TourReveal {
  return reveal === null && tour.signedIn && tour.actionsDone && actionsBefore === false ? "quests" : reveal;
}

/** The finish card: after the walk, or straight away for a player who has seen everything. */
export function showFinish(tour: TourState, reveal: TourReveal): boolean {
  return tour.signedIn && tour.actionsDone && (reveal === "end" || (reveal === null && tour.current === null));
}

/** A step's state as shown: once the finish card is up, no step reads as "your next step". */
export function shownStepState(state: TourStepState, finished: boolean): TourStepState {
  return finished && state === "current" ? "todo" : state;
}

export function tourHeading(tour: TourState, finished: boolean): string {
  if (finished) return TOUR_COPY.headingFinished;
  if (!tour.signedIn || tour.current === "predict") return TOUR_COPY.headingStart;
  return TOUR_COPY.headingTour;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type TourPick = SharePrediction & { points: number };

/**
 * The player's newest prediction still open (result pending), joined to its question; null when
 * there is none. A settled one is never shown as "points in" or shared as "this Friday".
 */
export function latestPick(
  positions: readonly Pick<CallPositionView, "marketId" | "side" | "points" | "createdAt" | "result">[],
  markets: readonly Pick<CallMarketView, "id" | "ticker" | "strike">[],
): TourPick | null {
  const byId = new Map(markets.map((m) => [m.id, m]));
  const sorted = positions.filter((p) => p.result === "pending").sort((a, b) => finiteOr(Date.parse(b.createdAt), 0) - finiteOr(Date.parse(a.createdAt), 0));
  for (const p of sorted) {
    const m = byId.get(p.marketId);
    if (m) return { ticker: m.ticker, strike: m.strike, side: p.side, points: p.points };
  }
  return null;
}

/** Complete quests, oldest completion first. Pre-IPO quests are left out of every tour list. */
export function completedQuests(plays: PlaysResponse | null | undefined): PlayView[] {
  const at = (p: PlayView) => finiteOr(p.completedAt ? Date.parse(p.completedAt) : Number.NaN, Number.POSITIVE_INFINITY);
  return allQuests(plays)
    .filter((p) => p.status === "complete" && !isPreIpoQuest(p))
    .sort((a, b) => at(a) - at(b) || a.title.localeCompare(b.title));
}

export interface NextUpQuest {
  title: string;
  current: number;
  target: number;
}

/** In-platform quests already started, closest to complete first. */
export function nextUpQuests(plays: PlaysResponse | null | undefined, limit = 3): NextUpQuest[] {
  const rows: (NextUpQuest & { points: number })[] = [];
  for (const p of allQuests(plays)) {
    if (p.status !== "in_progress" || p.comingSoon || isPreIpoQuest(p)) continue;
    if (ruleOf(p).type !== "internal_event") continue;
    const progress = proofProgress(p.proof);
    if (!progress || progress.target <= 0 || !(progress.current > 0 && progress.current < progress.target)) continue;
    rows.push({ title: p.title, current: progress.current, target: progress.target, points: p.points });
  }
  rows.sort((a, b) => b.current / b.target - a.current / a.target || a.points - b.points || a.title.localeCompare(b.title));
  return rows.slice(0, Math.max(0, limit)).map(({ title, current, target }) => ({ title, current, target }));
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** "You said YES: NVDA closes above $224.94 · 100 points in", or "First Prediction complete". */
export function predictionSummary(pick: TourPick | null, firstPrediction: Pick<PlayView, "title" | "status"> | null): string | null {
  if (pick) {
    const verdict = pick.side === "yes" ? "YES" : "NO";
    const verb = pick.side === "yes" ? "closes above" : "stays below";
    return `You said ${verdict}: ${pick.ticker} ${verb} ${formatUsd(pick.strike)} · ${formatPoints(pick.points)} points in`;
  }
  if (firstPrediction?.status === "complete") return `${firstPrediction.title} complete`;
  return null;
}

/** "3 paper trades this week · $7,000.00 virtual cash left · #2 this week", or "First Paper Trades complete". */
export function tradesSummary(
  me: Pick<LeagueAccountView, "trades" | "cashUsd" | "rank"> | null | undefined,
  scout: Pick<PlayView, "title" | "status"> | null,
): string | null {
  const n = me?.trades.length ?? 0;
  if (me && n > 0) {
    const count = n >= WEEK_TRADES_SHOWN ? `${WEEK_TRADES_SHOWN}+` : String(n);
    const noun = n === 1 ? "paper trade" : "paper trades";
    const rank = typeof me.rank === "number" && Number.isFinite(me.rank) ? ` · #${formatPoints(me.rank)} this week` : "";
    return `${count} ${noun} this week · ${formatUsd(me.cashUsd)} virtual cash left${rank}`;
  }
  if (scout?.status === "complete") return `${scout.title} complete`;
  return null;
}

/** "Complete: First Prediction +50 · First Paper Trades +50", or "No quest complete yet." */
export function completeLine(quests: readonly Pick<PlayView, "title" | "points">[]): string {
  if (quests.length === 0) return TOUR_COPY.questsNoneComplete;
  return `Complete: ${quests.map((q) => `${q.title} +${formatPoints(q.points)}`).join(" · ")}`;
}

/** "Next up: Five-Stock Paper Portfolio 3/5 · Three Predictions 1/3", or null. */
export function nextUpLine(items: readonly NextUpQuest[]): string | null {
  if (items.length === 0) return null;
  return `Next up: ${items.map((i) => `${i.title} ${formatPoints(i.current)}/${formatPoints(i.target)}`).join(" · ")}`;
}

const PRICE_SOURCES: ReadonlySet<string> = new Set(["pyth", "jupiter", "cache", "none"]);

/**
 * The holding quest's last read from Solana, in one sentence; null when no such quest is seeded.
 * Never tells anyone to buy: it says what the wallet holds and that there is nothing to submit.
 */
export function walletLine(
  play: Pick<PlayView, "title" | "points" | "proof"> | null,
  state: WalletReadState,
  walletCount: number,
  nowMs: number = Date.now(),
): string | null {
  if (!play || state === "none") return null;
  const many = walletCount > 1;
  const noun = many ? "your connected wallets" : "your wallet";
  const holds = many ? "hold" : "holds";
  if (state === "unread") return `Waiting for the first read of ${noun} from Solana.`;

  const takenAt = proofString(play.proof, "takenAt");
  const age = takenAt ? ` ${formatAge(ageSeconds(takenAt, nowMs))}` : "";
  const symbol = proofString(play.proof, "symbol");

  if (state === "complete") {
    const usd = proofNumber(play.proof, "usd");
    const reward = `${play.title} complete, +${formatPoints(play.points)}.`;
    if (!symbol || usd === null) return `Verified on-chain${age}: ${reward}`;
    const source = proofString(play.proof, "priceSource");
    const priced = source && PRICE_SOURCES.has(source) ? ` (${priceSourceLabel(source as PriceSourceName)} price)` : "";
    return `Verified on-chain${age}: ${noun} ${holds} ${symbol} worth ${formatUsd(usd)}${priced}. ${reward}`;
  }
  if (state === "empty") {
    return `Read from Solana${age}: ${noun} ${holds} no xStock. On-chain quests check every connected wallet ${WALLET_CHECK_TIMING}; there is nothing to submit.`;
  }
  // below: the proof carries no price source, so no USD figure for the holding itself.
  const minUsd = proofNumber(play.proof, "minUsd");
  const what = symbol ?? "an xStock";
  const threshold = minUsd !== null ? `the ${formatUsd(minUsd)} that ${play.title} reads` : `what ${play.title} reads`;
  return `Read from Solana${age}: ${noun} ${holds} ${what}, below ${threshold}.`;
}

/** "2 quests complete · wallet verified on-chain". */
export function questsSummary(completeCount: number, state: WalletReadState): string {
  const n = Math.max(0, Math.floor(finiteOr(completeCount, 0)));
  const base = `${n} ${n === 1 ? "quest" : "quests"} complete`;
  switch (state) {
    case "complete":
      return `${base} · wallet verified on-chain`;
    case "empty":
    case "below":
      return `${base} · wallet read from Solana`;
    case "unread":
      return `${base} · wallet not read yet`;
    default:
      return base;
  }
}

/** "175 Season points · Rank #1"; null when the server sent no points. Never an "of N". */
export function boardSummary(points: Pick<PointsSummary, "seasonPoints" | "rank"> | null | undefined): string | null {
  if (!points || typeof points !== "object") return null;
  return `${formatPoints(points.seasonPoints)} Season points · ${rankLabel(points.rank)}`;
}

/** "You: 175 Season points · Rank #1". */
export function boardLine(points: Pick<PointsSummary, "seasonPoints" | "rank"> | null | undefined): string | null {
  const s = boardSummary(points);
  return s ? `You: ${s}` : null;
}

/** Step 2 while the competition is not taking paper trades: when it opens, or the Season line. */
export function competeUnavailableLine(league: Pick<LeagueView, "open" | "closesIn" | "opensIn"> | null): string {
  return (league && !league.open ? competitionLine(league) : null) ?? TOUR_COPY.competeUnavailable;
}
