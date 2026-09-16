/**
 * The points policy (16 Sep 2026): the shared contract for starter points, virtual cash and what
 * counts toward a Season rank. Client-safe and import-free on purpose, so server code, API
 * handlers and UI copy all read the same numbers and the same sentences.
 *
 * Points only, no cash value. Balances are derived from the append-only PointsEvent ledger:
 * starter and admin rows add to what a player can put into predictions, but never to the
 * Season points a rank is built from.
 */

/** Starter points every real player receives once, on first sign-in. House bots never get them. */
export const STARTER_POINTS = 1000;

/** PointsEvent.source for the one-off starter grant. */
export const STARTER_SOURCE = "starter";

/** PointsEvent sources that add to the spendable balance but never to Season points or rank. */
export const NON_SCORING_SOURCES = ["starter", "admin"] as const;

/** Virtual cash each competition account starts the week with. Not real money. */
export const VIRTUAL_CASH_USD = 10_000;

/** Paper trades a competition account needs in a week before its finish can earn points. */
export const MIN_TRADES_FOR_WEEKLY_POINTS = 3;

export const WELCOME_TITLE = "Welcome to Dulo";

export const WELCOME_COPY =
  "You have 1,000 starter points for predictions and $10,000 of virtual cash for this week's competition. The starter grant itself isn't ranked; once a prediction settles, what you put in and get back counts toward your Season points. Points only, no cash value.";

/** The welcome offer, stated before sign-in. */
export const WELCOME_OFFER_LINE = "Sign in free: 1,000 starter points and $10,000 of virtual cash to play. Points only, no cash value.";

export const STARTER_HINT = "Includes 1,000 starter points";

export const SEASON_POINTS_HINT = "Starter grant not ranked; settled predictions are";

export const PREDICTION_LOSS_COPY = "If it doesn't settle your way, the points you put in count against your Season points.";

/** A player's points, split the way the policy counts them. */
export interface PointsSummary {
  seasonId: string;
  /** Spendable points: every ledger row, starter included, minus points held in open predictions. */
  balance: number;
  /** Rank points: excludes starter/admin rows and points in open predictions. */
  seasonPoints: number;
  /** Starter points granted this Season (0 or STARTER_POINTS). */
  starterPoints: number;
  /** Points currently held in open predictions. */
  inPredictions: number;
  rank: number | null;
}

/** What a first sign-in hands a new player. */
export interface WelcomeGrant {
  starterPoints: number;
  virtualCashUsd: number;
}

/** How a ledger row reads in the points history. */
export type LedgerRowKind = "starter" | "quest" | "pointsIn" | "pointsBack" | "refund" | "competition" | "seed" | "unknown";

/** One row of a player's points history, already labelled for display. */
export interface PointsHistoryRow {
  label: string;
  delta: number;
  /** ISO timestamp. */
  ts: string;
  kind: LedgerRowKind;
}

// ---------------------------------------------------------------------------
// Ledger refs and the two numbers (pure; the server queries mirror these rules)
// ---------------------------------------------------------------------------

/** PointsEvent.ref of the one starter grant per user per Season. */
export function starterRef(seasonId: string): string {
  return `starter:${seasonId}`;
}

/**
 * Every ref a prediction's points-in rows start with, for one market (all users, both sides,
 * top-ups included). Market and user ids never contain a colon, so the prefix is exact.
 */
export function openStakePrefix(marketId: string): string {
  return `call:${marketId}:stake:`;
}

/** A PointsEvent.ref taken apart. Only the fields its kind carries are set. */
export interface ParsedLedgerRef {
  kind: LedgerRowKind;
  playKey?: string;
  marketId?: string;
  side?: "yes" | "no";
  /** Top-up sequence of a points-in row: 1 for the first placement, then 2, 3, ... */
  seq?: number;
  leagueId?: string;
  rank?: number;
}

// Regex literals only: this file is read by the plain-names scan (tests/plain-names.test.ts).
const STARTER_REF_RE = /^starter:/;
const QUEST_REF_RE = /^play:(.+)$/;
const POINTS_IN_REF_RE = /^call:([^:]+):stake:([^:]+):(yes|no)(?::(\d+))?$/;
const POINTS_BACK_REF_RE = /^call:([^:]+):payout:/;
const REFUND_REF_RE = /^call:([^:]+):refund:[^:]+:(yes|no)$/;
const COMPETITION_REF_RE = /^league:(.+):rank:(\d+)$/;
const SEED_REF_RE = /^admin:seed:/;

/** What a ledger ref records. Anything unrecognised is kind "unknown", never a throw. */
export function parseLedgerRef(ref: string): ParsedLedgerRef {
  if (STARTER_REF_RE.test(ref)) return { kind: "starter" };
  let m = QUEST_REF_RE.exec(ref);
  if (m) return { kind: "quest", playKey: m[1] };
  m = POINTS_IN_REF_RE.exec(ref);
  if (m) return { kind: "pointsIn", marketId: m[1], side: m[3] as "yes" | "no", seq: m[4] ? Number(m[4]) : 1 };
  m = POINTS_BACK_REF_RE.exec(ref);
  if (m) return { kind: "pointsBack", marketId: m[1] };
  m = REFUND_REF_RE.exec(ref);
  if (m) return { kind: "refund", marketId: m[1], side: m[2] as "yes" | "no" };
  m = COMPETITION_REF_RE.exec(ref);
  if (m) return { kind: "competition", leagueId: m[1], rank: Number(m[2]) };
  if (SEED_REF_RE.test(ref)) return { kind: "seed" };
  return { kind: "unknown" };
}

/** The ledger columns the policy reads. */
export interface LedgerRowInput {
  source: string;
  ref: string;
  delta: number;
}

const NON_SCORING: ReadonlySet<string> = new Set(NON_SCORING_SOURCES);

function isOpenStakeRef(ref: string, openMarketIds: ReadonlySet<string>): boolean {
  for (const id of openMarketIds) if (ref.startsWith(openStakePrefix(id))) return true;
  return false;
}

/**
 * True when a row counts toward Season points: its source is not starter/admin, and it is not
 * points put into a prediction that is still open. The pure mirror of seasonScoreWhere
 * (lib/server/queries), which applies the same rule inside the database.
 */
export function isScoringRow(row: Pick<LedgerRowInput, "source" | "ref">, openMarketIds: ReadonlySet<string>): boolean {
  if (NON_SCORING.has(row.source)) return false;
  return !isOpenStakeRef(row.ref, openMarketIds);
}

/** One user's Season rows, split the way the policy counts them. */
export interface LedgerSummary {
  /** Spendable: the sum of every row. */
  balance: number;
  /** Rank points: the sum of the scoring rows. */
  seasonPoints: number;
  starterPoints: number;
  /** House funding for seeded pools. Always 0 for a real user. */
  adminPoints: number;
  /** Points held in open predictions, as a positive number. */
  inPredictions: number;
}

/**
 * Split a user's Season rows. Every row lands in exactly one bucket, so
 * balance = seasonPoints + starterPoints + adminPoints - inPredictions always holds.
 */
export function summariseLedger(rows: readonly LedgerRowInput[], openMarketIds: ReadonlySet<string>): LedgerSummary {
  const out: LedgerSummary = { balance: 0, seasonPoints: 0, starterPoints: 0, adminPoints: 0, inPredictions: 0 };
  for (const row of rows) {
    out.balance += row.delta;
    if (row.source === STARTER_SOURCE) out.starterPoints += row.delta;
    else if (NON_SCORING.has(row.source)) out.adminPoints += row.delta;
    else if (isOpenStakeRef(row.ref, openMarketIds)) out.inPredictions -= row.delta;
    else out.seasonPoints += row.delta;
  }
  return out;
}

/** Display names the history needs: quest titles by key, market symbols by market id. */
export interface LedgerLabelLookups {
  questTitles: ReadonlyMap<string, string>;
  marketTickers: ReadonlyMap<string, string>;
}

function withTicker(text: string, ticker: string | undefined): string {
  return ticker ? `${text} (${ticker})` : text;
}

/** How one ledger row reads in the points history. Never shows a raw ref or an internal key. */
export function ledgerRowLabel(row: Pick<LedgerRowInput, "ref">, lookups: LedgerLabelLookups): string {
  const parsed = parseLedgerRef(row.ref);
  const ticker = parsed.marketId ? lookups.marketTickers.get(parsed.marketId) : undefined;
  switch (parsed.kind) {
    case "starter":
      return "Starter points";
    case "quest": {
      const title = parsed.playKey ? lookups.questTitles.get(parsed.playKey) : undefined;
      return title ? `Quest: ${title}` : "Quest completed";
    }
    case "pointsIn":
      return withTicker("Points into a prediction", ticker);
    case "pointsBack":
      return withTicker("Points back from a prediction", ticker);
    case "refund":
      return withTicker("Prediction refund", ticker);
    case "competition":
      return `Competition finish #${parsed.rank}`;
    case "seed":
      return "House grant";
    default:
      return "Points";
  }
}
