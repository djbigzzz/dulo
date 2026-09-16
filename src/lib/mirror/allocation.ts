/**
 * Mirror — allocation maths and Jupiter deep links (docs/HANDOFF.md §3.4, DECIDED 14 Sep 2026).
 *
 * Mirror is an allocation VIEW plus one Jupiter deep link per leg. Nothing here moves
 * money: the user swaps in Jupiter with their own wallet and the next snapshot verifies
 * the mirror_match Play. Every function in this file is pure and client-safe (no server
 * imports, no clock reads), so the /mirror page can compute the plan in the browser and
 * the API can compute the target on the server from the same code.
 *
 *   allocationFromSnapshot(snapshot)   usd-weighted legs of a HoldingsSnapshot, weight desc
 *   allocationFromLegs(legs)           the same over already-valued { assetId, symbol, usd } rows
 *   pnlBetween(older, newer)           change in total position value between two allocations
 *   mirrorPlan({ target, budgetUsd })  per-leg USDC amounts for a budget (cents, legs < $1 dropped)
 *   jupiterSwapUrl({ inputMint, outputMint, amountUi })   https://jup.ag/swap?sell=<in>&buy=<out>&inAmount=<ui>
 */
import type { HoldingsSnapshot } from "@/lib/core/types";

/** USDC on Solana mainnet (the Mirror input mint). */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Positions worth less than this are dust and never become a leg. */
export const MIN_LEG_USD = 1;

/** Default budget the "Mirror with $X USDC" input starts with. */
export const DEFAULT_BUDGET_USD = 100;

/**
 * A model portfolio with one stock above this share is concentrated: /mirror lists it after
 * the diversified ones (15 Sep review, bot names) so the first thing a visitor
 * copies is not a single-stock bet.
 */
export const CONCENTRATED_LEG_WEIGHT = 0.4;

/** True when the largest leg of a portfolio is above CONCENTRATED_LEG_WEIGHT. Null / unknown weights are not concentrated. */
export function isConcentrated(topWeight: number | null | undefined): boolean {
  return typeof topWeight === "number" && Number.isFinite(topWeight) && topWeight > CONCENTRATED_LEG_WEIGHT;
}

export interface AllocationLeg {
  assetId: string;
  symbol: string;
  /** Position value, rounded to cents. */
  usd: number;
  /** Fraction of totalUsd (0..1), rounded to 4 dp. */
  weight: number;
}

export interface Allocation {
  /** Sum of the kept legs' usd (dust excluded), rounded to cents. */
  totalUsd: number;
  /** Sorted by weight desc, then symbol asc. */
  legs: AllocationLeg[];
}

export interface ValuedPosition {
  assetId: string;
  symbol?: string;
  usd: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Allocation over already-valued positions. Rows sharing an assetId are summed, rows
 * with usd < MIN_LEG_USD (after summing) are dropped, weights are usd / total of the
 * kept legs. Malformed rows (no assetId, non-finite usd) are ignored, never thrown.
 */
export function allocationFromLegs(positions: readonly ValuedPosition[]): Allocation {
  const byAsset = new Map<string, { symbol: string; usd: number }>();
  for (const p of Array.isArray(positions) ? positions : []) {
    if (!p || typeof p !== "object" || typeof p.assetId !== "string" || p.assetId.length === 0) continue;
    const usd = num(p.usd);
    if (usd === null || usd <= 0) continue;
    const symbol = typeof p.symbol === "string" && p.symbol.length > 0 ? p.symbol : p.assetId;
    const cur = byAsset.get(p.assetId);
    if (cur) cur.usd += usd;
    else byAsset.set(p.assetId, { symbol, usd });
  }

  const kept = [...byAsset.entries()].filter(([, v]) => v.usd >= MIN_LEG_USD);
  const total = kept.reduce((sum, [, v]) => sum + v.usd, 0);
  if (total <= 0) return { totalUsd: 0, legs: [] };

  const legs: AllocationLeg[] = kept
    .map(([assetId, v]) => ({ assetId, symbol: v.symbol, usd: round2(v.usd), weight: round4(v.usd / total) }))
    .sort((a, b) => b.weight - a.weight || b.usd - a.usd || cmpStr(a.symbol, b.symbol));
  return { totalUsd: round2(total), legs };
}

/**
 * Allocation of a wallet snapshot. Holdings are read tolerantly (the Snapshot.holdings
 * JSON column may be handed in as-is): qty <= 0 rows and rows without a usable usd are skipped.
 */
export function allocationFromSnapshot(snapshot: Pick<HoldingsSnapshot, "holdings"> | { holdings: unknown }): Allocation {
  const raw = snapshot && typeof snapshot === "object" ? (snapshot as { holdings?: unknown }).holdings : null;
  const rows: ValuedPosition[] = [];
  for (const h of Array.isArray(raw) ? raw : []) {
    if (!h || typeof h !== "object") continue;
    const o = h as Record<string, unknown>;
    const qty = num(o.qty);
    if (qty !== null && qty <= 0) continue;
    const usd = num(o.usd);
    if (typeof o.assetId !== "string" || usd === null) continue;
    rows.push({ assetId: o.assetId, symbol: typeof o.symbol === "string" ? o.symbol : undefined, usd });
  }
  return allocationFromLegs(rows);
}

export interface Pnl {
  /** newer.totalUsd - older.totalUsd, rounded to cents. */
  absUsd: number;
  /** Percent of the older total (absUsd / older * 100, 2 dp); null when the older total is 0. */
  pct: number | null;
}

/**
 * Change in TOTAL POSITION VALUE between two allocations (or snapshots).
 *
 * This is NOT cash-flow adjusted: a deposit or a fresh buy shows up as "profit" and a
 * withdrawal or sale as "loss", because Season 0 snapshots record holdings, not
 * transfers. It answers "how much is this wallet's xStocks stack worth now versus then",
 * which is what a Mirror candidate needs to see; label it "value change" in the UI.
 */
export function pnlBetween(older: Allocation | HoldingsSnapshot, newer: Allocation | HoldingsSnapshot): Pnl {
  const a = totalOf(older);
  const b = totalOf(newer);
  const absUsd = round2(b - a);
  return { absUsd, pct: a > 0 ? round2((absUsd / a) * 100) : null };
}

function totalOf(v: Allocation | HoldingsSnapshot): number {
  if (v && typeof v === "object" && "totalUsd" in v) return num((v as Allocation).totalUsd) ?? 0;
  return allocationFromSnapshot(v as HoldingsSnapshot).totalUsd;
}

export interface MirrorPlanLeg {
  assetId: string;
  symbol: string;
  weight: number;
  /** USDC to swap into this leg, rounded to cents. */
  usdc: number;
}

export interface MirrorPlan {
  budgetUsd: number;
  legs: MirrorPlanLeg[];
  /** Sum of the legs' usdc (can be below budgetUsd when dust legs were dropped). */
  allocatedUsd: number;
  /** Target legs whose share of the budget came to less than $1. */
  dropped: Array<{ assetId: string; symbol: string; weight: number; usdc: number }>;
}

/**
 * Split a USDC budget over the target legs: usdc = weight x budget rounded to cents; legs
 * under $1 are listed in `dropped` instead (Jupiter would route them, but a $0.30 xStock
 * position is noise inside the +/-20% tolerance). A non-finite or non-positive budget
 * yields an empty plan.
 */
export function mirrorPlan(input: { target: Pick<Allocation, "legs">; budgetUsd: number }): MirrorPlan {
  const budget = num(input?.budgetUsd);
  const source = input?.target && Array.isArray(input.target.legs) ? input.target.legs : [];
  if (budget === null || budget <= 0) return { budgetUsd: 0, legs: [], allocatedUsd: 0, dropped: [] };

  const legs: MirrorPlanLeg[] = [];
  const dropped: MirrorPlan["dropped"] = [];
  for (const leg of source) {
    const weight = num(leg.weight);
    if (weight === null || weight <= 0) continue;
    const usdc = round2(weight * budget);
    const row = { assetId: leg.assetId, symbol: leg.symbol, weight, usdc };
    if (usdc < MIN_LEG_USD) dropped.push(row);
    else legs.push(row);
  }
  const allocatedUsd = round2(legs.reduce((s, l) => s + l.usdc, 0));
  return { budgetUsd: round2(budget), legs, allocatedUsd, dropped };
}

export interface JupiterSwapUrlInput {
  inputMint: string;
  outputMint: string;
  /** Amount of the INPUT token in UI units (e.g. 25.5 USDC). Omit for an unprefilled swap. */
  amountUi?: number | null;
}

/**
 * Jupiter swap deep link: `https://jup.ag/swap?sell=<inputMint>&buy=<outputMint>&inAmount=<ui units>`.
 *
 * Verified against jup.ag's live client bundle on 15 Sep 2026 (15 Sep review
 * H-B): the /swap route validates the search params { sell, buy, inAmount } and the swap
 * form reads `inAmount` as a UI-unit number (> 0, under the input limit). `sell` and `buy`
 * are only honoured together. The legacy `/swap/<in>-<out>?amount=` link this replaced
 * loads the default USDC -> SOL pair with no amount.
 *
 * The amount is dropped when it is missing, non-positive or formats to "0" (a dust
 * value under 1e-6), so a link never carries `inAmount=0`. Jupiter always shows the live
 * quote before the user signs, and the UI prints the amount next to every link.
 */
export function jupiterSwapUrl({ inputMint, outputMint, amountUi }: JupiterSwapUrlInput): string {
  const params = new URLSearchParams({ sell: inputMint, buy: outputMint });
  const amount = num(amountUi ?? null);
  const formatted = amount !== null && amount > 0 ? formatAmount(amount) : "0";
  if (formatted !== "0") params.set("inAmount", formatted);
  return `https://jup.ag/swap?${params.toString()}`;
}

/** Plain decimal for URLs: no exponent, no trailing zeros, at most 6 dp (USDC has 6). */
function formatAmount(n: number): string {
  const fixed = n.toFixed(6);
  return fixed.replace(/\.?0+$/, "");
}

/** Deep link for one Mirror plan leg: USDC -> the xStock mint for the leg's USDC amount. */
export function jupiterLinkForLeg(leg: Pick<MirrorPlanLeg, "assetId" | "usdc">, mintOf: (assetId: string) => string | null): string | null {
  const mint = mintOf(leg.assetId);
  if (!mint) return null;
  return jupiterSwapUrl({ inputMint: USDC_MINT, outputMint: mint, amountUi: leg.usdc });
}

/** Mint of a Solana token CAIP-19 id ("solana:<ref>/token:<mint>"), null for anything else. Client-safe. */
export function mintOfAssetId(assetId: string): string | null {
  const m = /^solana:[-_a-zA-Z0-9]{1,32}\/token:([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(assetId);
  return m ? m[1] : null;
}

/** The `target` map a mirror_executed event carries: assetId -> weight. Legs with weight <= 0 are skipped. */
export function targetWeights(allocation: Pick<Allocation, "legs">): Record<string, number> {
  const out: Record<string, number> = {};
  for (const leg of allocation.legs) if (leg.weight > 0) out[leg.assetId] = leg.weight;
  return out;
}

/** assetId -> symbol for the legs (the engine uses it to label proof rows). */
export function targetSymbols(allocation: Pick<Allocation, "legs">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const leg of allocation.legs) out[leg.assetId] = leg.symbol;
  return out;
}
