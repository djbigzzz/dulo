/**
 * Calls seed — the three weekly markets plus the bots' stakes (HANDOFF §3.3, REVIEW H5/M10).
 *
 * Delegates to lib/games/calls ensureWeeklyMarkets, the same function the cron runs at the
 * top of every tick:
 *   NVDA, TSLA, SPY · "Will X close above $STRIKE on Fri?"
 *   strike   = the xStock's lib/price quote when the market opened (2 decimals). No quote
 *              (offline) -> the ticker is skipped here and the cron creates it on its next
 *              tick; there is no fixed fallback strike.
 *   settleAt = Friday close + 5 min via fridaySettleAt (20:05 UTC in September; rolls to
 *              next week when seeded after Friday's close).
 *   stakes   = the League bots' tilted pools (lib/games/calls-seed) through placeCall, so
 *              no market ever reads "No stakes yet".
 *
 * Idempotent on (seasonId, ticker, settleAt) — a DB unique — and per bot Position: an
 * existing market keeps its strike (stakes may already sit behind it) and staked bots are
 * skipped.
 */
import type { PrismaClient } from "@prisma/client";
import { STRIKE_LABEL, ensureWeeklyMarkets } from "../src/lib/games/calls";
import { SEED_CALL_TICKERS } from "../src/lib/games/calls-seed";
import type { SeedRow } from "./seed";

export { SEED_CALL_TICKERS };

export async function seedCalls(prisma: PrismaClient, seasonId: string, now: Date = new Date()): Promise<SeedRow[]> {
  const rows: SeedRow[] = [];
  const r = await ensureWeeklyMarkets(seasonId, now, prisma);
  const settles = r.settleAt.toISOString();

  if (r.locked) {
    rows.push({ entity: "Market", key: "calls", action: "updated", detail: `inside the lock window before ${settles}; the cron opens next week's markets after the settle` });
    return rows;
  }
  for (const m of r.markets) {
    const pools = m.stakes.yesPool !== null && m.stakes.noPool !== null ? ` · pools ${m.stakes.yesPool}/${m.stakes.noPool}` : "";
    const stakes = `${m.stakes.placed} bot stakes placed, ${m.stakes.skipped} already in${m.stakes.failed.length ? `, ${m.stakes.failed.length} failed` : ""}${pools}`;
    rows.push({
      entity: "Market",
      key: m.marketId,
      action: m.action === "created" ? "created" : "updated",
      detail: `${m.ticker} > $${m.strike.toFixed(2)} (${STRIKE_LABEL}) · settles ${settles} · ${stakes}`,
    });
  }
  for (const ticker of r.noQuote) {
    rows.push({ entity: "Market", key: ticker, action: "updated", detail: `no quote for a strike; not created — the cron creates it on its next tick` });
  }
  return rows;
}
