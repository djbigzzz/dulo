/**
 * Parimutuel pool math for points-only Calls (docs/HANDOFF.md §3.3).
 *
 * Two pools, Yes and No, hold integer points. There is no house and no rake: the
 * whole pool is paid back out. A winner's share of the losing pool is proportional
 * to their stake, so every winner gets
 *
 *     payout = stake × (yesPool + noPool) / winningPool
 *
 * which is their stake back plus their pro-rata slice of the losing side.
 *
 * Rounding: points are integers, so exact shares are floored and the leftover
 * points (always fewer than the number of winners) go one each to the winners with
 * the largest fractional remainder (largest-remainder / Hamilton rounding), ties
 * broken by larger stake then userId. The total paid therefore equals the total
 * pool exactly — no point is created or lost in settlement.
 *
 * Refunds: a "void" outcome refunds every stake. So does a one-sided market — when
 * either pool is empty there is no counterparty, so everyone gets their stake back
 * whichever way the price went (the ledger records these as refunds, not payouts).
 *
 * Pure functions, no I/O. Inputs are validated: pools and stakes must be
 * non-negative safe integers (a RangeError otherwise).
 */

export type Side = "yes" | "no";
export type Outcome = "yes" | "no" | "void";

export interface Odds {
  yesPool: number;
  noPool: number;
  total: number;
  /** Implied probability of Yes (0..1) — the Yes pool's share. 0.5 when the market is empty. */
  yesProb: number;
  noProb: number;
  /** Points paid per point staked on Yes if Yes wins (total / yesPool). Null when nobody is on Yes. */
  yesMultiplier: number | null;
  noMultiplier: number | null;
}

export interface PositionInput {
  userId: string;
  side: Side;
  points: number;
}

export type PositionResult = "won" | "lost" | "refunded";

export interface SettledPosition extends PositionInput {
  /** Points paid back to the user for this position (0 for a lost position). */
  payout: number;
  result: PositionResult;
}

export interface Settlement {
  outcome: Outcome;
  yesPool: number;
  noPool: number;
  total: number;
  /** True when stakes were refunded (void outcome, or nobody on the other side). */
  refunded: boolean;
  /** Sum of every payout — always equals `total`. */
  paid: number;
  positions: SettledPosition[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertPoints(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${String(value)}`);
  }
}

export function isSide(v: unknown): v is Side {
  return v === "yes" || v === "no";
}

export function isOutcome(v: unknown): v is Outcome {
  return v === "yes" || v === "no" || v === "void";
}

export function otherSide(side: Side): Side {
  return side === "yes" ? "no" : "yes";
}

// ---------------------------------------------------------------------------
// Odds and payouts
// ---------------------------------------------------------------------------

/** Implied probabilities and payout multipliers for the current pools. */
export function odds(yesPool: number, noPool: number): Odds {
  assertPoints(yesPool, "yesPool");
  assertPoints(noPool, "noPool");
  const total = yesPool + noPool;
  return {
    yesPool,
    noPool,
    total,
    yesProb: total === 0 ? 0.5 : yesPool / total,
    noProb: total === 0 ? 0.5 : noPool / total,
    yesMultiplier: yesPool === 0 ? null : total / yesPool,
    noMultiplier: noPool === 0 ? null : total / noPool,
  };
}

/**
 * Exact (unrounded) payout for a stake that is ALREADY inside its side's pool:
 * stake × (yesPool + noPool) / sidePool. A stake on an empty side is impossible, so
 * a zero side pool simply returns the stake (nothing to win, nothing lost).
 */
export function payout(stake: number, side: Side, yesPool: number, noPool: number): number {
  assertPoints(stake, "stake");
  assertPoints(yesPool, "yesPool");
  assertPoints(noPool, "noPool");
  if (stake === 0) return 0;
  const sidePool = side === "yes" ? yesPool : noPool;
  if (sidePool === 0) return stake;
  if (stake > sidePool) throw new RangeError(`stake ${stake} exceeds the ${side} pool ${sidePool}`);
  return (stake * (yesPool + noPool)) / sidePool;
}

/**
 * What a NEW stake would pay if placed now and its side won: the stake is first added
 * to its pool, then paid out of the enlarged total. This is the number to preview in
 * the UI before the call is placed; `payout` is for stakes already in the pool.
 */
export function potentialPayout(stake: number, side: Side, yesPool: number, noPool: number): number {
  assertPoints(stake, "stake");
  if (stake === 0) return 0;
  const yes = yesPool + (side === "yes" ? stake : 0);
  const no = noPool + (side === "no" ? stake : 0);
  return Math.floor(payout(stake, side, yes, no));
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/**
 * Split `total` across `shares` in proportion to `weights` (positive integers) using
 * largest-remainder rounding: floors first, then one extra point to the entries with the
 * largest fractional part (ties: larger weight, then lower index). Sum is exactly `total`.
 */
export function largestRemainderSplit(total: number, weights: readonly number[]): number[] {
  assertPoints(total, "total");
  const weightSum = weights.reduce((s, w) => {
    assertPoints(w, "weight");
    return s + w;
  }, 0);
  if (weights.length === 0) return [];
  if (weightSum === 0) throw new RangeError("weights must not all be zero");

  const floors = new Array<number>(weights.length);
  const remainders = new Array<number>(weights.length);
  let distributed = 0;
  for (let i = 0; i < weights.length; i++) {
    // Integer arithmetic: total * w fits in a safe integer for any realistic pool (≤ 2^53).
    const scaled = total * weights[i];
    const floor = Math.floor(scaled / weightSum);
    floors[i] = floor;
    remainders[i] = scaled - floor * weightSum; // in [0, weightSum)
    distributed += floor;
  }
  let leftover = total - distributed; // < weights.length
  if (leftover > 0) {
    const order = weights
      .map((_, i) => i)
      .sort((a, b) => remainders[b] - remainders[a] || weights[b] - weights[a] || a - b);
    for (const i of order) {
      if (leftover === 0) break;
      floors[i] += 1;
      leftover -= 1;
    }
  }
  return floors;
}

/**
 * Settle a market. Positions are (userId, side, points); a user may appear on both
 * sides. The losing pool is distributed pro rata to the winners on top of their
 * stakes; "void" refunds everyone; an empty pool on either side refunds everyone.
 * Invariant: Σ payout === yesPool + noPool.
 */
export function settle(positions: readonly PositionInput[], outcome: Outcome): Settlement {
  if (!isOutcome(outcome)) throw new RangeError(`unknown outcome ${String(outcome)}`);
  let yesPool = 0;
  let noPool = 0;
  for (const p of positions) {
    if (!isSide(p.side)) throw new RangeError(`unknown side ${String(p.side)} for ${p.userId}`);
    assertPoints(p.points, `points of ${p.userId}`);
    if (p.side === "yes") yesPool += p.points;
    else noPool += p.points;
  }
  const total = yesPool + noPool;

  const refund = (): Settlement => ({
    outcome,
    yesPool,
    noPool,
    total,
    refunded: true,
    paid: total,
    positions: positions.map((p) => ({ userId: p.userId, side: p.side, points: p.points, payout: p.points, result: "refunded" })),
  });

  if (outcome === "void") return refund();
  const winningPool = outcome === "yes" ? yesPool : noPool;
  const losingPool = outcome === "yes" ? noPool : yesPool;
  // No counterparty: nothing to win, nothing to lose.
  if (winningPool === 0 || losingPool === 0) return refund();

  const winnerIdx: number[] = [];
  positions.forEach((p, i) => {
    if (p.side === outcome && p.points > 0) winnerIdx.push(i);
  });
  const shares = largestRemainderSplit(total, winnerIdx.map((i) => positions[i].points));
  const payoutByIdx = new Map<number, number>();
  winnerIdx.forEach((i, k) => payoutByIdx.set(i, shares[k]));

  let paid = 0;
  const settled: SettledPosition[] = positions.map((p, i) => {
    const won = p.side === outcome;
    const pay = won ? (payoutByIdx.get(i) ?? 0) : 0;
    paid += pay;
    return { userId: p.userId, side: p.side, points: p.points, payout: pay, result: won ? "won" : "lost" };
  });

  return { outcome, yesPool, noPool, total, refunded: false, paid, positions: settled };
}
