import { after } from "next/server";
import { z } from "zod";
import { ApiError, assertSameOrigin, handler, ok, parseBody } from "@/lib/server/api";
import { requireSession } from "@/lib/auth/session";
import { isBotUserId } from "@/lib/games/bots";
import { evaluateLeaguePlays, placeLeagueTrade, type LeagueTradeResult } from "@/lib/games/league-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The inline quest evaluation caps itself at ~2.5s; after() may finish it past the response. */
export const maxDuration = 15;

const Body = z.object({
  /** xStocks symbol, e.g. "TSLAx". */
  symbol: z.string().trim().min(1).max(16),
  side: z.enum(["buy", "sell"]),
  /** Positive, up to 6 decimals (rounded server-side). */
  qty: z.number().positive().max(1_000_000_000),
});

/**
 * POST /api/v1/league/trade  { symbol, side, qty }
 * Paper trade in the weekly competition (virtual cash, no real money) at the lib/price quote
 * with a 0.1% virtual spread. Session cookie required; cross-site requests are refused (403).
 * The competition never pauses: between Friday 20:00 UTC and Monday 00:00 UTC trades count
 * toward next week's competition.
 *   400  bad body, unknown symbol, no price, not enough virtual cash / position,
 *        "Minimum paper trade is $10" (closing a whole position is exempt)
 *   403  a house bot session ("House bot accounts cannot trade here"; bots are seeded by the cron)
 *   409  the competition week is settled (only while it settles) or no Season
 * Right after the fill the caller's league_trade / game_action quests (First Paper Trades, ...)
 * are evaluated inline, so a third trade completes First Paper Trades in this response instead
 * of on the next 5-minute tick. Only quests whose points this request awarded are listed. The
 * trade is already committed: that step never fails the request, and past its ~2.5s budget
 * it finishes in after().
 * -> ok({ trade, account, quote, fill, completedPlays: [{ key, title, points }] })
 */
export const POST = handler(async (req) => {
  assertSameOrigin(req);
  const session = await requireSession();
  if (isBotUserId(session.userId)) throw new ApiError("House bot accounts cannot trade here", 403);
  const body = await parseBody(req, Body);
  const trade = await placeLeagueTrade({ userId: session.userId, symbol: body.symbol, side: body.side, qty: body.qty });

  const plays = await evaluateLeaguePlays(session.userId, new Date());
  const pending = plays.pending;
  if (pending) after(() => pending);

  const data: LeagueTradeResult = { ...trade, completedPlays: plays.completed };
  return ok(data, { headers: { "cache-control": "no-store" } });
});
