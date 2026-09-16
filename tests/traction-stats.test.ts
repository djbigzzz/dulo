import { describe, expect, it } from "vitest";
import { aggregateTraction, countedUserIds, holdingsUsd, parseWalletList, type TractionInput } from "../scripts/traction-stats";

// scripts/traction-stats.ts (work item C12): the numbers that go into the README, the form
// and the pitch video. Bots, wallet-less users and FOUNDER_WALLETS must never be counted.

const t = (iso: string) => new Date(iso);

function fixture(): TractionInput {
  return {
    users: [
      { id: "alice", walletAddresses: ["AliceMain", "AliceAlt"], isBot: false },
      { id: "bob", walletAddresses: ["BobMain"], isBot: false },
      { id: "carol", walletAddresses: ["CarolMain"], isBot: false }, // signed in, did nothing yet
      { id: "founder", walletAddresses: ["FounderDemo", "FounderSecond"], isBot: false },
      { id: "bot1", walletAddresses: ["BotWallet1"], isBot: true },
      { id: "stakebot", walletAddresses: [], isBot: false }, // wallet-less user a Calls bot stake can create
    ],
    completedPlays: [
      { userId: "alice", playKey: "first_position" },
      { userId: "alice", playKey: "diversified" },
      { userId: "alice", playKey: "first_position" }, // duplicate row must not double count
      { userId: "bob", playKey: "scout" },
      { userId: "founder", playKey: "first_position" },
      { userId: "bot1", playKey: "scout" },
    ],
    leagueAccounts: [
      { userId: "alice", isBot: false, trades: 3 },
      { userId: "bob", isBot: false, trades: 1 },
      { userId: "carol", isBot: false, trades: 0 }, // account without a trade is not a player
      { userId: "founder", isBot: false, trades: 5 },
      { userId: "bot1", isBot: true, trades: 7 },
    ],
    callPositions: [{ userId: "alice" }, { userId: "alice" }, { userId: "bob" }, { userId: "stakebot" }, { userId: "bot1" }, { userId: "founder" }],
    latestSnapshots: [
      { userId: "alice", walletAddress: "AliceMain", takenAt: t("2026-09-15T10:00:00Z"), holdings: [{ usd: 12.5 }, { usd: 20 }] },
      // An older row for the same wallet must be ignored, not summed.
      { userId: "alice", walletAddress: "AliceMain", takenAt: t("2026-09-14T10:00:00Z"), holdings: [{ usd: 999 }] },
      { userId: "alice", walletAddress: "AliceAlt", takenAt: t("2026-09-15T09:55:00Z"), holdings: [] },
      { userId: "bob", walletAddress: "BobMain", takenAt: t("2026-09-15T10:05:00Z"), holdings: [{ usd: 7.254 }, { usd: "nope" }, { usd: -3 }] },
      { userId: "founder", walletAddress: "FounderDemo", takenAt: t("2026-09-15T10:00:00Z"), holdings: [{ usd: 30 }] },
      { userId: "bot1", walletAddress: "BotWallet1", takenAt: t("2026-09-15T10:00:00Z"), holdings: [{ usd: 10_000 }] },
    ],
    excludedWallets: parseWalletList(" FounderSecond,\nOtherUnusedWallet "),
  };
}

describe("traction stats aggregation", () => {
  it("counts only signed-in, non-bot, non-founder users across every metric", () => {
    const s = aggregateTraction(fixture());
    expect(s).toEqual({
      signedInUsers: 3, // alice, bob, carol
      usersWithCompletedPlay: 2,
      playsVerified: 3,
      playsVerifiedByKey: { diversified: 1, first_position: 1, scout: 1 },
      leaguePlayers: 2,
      leagueTrades: 4,
      callsPlaced: 3,
      callers: 2,
      xstocksUsdHeld: 39.75, // 32.5 + 7.254, latest row per wallet only, rounded to cents
      walletsHoldingXstocks: 2,
      snapshotsAsOf: { oldest: "2026-09-15T09:55:00.000Z", newest: "2026-09-15T10:05:00.000Z" },
      excluded: { botUsers: 1, founderUsers: 1, walletlessUsers: 1 },
    });
  });

  it("parses FOUNDER_WALLETS as a case-sensitive comma/whitespace list and excludes the whole user for one listed wallet", () => {
    expect([...parseWalletList("A, b ,,C\nD")]).toEqual(["A", "b", "C", "D"]);
    expect(parseWalletList(undefined).size).toBe(0);
    expect(parseWalletList("").size).toBe(0);
    const users = fixture().users;
    expect([...countedUserIds(users, new Set())].sort()).toEqual(["alice", "bob", "carol", "founder"]);
    expect(countedUserIds(users, new Set(["foundersecond"])).has("founder")).toBe(true);
    expect(countedUserIds(users, new Set(["FounderSecond"])).has("founder")).toBe(false);
  });

  it("reads holdings USD defensively and reports an empty database as zeros", () => {
    expect(holdingsUsd(null)).toBe(0);
    expect(holdingsUsd({ usd: 5 })).toBe(0);
    expect(holdingsUsd([{ usd: 1.5 }, null, { usd: Number.NaN }, { usd: 2 }])).toBe(3.5);
    const empty = aggregateTraction({ users: [], completedPlays: [], leagueAccounts: [], callPositions: [], latestSnapshots: [], excludedWallets: new Set() });
    expect(empty.signedInUsers).toBe(0);
    expect(empty.xstocksUsdHeld).toBe(0);
    expect(empty.snapshotsAsOf).toBeNull();
  });
});
