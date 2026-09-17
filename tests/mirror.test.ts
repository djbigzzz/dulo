import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetId, HoldingsSnapshot } from "@/lib/core";

// events.ts and queries.ts import Prisma for the DB-backed functions; the pure helpers
// never touch it. The Mirror target / index queries get a mocked client and lib/price.
const mocks = vi.hoisted(() => ({
  db: {
    playProgress: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    wallet: { findFirst: vi.fn(), findMany: vi.fn() },
    season: { findFirst: vi.fn(), findUnique: vi.fn() },
    leagueAccount: { findMany: vi.fn() },
    snapshot: { findFirst: vi.fn() },
    pointsEvent: { aggregate: vi.fn(), groupBy: vi.fn() },
    market: { findMany: vi.fn() },
    league: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
  },
  getPrices: vi.fn(),
  getTokenBalances: vi.fn(),
  mintSet: vi.fn(),
  getAsset: vi.fn(),
}));
vi.mock("@/lib/server/db", () => ({ db: mocks.db }));
vi.mock("@/lib/price", () => ({ getPrices: mocks.getPrices }));
// Public Mirror reads: the chain and the catalogue are mocked, address validation and qty maths stay real.
vi.mock("@/lib/adapters/solana", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/adapters/solana")>()),
  solana: { getTokenBalances: mocks.getTokenBalances },
}));
vi.mock("@/lib/assets/xstocks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assets/xstocks")>();
  return { ...actual, xstocks: { mintSet: mocks.mintSet, getAsset: mocks.getAsset, normaliseQty: actual.normaliseQty } };
});

import { PublicKey } from "@solana/web3.js";
import { getMirrorTarget, listMirrorTargets } from "@/lib/server/queries";
import {
  PUBLIC_READ_FAILURE_TTL_MS,
  PUBLIC_READ_TTL_MS,
  PUBLIC_UNCACHED_READS_PER_MINUTE,
  PublicWalletReadError,
  getPublicMirrorTarget,
  listPublicMirrorRows,
  readPublicWallet,
  resetPublicReadCache,
} from "@/lib/mirror/public";
import { PUBLIC_WALLETS, isCuratedPublicWallet, publicWalletLabel } from "@/lib/mirror/public-wallets";
import { getMirrorIndex, publicReadApiError } from "@/lib/mirror/views";
import { ApiError } from "@/lib/server/api";
import { MIRROR_COMPLIANCE_LINE, parseWalletInput, toleranceCopy } from "@/components/mirror/mirror-format";
import { COMPLIANCE_LINE } from "@/components/common/compliance";
import { emptyAllocationCopy, sourceChip, targetStats } from "@/components/mirror/target-stats";
import {
  DEFAULT_BUDGET_USD,
  MIN_LEG_USD,
  USDC_MINT,
  allocationFromLegs,
  allocationFromSnapshot,
  jupiterLinkForLeg,
  jupiterSwapUrl,
  mintOfAssetId,
  mirrorPlan,
  pnlBetween,
  targetSymbols,
  targetWeights,
} from "@/lib/mirror/allocation";
import { intentFromProof, mirrorEventFromIntent, mirrorEventsForUser, parseMirrorIntent, recordMirrorIntent, MirrorPlayMissingError } from "@/lib/mirror/events";
import { evaluatePlay } from "@/lib/plays/engine";

const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const TSLA_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const AAPL_MINT = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const NVDA_MINT = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const TSLA = `${SOL}/token:${TSLA_MINT}` as AssetId;
const AAPL = `${SOL}/token:${AAPL_MINT}` as AssetId;
const NVDA = `${SOL}/token:${NVDA_MINT}` as AssetId;

function holding(assetId: AssetId, symbol: string, usd: number, qty = 1) {
  return { assetId, symbol, source: "xstocks", raw: "1", multiplier: 1, qty, price: qty > 0 ? usd / qty : null, priceSource: "jupiter" as const, usd };
}

function snapshot(takenAt: string, holdings: HoldingsSnapshot["holdings"]): HoldingsSnapshot {
  return { walletId: "w1", takenAt: new Date(takenAt), holdings };
}

beforeEach(() => {
  vi.resetAllMocks();
  // No prediction is open unless a test says so (seasonScoreWhere then omits NOT).
  mocks.db.market.findMany.mockResolvedValue([]);
  resetPublicReadCache();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------
// allocation
// ---------------------------------------------------------------------------

describe("allocationFromSnapshot", () => {
  it("weights positions by usd, drops dust under $1, sorts by weight desc", () => {
    const a = allocationFromSnapshot(
      snapshot("2026-09-14T12:00:00Z", [holding(AAPL, "AAPLx", 150), holding(TSLA, "TSLAx", 600), holding(NVDA, "NVDAx", 0.4)]),
    );
    expect(a.totalUsd).toBe(750);
    expect(a.legs.map((l) => [l.symbol, l.usd, l.weight])).toEqual([
      ["TSLAx", 600, 0.8],
      ["AAPLx", 150, 0.2],
    ]);
    expect(a.legs.reduce((s, l) => s + l.weight, 0)).toBeCloseTo(1, 6);
  });

  it("sums duplicate asset rows, skips qty <= 0 rows and malformed entries, and never throws", () => {
    const a = allocationFromSnapshot({
      holdings: [
        holding(TSLA, "TSLAx", 40),
        holding(TSLA, "TSLAx", 60),
        holding(AAPL, "AAPLx", 100, 0), // empty token account
        { assetId: NVDA, usd: "12" }, // usd not a number
        { symbol: "no asset id", usd: 10 },
        null,
        "x",
      ],
    });
    expect(a.legs).toEqual([{ assetId: TSLA, symbol: "TSLAx", usd: 100, weight: 1 }]);
    expect(allocationFromSnapshot({ holdings: null }).legs).toEqual([]);
    expect(allocationFromSnapshot({ holdings: [] })).toEqual({ totalUsd: 0, legs: [] });
  });

  it("MIN_LEG_USD is applied after summing duplicates", () => {
    const a = allocationFromLegs([
      { assetId: TSLA, symbol: "TSLAx", usd: 0.6 },
      { assetId: TSLA, symbol: "TSLAx", usd: 0.6 },
    ]);
    expect(MIN_LEG_USD).toBe(1);
    expect(a.legs).toHaveLength(1);
    expect(a.legs[0].usd).toBe(1.2);
  });

  it("rounds usd to cents and weights to 4 dp", () => {
    const a = allocationFromLegs([
      { assetId: TSLA, symbol: "TSLAx", usd: 33.333333 },
      { assetId: AAPL, symbol: "AAPLx", usd: 66.666667 },
    ]);
    expect(a.legs.map((l) => l.usd)).toEqual([66.67, 33.33]);
    expect(a.legs.map((l) => l.weight)).toEqual([0.6667, 0.3333]);
    expect(a.totalUsd).toBe(100);
  });
});

describe("pnlBetween", () => {
  it("is the change in total position value (not cash-flow adjusted) with pct of the older total", () => {
    const older = allocationFromLegs([{ assetId: TSLA, symbol: "TSLAx", usd: 400 }]);
    const newer = allocationFromLegs([{ assetId: TSLA, symbol: "TSLAx", usd: 450 }]);
    expect(pnlBetween(older, newer)).toEqual({ absUsd: 50, pct: 12.5 });
    expect(pnlBetween(newer, older)).toEqual({ absUsd: -50, pct: -11.11 });
  });

  it("accepts raw snapshots and reports pct null when the older total is 0", () => {
    const empty = snapshot("2026-09-01T00:00:00Z", []);
    const later = snapshot("2026-09-08T00:00:00Z", [holding(TSLA, "TSLAx", 100)]);
    expect(pnlBetween(empty, later)).toEqual({ absUsd: 100, pct: null });
    expect(pnlBetween(later, later)).toEqual({ absUsd: 0, pct: 0 });
  });
});

describe("mirrorPlan", () => {
  const target = allocationFromLegs([
    { assetId: TSLA, symbol: "TSLAx", usd: 600 },
    { assetId: AAPL, symbol: "AAPLx", usd: 399 },
    { assetId: NVDA, symbol: "NVDAx", usd: 1 },
  ]);

  it("splits the budget by weight, rounded to cents, and drops legs under $1", () => {
    const plan = mirrorPlan({ target, budgetUsd: 100 });
    expect(plan.budgetUsd).toBe(100);
    expect(plan.legs.map((l) => [l.symbol, l.usdc])).toEqual([
      ["TSLAx", 60],
      ["AAPLx", 39.9],
    ]);
    expect(plan.dropped.map((d) => [d.symbol, d.usdc])).toEqual([["NVDAx", 0.1]]);
    expect(plan.allocatedUsd).toBe(99.9);
  });

  it("rounds to cents without float noise and keeps every leg at a large budget", () => {
    const plan = mirrorPlan({ target, budgetUsd: 1234.567 });
    expect(plan.budgetUsd).toBe(1234.57);
    expect(plan.legs.map((l) => l.usdc)).toEqual([740.74, 492.59, 1.23]);
    for (const l of plan.legs) expect(Number.isInteger(Math.round(l.usdc * 100))).toBe(true);
    expect(plan.dropped).toEqual([]);
  });

  it("yields an empty plan for a non-positive or non-finite budget", () => {
    expect(mirrorPlan({ target, budgetUsd: 0 })).toEqual({ budgetUsd: 0, legs: [], allocatedUsd: 0, dropped: [] });
    expect(mirrorPlan({ target, budgetUsd: Number.NaN }).legs).toEqual([]);
    expect(mirrorPlan({ target, budgetUsd: -5 }).legs).toEqual([]);
  });

  it("defaults the UI budget to $100", () => {
    expect(DEFAULT_BUDGET_USD).toBe(100);
  });
});

describe("jupiterSwapUrl", () => {
  // Format verified against jup.ag's /swap route on 15 Sep 2026: search { sell, buy, inAmount } (UI units).
  it("builds the jup.ag /swap link with sell, buy and inAmount query params", () => {
    expect(jupiterSwapUrl({ inputMint: USDC_MINT, outputMint: TSLA_MINT, amountUi: 60 })).toBe(`https://jup.ag/swap?sell=${USDC_MINT}&buy=${TSLA_MINT}&inAmount=60`);
    expect(jupiterSwapUrl({ inputMint: "USDC", outputMint: "SOL", amountUi: 39.9 })).toBe("https://jup.ag/swap?sell=USDC&buy=SOL&inAmount=39.9");
  });

  it("never uses the legacy pair path or the amount param", () => {
    const url = new URL(jupiterSwapUrl({ inputMint: USDC_MINT, outputMint: NVDA_MINT, amountUi: 25.5 }));
    expect(url.origin + url.pathname).toBe("https://jup.ag/swap");
    expect(Object.fromEntries(url.searchParams)).toEqual({ sell: USDC_MINT, buy: NVDA_MINT, inAmount: "25.5" });
    expect(url.searchParams.has("amount")).toBe(false);
  });

  it("omits the amount when missing, non-positive or formatting to 0, and trims trailing zeros", () => {
    expect(jupiterSwapUrl({ inputMint: "USDC", outputMint: "SOL" })).toBe("https://jup.ag/swap?sell=USDC&buy=SOL");
    expect(jupiterSwapUrl({ inputMint: "USDC", outputMint: "SOL", amountUi: 0 })).toBe("https://jup.ag/swap?sell=USDC&buy=SOL");
    expect(jupiterSwapUrl({ inputMint: "USDC", outputMint: "SOL", amountUi: -3 })).toBe("https://jup.ag/swap?sell=USDC&buy=SOL");
    expect(jupiterSwapUrl({ inputMint: "USDC", outputMint: "SOL", amountUi: Number.NaN })).toBe("https://jup.ag/swap?sell=USDC&buy=SOL");
    expect(jupiterSwapUrl({ inputMint: "USDC", outputMint: "SOL", amountUi: 12.5 })).toBe("https://jup.ag/swap?sell=USDC&buy=SOL&inAmount=12.5");
    expect(jupiterSwapUrl({ inputMint: "USDC", outputMint: "SOL", amountUi: 12.1234567 })).toBe("https://jup.ag/swap?sell=USDC&buy=SOL&inAmount=12.123457");
    expect(jupiterSwapUrl({ inputMint: "USDC", outputMint: "SOL", amountUi: 1e-7 })).toBe("https://jup.ag/swap?sell=USDC&buy=SOL");
  });

  it("USDC is the mainnet mint", () => {
    expect(USDC_MINT).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });

  it("links a plan leg from USDC to the xStock mint", () => {
    const plan = mirrorPlan({ target: allocationFromLegs([{ assetId: TSLA, symbol: "TSLAx", usd: 10 }]), budgetUsd: 25 });
    expect(jupiterLinkForLeg(plan.legs[0], mintOfAssetId)).toBe(`https://jup.ag/swap?sell=${USDC_MINT}&buy=${TSLA_MINT}&inAmount=25`);
    expect(jupiterLinkForLeg({ assetId: "eip155:1/erc20:0xabc", usdc: 1 }, mintOfAssetId)).toBeNull();
  });
});

describe("mintOfAssetId / targetWeights / targetSymbols", () => {
  it("extracts the mint from a Solana token id only", () => {
    expect(mintOfAssetId(TSLA)).toBe(TSLA_MINT);
    expect(mintOfAssetId(`${SOL}/slip44:501`)).toBeNull();
    expect(mintOfAssetId("garbage")).toBeNull();
  });

  it("builds the engine's target map and symbol map", () => {
    const a = allocationFromLegs([
      { assetId: TSLA, symbol: "TSLAx", usd: 75 },
      { assetId: AAPL, symbol: "AAPLx", usd: 25 },
    ]);
    expect(targetWeights(a)).toEqual({ [TSLA]: 0.75, [AAPL]: 0.25 });
    expect(targetSymbols(a)).toEqual({ [TSLA]: "TSLAx", [AAPL]: "AAPLx" });
  });
});

// ---------------------------------------------------------------------------
// events (intent -> mirror_executed)
// ---------------------------------------------------------------------------

const INTENT = {
  targetWallet: "EwrBryTJ26ujseqB9JXE1LXZU39E9UtHn9KyPvCt8Raa",
  target: { [TSLA]: 0.75, [AAPL]: 0.25 },
  symbols: { [TSLA]: "TSLAx", [AAPL]: "AAPLx" },
  budgetUsd: 100,
  recordedAt: "2026-09-14T12:00:00.000Z",
  source: "paper" as const,
};

describe("parseMirrorIntent / intentFromProof", () => {
  it("accepts a well-formed intent and rejects malformed ones", () => {
    expect(parseMirrorIntent(INTENT)).toEqual(INTENT);
    expect(parseMirrorIntent({ ...INTENT, target: {} })).toBeNull();
    expect(parseMirrorIntent({ ...INTENT, target: { [TSLA]: 1.5 } })).toBeNull();
    expect(parseMirrorIntent({ ...INTENT, recordedAt: "yesterday" })).toBeNull();
    expect(parseMirrorIntent({ ...INTENT, targetWallet: "" })).toBeNull();
    expect(parseMirrorIntent(null)).toBeNull();
    // Unknown source / missing budget degrade instead of failing.
    expect(parseMirrorIntent({ ...INTENT, source: "?", budgetUsd: undefined })).toMatchObject({ source: "snapshot", budgetUsd: 0 });
    // A public (non-Dulo) target keeps its source.
    expect(parseMirrorIntent({ ...INTENT, source: "public" })).toMatchObject({ source: "public" });
  });

  it("reads the intent from proof.intent only", () => {
    expect(intentFromProof({ intent: INTENT, reason: "no_mirror" })).toEqual(INTENT);
    expect(intentFromProof(INTENT)).toBeNull();
    expect(intentFromProof(null)).toBeNull();
  });
});

describe("mirrorEventFromIntent", () => {
  it("is the mirror_executed InternalEvent the engine consumes", () => {
    const ev = mirrorEventFromIntent("user_1", INTENT);
    expect(ev).toEqual({
      type: "mirror_executed",
      userId: "user_1",
      ref: `mirror:${INTENT.targetWallet}`,
      ts: new Date(INTENT.recordedAt),
      meta: { targetWallet: INTENT.targetWallet, target: INTENT.target, symbols: INTENT.symbols, budgetUsd: 100, source: "paper" },
    });
  });

  it("completes the mirror_match Play once a later snapshot lands inside the tolerance", () => {
    const ev = mirrorEventFromIntent("user_1", INTENT);
    const ctx = {
      now: new Date("2026-09-14T12:10:00Z"),
      events: [ev],
      earnings: {},
      sectorOf: () => null,
      underlyingOf: () => null,
    };
    const before = snapshot("2026-09-14T11:55:00Z", [holding(TSLA, "TSLAx", 100)]);
    const matching = snapshot("2026-09-14T12:05:00Z", [holding(TSLA, "TSLAx", 70), holding(AAPL, "AAPLx", 30)]);
    const off = snapshot("2026-09-14T12:05:00Z", [holding(TSLA, "TSLAx", 30), holding(AAPL, "AAPLx", 70)]);

    expect(evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, { ...ctx, snapshots: [before] })).toMatchObject({ complete: false, proof: { reason: "no_snapshot_after_mirror" } });
    expect(evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, { ...ctx, snapshots: [before, matching] })).toMatchObject({ complete: true, completedAt: "2026-09-14T12:05:00.000Z" });
    expect(evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, { ...ctx, snapshots: [before, off] })).toMatchObject({ complete: false, proof: { reason: "outside_tolerance" } });
  });
});

describe("mirrorEventsForUser", () => {
  it("returns the event for a stored intent and [] for no row / a malformed proof", async () => {
    mocks.db.playProgress.findMany.mockResolvedValue([{ playKey: "mirror", proof: { reason: "no_mirror", intent: INTENT } }]);
    const events = await mirrorEventsForUser("user_1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "mirror_executed", ref: `mirror:${INTENT.targetWallet}` });
    expect(mocks.db.playProgress.findMany.mock.calls[0][0].where).toEqual({ userId: "user_1", playKey: "mirror" });

    mocks.db.playProgress.findMany.mockResolvedValue([]);
    expect(await mirrorEventsForUser("user_1")).toEqual([]);
    mocks.db.playProgress.findMany.mockResolvedValue([{ playKey: "mirror", proof: { reason: "no_mirror" } }]);
    expect(await mirrorEventsForUser("user_1")).toEqual([]);
    // Rows of another Play (a shared findMany mock in the cron tests) are ignored.
    mocks.db.playProgress.findMany.mockResolvedValue([{ playKey: "first_position", proof: { intent: INTENT } }]);
    expect(await mirrorEventsForUser("user_1")).toEqual([]);
  });

  it("never throws: a database failure yields []", async () => {
    mocks.db.playProgress.findMany.mockRejectedValue(new Error("db offline"));
    await expect(mirrorEventsForUser("user_1")).resolves.toEqual([]);
  });
});

describe("recordMirrorIntent", () => {
  it("creates an in_progress row with proof.intent when none exists", async () => {
    mocks.db.playProgress.findUnique.mockResolvedValue(null);
    mocks.db.playProgress.create.mockResolvedValue({});
    await recordMirrorIntent("user_1", INTENT);
    expect(mocks.db.playProgress.create).toHaveBeenCalledWith({
      data: { userId: "user_1", playKey: "mirror", status: "in_progress", completedAt: null, proof: { intent: INTENT } },
    });
    expect(mocks.db.playProgress.update).not.toHaveBeenCalled();
  });

  it("keeps a completed row's status and proof and only adds the intent", async () => {
    mocks.db.playProgress.findUnique.mockResolvedValue({ status: "complete", proof: { targetWallet: "old", legs: [] } });
    mocks.db.playProgress.update.mockResolvedValue({});
    await recordMirrorIntent("user_1", INTENT);
    expect(mocks.db.playProgress.create).not.toHaveBeenCalled();
    expect(mocks.db.playProgress.update).toHaveBeenCalledWith({
      where: { userId_playKey: { userId: "user_1", playKey: "mirror" } },
      data: { proof: { targetWallet: "old", legs: [], intent: INTENT } },
    });
  });

  it("maps a missing Play (FK violation) to MirrorPlayMissingError and repairs a lost race", async () => {
    mocks.db.playProgress.findUnique.mockResolvedValue(null);
    mocks.db.playProgress.create.mockRejectedValue(Object.assign(new Error("fk"), { code: "P2003" }));
    await expect(recordMirrorIntent("user_1", INTENT)).rejects.toBeInstanceOf(MirrorPlayMissingError);

    mocks.db.playProgress.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    mocks.db.playProgress.update.mockResolvedValue({});
    await recordMirrorIntent("user_1", INTENT);
    expect(mocks.db.playProgress.update).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Mirror target + index (docs/REVIEW-2026-09-14.md H2/H3: bot hygiene, paper fallback)
// ---------------------------------------------------------------------------

const NOW = new Date("2026-09-14T12:00:00.000Z");
const SEASON = {
  id: "season_0",
  name: "Stocks Season",
  chainScope: [SOL],
  startsAt: new Date("2026-09-01T00:00:00.000Z"),
  endsAt: new Date("2026-10-31T00:00:00.000Z"),
};
const WEEK_START = new Date("2026-09-14T00:00:00.000Z");
const CREATED = new Date("2026-09-10T00:00:00.000Z");
const BOT_ADDR = "DE8jfH1jAtSmaiFkFbQgMWcKKSGGvD5WCTfMyTsJyTeH";
const REAL_ADDR = "EwrBryTJ26ujseqB9JXE1LXZU39E9UtHn9KyPvCt8Raa";
/** A valid address on no curated list and in no Dulo table. */
const PUBLIC_ADDR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const REAL_USERS_ONLY = { leagueAccounts: { none: { isBot: true } }, NOT: { id: { startsWith: "bot-league-" } } };

const BOT_WALLET = { id: "w_bot", address: BOT_ADDR, chainId: SOL, userId: "bot-league-0", user: { handle: "Ivaylo" } };
const REAL_WALLET = { id: "w_real", address: REAL_ADDR, chainId: SOL, userId: "u_real", user: { handle: null } };
const BOT_ACCOUNT = {
  positions: { [TSLA]: { symbol: "TSLAx", qty: 2, avgPrice: 100 }, [AAPL]: { symbol: "AAPLx", qty: 1, avgPrice: 50 } },
  rank: 1,
  isBot: true,
  cashUsd: "9650.000000",
  league: { weekStart: WEEK_START },
};

function priceQuote(assetId: AssetId, symbol: string, price: number | null) {
  return { assetId, symbol, price, source: price === null ? "none" : "jupiter", publishedAt: null, ageSeconds: null, stale: price === null, marketOpen: false };
}

describe("getMirrorTarget", () => {
  beforeEach(() => {
    mocks.db.season.findFirst.mockResolvedValue(SEASON);
    mocks.db.pointsEvent.aggregate.mockResolvedValue({ _sum: { delta: null } });
    mocks.db.pointsEvent.groupBy.mockResolvedValue([]);
    mocks.getPrices.mockResolvedValue(new Map([[TSLA, priceQuote(TSLA, "TSLAx", 150)], [AAPL, priceQuote(AAPL, "AAPLx", null)]]));
  });

  it("falls back to the paper allocation when the latest snapshot has no legs (a League leader snapshotted empty)", async () => {
    mocks.db.wallet.findFirst.mockResolvedValue(BOT_WALLET);
    mocks.db.leagueAccount.findMany.mockResolvedValue([BOT_ACCOUNT]);
    // Snapshotted empty by a tick before the bot exclusion shipped: still not an on-chain target.
    mocks.db.snapshot.findFirst.mockResolvedValue({ id: "s_empty", takenAt: new Date("2026-09-14T11:55:00.000Z"), holdings: [] });

    const target = await getMirrorTarget(BOT_ADDR, NOW);

    expect(target).toMatchObject({ address: BOT_ADDR, handle: "Ivaylo", isBot: true, rank: null, leagueRank: 1, source: "paper", asOf: NOW.toISOString(), pnl7d: null, pnl30d: null });
    // TSLAx priced by lib/price (2 x 150); AAPLx has no quote so its avgPrice values it (1 x 50).
    expect(target?.totalUsd).toBe(350);
    // 15 Sep review M-O: the header shows League equity (cash + positions), not invested value.
    expect(target).toMatchObject({ cashUsd: 9650, equityUsd: 10000 });
    // Bots never carry a Season rank: the points lookup is skipped entirely.
    expect(mocks.db.pointsEvent.aggregate).not.toHaveBeenCalled();
    expect(target?.legs.map((l) => [l.symbol, l.usd, l.weight])).toEqual([
      ["TSLAx", 300, 0.8571],
      ["AAPLx", 50, 0.1429],
    ]);
    expect(mocks.getPrices).toHaveBeenCalledWith([TSLA, AAPL]);
    // Only the "latest" lookup ran: no 7d / 30d history reads on the paper branch.
    expect(mocks.db.snapshot.findFirst).toHaveBeenCalledTimes(1);
  });

  it("keeps the on-chain branch when the latest snapshot has legs, with value change against the closest older snapshot", async () => {
    mocks.db.wallet.findFirst.mockResolvedValue(REAL_WALLET);
    mocks.db.leagueAccount.findMany.mockResolvedValue([{ ...BOT_ACCOUNT, isBot: false, rank: 4 }]);
    const latest = { id: "s_now", takenAt: new Date("2026-09-14T11:55:00.000Z"), holdings: [holding(TSLA, "TSLAx", 600)] };
    const weekAgo = { id: "s_7d", takenAt: new Date("2026-09-07T12:00:00.000Z"), holdings: [holding(TSLA, "TSLAx", 400)] };
    mocks.db.snapshot.findFirst.mockImplementation(async ({ where }: { where: { takenAt?: { lte?: Date; gt?: Date } } }) => {
      if (!where.takenAt) return latest;
      if (where.takenAt.lte) return weekAgo;
      return null;
    });

    const target = await getMirrorTarget(REAL_ADDR, NOW);

    expect(target).toMatchObject({ address: REAL_ADDR, isBot: false, leagueRank: 4, source: "snapshot", asOf: latest.takenAt.toISOString(), totalUsd: 600, cashUsd: null, equityUsd: null });
    expect(target?.legs).toEqual([{ assetId: TSLA, symbol: "TSLAx", usd: 600, weight: 1 }]);
    expect(target?.pnl7d).toEqual({ absUsd: 200, pct: 50, since: weekAgo.takenAt.toISOString() });
    expect(target?.pnl30d).toEqual({ absUsd: 200, pct: 50, since: weekAgo.takenAt.toISOString() });
    // The paper positions were never priced.
    expect(mocks.getPrices).not.toHaveBeenCalled();
  });

  it("reports the empty on-chain allocation when there is no League account to fall back to, and null with nothing at all", async () => {
    mocks.db.wallet.findFirst.mockResolvedValue(REAL_WALLET);
    mocks.db.leagueAccount.findMany.mockResolvedValue([]);
    mocks.db.snapshot.findFirst.mockResolvedValue({ id: "s_empty", takenAt: new Date("2026-09-14T11:55:00.000Z"), holdings: [] });

    const empty = await getMirrorTarget(REAL_ADDR, NOW);
    expect(empty).toMatchObject({ source: "snapshot", totalUsd: 0, legs: [] });

    mocks.db.snapshot.findFirst.mockResolvedValue(null);
    expect(await getMirrorTarget(REAL_ADDR, NOW)).toBeNull();
    expect(await getMirrorTarget("   ", NOW)).toBeNull();
  });

  it("values the paper allocation, cash, equity and League rank from the same account (the latest one with positions)", async () => {
    mocks.db.wallet.findFirst.mockResolvedValue(REAL_WALLET);
    const thisWeekEmpty = { positions: {}, rank: 7, isBot: false, cashUsd: "10000.000000", league: { weekStart: WEEK_START } };
    const lastWeek = { ...BOT_ACCOUNT, isBot: false, rank: 3, cashUsd: "120.555", league: { weekStart: new Date("2026-09-07T00:00:00.000Z") } };
    mocks.db.leagueAccount.findMany.mockResolvedValue([thisWeekEmpty, lastWeek]);
    mocks.db.snapshot.findFirst.mockResolvedValue(null);

    const target = await getMirrorTarget(REAL_ADDR, NOW);

    expect(target).toMatchObject({ source: "paper", totalUsd: 350, leagueRank: 3, cashUsd: 120.56, equityUsd: 470.56 });
    expect(mocks.db.leagueAccount.findMany.mock.calls[0][0].select).toMatchObject({ cashUsd: true, positions: true, rank: true, isBot: true });
  });

  it("an address that is not a Dulo wallet is read live as a public target: no rank, no history, nothing written", async () => {
    mocks.db.wallet.findFirst.mockResolvedValue(null);
    mocks.mintSet.mockResolvedValue(new Set([TSLA_MINT, AAPL_MINT]));
    mocks.getAsset.mockImplementation(async (assetId: string) => (assetId === TSLA ? { assetId: TSLA, symbol: "TSLAx", multiplier: 1 } : { assetId: AAPL, symbol: "AAPLx", multiplier: 1 }));
    mocks.getTokenBalances.mockResolvedValue([
      { chainId: SOL, mint: TSLA_MINT, account: "a1", amountRaw: "300000000", decimals: 8, program: "token-2022", multiplier: 1 },
      { chainId: SOL, mint: AAPL_MINT, account: "a2", amountRaw: "100000000", decimals: 8, program: "token-2022", multiplier: null },
    ]);
    mocks.getPrices.mockResolvedValue(new Map([[TSLA, priceQuote(TSLA, "TSLAx", 200)], [AAPL, priceQuote(AAPL, "AAPLx", 400)]]));

    const target = await getMirrorTarget(PUBLIC_ADDR, NOW);

    expect(target).toMatchObject({
      address: PUBLIC_ADDR,
      chainId: SOL,
      handle: null,
      isBot: false,
      rank: null,
      leagueRank: null,
      source: "public",
      totalUsd: 1000,
      pnl7d: null,
      pnl30d: null,
      cashUsd: null,
      equityUsd: null,
    });
    expect(target?.legs.map((l) => [l.symbol, l.usd, l.weight])).toEqual([
      ["TSLAx", 600, 0.6],
      ["AAPLx", 400, 0.4],
    ]);
    expect(mocks.getTokenBalances).toHaveBeenCalledWith(PUBLIC_ADDR, new Set([TSLA_MINT, AAPL_MINT]));
    // Never scored, never stored: no snapshot, League or points reads or writes for a public wallet.
    expect(mocks.db.snapshot.findFirst).not.toHaveBeenCalled();
    expect(mocks.db.leagueAccount.findMany).not.toHaveBeenCalled();
    expect(mocks.db.pointsEvent.aggregate).not.toHaveBeenCalled();

    // A string that is not a Solana public key never reaches the chain.
    expect(await getMirrorTarget("1111111111111111111111111111111O", NOW)).toBeNull();
    expect(mocks.getTokenBalances).toHaveBeenCalledTimes(1);
  });

  it("ranks a scored target among real users only", async () => {
    mocks.db.wallet.findFirst.mockResolvedValue(REAL_WALLET);
    mocks.db.leagueAccount.findMany.mockResolvedValue([]);
    mocks.db.snapshot.findFirst.mockResolvedValue({ id: "s_now", takenAt: new Date("2026-09-14T11:55:00.000Z"), holdings: [holding(TSLA, "TSLAx", 600)] });
    mocks.db.pointsEvent.aggregate.mockResolvedValue({ _sum: { delta: 100 } });
    mocks.db.pointsEvent.groupBy.mockResolvedValue([{ userId: "u_a", _sum: { delta: 400 } }]);

    const target = await getMirrorTarget(REAL_ADDR, NOW);

    expect(target?.rank).toBe(2);
    expect(mocks.db.pointsEvent.groupBy.mock.calls[0][0]).toEqual({
      by: ["userId"],
      where: { seasonId: "season_0", source: { notIn: ["starter", "admin"] }, user: REAL_USERS_ONLY },
      _sum: { delta: true },
      having: { delta: { _sum: { gt: 100 } } },
    });
  });
});

describe("listMirrorTargets", () => {
  it("offers only leaderboard wallets whose latest snapshot has legs, derives isBot, and lists League leaders (bots included) as paper targets", async () => {
    const ADDR_EMPTY = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    const ADDR_NEVER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    mocks.db.season.findFirst.mockResolvedValue(SEASON);
    mocks.db.pointsEvent.groupBy.mockResolvedValue([
      { userId: "u_a", _sum: { delta: 300 } },
      { userId: "u_b", _sum: { delta: 100 } },
      { userId: "u_c", _sum: { delta: 50 } },
    ]);
    mocks.db.user.findMany.mockResolvedValue([
      { id: "u_a", handle: "alpha", wallets: [{ address: REAL_ADDR, isPrimary: true, createdAt: CREATED }] },
      { id: "u_b", handle: null, wallets: [{ address: ADDR_EMPTY, isPrimary: true, createdAt: CREATED }] },
      { id: "u_c", handle: null, wallets: [{ address: ADDR_NEVER, isPrimary: true, createdAt: CREATED }] },
    ]);
    mocks.db.wallet.findMany.mockResolvedValue([
      { address: REAL_ADDR, snapshots: [{ holdings: [holding(TSLA, "TSLAx", 600)] }], user: { leagueAccounts: [] } },
      { address: ADDR_EMPTY, snapshots: [{ holdings: [] }], user: { leagueAccounts: [] } }, // snapshotted, holds nothing
      { address: ADDR_NEVER, snapshots: [], user: { leagueAccounts: [] } }, // never snapshotted
    ]);
    mocks.db.league.findFirst.mockResolvedValue({ id: "league_1" });
    const diversified = {
      [TSLA]: { symbol: "TSLAx", qty: 1, avgPrice: 100 },
      [AAPL]: { symbol: "AAPLx", qty: 2, avgPrice: 50 },
      [NVDA]: { symbol: "NVDAx", qty: 1, avgPrice: 150 },
    };
    mocks.db.leagueAccount.findMany.mockResolvedValue([
      // 2 TSLAx at 150 + 1 AAPLx at avgPrice 50: TSLAx is 85.7% -> concentrated, listed last.
      { rank: 1, equityUsd: "10450.500000", isBot: true, positions: BOT_ACCOUNT.positions, user: { handle: "Ivaylo", wallets: [{ address: BOT_ADDR, isPrimary: true, createdAt: CREATED }] } },
      // 150 / 100 / 150: top leg 37.5% -> stays first.
      { rank: 2, equityUsd: "10100.000000", isBot: false, positions: diversified, user: { handle: "alpha", wallets: [{ address: REAL_ADDR, isPrimary: true, createdAt: CREATED }] } },
      { rank: 3, equityUsd: "9990.000000", isBot: true, positions: {}, user: { handle: "Orphan", wallets: [] } }, // no wallet: nothing to link to
    ]);
    mocks.getPrices.mockResolvedValue(new Map([[TSLA, priceQuote(TSLA, "TSLAx", 150)], [AAPL, priceQuote(AAPL, "AAPLx", null)]]));

    const { leaderboard, league } = await listMirrorTargets(NOW);

    // The Season side never sees bots: the exclusion is in the leaderboard groupBy.
    expect(mocks.db.pointsEvent.groupBy.mock.calls[0][0].where).toEqual({ seasonId: "season_0", source: { notIn: ["starter", "admin"] }, user: REAL_USERS_ONLY });
    // Gate on the LATEST snapshot's legs, not on snapshot count.
    expect(mocks.db.wallet.findMany.mock.calls[0][0]).toEqual({
      where: { address: { in: [REAL_ADDR, ADDR_EMPTY, ADDR_NEVER] } },
      select: {
        address: true,
        snapshots: { orderBy: { takenAt: "desc" }, take: 1, select: { holdings: true } },
        user: { select: { leagueAccounts: { where: { isBot: true }, take: 1, select: { isBot: true } } } },
      },
    });
    expect(leaderboard).toEqual([{ address: REAL_ADDR, handle: "alpha", isBot: false, rank: 1, points: 300, equityUsd: null }]);

    expect(mocks.db.league.findFirst.mock.calls[0][0].where).toEqual({ weekStart: { lte: NOW }, accounts: { some: {} } });
    // "Model portfolios (paper)": the concentrated bot (a leg over 40%) is demoted below the diversified account.
    expect(league).toEqual([
      { address: REAL_ADDR, handle: "alpha", isBot: false, rank: 2, points: null, equityUsd: 10100, topWeight: 0.375 },
      { address: BOT_ADDR, handle: "Ivaylo", isBot: true, rank: 1, points: null, equityUsd: 10450.5, topWeight: 0.8571 },
    ]);
    // One batched price call for every model portfolio.
    expect(mocks.getPrices).toHaveBeenCalledTimes(1);
    expect(new Set(mocks.getPrices.mock.calls[0][0])).toEqual(new Set([TSLA, AAPL, NVDA]));
  });

  it("orders model portfolios by rank when pricing fails (avgPrice weights) and keeps an all-cash account first", async () => {
    mocks.db.season.findFirst.mockResolvedValue(SEASON);
    mocks.db.pointsEvent.groupBy.mockResolvedValue([]);
    mocks.db.league.findFirst.mockResolvedValue({ id: "league_1" });
    mocks.db.leagueAccount.findMany.mockResolvedValue([
      { rank: 1, equityUsd: "10000", isBot: true, positions: { [TSLA]: { symbol: "TSLAx", qty: 1, avgPrice: 100 } }, user: { handle: "one", wallets: [{ address: BOT_ADDR, isPrimary: true, createdAt: CREATED }] } },
      { rank: 2, equityUsd: "10000", isBot: false, positions: {}, user: { handle: "cash", wallets: [{ address: REAL_ADDR, isPrimary: true, createdAt: CREATED }] } },
    ]);
    mocks.getPrices.mockRejectedValue(new Error("jupiter down"));

    const { league } = await listMirrorTargets(NOW);

    expect(league.map((r) => [r.handle, r.topWeight])).toEqual([
      ["cash", null],
      ["one", 1],
    ]);
  });

  it("skips the wallet lookup when the board is empty and lists nothing without a League", async () => {
    mocks.db.season.findFirst.mockResolvedValue(SEASON);
    mocks.db.pointsEvent.groupBy.mockResolvedValue([]);
    mocks.db.league.findFirst.mockResolvedValue(null);

    const out = await listMirrorTargets(NOW);

    expect(out).toEqual({ leaderboard: [], league: [] });
    expect(mocks.db.wallet.findMany).not.toHaveBeenCalled();
    expect(mocks.db.leagueAccount.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Public Mirror targets (15 Sep review M-D): live read, 10-minute cache, never scored
// ---------------------------------------------------------------------------

/** One TSLAx (3 shares at $200) balance for every address, unless a test overrides getTokenBalances. */
function stubChain() {
  mocks.mintSet.mockResolvedValue(new Set([TSLA_MINT]));
  mocks.getAsset.mockResolvedValue({ assetId: TSLA, symbol: "TSLAx", multiplier: 1 });
  mocks.getTokenBalances.mockResolvedValue([{ chainId: SOL, mint: TSLA_MINT, account: "a1", amountRaw: "300000000", decimals: 8, program: "token-2022", multiplier: 1 }]);
  mocks.getPrices.mockResolvedValue(new Map([[TSLA, priceQuote(TSLA, "TSLAx", 200)]]));
}

describe("readPublicWallet (lib/mirror/public)", () => {
  it("caches a live read for 10 minutes and shares concurrent reads of the same address", async () => {
    stubChain();
    let t = 1_000_000;
    const now = () => t;

    const [a, b] = await Promise.all([readPublicWallet(PUBLIC_ADDR, { now }), readPublicWallet(PUBLIC_ADDR, { now })]);
    expect(a).toBe(b);
    expect(a.allocation).toEqual({ totalUsd: 600, legs: [{ assetId: TSLA, symbol: "TSLAx", usd: 600, weight: 1 }] });
    expect(mocks.getTokenBalances).toHaveBeenCalledTimes(1);

    t += PUBLIC_READ_TTL_MS - 1;
    await readPublicWallet(PUBLIC_ADDR, { now });
    expect(mocks.getTokenBalances).toHaveBeenCalledTimes(1);

    t += 1;
    await readPublicWallet(PUBLIC_ADDR, { now });
    expect(mocks.getTokenBalances).toHaveBeenCalledTimes(2);
  });

  it("remembers a failed read for 30 seconds, then reads again", async () => {
    stubChain();
    mocks.getTokenBalances.mockRejectedValueOnce(new Error("429 Too Many Requests"));
    let t = 5_000_000;
    const now = () => t;

    const first = await readPublicWallet(PUBLIC_ADDR, { now }).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(PublicWalletReadError);
    expect((first as PublicWalletReadError).kind).toBe("unavailable");
    // The RPC message never reaches the caller.
    expect((first as Error).message).not.toContain("429");

    t += PUBLIC_READ_FAILURE_TTL_MS - 1;
    await expect(readPublicWallet(PUBLIC_ADDR, { now })).rejects.toBeInstanceOf(PublicWalletReadError);
    expect(mocks.getTokenBalances).toHaveBeenCalledTimes(1);

    t += 1;
    await expect(readPublicWallet(PUBLIC_ADDR, { now })).resolves.toMatchObject({ address: PUBLIC_ADDR });
    expect(mocks.getTokenBalances).toHaveBeenCalledTimes(2);
  });

  it("caps uncached reads of arbitrary addresses per minute; curated wallets and cached reads are exempt", async () => {
    stubChain();
    let t = 9_000_000;
    const now = () => t;
    const addresses = Array.from({ length: PUBLIC_UNCACHED_READS_PER_MINUTE + 1 }, () => PublicKey.unique().toBase58());

    for (const address of addresses.slice(0, -1)) await readPublicWallet(address, { now });
    const over = await readPublicWallet(addresses[addresses.length - 1], { now }).catch((e: unknown) => e);
    expect(over).toBeInstanceOf(PublicWalletReadError);
    expect((over as PublicWalletReadError).kind).toBe("busy");

    // Already-cached addresses and the curated list still answer.
    await expect(readPublicWallet(addresses[0], { now })).resolves.toBeTruthy();
    await expect(readPublicWallet(PUBLIC_WALLETS[0].address, { now })).resolves.toBeTruthy();

    t += 60_000;
    await expect(readPublicWallet(addresses[addresses.length - 1], { now })).resolves.toBeTruthy();
  });

  it("keeps a read with an unpriced position for 30 seconds only, so a call within the 10 minutes re-prices it and shows the legs", async () => {
    stubChain();
    mocks.getPrices.mockResolvedValueOnce(new Map([[TSLA, priceQuote(TSLA, "TSLAx", null)]]));
    const start = 12_000_000;
    let t = start;
    const now = () => t;

    const first = await readPublicWallet(PUBLIC_ADDR, { now });
    expect(first.priced).toBe(false);
    expect(first.allocation).toEqual({ totalUsd: 0, legs: [] });

    t += PUBLIC_READ_FAILURE_TTL_MS - 1;
    expect(await readPublicWallet(PUBLIC_ADDR, { now })).toBe(first);
    expect(mocks.getTokenBalances).toHaveBeenCalledTimes(1);

    t += 1;
    expect(t - start).toBeLessThan(PUBLIC_READ_TTL_MS);
    const second = await readPublicWallet(PUBLIC_ADDR, { now });
    expect(second.priced).toBe(true);
    expect(second.allocation).toEqual({ totalUsd: 600, legs: [{ assetId: TSLA, symbol: "TSLAx", usd: 600, weight: 1 }] });
    expect(mocks.getTokenBalances).toHaveBeenCalledTimes(2);

    // A priced read keeps the full 10 minutes.
    t += PUBLIC_READ_FAILURE_TTL_MS;
    expect(await readPublicWallet(PUBLIC_ADDR, { now })).toBe(second);
  });

  it("decides the caller's own limit before spending the shared budget", async () => {
    stubChain();
    const t = 20_000_000;
    const now = () => t;
    const refuse = () => {
      throw new PublicWalletReadError("limited", "Too many wallet lookups from this connection. Try again in a minute.", 42);
    };
    const addresses = Array.from({ length: PUBLIC_UNCACHED_READS_PER_MINUTE }, () => PublicKey.unique().toBase58());

    const refused = await readPublicWallet(addresses[0], { now, beforeUncachedRead: refuse }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ kind: "limited", retryAfterSeconds: 42 });
    expect(mocks.getTokenBalances).not.toHaveBeenCalled();

    // The refusal spent nothing: the whole per-minute budget is still there.
    for (const address of addresses) await expect(readPublicWallet(address, { now })).resolves.toBeTruthy();
    // Cached reads never ask the hook.
    const hook = vi.fn(refuse);
    await expect(readPublicWallet(addresses[0], { now, beforeUncachedRead: hook })).resolves.toBeTruthy();
    expect(hook).not.toHaveBeenCalled();
  });

  it("gives a curated wallet its neutral label and rejects an invalid address without a chain call", async () => {
    stubChain();
    const curated = PUBLIC_WALLETS[2];
    const target = await getPublicMirrorTarget(curated.address);
    expect(target).toMatchObject({ address: curated.address, handle: curated.label, source: "public", isBot: false, rank: null, totalUsd: 600 });

    expect(await getPublicMirrorTarget("not-a-key")).toBeNull();
    await expect(readPublicWallet("not-a-key")).rejects.toBeInstanceOf(PublicWalletReadError);
    expect(mocks.getTokenBalances).toHaveBeenCalledTimes(1);
  });

  it("reads through the cron snapshot's path: chain multiplier first, catalogue fallback, an uncatalogued mint kept unpriced", async () => {
    mocks.mintSet.mockResolvedValue(new Set([TSLA_MINT, AAPL_MINT, NVDA_MINT]));
    mocks.getAsset.mockImplementation(async (assetId: string) =>
      assetId === TSLA ? { assetId: TSLA, symbol: "TSLAx", multiplier: 2 } : assetId === AAPL ? { assetId: AAPL, symbol: "AAPLx", multiplier: 1 } : null,
    );
    mocks.getTokenBalances.mockResolvedValue([
      { chainId: SOL, mint: TSLA_MINT, account: "a1", amountRaw: "300000000", decimals: 8, program: "token-2022", multiplier: null },
      { chainId: SOL, mint: AAPL_MINT, account: "a2", amountRaw: "100000000", decimals: 8, program: "token-2022", multiplier: 1.5 },
      { chainId: SOL, mint: NVDA_MINT, account: "a3", amountRaw: "200000000", decimals: 8, program: "token-2022", multiplier: null },
    ]);
    mocks.getPrices.mockResolvedValue(new Map([[TSLA, priceQuote(TSLA, "TSLAx", 200)], [AAPL, priceQuote(AAPL, "AAPLx", 400)]]));

    const read = await readPublicWallet(PUBLIC_ADDR, { now: () => 30_000_000 });

    expect(read).toMatchObject({ address: PUBLIC_ADDR, chainId: SOL });
    expect(read.readAt).toBeInstanceOf(Date);
    // One batched price call for every balance, in balance order.
    expect(mocks.getPrices).toHaveBeenCalledTimes(1);
    expect(mocks.getPrices).toHaveBeenCalledWith([TSLA, AAPL, NVDA]);
    expect(read.holdings.map((h) => [h.assetId, h.symbol, h.multiplier, h.qty, h.price, h.priceSource, h.usd])).toEqual([
      [TSLA, "TSLAx", 2, 6, 200, "jupiter", 1200],
      [AAPL, "AAPLx", 1.5, 1.5, 400, "jupiter", 600],
      [NVDA, NVDA_MINT, 1, 2, null, "none", 0],
    ]);
    // The unknown position is not $0: the read is flagged unpriced and the catalogue miss is logged.
    expect(read.priced).toBe(false);
    expect(read.allocation.totalUsd).toBe(1800);
    expect(read.allocation.legs.map((l) => l.symbol)).toEqual(["TSLAx", "AAPLx"]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`${NVDA_MINT} is in the mint set but not in the catalogue`));
  });
});

describe("listPublicMirrorRows / getMirrorIndex", () => {
  it("values the reads that land in time, lists the rest with null values, and drops curated wallets that are Dulo wallets", async () => {
    stubChain();
    const [first, second] = PUBLIC_WALLETS;
    // Only the first curated wallet answers; every other read hangs past the wait.
    mocks.getTokenBalances.mockImplementation((address: string) =>
      address === first.address
        ? Promise.resolve([{ chainId: SOL, mint: TSLA_MINT, account: "a1", amountRaw: "100000000", decimals: 8, program: "token-2022", multiplier: 1 }])
        : new Promise(() => undefined),
    );

    const rows = await listPublicMirrorRows({ waitMs: 50, exclude: new Set([second.address]) });

    expect(rows).toHaveLength(PUBLIC_WALLETS.length - 1);
    expect(rows.some((r) => r.address === second.address)).toBe(false);
    expect(rows[0]).toMatchObject({ address: first.address, label: first.label, totalUsd: 200, stocks: 1 });
    expect(rows[0].asOf).toEqual(expect.any(String));
    expect(rows.slice(1).every((r) => r.totalUsd === null && r.stocks === null && r.asOf === null)).toBe(true);
  });

  it("getMirrorIndex adds the curated public wallets next to the database lists", async () => {
    stubChain();
    mocks.getTokenBalances.mockResolvedValue([]);
    mocks.db.season.findFirst.mockResolvedValue(SEASON);
    mocks.db.pointsEvent.groupBy.mockResolvedValue([]);
    mocks.db.league.findFirst.mockResolvedValue(null);
    mocks.db.wallet.findMany.mockResolvedValue([{ address: PUBLIC_WALLETS[1].address }]); // signed in to Dulo since

    const index = await getMirrorIndex(NOW, { publicWaitMs: 1000 });

    expect(index.leaderboard).toEqual([]);
    expect(index.league).toEqual([]);
    expect(index.public).toHaveLength(PUBLIC_WALLETS.length - 1);
    expect(index.public[0]).toMatchObject({ address: PUBLIC_WALLETS[0].address, label: "Public holder A", totalUsd: 0, stocks: 0 });
    expect(mocks.db.wallet.findMany).toHaveBeenCalledWith({ where: { address: { in: PUBLIC_WALLETS.map((w) => w.address) } }, select: { address: true } });
  });

  it("lists a curated wallet whose read has an unpriced position with an unknown value, not $0 across 0 stocks", async () => {
    stubChain();
    mocks.getPrices.mockResolvedValue(new Map([[TSLA, priceQuote(TSLA, "TSLAx", null)]]));
    const rows = await listPublicMirrorRows({ waitMs: 1000 });
    expect(rows).toHaveLength(PUBLIC_WALLETS.length);
    expect(rows.every((r) => r.totalUsd === null && r.stocks === null)).toBe(true);
  });

  it("maps a public read failure to a 503 API error (429 when the caller is limited) and leaves other errors alone", () => {
    const busy = publicReadApiError(new PublicWalletReadError("busy", "Too many wallet lookups right now. Try again in a minute."));
    expect(busy).toBeInstanceOf(ApiError);
    expect(busy?.status).toBe(503);
    expect(publicReadApiError(new PublicWalletReadError("limited", "Too many wallet lookups from this connection.", 30))?.status).toBe(429);
    expect(publicReadApiError(new Error("db down"))).toBeNull();
  });
});

describe("curated public wallets", () => {
  it("lists 8-10 unique on-curve keypair addresses with neutral labels", () => {
    expect(PUBLIC_WALLETS.length).toBeGreaterThanOrEqual(8);
    expect(PUBLIC_WALLETS.length).toBeLessThanOrEqual(10);
    expect(new Set(PUBLIC_WALLETS.map((w) => w.address)).size).toBe(PUBLIC_WALLETS.length);
    expect(new Set(PUBLIC_WALLETS.map((w) => w.label)).size).toBe(PUBLIC_WALLETS.length);
    for (const w of PUBLIC_WALLETS) {
      const key = new PublicKey(w.address);
      expect(key.toBase58()).toBe(w.address);
      expect(PublicKey.isOnCurve(key.toBytes())).toBe(true);
      expect(w.label).toMatch(/^Public holder [A-Z]$/);
      expect(w.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(publicWalletLabel(w.address)).toBe(w.label);
      expect(isCuratedPublicWallet(w.address)).toBe(true);
    }
    expect(publicWalletLabel(PUBLIC_ADDR)).toBeNull();
  });
});

describe("Mirror copy helpers", () => {
  it("parses the 'Copy any wallet's portfolio' box", () => {
    expect(parseWalletInput(`  ${PUBLIC_ADDR}\n`)).toBe(PUBLIC_ADDR);
    expect(parseWalletInput("")).toBeNull();
    expect(parseWalletInput("0x1234")).toBeNull();
    expect(parseWalletInput("O".repeat(44))).toBeNull();
  });

  it("states the tolerance rule and the compliance line", () => {
    expect(toleranceCopy(0.2)).toBe("Land within 20% of each weight, with no more than 20% of your xStocks off the mix");
    expect(MIRROR_COMPLIANCE_LINE).toContain("Not investment advice");
    expect(MIRROR_COMPLIANCE_LINE).toContain("U.S. persons");
    expect(MIRROR_COMPLIANCE_LINE).toBe(COMPLIANCE_LINE);
  });

  it("headlines paper equity for paper targets and never a rank for public ones", () => {
    const base = {
      address: REAL_ADDR,
      chainId: SOL,
      handle: null,
      isBot: true,
      rank: null,
      leagueRank: 2,
      asOf: NOW.toISOString(),
      totalUsd: 350,
      legs: [
        { assetId: TSLA, symbol: "TSLAx", usd: 300, weight: 0.8571 },
        { assetId: AAPL, symbol: "AAPLx", usd: 50, weight: 0.1429 },
      ],
      pnl7d: null,
      pnl30d: null,
    };
    const paper = targetStats({ ...base, source: "paper", cashUsd: 9650, equityUsd: 10000 }, NOW.getTime());
    expect(paper.map((s) => [s.label, s.value, s.hint])).toEqual([
      ["Paper equity", "$10,000.00", "$350.00 invested · 2 stocks"],
      ["Competition rank", "#2", "This week"],
    ]);

    const pub = targetStats({ ...base, isBot: false, leagueRank: null, source: "public", cashUsd: null, equityUsd: null }, NOW.getTime());
    expect(pub.map((s) => s.label)).toEqual(["Portfolio value", "Dulo player"]);
    expect(sourceChip("public").label).toContain("Public wallet");
    expect(emptyAllocationCopy("public")).toContain("public wallet");
  });
});
