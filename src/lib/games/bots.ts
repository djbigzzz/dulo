/**
 * Bot identity, dependency-free so any module can import it without a cycle
 * (lib/server/queries -> lib/games/league would pull Prisma writes, prices and Solana keys
 * into every read path).
 *
 * League bots are Users whose id is `bot-league-<n>` (lib/games/league botUserId). They trade
 * in the paper League and stake on Calls so neither board is ever empty, but they never
 * score. Two independent markers identify them: a LeagueAccount with isBot = true (set by
 * seedBots) and this id prefix. REAL_USER_WHERE (lib/server/queries) excludes both, so a bot
 * row that exists before its LeagueAccount (or after one is deleted) still never scores.
 */

/** Every League bot's User id starts with this. lib/games/league botUserId builds ids from it. */
export const BOT_USER_ID_PREFIX = "bot-league-";

/** True for a League bot's User id. */
export function isBotUserId(userId: string): boolean {
  return typeof userId === "string" && userId.startsWith(BOT_USER_ID_PREFIX);
}
