/**
 * Client-safe typed access to the /api/v1 envelope.
 *
 * Every /api/v1 handler answers with { ok: true, data } or { ok: false, error, issues? }
 * (see src/lib/server/api.ts). This module is the ONLY way UI code reads data:
 * pages and components call apiGet<T>() and share the response types exported here.
 *
 * No server imports. Safe to import from client components, server components and tests.
 */

import type { PlayRule } from "@/lib/plays/rules";
import type { PriceSourceName } from "@/lib/core";
import type { PointsHistoryRow } from "@/lib/games/ledger-policy";

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string; issues?: unknown };
export type ApiEnvelope<T> = ApiOk<T> | ApiErr;

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  get isNotFound() {
    return this.status === 404;
  }

  get isUnauthorized() {
    return this.status === 401;
  }
}

export interface ApiRequestOptions {
  /** Absolute origin for server-side callers (e.g. "https://dulo.fun"). Browsers can leave this out. */
  baseUrl?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

function joinUrl(baseUrl: string | undefined, path: string): string {
  if (!baseUrl) return path;
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

/**
 * Caller headers layered over `defaults`. Goes through the Headers API so a Headers
 * instance, a [name, value][] tuple list, or a plain record all survive (spreading a
 * Headers instance into an object silently drops every entry).
 */
export function withDefaults(init: HeadersInit | undefined, defaults: Record<string, string>): Headers {
  const headers = new Headers(defaults);
  if (init) new Headers(init).forEach((value, name) => headers.set(name, value));
  return headers;
}

async function readEnvelope<T>(res: Response): Promise<T> {
  let json: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiClientError(`Bad response from ${res.url || "api"} (${res.status})`, res.status || 502);
    }
  }
  const env = json as Partial<ApiEnvelope<T>> | null;
  if (env && env.ok === true) return (env as ApiOk<T>).data;
  const message =
    env && env.ok === false && typeof env.error === "string" ? env.error : res.statusText || `Request failed (${res.status})`;
  throw new ApiClientError(message, res.status || 500, env && env.ok === false ? env.issues : undefined);
}

/** GET a /api/v1 path. Resolves to `data`, throws ApiClientError on any non-ok envelope. */
export async function apiGet<T>(path: string, opts: ApiRequestOptions = {}): Promise<T> {
  const res = await fetch(joinUrl(opts.baseUrl, path), {
    method: "GET",
    headers: withDefaults(opts.headers, { accept: "application/json" }),
    credentials: "same-origin",
    cache: "no-store",
    signal: opts.signal,
  });
  return readEnvelope<T>(res);
}

/** POST JSON to a /api/v1 path. Resolves to `data`, throws ApiClientError on any non-ok envelope. */
export async function apiPost<T>(path: string, body: unknown, opts: ApiRequestOptions = {}): Promise<T> {
  const res = await fetch(joinUrl(opts.baseUrl, path), {
    method: "POST",
    headers: withDefaults(opts.headers, { accept: "application/json", "content-type": "application/json" }),
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify(body ?? {}),
    signal: opts.signal,
  });
  return readEnvelope<T>(res);
}

/** Narrow an unknown thrown value to a readable message for the UI. */
export function errorMessage(e: unknown, fallback = "Something went wrong"): string {
  if (e instanceof ApiClientError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

// ---------------------------------------------------------------------------
// Wire types (dates are ISO strings on the wire)
// ---------------------------------------------------------------------------

export type SeasonPhase = "upcoming" | "active" | "ended";

export interface SeasonView {
  id: string;
  name: string;
  /** CAIP-2 chain ids in scope. */
  chainScope: string[];
  startsAt: string;
  endsAt: string;
  phase: SeasonPhase;
}

export interface PartnerLinks {
  website?: string;
  x?: string;
  docs?: string;
}

export interface PartnerSummary {
  slug: string;
  name: string;
  logoUrl: string | null;
  blurb: string;
  links: PartnerLinks;
}

export type PlayStatus = "locked" | "in_progress" | "complete";

/** One Play as seen by a (possibly anonymous) caller. */
export interface PlayView {
  key: string;
  title: string;
  desc: string;
  points: number;
  badgeKey: string | null;
  rule: PlayRule;
  status: PlayStatus;
  completedAt: string | null;
  proof: unknown | null;
  /** Number of users who have completed this Play. */
  completions: number;
  /**
   * Listed but not yet verifiable (Play.isActive = false; partner integration pending).
   * The engine never evaluates it and the UI renders it as "coming soon"; status is "locked".
   */
  comingSoon: boolean;
  /**
   * Play.assetSource, the issuer this quest is fenced to ("xstocks", "prestocks"), when the route
   * sends it. Absent means the UI falls back to the quest key (components/common/issuer questAssetSource).
   */
  assetSource?: string | null;
}

export interface CampaignGroup {
  id: string;
  title: string;
  plays: PlayView[];
}

export interface PartnerGroup {
  partner: PartnerSummary;
  campaigns: CampaignGroup[];
}

export interface PlaysResponse {
  season: SeasonView | null;
  signedIn: boolean;
  groups: PartnerGroup[];
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  handle: string | null;
  /** Primary wallet address (any wallet when none is flagged primary). */
  address: string | null;
  points: number;
}

export interface LeaderboardResponse {
  season: SeasonView | null;
  rows: LeaderboardRow[];
  limit: number;
}

export interface PartnerListItem extends PartnerSummary {
  chainIds: string[];
  /** Listed Plays, "coming soon" ones included. */
  playCount: number;
  /** Plays verifiable now (playCount minus "coming soon"). */
  livePlayCount: number;
  completions: number;
}

export interface PartnersResponse {
  partners: PartnerListItem[];
}

/** A Play on a Partner page: no per-user status, only public facts. */
export interface PartnerPlayView {
  key: string;
  title: string;
  desc: string;
  points: number;
  badgeKey: string | null;
  rule: PlayRule;
  completions: number;
  /** See PlayView.comingSoon. */
  comingSoon: boolean;
  /** See PlayView.assetSource. */
  assetSource?: string | null;
}

export interface PartnerCampaignView {
  id: string;
  title: string;
  seasonId: string;
  startsAt: string;
  endsAt: string;
  plays: PartnerPlayView[];
}

/**
 * One Token-2022 ScaledUiAmount change on an issuer's mint (lib/corporate-actions): a split
 * (integer ratio >= 2) or an adjustment (anything else). It changes the number of tokens shown to
 * every holder, never the holder's value, and carries no price on purpose. `effective` says
 * whether the new multiplier is already in force; `effectiveAt` is ISO, null when the chain
 * reports no date.
 */
export interface CorporateActionView {
  assetId: string;
  symbol: string;
  /** AssetSource name ("xstocks", "prestocks"). */
  source: string;
  kind: "split" | "adjustment";
  multiplierBefore: number;
  multiplierAfter: number;
  /** multiplierAfter / multiplierBefore, rounded to 8 dp. */
  ratio: number;
  effectiveAt: string | null;
  effective: boolean;
}

export interface PartnerDetail {
  partner: PartnerSummary & { chainIds: string[] };
  campaigns: PartnerCampaignView[];
  /** `plays` counts every listed Play ("coming soon" included); `completions` sums completed PlayProgress rows. */
  totals: { plays: number; completions: number };
  /**
   * Corporate actions on the issuer's mints: only for an issuer Partner whose slug names a
   * registered AssetSource ("prestocks", "xstocks"); [] for every other Partner and on a chain
   * read failure (the API never fails over it).
   */
  corporateActions: CorporateActionView[];
}

export type PartnerResponse = PartnerDetail;

export interface SeasonResponse {
  season: SeasonView | null;
  /** Server clock, ISO. */
  now: string;
}

export interface WalletView {
  id: string;
  chainId: string;
  address: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface CompletedPlayView {
  key: string;
  title: string;
  points: number;
  badgeKey: string | null;
  completedAt: string | null;
  proof: unknown | null;
  campaignTitle: string;
  partner: { slug: string; name: string; logoUrl: string | null } | null;
}

export interface BadgeView {
  playKey: string;
  /** Play title when the Play still exists. */
  title: string | null;
  mint: string | null;
  txSig: string | null;
  createdAt: string;
}

export interface UserProfile {
  userId: string;
  handle: string | null;
  season: SeasonView | null;
  /** Season points: excludes starter/admin rows and points in open predictions. */
  points: number;
  pointsAllTime: number;
  /** Spendable points this Season, starter points included, minus points held in open predictions. */
  balance?: number;
  /** Starter points granted this Season (0 or 1,000); they never count toward rank. */
  starterPoints?: number;
  /** Points currently held in open predictions. */
  inPredictions?: number;
  /** Recent points ledger rows for this Season, newest first, labelled for display. */
  history?: PointsHistoryRow[];
  /** Season rank (1-based) or null when the user has no season points yet. */
  rank: number | null;
  wallets: WalletView[];
  /** Every completed Play, all Seasons (retired Plays included), newest first. */
  completedPlays: CompletedPlayView[];
  badges: BadgeView[];
  /**
   * Completed Plays that are active in the current Season: the same scope as `playsTotal`,
   * so "playsCompleted / playsTotal" never exceeds 1 even though `completedPlays` is all-time.
   */
  playsCompleted: number;
  /** Active Plays in the current Season (all Plays when no Season is seeded). */
  playsTotal: number;
}

export interface MeResponse {
  signedIn: boolean;
  profile: UserProfile | null;
}

/** POST /api/v1/plays/refresh: the caller's wallets re-read and Plays re-evaluated on demand. */
export interface RefreshPlaysResponse {
  /** Both steps finished cleanly inside the time budget. */
  ok: boolean;
  /** The run outlived its ~8s budget; it keeps going server-side and the next tick repairs anything half-done. */
  timedOut: boolean;
  /** Wall-clock milliseconds. */
  took: number;
  error: string | null;
  /** Wallets snapshotted / failed / skipped (non-Solana). Null when the run timed out or failed early. */
  snapshot: { ok: number; failed: number; skipped: number } | null;
  /** Plays evaluated; `newlyCompleted` flipped to complete in this run, `awarded` got their PointsEvent now. */
  evaluate: { evaluated: number; completed: number; newlyCompleted: number; awarded: number } | null;
}

// ---------------------------------------------------------------------------
// Calls (points-only parimutuel) — /api/v1/calls, /api/v1/calls/place, /api/v1/calls/[id]
// ---------------------------------------------------------------------------

export type CallSide = "yes" | "no";
export type CallOutcome = "yes" | "no" | "void";
/**
 * open    stakes accepted
 * locked  inside the 5-minute window before settleAt (or past it, price pending)
 * settled outcome yes/no written, payouts in the ledger
 * void    no usable price 24h after settleAt; every stake refunded
 */
export type CallMarketStatus = "open" | "locked" | "settled" | "void";
/** pending until the market settles; refunded when the outcome was void or the market had no counterparty. */
export type CallPositionResult = "pending" | "won" | "lost" | "refunded";

export interface CallOdds {
  yesPool: number;
  noPool: number;
  total: number;
  /** Implied probability of Yes (0..1). 0.5 when both pools are empty. */
  yesProb: number;
  noProb: number;
  /** Points paid per point staked if that side wins; null while nobody is on the side. */
  yesMultiplier: number | null;
  noMultiplier: number | null;
}

/** PriceQuote in wire shape (publishedAt as ISO). Same fields PriceChip reads. */
export interface CallQuote {
  symbol: string;
  price: number | null;
  source: "pyth" | "jupiter" | "cache" | "none";
  publishedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  marketOpen: boolean;
}

export interface CallMarketView {
  id: string;
  /** Underlying ticker, e.g. "NVDA". */
  ticker: string;
  /** xStock symbol the current price is quoted for, e.g. "NVDAx". */
  symbol: string;
  strike: number;
  settleAt: string;
  /** settleAt minus the lock window; no stakes after this instant. */
  locksAt: string;
  status: CallMarketStatus;
  yesPool: number;
  noPool: number;
  odds: CallOdds;
  settledPrice: number | null;
  outcome: CallOutcome | null;
  /** Price source the market settled on ("pyth" | "jupiter"), null until settled or when void. */
  source: string | null;
  /** Current price of the xStock; null when the catalogue or every source is unavailable. */
  quote: CallQuote | null;
  /** Number of Position rows on this market (only on GET /api/v1/calls/[id]). */
  positionsCount?: number;
}

export interface CallPositionView {
  marketId: string;
  side: CallSide;
  points: number;
  /** What this stake pays if its side wins at the current pools (stake included). */
  potentialPayout: number;
  result: CallPositionResult;
  /** Points paid back once settled (payout or refund); 0 when lost; null while pending. */
  payout: number | null;
  createdAt: string;
}

export interface CallsMeView {
  /** Season points minus everything staked in open markets (stakes are escrowed in the ledger). */
  spendablePoints: number;
  positions: CallPositionView[];
}

export interface CallsResponse {
  season: SeasonView | null;
  /** Server clock, ISO — the lock countdown is measured against this. */
  now: string;
  markets: CallMarketView[];
  /** Null when signed out. */
  me: CallsMeView | null;
}

export interface CallMarketResponse {
  market: CallMarketView & { positionsCount: number };
  me: CallsMeView | null;
}

export interface PlaceCallBody {
  marketId: string;
  side: CallSide;
  /** Integer, 10..5000. */
  points: number;
}

export interface PlaceCallResponse {
  position: CallPositionView;
  market: CallMarketView;
  spendablePoints: number;
}

// ---------------------------------------------------------------------------
// Endpoint map — one place that documents every read the UI performs.
// ---------------------------------------------------------------------------

export const api = {
  plays: () => apiGet<PlaysResponse>("/api/v1/plays"),
  leaderboard: (limit = 100, seasonId?: string) =>
    apiGet<LeaderboardResponse>(
      `/api/v1/leaderboard?limit=${encodeURIComponent(String(limit))}${seasonId ? `&season=${encodeURIComponent(seasonId)}` : ""}`,
    ),
  partners: () => apiGet<PartnersResponse>("/api/v1/partners"),
  partner: (slug: string, opts?: ApiRequestOptions) =>
    apiGet<PartnerResponse>(`/api/v1/partners/${encodeURIComponent(slug)}`, opts),
  season: () => apiGet<SeasonResponse>("/api/v1/season"),
  me: () => apiGet<MeResponse>("/api/v1/season/me"),
  /** The one write on this map: re-read the caller's wallets and re-evaluate their Plays now (1/min). */
  refreshPlays: (opts?: ApiRequestOptions) => apiPost<RefreshPlaysResponse>("/api/v1/plays/refresh", {}, opts),
  /** Calls board: every Market this Season with its current quote, plus the caller's stakes when signed in. */
  calls: (opts?: ApiRequestOptions) => apiGet<CallsResponse>("/api/v1/calls", opts),
  callMarket: (id: string, opts?: ApiRequestOptions) =>
    apiGet<CallMarketResponse>(`/api/v1/calls/${encodeURIComponent(id)}`, opts),
  /** Put points on Yes or No. 409 "Prediction locked" / "Not enough points", 400 on a bad body. */
  placeCall: (body: PlaceCallBody, opts?: ApiRequestOptions) => apiPost<PlaceCallResponse>("/api/v1/calls/place", body, opts),
} as const;

// ---------------------------------------------------------------------------
// League (the weekly competition, virtual cash) — /api/v1/league, /league/trade, /league/symbols
// ---------------------------------------------------------------------------

export type LeagueTradeSide = "buy" | "sell";

/** lib/price PriceQuote on the wire (publishedAt as ISO). */
export interface PriceQuoteView {
  assetId: string;
  symbol: string;
  price: number | null;
  source: PriceSourceName;
  publishedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  marketOpen: boolean;
}

export interface LeagueView {
  id: string;
  seasonId: string;
  /** Monday 00:00 UTC, ISO. */
  weekStart: string;
  /** Friday 20:00 UTC, ISO. */
  weekEnd: string;
  status: "open" | "settled";
  /** Trades are accepted right now (inside the window and not settled). */
  open: boolean;
  /** Milliseconds until weekEnd while open, else null. */
  closesIn: number | null;
  /** Milliseconds until weekStart when the League has not opened yet (weekend), else null. */
  opensIn: number | null;
}

export interface LeaguePositionView {
  assetId: string;
  symbol: string;
  qty: number;
  avgPrice: number;
  /** Last price from lib/price, null when no source could quote (then `valueUsd` uses avgPrice). */
  last: number | null;
  quote: PriceQuoteView;
  valueUsd: number;
  costUsd: number;
  /** Null when there is no live price. */
  pnlUsd: number | null;
  pnlPct: number | null;
}

export interface LeagueTradeView {
  id: string;
  symbol: string;
  side: LeagueTradeSide;
  qty: number;
  /** Fill price (spread applied). */
  price: number;
  priceSource: string;
  ts: string;
}

export interface LeagueAccountView {
  id: string;
  cashUsd: number;
  equityUsd: number;
  /** 1-based, null until the first recompute. */
  rank: number | null;
  /** Rank change since the previous recompute (positive = up); null when unknown. */
  delta: number | null;
  pnlUsd: number;
  pnlPct: number;
  positions: LeaguePositionView[];
  /** Newest first, at most 20. */
  trades: LeagueTradeView[];
  isBot: boolean;
}

export interface LeagueLeaderboardRow {
  rank: number;
  userId: string;
  handle: string | null;
  address: string | null;
  equityUsd: number;
  pnlPct: number;
  isBot: boolean;
  /** Rank change since the previous recompute (positive = up); null when unknown. */
  delta: number | null;
  isMe: boolean;
}

export interface LeagueSettledView {
  id: string;
  weekStart: string;
  weekEnd: string;
  /** Final top 10. */
  top: LeagueLeaderboardRow[];
}

export interface LeagueResponse {
  /** Server clock, ISO (countdowns are computed against it). */
  now: string;
  signedIn: boolean;
  /** Null only when no Season is seeded. */
  league: LeagueView | null;
  /** The caller's account, null when signed out or before the first trade. */
  me: LeagueAccountView | null;
  /** Top 50 by rank. */
  leaderboard: LeagueLeaderboardRow[];
  /** Quotes for the tradable list plus the caller's held symbols. */
  quotes: PriceQuoteView[];
  /** The most recently settled League in this Season, for the weekend. */
  lastSettled: LeagueSettledView | null;
  startingCashUsd: number;
  /** Virtual spread fraction (0.001 = 0.1%). */
  spread: number;
}

export interface LeagueSymbolView {
  symbol: string;
  assetId: string;
  quote: PriceQuoteView;
  /** Quantity the caller holds (0 when none / signed out). */
  held: number;
}

export interface LeagueSymbolsResponse {
  symbols: LeagueSymbolView[];
  /** Trades are accepted right now. */
  open: boolean;
  /** The caller's cash, null when signed out or without an account. */
  cashUsd: number | null;
  spread: number;
}

export interface LeagueTradeBody {
  symbol: string;
  side: LeagueTradeSide;
  qty: number;
}

export interface LeagueTradeResponse {
  trade: LeagueTradeView;
  account: LeagueAccountView;
  /** The quote the fill came from (source / age / stale for the chip). */
  quote: PriceQuoteView;
  fill: number;
}

/** League endpoints (kept separate from `api` so the League can evolve on its own). */
export const leagueApi = {
  overview: (opts?: ApiRequestOptions) => apiGet<LeagueResponse>("/api/v1/league", opts),
  symbols: (opts?: ApiRequestOptions) => apiGet<LeagueSymbolsResponse>("/api/v1/league/symbols", opts),
  trade: (body: LeagueTradeBody, opts?: ApiRequestOptions) => apiPost<LeagueTradeResponse>("/api/v1/league/trade", body, opts),
} as const;

// ---------------------------------------------------------------------------
// Mirror (allocation view + Jupiter deep links) — /api/v1/mirror, /mirror/[wallet], /mirror/record
// ---------------------------------------------------------------------------

/**
 * "snapshot" = on-chain allocation from a Dulo wallet's latest Snapshot; "paper" = League
 * positions valued at current prices; "public" = a live on-chain read of a Solana wallet that
 * is not a Dulo player (cached 10 minutes, never stored, never scored).
 */
export type MirrorSource = "snapshot" | "paper" | "public";

export interface MirrorLegView {
  assetId: string;
  symbol: string;
  /** Position value in USD (cents). */
  usd: number;
  /** Share of totalUsd, 0..1 (4 dp). */
  weight: number;
}

/**
 * Change in total position value since `since` (NOT cash-flow adjusted: a deposit reads
 * as profit, a withdrawal as loss; snapshots record holdings, not transfers).
 */
export interface MirrorPnlView {
  absUsd: number;
  /** Percent of the older total; null when it was 0. */
  pct: number | null;
  /** ISO takenAt of the comparison snapshot (the closest one to 7d / 30d ago). */
  since: string;
}

export interface MirrorTargetView {
  address: string;
  chainId: string;
  /** Dulo handle; for a curated public wallet its neutral label ("Public holder A"); else null. */
  handle: string | null;
  /** Seeded League bot (paper positions only). */
  isBot: boolean;
  /** Season points rank, null when the owner has no season points, is a bot or is a public wallet. */
  rank: number | null;
  /** Rank of the League account the paper allocation was valued from (else the most recent League), null when none. */
  leagueRank: number | null;
  source: MirrorSource;
  /** Snapshot takenAt (snapshot), the valuation time (paper) or the live read time (public), ISO. */
  asOf: string;
  /** Value of the legs (invested value for paper). */
  totalUsd: number;
  /** Weight desc. Empty when the wallet holds nothing worth $1+. */
  legs: MirrorLegView[];
  pnl7d: MirrorPnlView | null;
  pnl30d: MirrorPnlView | null;
  /** Paper only: the League account's virtual cash. Null for snapshot / public targets. */
  cashUsd: number | null;
  /** Paper only: cash + positions at current prices (what the League ranks on). Null otherwise. */
  equityUsd: number | null;
}

export interface MirrorResponse {
  /** Server clock, ISO. */
  now: string;
  signedIn: boolean;
  target: MirrorTargetView;
  /** One quote per leg (source / age / stale for the chips). */
  quotes: PriceQuoteView[];
  /** True when any leg's quote is stale or missing: amounts are estimates. */
  stale: boolean;
  /** Input mint for every deep link (USDC). */
  usdcMint: string;
  /** mirror_match tolerance from the Play (fraction, e.g. 0.2). */
  tolerance: number;
}

export interface MirrorIndexRow {
  address: string;
  handle: string | null;
  isBot: boolean;
  rank: number;
  /** Season points (leaderboard rows). */
  points: number | null;
  /** League equity (League rows). */
  equityUsd: number | null;
  /**
   * League rows: the largest single-stock weight of the paper portfolio at current prices
   * (0..1, 4 dp), null when it holds nothing. Rows above 0.4 are listed after the rest.
   */
  topWeight?: number | null;
}

/** A curated public Solana wallet on /mirror (not a Dulo player, never scored). */
export interface MirrorPublicRow {
  address: string;
  /** Neutral label, e.g. "Public holder A". Never a guessed identity. */
  label: string;
  /** Live xStocks value from the 10-minute read cache; null while the read is pending or failed. */
  totalUsd: number | null;
  /** Legs worth $1+; null while pending or failed. */
  stocks: number | null;
  /** ISO time of the live read behind totalUsd, null when none. */
  asOf: string | null;
}

export interface MirrorIndexResponse {
  now: string;
  /** Top Season leaderboard wallets that have snapshot history. */
  leaderboard: MirrorIndexRow[];
  /** "Model portfolios (paper)": League accounts (bots included), concentrated ones (a leg > 40%) last. */
  league: MirrorIndexRow[];
  /** Curated public wallets on Solana: not Dulo players, never scored. */
  public: MirrorPublicRow[];
}

export interface MirrorRecordBody {
  targetWallet: string;
  /** USDC budget the plan was built for (informational; the snapshot compares weights, not amounts). */
  budgetUsd: number;
}

/** POST /api/v1/mirror/record: the intent is stored; the next snapshot (<= 5 min, sooner after sign-in/refresh) verifies it. */
export interface MirrorRecordResponse {
  targetWallet: string;
  recordedAt: string;
  budgetUsd: number;
  /** Target legs recorded. */
  legs: number;
  source: MirrorSource;
  /** The Mirror Play's status after recording ("in_progress", or "complete" when it was already done). */
  status: string;
}

export const mirrorApi = {
  index: (opts?: ApiRequestOptions) => apiGet<MirrorIndexResponse>("/api/v1/mirror", opts),
  target: (wallet: string, opts?: ApiRequestOptions) => apiGet<MirrorResponse>(`/api/v1/mirror/${encodeURIComponent(wallet)}`, opts),
  /** Record "I've done my swaps": 401 signed out, 404 nothing to mirror, 409 no legs / own wallet / Play missing, 503 public wallet read unavailable. */
  record: (body: MirrorRecordBody, opts?: ApiRequestOptions) => apiPost<MirrorRecordResponse>("/api/v1/mirror/record", body, opts),
} as const;

// ---------------------------------------------------------------------------
// Badges (soulbound Token-2022) — /api/v1/badges/me, /badges/[key]/metadata.json, /badges/[key]/image.svg
// ---------------------------------------------------------------------------

export type BadgeState = "minted" | "pending";

export interface MyBadgeView {
  playKey: string;
  /** Short title, e.g. "First Position". */
  title: string;
  /** On-chain token name, e.g. "Dulo · First Position". */
  name: string;
  description: string;
  /** Design accent ("ember" | "ice" | "gold" | "violet" | "laurel"), null for an unknown key. */
  accent: string | null;
  color: string | null;
  /** Relative URL of the SVG (null when no design exists for the key). */
  imageUrl: string | null;
  mint: string | null;
  txSig: string | null;
  /** Solscan link for txSig. */
  txUrl: string | null;
  /** "minted" once mint + txSig are set; "pending" = "Minting soon". */
  state: BadgeState;
  createdAt: string;
}

export interface BadgesMeResponse {
  badges: MyBadgeView[];
}

/** Public URL (relative) of a badge design's SVG. */
export function badgeImageUrl(key: string): string {
  return `/api/v1/badges/${encodeURIComponent(key)}/image.svg`;
}

export const badgesApi = {
  me: (opts?: ApiRequestOptions) => apiGet<BadgesMeResponse>("/api/v1/badges/me", opts),
} as const;

// ---------------------------------------------------------------------------
// Check any wallet (read-only preview) — /api/v1/preview/[address]
// ---------------------------------------------------------------------------

/**
 * qualifies       a holdings Play the wallet's live holdings satisfy right now
 * not_yet         a holdings Play they do not satisfy yet
 * needs_history   the Play reads daily snapshots (streaks, DCA, earnings): connect to start the clock
 * needs_activity  the Play is played inside Dulo (League trades, Calls, Mirror): connect to take part
 */
export type PreviewPlayStatus = "qualifies" | "not_yet" | "needs_history" | "needs_activity";

/**
 * An issuer's own valuation of a pre-IPO token's underlying (PreStocks "markPrice"), with its own
 * age. An explanation beside the DEX quote, never a signal: the UI prints both numbers and no
 * difference, percentage or sort key.
 */
export interface IssuerMarkView {
  price: number;
  /** When the issuer payload was fetched, ISO. */
  publishedAt: string | null;
  ageSeconds: number | null;
}

export interface PreviewHoldingView {
  assetId: string;
  symbol: string;
  /** Holding.source: the issuer that resolved this position ("xstocks", "prestocks"). */
  source: string;
  /** Multiplier-correct quantity. */
  qty: number;
  /** Token-2022 ScaledUiAmount multiplier applied to the raw balance (1 when none). */
  multiplier: number;
  /** Position value in USD (cents); 0 without a price. */
  usd: number;
  /** The quote behind `usd` (source / age / stale for the PriceChip). */
  quote: PriceQuoteView;
  /** PreStocks only: the issuer mark when the issuer API has answered; null otherwise (the UI omits the line). */
  issuerMark: IssuerMarkView | null;
  /**
   * The corporate action on this holding's mint (a Token-2022 ScaledUiAmount change), when the
   * mint carries one; null or absent otherwise. The UI prints the arithmetic for a past action only.
   */
  action?: PreviewHoldingActionView | null;
}

/** A holding's corporate action as the wallet check shows it: what kind, by how much, and when. */
export interface PreviewHoldingActionView {
  kind: CorporateActionView["kind"];
  /** multiplierAfter / multiplierBefore. */
  ratio: number;
  effectiveAt: string | null;
  /** True once the new multiplier is in force on the mint. */
  effective: boolean;
}

export interface PreviewPlayView {
  key: string;
  title: string;
  desc: string;
  points: number;
  badgeKey: string | null;
  rule: PlayRule;
  /** The issuer this quest was evaluated against (Play.assetSource); null when unfenced. */
  assetSource: string | null;
  status: PreviewPlayStatus;
  /** One line explaining the status, e.g. "Needs daily snapshots — connect to start the clock". */
  note: string;
  /** The engine's evidence on this one read (holdings Plays), or the reason it cannot be decided yet. */
  proof: Record<string, unknown>;
  /** Holdings Plays only. */
  progress: { current: number; target: number; unit: string } | null;
}

export interface PreviewResponse {
  /** Server clock, ISO. */
  now: string;
  address: string;
  chainId: string;
  /** When the balances were read from the chain, ISO. */
  readAt: string;
  /** Neutral label when the address is a curated public holder ("Public holder A"), else null. */
  label: string | null;
  /** Value of every position held, xStocks and pre-IPO tokens (cents). */
  totalUsd: number;
  /** Positions with qty > 0, largest first. */
  holdings: PreviewHoldingView[];
  /** Every active Play: holdings Plays first, then history Plays, then in-app Plays. */
  plays: PreviewPlayView[];
  /** Plays with status "qualifies". */
  qualifying: number;
  /** Points of the qualifying Plays, scored only once the owner connects. Points only, no cash value. */
  qualifyingPoints: number;
}

export const previewApi = {
  /** Read-only: nothing stored, never scored. 400 invalid address, 429 over 10 checks/min, 503 read failed. */
  wallet: (address: string, opts?: ApiRequestOptions) => apiGet<PreviewResponse>(`/api/v1/preview/${encodeURIComponent(address)}`, opts),
} as const;
