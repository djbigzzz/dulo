import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { isBotUserId } from "@/lib/games/bots";
import { ApiError, assertSameOrigin, handler, ok, parseBody } from "@/lib/server/api";
import {
  CallsError,
  MAX_CALL_POINTS,
  MIN_CALL_POINTS,
  getCallMarket,
  placeCall,
  type PlaceCallRouteResponse,
} from "@/lib/games/calls";
import { ensureStarterPoints } from "@/lib/games/starter";
import { evaluateAfterPlacement } from "./inline-evaluate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  marketId: z.string().min(1).max(64),
  side: z.enum(["yes", "no"]),
  points: z.number().int().min(MIN_CALL_POINTS).max(MAX_CALL_POINTS),
});

/**
 * POST /api/v1/calls/place   { marketId, side: "yes" | "no", points }
 * Put points into one side of a prediction. Session cookie required; cross-site requests are refused.
 *   400  bad body            409  "Prediction locked" | "Prediction settled" |
 *   403  house bot session        "Not enough points: you have X, this prediction needs Y. Earn more
 *   404  unknown market            in the weekly competition (virtual cash) or from quests."
 * -> ok({ position, market, spendablePoints, newlyCompleted })
 *
 * Before placeCall the caller's starter points for the active Season are ensured
 * (lib/games/starter), so an account that signed in before the grant existed, or whose
 * sign-in grant failed, can still make its first prediction. The grant commits on its own;
 * placeCall's user lock then reads it. A failed grant is logged and never blocks the request.
 * House bot sessions are refused (their predictions are seeded by the cron, never made here).
 *
 * After the points-in row commits, the caller's call_placed / game_action quests (First
 * Prediction, ...) are evaluated inline with a short deadline (./inline-evaluate), so a first
 * prediction completes its quest in this response instead of on the next 5-minute tick.
 * `newlyCompleted` lists only the quests whose points this request awarded; a slow or failed
 * evaluation finishes in after() and never fails the prediction.
 */
export const POST = handler(async (req) => {
  assertSameOrigin(req);
  const session = await requireSession();
  if (isBotUserId(session.userId)) throw new ApiError("House bot accounts cannot make predictions", 403);
  const body = await parseBody(req, Body);
  const now = new Date();

  try {
    await ensureStarterPoints(session.userId, now);
  } catch (e) {
    console.warn(`[calls/place] starter points grant failed for ${session.userId}: ${e instanceof Error ? e.message : String(e)}`);
  }

  let placed;
  try {
    placed = await placeCall({ userId: session.userId, marketId: body.marketId, side: body.side, points: body.points }, now);
  } catch (e) {
    if (e instanceof CallsError) throw new ApiError(e.message, e.status);
    throw e;
  }

  const newlyCompleted = await evaluateAfterPlacement(session.userId);

  // Re-read through the same view builder the board uses so the card can be swapped in place.
  // Read after the evaluation, so spendable points include a quest award that just landed.
  const view = await getCallMarket(body.marketId, session.userId, new Date());
  if (!view) throw new ApiError("Market not found", 404);
  const position = view.me?.positions.find((p) => p.side === body.side) ?? {
    marketId: body.marketId,
    side: body.side,
    points: placed.position.points,
    potentialPayout: placed.position.points,
    result: "pending" as const,
    payout: null,
    createdAt: placed.position.createdAt.toISOString(),
  };
  const data: PlaceCallRouteResponse = {
    position,
    market: view.market,
    spendablePoints: view.me?.spendablePoints ?? placed.spendablePoints,
    newlyCompleted,
  };
  return ok(data, { headers: { "cache-control": "no-store" } });
});
