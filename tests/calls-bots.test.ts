import { describe, expect, it, vi } from "vitest";

// Bot identity (15 Sep review, game integrity): the prefix lives in a dependency-free module
// and REAL_USER_WHERE excludes bots by BOTH markers. queries.ts and league.ts only need their
// server deps inert here.
vi.mock("@/lib/server/db", () => ({ db: {} }));
vi.mock("@/lib/price", () => ({
  getPrices: vi.fn(),
  getPriceBySymbol: vi.fn(),
  getPricesBySymbols: vi.fn(),
  UnknownAssetError: class UnknownAssetError extends Error {},
}));

import { BOT_USER_ID_PREFIX, isBotUserId } from "@/lib/games/bots";
import { planBotStakes, SEED_CALL_TICKERS } from "@/lib/games/calls-seed";
import { BOT_HANDLES, BOT_USER_ID_PREFIX as LEAGUE_BOT_USER_ID_PREFIX, botUserId } from "@/lib/games/league";
import { REAL_USER_WHERE } from "@/lib/server/queries";

describe("lib/games/bots", () => {
  it("every League bot id, and every Calls bot stake, carries the prefix", () => {
    expect(BOT_USER_ID_PREFIX).toBe("bot-league-");
    expect(LEAGUE_BOT_USER_ID_PREFIX).toBe(BOT_USER_ID_PREFIX); // league.ts re-exports bots.ts, one source of truth
    BOT_HANDLES.forEach((_, i) => expect(isBotUserId(botUserId(i)), botUserId(i)).toBe(true));
    for (const ticker of SEED_CALL_TICKERS) {
      for (const s of planBotStakes(ticker)) expect(isBotUserId(s.userId), s.userId).toBe(true);
    }
  });

  it("does not flag real user ids", () => {
    for (const id of ["cm1abc", "u1", "league-bot-1", "xbot-league-1", ""]) expect(isBotUserId(id), id).toBe(false);
  });
});

describe("REAL_USER_WHERE", () => {
  it("excludes a User with an isBot LeagueAccount and a User whose id has the bot prefix", () => {
    expect(REAL_USER_WHERE).toEqual({
      leagueAccounts: { none: { isBot: true } },
      NOT: { id: { startsWith: BOT_USER_ID_PREFIX } },
    });
  });
});
