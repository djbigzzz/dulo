import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetId, AssetInfo, HoldingsSnapshot, PriceQuote, RawTokenBalance } from "@/lib/core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const TSLAX = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const TSLAX_ID = `${SOL}/token:${TSLAX}` as AssetId;
const AAPLX_ID = `${SOL}/token:${AAPLX}` as AssetId;
const OWNER = "7C4jsdZxVDxbATGQeTNwyoDF5YkpHgqZUwKMoSHPHhNz";
const NOW = new Date("2026-09-14T12:00:00.000Z");
const USER = "user_1";

function asset(mint: string, symbol: string, underlying: string, sector: string | null): AssetInfo {
  return {
    assetId: `${SOL}/token:${mint}` as AssetId,
    chainId: SOL,
    symbol,
    underlying,
    name: `${underlying} xStock`,
    decimals: 8,
    sector,
    logoUrl: null,
    pythFeedId: null,
    multiplier: 1,
  };
}

const ASSETS: AssetInfo[] = [asset(TSLAX, "TSLAx", "TSLA", "Consumer Discretionary"), asset(AAPLX, "AAPLx", "AAPL", "Technology")];
const BY_ID = new Map(ASSETS.map((a) => [a.assetId, a]));

function balance(mint: string, amountRaw: string, multiplier: number | null): RawTokenBalance {
  return { chainId: SOL, mint, account: `acct_${mint.slice(0, 4)}`, amountRaw, decimals: 8, program: "token-2022", multiplier };
}

function quote(assetId: AssetId, price: number | null, source: PriceQuote["source"]): PriceQuote {
  return { assetId, symbol: BY_ID.get(assetId)?.symbol ?? assetId, price, source, publishedAt: null, ageSeconds: null, stale: price === null, marketOpen: true };
}

const P2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

// ---------------------------------------------------------------------------
// Module mocks (hoisted). Every external the cron touches is replaced.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  db: {
    wallet: { findMany: vi.fn() },
    snapshot: { create: vi.fn(), findMany: vi.fn() },
    season: { findFirst: vi.fn() },
    play: { findMany: vi.fn() },
    playProgress: { findMany: vi.fn(), upsert: vi.fn() },
    // createMany: the starter points backfill in the evaluate step.
    pointsEvent: { create: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
    // The badges step (P4): podium refs -> league_top3 rows, pending rows -> mint.
    badge: { create: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
    leagueTrade: { findMany: vi.fn() },
    // The League GameModule's tick: ensureLeague (upsert), open Leagues (findMany), accounts.
    league: { upsert: vi.fn(), findMany: vi.fn() },
    // count: the bot check before seedBots (REVIEW H4); the defaults say the bots are already in.
    leagueAccount: { findMany: vi.fn(), count: vi.fn() },
    // The Calls GameModule's tick: ensureWeeklyMarkets looks each weekly market up (findFirst),
    // then Markets due for settlement (none here).
    market: { findMany: vi.fn(), findFirst: vi.fn() },
    position: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
  getTokenBalances: vi.fn(),
  getPrices: vi.fn(),
  listAssets: vi.fn(),
  getAsset: vi.fn(),
  mintSet: vi.fn(),
  evaluatePlay: vi.fn(),
  mergeSnapshots: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({ db: mocks.db }));

vi.mock("@/lib/adapters/solana", () => ({
  solana: { chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", getTokenBalances: mocks.getTokenBalances },
}));

vi.mock("@/lib/assets/xstocks", () => {
  const normaliseQty = (raw: string, decimals: number, multiplier: number) => (Number(raw) / 10 ** decimals) * multiplier;
  return {
    xstocks: {
      name: "xstocks",
      listAssets: mocks.listAssets,
      getAsset: mocks.getAsset,
      getAssetBySymbol: vi.fn(async () => null),
      mintSet: mocks.mintSet,
      normaliseQty,
    },
    refreshXstocksCatalogue: vi.fn(async () => true),
    normaliseQty,
  };
});

vi.mock("@/lib/price", () => ({
  getPrices: mocks.getPrices,
  getPriceBySymbol: vi.fn(),
  getPricesBySymbols: vi.fn(async () => ({ quotes: [], unknown: [] })),
  UnknownAssetError: class UnknownAssetError extends Error {},
}));

vi.mock("@/lib/plays/engine", () => ({ evaluatePlay: mocks.evaluatePlay, mergeSnapshots: mocks.mergeSnapshots }));

import { bucketSnapshots, buildEvalContext, evaluateAllUsers, evaluateUser, loadInternalEvents, toHoldings } from "@/lib/cron/evaluate";
import { readWalletHoldings, snapshotAllWallets, snapshotWallet } from "@/lib/cron/snapshot";
import { runForUser, runTick } from "@/lib/cron/tick";

/** The bot exclusion every user-scoped cron query must carry (REVIEW H2, C20): bots are users with a LeagueAccount.isBot or a bot-league- id. */
const REAL_USERS_ONLY = { leagueAccounts: { none: { isBot: true } }, NOT: { id: { startsWith: "bot-league-" } } };

const FIRST_POSITION = { key: "first_position", points: 100, badgeKey: "first_position", rule: { type: "hold_any", minUsd: 5 } };
const DIVERSIFIED = { key: "diversified", points: 250, badgeKey: null, rule: { type: "diversified", minAssets: 3, minSectors: 2 } };

const COMPLETE_EVAL = {
  complete: true,
  proof: { symbol: "TSLAx", usd: 600 },
  progress: { current: 600, target: 5, unit: "usd" },
  completedAt: "2026-09-14T11:55:00.000Z",
};
const INCOMPLETE_EVAL = { complete: false, proof: { usd: 0 }, progress: { current: 0, target: 5, unit: "usd" } };

/** Sensible defaults: one Solana wallet with TSLAx, a live Season, one active Play, an empty ledger. */
function setDefaults() {
  mocks.listAssets.mockResolvedValue(ASSETS);
  mocks.getAsset.mockImplementation(async (id: AssetId) => BY_ID.get(id) ?? null);
  mocks.mintSet.mockResolvedValue(new Set([TSLAX, AAPLX]));
  mocks.getTokenBalances.mockResolvedValue([balance(TSLAX, "150000000", 2)]);
  mocks.getPrices.mockResolvedValue(new Map([[TSLAX_ID, quote(TSLAX_ID, 200, "pyth")]]));
  mocks.mergeSnapshots.mockImplementation((snaps: HoldingsSnapshot[], takenAt: Date) => ({
    walletId: "merged",
    takenAt,
    holdings: snaps.flatMap((s) => s.holdings),
  }));
  mocks.evaluatePlay.mockReturnValue(INCOMPLETE_EVAL);

  mocks.db.wallet.findMany.mockResolvedValue([{ id: "w1", userId: USER, address: OWNER, chainId: SOL }]);
  mocks.db.snapshot.create.mockResolvedValue({ id: "snap_1" });
  mocks.db.snapshot.findMany.mockResolvedValue([]);
  mocks.db.season.findFirst.mockResolvedValue({ id: "season_0" });
  mocks.db.play.findMany.mockResolvedValue([FIRST_POSITION]);
  mocks.db.playProgress.findMany.mockResolvedValue([]);
  mocks.db.playProgress.upsert.mockResolvedValue({});
  mocks.db.pointsEvent.create.mockResolvedValue({ id: "pe_1" });
  mocks.db.pointsEvent.findMany.mockResolvedValue([]);
  // Everyone already holds their starter points unless a test says otherwise.
  mocks.db.pointsEvent.createMany.mockResolvedValue({ count: 0 });
  mocks.db.badge.create.mockResolvedValue({ id: "badge_1" });
  mocks.db.badge.findMany.mockResolvedValue([]);
  mocks.db.badge.createMany.mockResolvedValue({ count: 0 });
  mocks.db.leagueTrade.findMany.mockResolvedValue([]);
  mocks.db.league.upsert.mockResolvedValue({
    id: "league_1",
    seasonId: "season_0",
    weekStart: new Date("2026-09-14T00:00:00Z"),
    weekEnd: new Date("2026-09-18T20:00:00Z"),
    status: "open",
  });
  mocks.db.league.findMany.mockResolvedValue([]);
  mocks.db.leagueAccount.findMany.mockResolvedValue([]);
  mocks.db.leagueAccount.count.mockResolvedValue(15);
  mocks.db.market.findMany.mockResolvedValue([]);
  // No weekly market yet and no strike quote (getPriceBySymbol is unmocked): ensure creates nothing.
  mocks.db.market.findFirst.mockResolvedValue(null);
  mocks.db.position.findMany.mockResolvedValue([]);
  mocks.db.user.findMany.mockResolvedValue([{ id: USER }]);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  setDefaults();
});

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

describe("snapshotWallet", () => {
  it("builds Holdings with the chain multiplier applied, prices from one batched getPrices call, and writes a Snapshot row", async () => {
    mocks.getTokenBalances.mockResolvedValue([balance(TSLAX, "150000000", 2), balance(AAPLX, "50000000", null)]);
    mocks.getPrices.mockResolvedValue(new Map([[TSLAX_ID, quote(TSLAX_ID, 200, "pyth")], [AAPLX_ID, quote(AAPLX_ID, null, "none")]]));

    const snap = await snapshotWallet({ id: "w1", address: OWNER, chainId: SOL }, { takenAt: NOW });

    // Balances are read through the adapter, filtered to the xStocks mint set.
    expect(mocks.getTokenBalances).toHaveBeenCalledTimes(1);
    expect(mocks.getTokenBalances.mock.calls[0][0]).toBe(OWNER);
    expect(mocks.getTokenBalances.mock.calls[0][1]).toEqual(new Set([TSLAX, AAPLX]));

    // One price call for the whole wallet, CAIP-19 ids only.
    expect(mocks.getPrices).toHaveBeenCalledTimes(1);
    expect(mocks.getPrices).toHaveBeenCalledWith([TSLAX_ID, AAPLX_ID]);

    expect(snap.walletId).toBe("w1");
    expect(snap.takenAt).toBe(NOW);
    expect(snap.holdings).toEqual([
      // 1.5 raw units * multiplier 2 from the chain
      { assetId: TSLAX_ID, symbol: "TSLAx", raw: "150000000", multiplier: 2, qty: 3, price: 200, priceSource: "pyth", usd: 600 },
      // chain reported no multiplier -> catalogue's (1); no price -> usd 0, source "none"
      { assetId: AAPLX_ID, symbol: "AAPLx", raw: "50000000", multiplier: 1, qty: 0.5, price: null, priceSource: "none", usd: 0 },
    ]);

    expect(mocks.db.snapshot.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.snapshot.create).toHaveBeenCalledWith({ data: { walletId: "w1", takenAt: NOW, holdings: snap.holdings } });
  });

  it("writes an empty Snapshot for a wallet holding no xStocks and skips the price call", async () => {
    mocks.getTokenBalances.mockResolvedValue([]);
    const snap = await snapshotWallet({ id: "w1", address: OWNER, chainId: SOL }, { takenAt: NOW });
    expect(snap.holdings).toEqual([]);
    expect(mocks.getPrices).not.toHaveBeenCalled();
    expect(mocks.db.snapshot.create).toHaveBeenCalledWith({ data: { walletId: "w1", takenAt: NOW, holdings: [] } });
  });

  it("refuses a wallet on a non-Solana chain", async () => {
    await expect(snapshotWallet({ id: "w9", address: "0xabc", chainId: "eip155:1" })).rejects.toThrow(/only Solana/);
    expect(mocks.getTokenBalances).not.toHaveBeenCalled();
  });

  it("stamps the snapshot with the read time when no takenAt is given", async () => {
    const before = Date.now();
    const snap = await snapshotWallet({ id: "w1", address: OWNER, chainId: SOL });
    expect(snap.takenAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(mocks.db.snapshot.create.mock.calls[0][0].data.takenAt).toBe(snap.takenAt);
  });
});

describe("readWalletHoldings", () => {
  it("returns the same multiplier-correct Holdings plus the quotes behind them, and writes nothing", async () => {
    mocks.getTokenBalances.mockResolvedValue([balance(TSLAX, "150000000", 2), balance(AAPLX, "50000000", null)]);
    const tsla = quote(TSLAX_ID, 200, "jupiter");
    mocks.getPrices.mockResolvedValue(new Map([[TSLAX_ID, tsla], [AAPLX_ID, quote(AAPLX_ID, null, "none")]]));

    const read = await readWalletHoldings(OWNER);

    expect(read.address).toBe(OWNER);
    expect(read.chainId).toBe(SOL);
    expect(read.readAt).toBeInstanceOf(Date);
    expect(read.holdings).toEqual([
      { assetId: TSLAX_ID, symbol: "TSLAx", raw: "150000000", multiplier: 2, qty: 3, price: 200, priceSource: "jupiter", usd: 600 },
      { assetId: AAPLX_ID, symbol: "AAPLx", raw: "50000000", multiplier: 1, qty: 0.5, price: null, priceSource: "none", usd: 0 },
    ]);
    expect(read.quotes.get(TSLAX_ID)).toBe(tsla);
    expect(mocks.getTokenBalances.mock.calls[0][1]).toEqual(new Set([TSLAX, AAPLX]));
    expect(mocks.getPrices).toHaveBeenCalledTimes(1);
    // Read-only: the preview route relies on this.
    expect(mocks.db.snapshot.create).not.toHaveBeenCalled();
    expect(mocks.db.wallet.findMany).not.toHaveBeenCalled();
  });

  it("refuses a non-Solana chain before touching the adapter", async () => {
    await expect(readWalletHoldings(OWNER, "eip155:1")).rejects.toThrow(/not a Solana chain/);
    expect(mocks.getTokenBalances).not.toHaveBeenCalled();
  });
});

describe("snapshotAllWallets", () => {
  it("isolates per-wallet failures, skips non-Solana wallets and warms the catalogue once", async () => {
    mocks.db.wallet.findMany.mockResolvedValue([
      { id: "w1", address: OWNER, chainId: SOL },
      { id: "w2", address: "broken", chainId: SOL },
      { id: "w3", address: "0xabc", chainId: "eip155:1" },
    ]);
    mocks.getTokenBalances.mockImplementation(async (owner: string) => {
      if (owner === "broken") throw new Error("rpc down");
      return [balance(TSLAX, "100000000", 1)];
    });

    const r = await snapshotAllWallets({ takenAt: NOW });

    expect(r.ok).toBe(1);
    expect(r.failed).toEqual([{ walletId: "w2", error: "rpc down" }]);
    expect(r.skipped).toBe(1);
    expect(r.took).toBeGreaterThanOrEqual(0);
    expect(mocks.listAssets).toHaveBeenCalledTimes(1);
    expect(mocks.db.snapshot.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.snapshot.create.mock.calls[0][0].data.walletId).toBe("w1");
  });

  it("restricts the run to the given wallet ids (bot wallets still excluded)", async () => {
    await snapshotAllWallets({ walletIds: ["w1", "w2"] });
    expect(mocks.db.wallet.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["w1", "w2"] }, user: REAL_USERS_ONLY });
  });

  it("never snapshots bot wallets: the exclusion is in the wallet query, not applied after the read", async () => {
    await snapshotAllWallets({ takenAt: NOW });
    expect(mocks.db.wallet.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.wallet.findMany.mock.calls[0][0]).toEqual({
      where: { user: REAL_USERS_ONLY },
      select: { id: true, address: true, chainId: true },
      orderBy: { createdAt: "asc" },
    });
  });
});

// ---------------------------------------------------------------------------
// evaluate
// ---------------------------------------------------------------------------

describe("toHoldings / bucketSnapshots", () => {
  it("coerces the JSON column and drops malformed entries", () => {
    const holdings = toHoldings([
      { assetId: TSLAX_ID, symbol: "TSLAx", raw: "1", multiplier: 1, qty: 1, price: 2, priceSource: "jupiter", usd: 2 },
      { assetId: AAPLX_ID, qty: "not a number", priceSource: "bogus" },
      { symbol: "no asset id" },
      null,
      "string",
    ]);
    expect(holdings).toEqual([
      { assetId: TSLAX_ID, symbol: "TSLAx", raw: "1", multiplier: 1, qty: 1, price: 2, priceSource: "jupiter", usd: 2 },
      { assetId: AAPLX_ID, symbol: AAPLX_ID, raw: "0", multiplier: 1, qty: 0, price: null, priceSource: "none", usd: 0 },
    ]);
    expect(toHoldings(null)).toEqual([]);
    expect(toHoldings({ not: "an array" })).toEqual([]);
  });

  it("merges every wallet's latest row per 5-minute bucket, ascending", () => {
    const h = (symbol: string, usd: number) => [{ assetId: TSLAX_ID, symbol, raw: "1", multiplier: 1, qty: 1, price: usd, priceSource: "pyth", usd }];
    const rows = [
      { walletId: "w1", takenAt: new Date("2026-09-14T12:07:00Z"), holdings: h("late", 3) },
      { walletId: "w1", takenAt: new Date("2026-09-14T12:00:10Z"), holdings: h("stale", 1) },
      { walletId: "w2", takenAt: new Date("2026-09-14T12:01:00Z"), holdings: h("w2", 5) },
      { walletId: "w1", takenAt: new Date("2026-09-14T12:00:50Z"), holdings: h("fresh", 2) },
    ];

    const out = bucketSnapshots(rows);

    expect(out.map((s) => s.takenAt.toISOString())).toEqual(["2026-09-14T12:00:00.000Z", "2026-09-14T12:05:00.000Z"]);
    expect(mocks.mergeSnapshots).toHaveBeenCalledTimes(2);
    // First bucket: w1's later row replaced its earlier one; w2 merged alongside.
    const firstInputs = mocks.mergeSnapshots.mock.calls[0][0] as HoldingsSnapshot[];
    expect(firstInputs.map((s) => [s.walletId, s.holdings[0].symbol]).sort()).toEqual([
      ["w1", "fresh"],
      ["w2", "w2"],
    ]);
    expect(mocks.mergeSnapshots.mock.calls[0][1]).toEqual(new Date("2026-09-14T12:00:00Z"));
    expect(out[1].holdings.map((x) => x.symbol)).toEqual(["late"]);
  });
});

describe("buildEvalContext", () => {
  it("loads 45 days of the user's snapshots, derives events from League trades and Calls, and wires the catalogue lookups", async () => {
    mocks.db.wallet.findMany.mockResolvedValue([{ id: "w1" }, { id: "w2" }]);
    mocks.db.snapshot.findMany.mockResolvedValue([
      { walletId: "w1", takenAt: new Date("2026-09-13T12:00:00Z"), holdings: [{ assetId: TSLAX_ID, symbol: "TSLAx", raw: "1", multiplier: 1, qty: 1, price: 1, priceSource: "pyth", usd: 1 }] },
    ]);
    mocks.db.leagueTrade.findMany.mockResolvedValue([
      { id: "trade_2", ts: new Date("2026-09-14T10:00:00Z"), symbol: "TSLAx", side: "buy", leagueAccountId: "la_1" },
    ]);
    mocks.db.position.findMany.mockResolvedValue([{ marketId: "mkt_1", side: "yes", points: 50, createdAt: new Date("2026-09-14T09:00:00Z") }]);

    const ctx = await buildEvalContext(USER, NOW, {
      extraEvents: [{ type: "mirror_executed", userId: USER, ref: "mirror:abc", ts: new Date("2026-09-14T11:00:00Z") }],
    });

    expect(ctx.now).toBe(NOW);
    const where = mocks.db.snapshot.findMany.mock.calls[0][0].where;
    expect(where.walletId).toEqual({ in: ["w1", "w2"] });
    expect(where.takenAt.gte).toEqual(new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000));
    expect(mocks.db.leagueTrade.findMany.mock.calls[0][0].where).toEqual({ account: { userId: USER } });

    expect(ctx.snapshots).toHaveLength(1);
    expect(ctx.snapshots[0].holdings[0].assetId).toBe(TSLAX_ID);

    // Ascending by ts; refs are the trade id / market id; each trade and each prediction side also
    // emits one game_action (derived from the same reads); extra (mirror) events are merged in.
    expect(ctx.events.map((e) => [e.type, e.ref])).toEqual([
      ["call_placed", "mkt_1"],
      ["game_action", "prediction:mkt_1:yes"],
      ["league_trade", "trade_2"],
      ["game_action", "trade:trade_2"],
      ["mirror_executed", "mirror:abc"],
    ]);
    expect(ctx.events.every((e) => e.userId === USER)).toBe(true);

    expect(ctx.earnings.NVDA).toEqual(["2026-11-18"]);
    expect(ctx.earnings).not.toHaveProperty("_note");
    expect(ctx.earnings).not.toHaveProperty("asOf");

    expect(ctx.sectorOf(TSLAX_ID)).toBe("Consumer Discretionary");
    expect(ctx.underlyingOf(AAPLX_ID)).toBe("AAPL");
    expect(ctx.sectorOf(`${SOL}/token:unknown`)).toBeNull();
    expect(ctx.underlyingOf("nope")).toBeNull();
  });
});

describe("loadInternalEvents", () => {
  const TRADES = [
    { id: "t1", ts: new Date("2026-09-14T10:00:00Z"), symbol: "TSLAx", side: "buy", leagueAccountId: "la_1" },
    { id: "t2", ts: new Date("2026-09-15T10:00:00Z"), symbol: "NVDAx", side: "sell", leagueAccountId: "la_1" },
  ];
  const POSITIONS = [
    { marketId: "m1", side: "yes", points: 100, createdAt: new Date("2026-09-14T09:00:00Z") },
    { marketId: "m1", side: "no", points: 50, createdAt: new Date("2026-09-16T09:00:00Z") },
  ];

  it("emits exactly league_trade, call_placed and game_action", async () => {
    mocks.db.leagueTrade.findMany.mockResolvedValue(TRADES);
    mocks.db.position.findMany.mockResolvedValue(POSITIONS);
    const events = await loadInternalEvents(USER);
    expect(new Set(events.map((e) => e.type))).toEqual(new Set(["league_trade", "call_placed", "game_action"]));
  });

  it("derives one game_action per trade and one per prediction side, with no extra query", async () => {
    mocks.db.leagueTrade.findMany.mockResolvedValue(TRADES);
    mocks.db.position.findMany.mockResolvedValue(POSITIONS);

    const events = await loadInternalEvents(USER);

    expect(events.filter((e) => e.type === "game_action")).toEqual([
      { type: "game_action", userId: USER, ref: "trade:t1", ts: TRADES[0].ts, meta: { kind: "trade" } },
      { type: "game_action", userId: USER, ref: "trade:t2", ts: TRADES[1].ts, meta: { kind: "trade" } },
      { type: "game_action", userId: USER, ref: "prediction:m1:yes", ts: POSITIONS[0].createdAt, meta: { kind: "prediction" } },
      { type: "game_action", userId: USER, ref: "prediction:m1:no", ts: POSITIONS[1].createdAt, meta: { kind: "prediction" } },
    ]);
    expect(events.filter((e) => e.type === "league_trade")).toHaveLength(2);
    expect(events.filter((e) => e.type === "call_placed")).toHaveLength(2);
    // Still exactly the two reads it always made.
    expect(mocks.db.leagueTrade.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.position.findMany).toHaveBeenCalledTimes(1);
  });

  it("emits nothing for a user with no trades and no predictions", async () => {
    expect(await loadInternalEvents(USER)).toEqual([]);
  });
});

describe("evaluateUser", () => {
  it("returns an empty result for a house bot id without touching the database", async () => {
    mocks.evaluatePlay.mockReturnValue(COMPLETE_EVAL);

    const r = await evaluateUser("bot-league-3", NOW);

    expect(r).toEqual({ userId: "bot-league-3", seasonId: null, evaluated: 0, completed: 0, newlyCompleted: 0, awarded: 0, badges: 0, errors: 0, plays: [] });
    // Not even with a Season and Plays handed in (the inline routes pass both).
    const again = await evaluateUser("bot-league-3", NOW, undefined, { season: { id: "season_0" }, plays: [FIRST_POSITION] });
    expect(again.plays).toEqual([]);
    for (const model of Object.values(mocks.db)) {
      for (const fn of Object.values(model)) expect(fn).not.toHaveBeenCalled();
    }
    expect(mocks.evaluatePlay).not.toHaveBeenCalled();
  });

  it("awards points and queues the Badge exactly once across two runs", async () => {
    mocks.evaluatePlay.mockReturnValue(COMPLETE_EVAL);

    // Run 1: nothing recorded yet -> complete, points, badge.
    const first = await evaluateUser(USER, NOW);
    expect(first.seasonId).toBe("season_0");
    expect(first).toMatchObject({ evaluated: 1, completed: 1, newlyCompleted: 1, awarded: 1, badges: 1, errors: 0 });
    expect(mocks.db.pointsEvent.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.pointsEvent.create).toHaveBeenCalledWith({
      data: { userId: USER, seasonId: "season_0", source: "play", ref: "play:first_position", delta: 100 },
    });
    expect(mocks.db.badge.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.badge.create).toHaveBeenCalledWith({ data: { userId: USER, playKey: "first_position", mint: null, txSig: null } });
    expect(mocks.db.playProgress.upsert).toHaveBeenCalledTimes(1);
    const upsert = mocks.db.playProgress.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ userId_playKey: { userId: USER, playKey: "first_position" } });
    expect(upsert.create).toEqual({
      userId: USER,
      playKey: "first_position",
      status: "complete",
      completedAt: new Date("2026-09-14T11:55:00.000Z"),
      proof: { symbol: "TSLAx", usd: 600, progress: { current: 600, target: 5, unit: "usd" } },
    });
    expect(upsert.update).toEqual({
      status: "complete",
      completedAt: new Date("2026-09-14T11:55:00.000Z"),
      proof: { symbol: "TSLAx", usd: 600, progress: { current: 600, target: 5, unit: "usd" } },
    });

    // Run 2: the progress row exists -> no second PointsEvent / Badge, proof refreshed.
    mocks.db.pointsEvent.create.mockClear();
    mocks.db.badge.create.mockClear();
    mocks.db.playProgress.upsert.mockClear();
    mocks.db.playProgress.findMany.mockResolvedValue([
      { playKey: "first_position", status: "complete", completedAt: new Date("2026-09-14T11:55:00.000Z"), proof: upsert.create.proof },
    ]);
    mocks.evaluatePlay.mockReturnValue({ ...COMPLETE_EVAL, proof: { symbol: "TSLAx", usd: 650 }, completedAt: "2026-09-14T12:00:00.000Z" });

    const second = await evaluateUser(USER, new Date(NOW.getTime() + 5 * 60_000));
    expect(second).toMatchObject({ evaluated: 1, completed: 1, newlyCompleted: 0, awarded: 0, badges: 0, errors: 0 });
    expect(mocks.db.pointsEvent.create).not.toHaveBeenCalled();
    expect(mocks.db.badge.create).not.toHaveBeenCalled();
    const again = mocks.db.playProgress.upsert.mock.calls[0][0].update;
    expect(again.status).toBe("complete");
    expect(again.completedAt).toEqual(new Date("2026-09-14T11:55:00.000Z")); // original kept
    expect(again.proof).toEqual({ symbol: "TSLAx", usd: 650, progress: COMPLETE_EVAL.progress }); // refreshed
  });

  it("treats a P2002 on PointsEvent / Badge as already awarded and still records the completion", async () => {
    // A previous run wrote the ledger rows but died before PlayProgress.
    mocks.evaluatePlay.mockReturnValue(COMPLETE_EVAL);
    mocks.db.pointsEvent.create.mockRejectedValue(P2002);
    mocks.db.badge.create.mockRejectedValue(P2002);

    const r = await evaluateUser(USER, NOW);

    expect(r).toMatchObject({ evaluated: 1, completed: 1, newlyCompleted: 1, awarded: 0, badges: 0, errors: 0 });
    expect(r.plays[0]).toMatchObject({ key: "first_position", status: "complete", newlyCompleted: true, awarded: false, badge: false });
    expect(mocks.db.playProgress.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.db.playProgress.upsert.mock.calls[0][0].update.status).toBe("complete");
  });

  it("surfaces a non-unique database error on the Play without aborting the user", async () => {
    mocks.evaluatePlay.mockReturnValue(COMPLETE_EVAL);
    mocks.db.pointsEvent.create.mockRejectedValue(new Error("connection reset"));

    const r = await evaluateUser(USER, NOW);

    expect(r.errors).toBe(1);
    expect(r.plays[0].error).toBe("connection reset");
    // Progress is written after the ledger, so nothing claims completion until the points exist.
    expect(mocks.db.playProgress.upsert).not.toHaveBeenCalled();
  });

  it("never reverts a completed Play and keeps its completedAt and proof when the rule no longer holds", async () => {
    const completedAt = new Date("2026-09-10T15:00:00.000Z");
    const storedProof = { symbol: "TSLAx", usd: 42, progress: { current: 42, target: 5, unit: "usd" } };
    mocks.db.playProgress.findMany.mockResolvedValue([{ playKey: "first_position", status: "complete", completedAt, proof: storedProof }]);
    mocks.evaluatePlay.mockReturnValue(INCOMPLETE_EVAL); // user sold everything

    const r = await evaluateUser(USER, NOW);

    expect(r).toMatchObject({ completed: 1, newlyCompleted: 0, awarded: 0, badges: 0 });
    expect(mocks.db.pointsEvent.create).not.toHaveBeenCalled();
    expect(mocks.db.badge.create).not.toHaveBeenCalled();
    const upsert = mocks.db.playProgress.upsert.mock.calls[0][0];
    expect(upsert.update).toEqual({ status: "complete", completedAt, proof: storedProof });
  });

  it("writes in_progress with the fresh proof (progress included) while the rule is unmet", async () => {
    const r = await evaluateUser(USER, NOW);
    expect(r).toMatchObject({ evaluated: 1, completed: 0, newlyCompleted: 0, awarded: 0 });
    const upsert = mocks.db.playProgress.upsert.mock.calls[0][0];
    expect(upsert.create).toEqual({
      userId: USER,
      playKey: "first_position",
      status: "in_progress",
      completedAt: null,
      proof: { usd: 0, progress: { current: 0, target: 5, unit: "usd" } },
    });
  });

  it("creates a Badge row only for Plays with a badgeKey", async () => {
    mocks.db.play.findMany.mockResolvedValue([FIRST_POSITION, DIVERSIFIED]);
    mocks.evaluatePlay.mockReturnValue(COMPLETE_EVAL);

    const r = await evaluateUser(USER, NOW);

    expect(r).toMatchObject({ evaluated: 2, newlyCompleted: 2, awarded: 2, badges: 1 });
    expect(mocks.db.pointsEvent.create).toHaveBeenCalledTimes(2);
    expect(mocks.db.badge.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.badge.create.mock.calls[0][0].data.playKey).toBe("first_position");
  });

  it("skips a Play whose stored rule is invalid and keeps evaluating the rest", async () => {
    mocks.db.play.findMany.mockResolvedValue([{ key: "broken", points: 1, badgeKey: null, rule: { type: "nope" } }, FIRST_POSITION]);
    const r = await evaluateUser(USER, NOW);
    expect(r.errors).toBe(1);
    expect(r.evaluated).toBe(1);
    expect(r.plays.map((p) => [p.key, p.error ?? null])).toEqual([
      ["broken", "invalid rule"],
      ["first_position", null],
    ]);
    expect(mocks.evaluatePlay).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no Season is seeded", async () => {
    mocks.db.season.findFirst.mockResolvedValue(null);
    const r = await evaluateUser(USER, NOW);
    expect(r).toMatchObject({ seasonId: null, evaluated: 0 });
    expect(mocks.db.play.findMany).not.toHaveBeenCalled();
    expect(mocks.db.playProgress.upsert).not.toHaveBeenCalled();
  });

  it("only evaluates active Plays in the current Season", async () => {
    await evaluateUser(USER, NOW);
    expect(mocks.db.play.findMany.mock.calls[0][0].where).toEqual({ isActive: true, campaign: { seasonId: "season_0" } });
  });
});

describe("evaluateAllUsers", () => {
  it("evaluates every user, isolating failures, and loads Season, Plays and catalogue once", async () => {
    mocks.db.user.findMany.mockResolvedValue([{ id: "u_ok" }, { id: "u_boom" }]);
    mocks.db.playProgress.findMany.mockImplementation(async ({ where }: { where: { userId: string } }) => {
      if (where.userId === "u_boom") throw new Error("boom");
      return [];
    });
    mocks.evaluatePlay.mockReturnValue(COMPLETE_EVAL);

    const r = await evaluateAllUsers(NOW);

    expect(r.seasonId).toBe("season_0");
    expect(r.ok).toBe(1);
    expect(r.failed).toEqual([{ userId: "u_boom", error: "boom" }]);
    expect(r.awarded).toBe(1);
    // The current Season is looked up once (the starter backfill's own check names the Season id).
    expect(mocks.db.season.findFirst.mock.calls.filter((c) => c[0]?.where?.id === undefined)).toHaveLength(1);
    expect(mocks.db.play.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.listAssets).toHaveBeenCalledTimes(1);
  });

  it("backfills starter points for the real users it loaded, in one insert with skipDuplicates", async () => {
    mocks.db.user.findMany.mockResolvedValue([{ id: "u_a" }, { id: "u_b" }]);
    mocks.db.pointsEvent.createMany.mockResolvedValue({ count: 2 });

    const r = await evaluateAllUsers(NOW);

    expect(r.starterGranted).toBe(2);
    expect(mocks.db.pointsEvent.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.pointsEvent.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "u_a", seasonId: "season_0", source: "starter", ref: "starter:season_0", delta: 1000 },
        { userId: "u_b", seasonId: "season_0", source: "starter", ref: "starter:season_0", delta: 1000 },
      ],
      skipDuplicates: true,
    });
    // Only while the Season's window is active.
    expect(mocks.db.season.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "season_0", startsAt: { lte: NOW }, endsAt: { gte: NOW } } }),
    );
  });

  it("never grants starter points to a bot, even one that slipped past the user query", async () => {
    // The database already filters bots (REAL_USER_WHERE); the backfill drops the id prefix as well.
    mocks.db.user.findMany.mockResolvedValue([{ id: USER }, { id: "bot-league-5" }]);
    mocks.db.pointsEvent.createMany.mockResolvedValue({ count: 1 });

    await evaluateAllUsers(NOW);

    const rows = mocks.db.pointsEvent.createMany.mock.calls[0][0].data as Array<{ userId: string }>;
    expect(rows.map((row) => row.userId)).toEqual([USER]);
    expect(mocks.db.user.findMany.mock.calls[0][0].where).toEqual(REAL_USERS_ONLY);
  });

  it("backfills even when no quest is active, and writes nothing for an ended Season", async () => {
    mocks.db.play.findMany.mockResolvedValue([]);
    mocks.db.pointsEvent.createMany.mockResolvedValue({ count: 1 });
    expect((await evaluateAllUsers(NOW)).starterGranted).toBe(1);

    mocks.db.pointsEvent.createMany.mockClear();
    // The backfill's active-window check finds nothing: the Season has ended.
    mocks.db.season.findFirst.mockImplementation(async (args: { where?: { id?: string } }) => (args?.where?.id ? null : { id: "season_0" }));
    const r = await evaluateAllUsers(NOW);
    expect(r.starterGranted).toBe(0);
    expect(mocks.db.pointsEvent.createMany).not.toHaveBeenCalled();
  });

  it("a failing backfill is logged and never fails the step", async () => {
    mocks.db.pointsEvent.createMany.mockRejectedValue(new Error("pool timeout"));
    mocks.evaluatePlay.mockReturnValue(COMPLETE_EVAL);

    const r = await evaluateAllUsers(NOW);

    expect(r).toMatchObject({ seasonId: "season_0", ok: 1, failed: [], awarded: 1, starterGranted: 0 });
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/starter points backfill failed.*pool timeout/));

    const tick = await runTick(NOW, { steps: ["evaluate"] });
    expect(tick.steps[0]).toMatchObject({ name: "evaluate", ok: true });
  });

  it("never evaluates bot users: the exclusion is in the user query, so a bot's seeded League trades cannot complete Scout", async () => {
    const SCOUT = { key: "scout", points: 50, badgeKey: null, rule: { type: "internal_event", event: "league_trade", count: 3 } };
    mocks.db.play.findMany.mockResolvedValue([SCOUT]);
    // The mocked DB honours the where-clause the way Postgres would: bots are not returned.
    mocks.db.user.findMany.mockImplementation(async ({ where }: { where: unknown }) => {
      expect(where).toEqual(REAL_USERS_ONLY);
      return [{ id: USER }];
    });
    mocks.evaluatePlay.mockReturnValue(COMPLETE_EVAL);

    const r = await evaluateAllUsers(NOW);

    expect(mocks.db.user.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.user.findMany.mock.calls[0][0]).toEqual({ where: REAL_USERS_ONLY, select: { id: true }, orderBy: { createdAt: "asc" } });
    expect(r).toMatchObject({ ok: 1, failed: [], awarded: 1 });
    // Only the real user's ledger is touched.
    expect(mocks.db.pointsEvent.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.pointsEvent.create.mock.calls[0][0].data).toMatchObject({ userId: USER, ref: "play:scout", delta: 50 });
  });
});

// ---------------------------------------------------------------------------
// tick
// ---------------------------------------------------------------------------

describe("runTick", () => {
  it("runs games -> snapshot -> evaluate -> badges in order, timing each", async () => {
    const r = await runTick(NOW);
    expect(r.ranAt).toBe(NOW.toISOString());
    // Games first: the Friday settle/rollover is clock-driven, reads no Snapshot, and must never
    // starve behind a rate-limited RPC. Badges last: the podium rows come from the games step.
    expect(r.steps.map((s) => [s.name, s.ok])).toEqual([
      ["games", true],
      ["snapshot", true],
      ["evaluate", true],
      ["badges", true],
    ]);
    // Nothing pending and nobody on a podium: the badges step is a no-op.
    expect(r.steps[3].detail).toMatchObject({ leagueTop3Created: 0, pending: 0, minted: 0, skipped: false });
    for (const s of r.steps) expect(s.took).toBeGreaterThanOrEqual(0);
    expect(r.steps[1].detail).toMatchObject({ ok: 1, failed: [], skipped: 0 });
    expect(r.steps[2].detail).toMatchObject({ seasonId: "season_0", ok: 1, failed: [], starterGranted: 0 });
    // Every registered GameModule is ticked; the League ensures this week's row and finds nothing to settle.
    expect(r.steps[0].detail).toMatchObject({
      modules: expect.arrayContaining([expect.objectContaining({ key: "league", ok: true }), expect.objectContaining({ key: "calls", ok: true })]),
    });
    expect(mocks.db.league.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.db.league.upsert.mock.calls[0][0].where).toEqual({
      seasonId_weekStart: { seasonId: "season_0", weekStart: new Date("2026-09-14T00:00:00Z") },
    });
    // The snapshot step stamps every row with the tick time so buckets line up.
    expect(mocks.db.snapshot.create.mock.calls[0][0].data.takenAt).toBe(NOW);
  });

  it("runs only the requested steps, in pipeline order, and reports a throwing step instead of failing the tick", async () => {
    mocks.db.season.findFirst.mockRejectedValue(new Error("db offline"));
    // Requested out of order: the pipeline order (games before evaluate) wins.
    const r = await runTick(NOW, { steps: ["evaluate", "games"] });
    expect(r.steps.map((s) => s.name)).toEqual(["games", "evaluate"]);
    expect(r.steps[1].ok).toBe(false);
    expect(r.steps[1].detail).toEqual({ error: "db offline" });
    // The games step also hits the offline Season lookup: it is reported per module, never thrown.
    expect(r.steps[0].name).toBe("games");
    expect(r.steps[0].detail).toMatchObject({
      modules: expect.arrayContaining([expect.objectContaining({ key: "league", ok: false, error: "db offline" })]),
    });
    expect(mocks.getTokenBalances).not.toHaveBeenCalled();
  });

  it("flags the snapshot step when any wallet failed", async () => {
    mocks.getTokenBalances.mockRejectedValue(new Error("rpc down"));
    const r = await runTick(NOW, { steps: ["snapshot"] });
    expect(r.steps[0].ok).toBe(false);
    expect(r.steps[0].detail).toMatchObject({ ok: 0, failed: [{ walletId: "w1", error: "rpc down" }] });
  });
});

describe("runForUser", () => {
  it("snapshots the user's wallets, evaluates them and reports the outcome", async () => {
    mocks.evaluatePlay.mockReturnValue(COMPLETE_EVAL);
    const r = await runForUser(USER, NOW);
    expect(r).toMatchObject({ userId: USER, ok: true, timedOut: false, error: null });
    expect(r.snapshot).toMatchObject({ ok: 1, failed: [] });
    expect(r.evaluate).toMatchObject({ evaluated: 1, newlyCompleted: 1, awarded: 1 });
    // Only this user's wallets are snapshotted (a bot's wallet would still be excluded).
    const snapshotQuery = mocks.db.wallet.findMany.mock.calls.find((c) => c[0]?.where?.id);
    expect(snapshotQuery?.[0].where).toEqual({ id: { in: ["w1"] }, user: REAL_USERS_ONLY });
  });

  it("resolves with timedOut when the work outlives its budget, and never throws", async () => {
    mocks.getTokenBalances.mockReturnValue(new Promise(() => undefined)); // RPC hangs forever
    const r = await runForUser(USER, NOW, { timeoutMs: 40 });
    expect(r).toMatchObject({ userId: USER, ok: false, timedOut: true, snapshot: null, evaluate: null });
    expect(r.error).toMatch(/timed out after 40ms/);
    expect(r.took).toBeGreaterThanOrEqual(30);
    expect(mocks.db.playProgress.upsert).not.toHaveBeenCalled();
  });

  it("resolves with the error message when a step throws", async () => {
    mocks.db.wallet.findMany.mockRejectedValue(new Error("db offline"));
    const r = await runForUser(USER, NOW);
    expect(r).toMatchObject({ ok: false, timedOut: false, error: "db offline", snapshot: null, evaluate: null });
  });
});
