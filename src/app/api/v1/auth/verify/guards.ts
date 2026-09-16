/**
 * Sign-in guards for POST /api/v1/auth/verify (16 Sep 2026 points policy).
 *
 * newAccountLimiter        at most 20 new accounts per network per hour, in memory and per
 *                          server instance. It only slows throwaway accounts farming starter
 *                          points; it is not a hard cap (docs/HANDOFF.md, known limits).
 * isBotOwnedUser           house bot accounts never sign in: a bot-league-* id, or any user
 *                          with an isBot competition account.
 * welcomePayload           what the first sign-in in a Season tells the player (the toast).
 *
 * Server-only (Prisma).
 */
import type { PrismaClient } from "@prisma/client";
import { isBotUserId } from "@/lib/games/bots";
import { STARTER_POINTS, VIRTUAL_CASH_USD, type WelcomeGrant } from "@/lib/games/ledger-policy";
import { ApiError } from "@/lib/server/api";
import { db } from "@/lib/server/db";
import { createRateLimiter, type RateLimiter } from "@/lib/server/rate-limit";

export const NEW_ACCOUNTS_PER_WINDOW = 20;
export const NEW_ACCOUNT_WINDOW_MS = 3_600_000;
export const NEW_ACCOUNT_LIMIT_MESSAGE = "Too many new accounts from this network. Try again later.";

/** Shared by every sign-in on this server instance. */
export const newAccountLimiter: RateLimiter = createRateLimiter({ limit: NEW_ACCOUNTS_PER_WINDOW, windowMs: NEW_ACCOUNT_WINDOW_MS });

/**
 * Count one new account against `key` (clientIp(req), already IP-normalised).
 * Throws ApiError(429) once the network has used its budget for the window.
 */
export function assertNewAccountAllowed(key: string, limiter: RateLimiter = newAccountLimiter, nowMs?: number): void {
  const decision = limiter.take(key, nowMs);
  if (!decision.ok) throw new ApiError(NEW_ACCOUNT_LIMIT_MESSAGE, 429);
}

/** A house bot's planned wallet address: refused before any row is read or written. */
export { isHouseBotAddress } from "@/lib/games/bot-identity";

/** True for a house bot account: the id prefix, or a competition account flagged isBot. */
export async function isBotOwnedUser(userId: string, client: Pick<PrismaClient, "leagueAccount"> = db): Promise<boolean> {
  if (isBotUserId(userId)) return true;
  const bots = await client.leagueAccount.count({ where: { userId, isBot: true } });
  return bots > 0;
}

/** The welcome block for the sign-in response: only for the request that wrote the grant. */
export function welcomePayload(granted: boolean): WelcomeGrant | null {
  return granted ? { starterPoints: STARTER_POINTS, virtualCashUsd: VIRTUAL_CASH_USD } : null;
}
