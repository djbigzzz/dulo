/**
 * Calls seeding — the pure part (docs/REVIEW-2026-09-14.md H5 + M10).
 *
 *   SEED_CALL_TICKERS  the three standard weekly markets (NVDA, TSLA, SPY). The cron
 *                      (lib/games/calls ensureWeeklyMarkets) creates them for the coming
 *                      Friday whenever they are missing; prisma/seed-calls.ts delegates.
 *   planBotStakes      which League bots stake how many points on which side of a market,
 *                      so a fresh market never reads "No stakes yet". Pools are tilted per
 *                      ticker (POOL_TILTS) so the parimutuel odds are visibly asymmetric.
 *                      Deterministic in the ticker: the same market always gets the same
 *                      plan, which is what makes re-running the seed idempotent.
 *
 * The DB side (admin grant + placeCall per bot) lives in lib/games/calls seedCallStakes,
 * because it needs placeCall and this module must stay import-free of calls.ts.
 */
import { MAX_CALL_POINTS, MIN_CALL_POINTS } from "./calls-limits";
import { BOT_HANDLES, botUserId } from "./league";
import { largestRemainderSplit, type Side } from "./parimutuel";

/** Markets the cron keeps open every week. */
export const SEED_CALL_TICKERS: readonly string[] = Object.freeze(["NVDA", "TSLA", "SPY"]);

export interface PoolTilt {
  /** Points the bots put on Yes. */
  yes: number;
  /** Points the bots put on No. */
  no: number;
}

/** Bot pool sizes per ticker (points). Anything else gets DEFAULT_POOL_TILT. */
export const POOL_TILTS: Readonly<Record<string, PoolTilt>> = Object.freeze({
  NVDA: Object.freeze({ yes: 320, no: 180 }),
  TSLA: Object.freeze({ yes: 150, no: 350 }),
  SPY: Object.freeze({ yes: 400, no: 250 }),
});

export const DEFAULT_POOL_TILT: PoolTilt = Object.freeze({ yes: 300, no: 200 });

/** Most bots on one side of one market. */
export const MAX_BOTS_PER_SIDE = 5;

export function poolTilt(ticker: string): PoolTilt {
  return POOL_TILTS[ticker.toUpperCase()] ?? DEFAULT_POOL_TILT;
}

export interface BotStake {
  userId: string;
  handle: string;
  side: Side;
  points: number;
}

/** PointsEvent ref of the admin grant that funds one bot's stake on one market. */
export function seedGrantRef(marketId: string, userId: string): string {
  return `admin:seed:${marketId}:${userId}`;
}

/** FNV-1a 32-bit; only used to spread bots and weights deterministically across tickers. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Split `total` points across a few bots: 2-5 shares of unequal size (weights 2..5 from
 * the hash), largest-remainder rounded, every share inside [MIN_CALL_POINTS,
 * MAX_CALL_POINTS]. Fewer shares when the total is small. Pure.
 */
export function splitStake(total: number, seed: number): number[] {
  if (!Number.isSafeInteger(total) || total < MIN_CALL_POINTS) {
    throw new RangeError(`stake total must be an integer >= ${MIN_CALL_POINTS}, got ${String(total)}`);
  }
  let parts = Math.min(MAX_BOTS_PER_SIDE, Math.max(1, Math.floor(total / 60)));
  for (; parts >= 1; parts -= 1) {
    const weights = Array.from({ length: parts }, (_, i) => 2 + ((seed >>> ((i * 3) % 29)) & 3)); // 2..5
    const shares = largestRemainderSplit(total, weights);
    if (shares.every((s) => s >= MIN_CALL_POINTS && s <= MAX_CALL_POINTS)) return shares;
  }
  throw new RangeError(`cannot split ${total} points into stakes of at least ${MIN_CALL_POINTS}`);
}

/**
 * The bot stakes for one market. Yes and No are held by disjoint bots (a bot never hedges
 * itself); which bots depends on the ticker so the three weekly markets show different
 * handles. Pure and deterministic.
 */
export function planBotStakes(ticker: string, tilt: PoolTilt = poolTilt(ticker)): BotStake[] {
  const key = ticker.toUpperCase();
  const seed = hash32(key);
  const yesShares = splitStake(tilt.yes, seed);
  const noShares = splitStake(tilt.no, hash32(`${key}:no`));
  const n = BOT_HANDLES.length;
  const start = seed % n;
  const out: BotStake[] = [];
  const bot = (offset: number) => {
    const index = (start + offset) % n;
    return { userId: botUserId(index), handle: BOT_HANDLES[index] };
  };
  yesShares.forEach((points, i) => out.push({ ...bot(i), side: "yes", points }));
  noShares.forEach((points, j) => out.push({ ...bot(yesShares.length + j), side: "no", points }));
  return out;
}
