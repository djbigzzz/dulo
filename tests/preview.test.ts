import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetId, AssetInfo, Holding, PriceQuote, RawTokenBalance } from "@/lib/core";
import type { PlayRule } from "@/lib/plays/rules";
import type { PreviewResponse } from "@/lib/api-client";

/**
 * GET /api/v1/preview/[address] (15 Sep review M-C): a live read of any wallet run through the
 * real Plays engine, with NO database writes. The chain, catalogue and prices are mocked; the
 * engine, rules, catalogue, address validation and quantity maths are real.
 */

const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const TSLA_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const AAPL_MINT = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const NVDA_MINT = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const TSLA = `${SOL}/token:${TSLA_MINT}` as AssetId;
const AAPL = `${SOL}/token:${AAPL_MINT}` as AssetId;
const NVDA = `${SOL}/token:${NVDA_MINT}` as AssetId;
/** The one PreStocks mint the mocked second issuer knows (see the prestocks mock below). */
const SPACEX_MINT = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const SPACEX = `${SOL}/token:${SPACEX_MINT}` as AssetId;
const PUBLISHED = new Date("2026-09-15T13:59:30.000Z");

function asset(mint: string, symbol: string, underlying: string, sector: string): AssetInfo {
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

const ASSETS: AssetInfo[] = [
  asset(TSLA_MINT, "TSLAx", "TSLA", "Consumer Discretionary"),
  asset(AAPL_MINT, "AAPLx", "AAPL", "Technology"),
  asset(NVDA_MINT, "NVDAx", "NVDA", "Technology"),
];
const BY_ID = new Map(ASSETS.map((a) => [a.assetId, a]));
const PRICES = new Map<AssetId, number>([
  [TSLA, 200],
  [AAPL, 230],
  [NVDA, 180],
]);

function balance(mint: string, amountRaw: string, multiplier: number | null = null): RawTokenBalance {
  return { chainId: SOL, mint, account: `acct_${mint.slice(0, 4)}`, amountRaw, decimals: 8, program: "token-2022", multiplier };
}

function quote(assetId: AssetId): PriceQuote {
  return {
    assetId,
    symbol: BY_ID.get(assetId)?.symbol ?? assetId,
    price: PRICES.get(assetId) ?? null,
    source: "jupiter",
    publishedAt: PUBLISHED,
    ageSeconds: 30,
    stale: false,
    marketOpen: true,
  };
}

const mocks = vi.hoisted(() => {
  /** Every db call that is not one of the two expected reads lands here (and rejects). */
  const unexpected: string[] = [];
  const seasonFindFirst = vi.fn();
  const playFindMany = vi.fn();
  const reads: Record<string, Record<string, unknown>> = { season: { findFirst: seasonFindFirst }, play: { findMany: playFindMany } };
  const model = (name: string) =>
    new Proxy({} as Record<string, unknown>, {
      get: (_target, method) => {
        if (typeof method !== "string") return undefined;
        const read = reads[name]?.[method];
        if (read) return read;
        return () => {
          unexpected.push(`${name}.${method}`);
          return Promise.reject(new Error(`unexpected db.${name}.${method}`));
        };
      },
    });
  const db = new Proxy({} as Record<string, unknown>, {
    get: (_target, name) => (typeof name === "string" && name !== "then" ? model(name) : undefined),
  });
  return {
    unexpected,
    db,
    seasonFindFirst,
    playFindMany,
    getTokenBalances: vi.fn(),
    getPrices: vi.fn(),
    listAssets: vi.fn(),
    getAsset: vi.fn(),
    mintSet: vi.fn(),
  };
});

vi.mock("@/lib/server/db", () => ({ db: mocks.db }));
vi.mock("@/lib/price", () => ({
  getPrices: mocks.getPrices,
  getPriceBySymbol: vi.fn(),
  getPricesBySymbols: vi.fn(async () => ({ quotes: [], unknown: [] })),
  UnknownAssetError: class UnknownAssetError extends Error {},
}));
vi.mock("@/lib/adapters/solana", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/adapters/solana")>()),
  solana: { chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", getTokenBalances: mocks.getTokenBalances },
}));
vi.mock("@/lib/assets/xstocks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assets/xstocks")>();
  return {
    ...actual,
    xstocks: { name: actual.xstocks.name, mintSet: mocks.mintSet, getAsset: mocks.getAsset, listAssets: mocks.listAssets, normaliseQty: actual.normaliseQty },
  };
});
// The second issuer (lib/assets/registry): one pre-IPO token, 9 decimals, sector null. Its mint joins
// the wallet read; its holding is tagged "prestocks", which every Season 0 quest is fenced away from.
vi.mock("@/lib/assets/prestocks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assets/prestocks")>();
  const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  const SPACEX = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
  const spacex = { assetId: `${SOL}/token:${SPACEX}`, chainId: SOL, symbol: "SPACEX", underlying: "SPACEX", name: "SpaceX PreStocks", decimals: 9, sector: null, logoUrl: null, pythFeedId: null, multiplier: 1 };
  return {
    ...actual,
    prestocks: {
      name: actual.prestocks.name,
      listAssets: async () => [spacex],
      getAsset: async (id: string) => (id === spacex.assetId ? spacex : null),
      getAssetBySymbol: async (s: string) => (s.toUpperCase() === "SPACEX" ? spacex : null),
      mintSet: async () => new Set([SPACEX]),
      normaliseQty: actual.normaliseQty,
    },
  };
});

import { GET } from "@/app/api/v1/preview/[address]/route";
import {
  GAME_ACTION_NOTE,
  NEEDS_HISTORY_NOTE,
  PREVIEW_CACHE_CONTROL,
  PREVIEW_PER_IP_PER_MINUTE,
  QUALIFIES_NOTE,
  buildPreview,
  clientIp,
  createRateLimiter,
  previewKind,
  previewStatus,
  resetPreviewLimits,
} from "@/app/api/v1/preview/preview";
import { PUBLIC_WALLETS } from "@/lib/mirror/public-wallets";
import { ipRateLimitKey } from "@/lib/server/rate-limit";
import { activePlays, playAssetSource } from "@/lib/plays/catalogue";
import { evaluatePlay, type EvalContext } from "@/lib/plays/engine";

const ADDRESS = PUBLIC_WALLETS[0].address;

/** Active Season 0 Plays as the database returns them (sortOrder, then key), assetSource column included. */
const DB_ROWS = [...activePlays()]
  .sort((a, b) => a.sortOrder - b.sortOrder || (a.key < b.key ? -1 : 1))
  .map((p) => ({ key: p.key, title: p.title, desc: p.desc, points: p.points, badgeKey: p.badgeKey ?? null, rule: p.rule, assetSource: playAssetSource(p) }));

async function call(address: string, ip = "203.0.113.7") {
  const req = new Request(`http://localhost/api/v1/preview/${address}`, { headers: { "x-forwarded-for": ip } });
  const res = await GET(req, { params: Promise.resolve({ address }) });
  const body = (await res.json()) as { ok: boolean; data?: PreviewResponse; error?: string };
  return { res, body };
}

beforeEach(() => {
  vi.resetAllMocks();
  resetPreviewLimits();
  mocks.unexpected.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.listAssets.mockResolvedValue(ASSETS);
  mocks.getAsset.mockImplementation(async (id: AssetId) => BY_ID.get(id) ?? null);
  mocks.mintSet.mockResolvedValue(new Set([TSLA_MINT, AAPL_MINT, NVDA_MINT]));
  // 1.5 raw TSLAx with a chain multiplier of 2 -> 3 shares ($600); 0.5 AAPLx ($115).
  mocks.getTokenBalances.mockResolvedValue([balance(TSLA_MINT, "150000000", 2), balance(AAPL_MINT, "50000000")]);
  mocks.getPrices.mockImplementation(async (ids: AssetId[]) => new Map(ids.map((id) => [id, quote(id)])));
  mocks.seasonFindFirst.mockResolvedValue({ id: "season_0" });
  mocks.playFindMany.mockResolvedValue(DB_ROWS);
});

describe("GET /api/v1/preview/[address]", () => {
  it("reads the wallet once, runs every active Play through the engine, maps statuses and writes nothing", async () => {
    const { res, body } = await call(ADDRESS);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(PREVIEW_CACHE_CONTROL);
    expect(PREVIEW_CACHE_CONTROL).toContain("s-maxage=300");
    const data = body.data!;
    expect(data.address).toBe(ADDRESS);
    expect(data.chainId).toBe(SOL);
    expect(data.label).toBe(PUBLIC_WALLETS[0].label);

    // Holdings: multiplier-correct, largest first, each with its quote's source and age.
    expect(data.holdings.map((h) => [h.symbol, h.qty, h.multiplier, h.usd])).toEqual([
      ["TSLAx", 3, 2, 600],
      ["AAPLx", 0.5, 1, 115],
    ]);
    expect(data.holdings[0].quote).toMatchObject({ source: "jupiter", price: 200, publishedAt: PUBLISHED.toISOString(), stale: false });
    expect(data.totalUsd).toBe(715);

    const byKey = Object.fromEntries(data.plays.map((p) => [p.key, p]));
    expect(byKey.first_position).toMatchObject({ status: "qualifies", note: QUALIFIES_NOTE, points: 100 });
    expect(byKey.first_position.proof).toMatchObject({ symbol: "TSLAx", usd: 600, priceSource: "jupiter" });
    expect(byKey.diversified).toMatchObject({
      status: "not_yet",
      note: "Holds 2 of 3 xStocks needed (each $1+)",
      progress: { current: 2, target: 3, unit: "assets" },
    });
    for (const key of ["diamond_hands", "dca_streak", "earnings_holder"]) {
      expect(byKey[key], key).toMatchObject({ status: "needs_history", note: NEEDS_HISTORY_NOTE, progress: null });
      expect(byKey[key].proof, key).toMatchObject({ reason: "needs_daily_snapshots" });
    }
    for (const key of ["scout", "oracle", "mirror", "three_predictions", "paper_portfolio", "paper_portfolio_five", "game_days", "five_predictions"]) {
      expect(byKey[key].status, key).toBe("needs_activity");
      // A wallet read proves no in-platform activity: the proof says so and carries no progress.
      expect(byKey[key].proof, key).toMatchObject({ reason: "needs_activity" });
      expect(byKey[key].progress, key).toBeNull();
    }
    expect(byKey.game_days.note).toBe(GAME_ACTION_NOTE);
    expect(data.qualifying).toBe(1);
    expect(data.qualifyingPoints).toBe(100);

    // Holdings Plays first, then history Plays, then in-app Plays.
    const group = { qualifies: 0, not_yet: 0, needs_history: 1, needs_activity: 2 } as const;
    const groups = data.plays.map((p) => group[p.status]);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));

    // One adapter read with the union of every source's mint set, one batched price call.
    expect(mocks.getTokenBalances).toHaveBeenCalledTimes(1);
    expect(mocks.getTokenBalances.mock.calls[0][0]).toBe(ADDRESS);
    expect(mocks.getTokenBalances.mock.calls[0][1]).toEqual(new Set([TSLA_MINT, AAPL_MINT, NVDA_MINT, SPACEX_MINT]));
    expect(mocks.getPrices).toHaveBeenCalledTimes(1);

    // Read-only: the only database calls were the Season and Play reads.
    expect(mocks.unexpected).toEqual([]);
    expect(mocks.playFindMany.mock.calls[0][0].where).toEqual({ isActive: true, campaign: { seasonId: "season_0" } });
  });

  it("marks Diversified as qualifying when three xStocks span two sectors", async () => {
    mocks.getTokenBalances.mockResolvedValue([
      balance(TSLA_MINT, "100000000"),
      balance(AAPL_MINT, "100000000"),
      balance(NVDA_MINT, "100000000"),
    ]);
    const { body } = await call(ADDRESS);
    const statuses = Object.fromEntries(body.data!.plays.map((p) => [p.key, p.status]));
    expect(statuses.first_position).toBe("qualifies");
    expect(statuses.diversified).toBe("qualifies");
    expect(body.data!.qualifyingPoints).toBe(350);
    expect(mocks.unexpected).toEqual([]);
  });

  it("previews an empty wallet without a price call", async () => {
    mocks.getTokenBalances.mockResolvedValue([]);
    const { res, body } = await call(ADDRESS);
    expect(res.status).toBe(200);
    expect(body.data!.holdings).toEqual([]);
    expect(body.data!.totalUsd).toBe(0);
    expect(body.data!.plays.find((p) => p.key === "first_position")).toMatchObject({
      status: "not_yet",
      note: "No qualifying xStock in this wallet right now",
    });
    expect(mocks.getPrices).not.toHaveBeenCalled();
  });

  // The second issuer in the preview: the pre-IPO position is read, normalised (9 decimals, chain
  // multiplier) and listed, but no Season 0 quest can see it, exactly as in the cron.
  it("lists a pre-IPO position but never lets it complete an xStocks quest", async () => {
    mocks.getTokenBalances.mockResolvedValue([{ chainId: SOL, mint: SPACEX_MINT, account: "acct_Pre", amountRaw: "1000000000", decimals: 9, program: "token-2022", multiplier: 5 }]);
    mocks.getPrices.mockResolvedValue(new Map([[SPACEX, { ...quote(SPACEX), symbol: "SPACEX", price: 100 }]]));

    const { res, body } = await call(ADDRESS);
    expect(res.status).toBe(200);
    const data = body.data!;
    expect(data.holdings.map((h) => [h.symbol, h.qty, h.multiplier, h.usd])).toEqual([["SPACEX", 5, 5, 500]]);
    expect(data.totalUsd).toBe(500);
    const byKey = Object.fromEntries(data.plays.map((p) => [p.key, p]));
    expect(byKey.first_position).toMatchObject({ status: "not_yet", note: "No qualifying xStock in this wallet right now" });
    expect(byKey.thousand_club.status).toBe("not_yet");
    expect(byKey.diversified).toMatchObject({ status: "not_yet", note: "Holds 0 of 3 xStocks needed (each $1+)" });
    // The one quest fenced to prestocks (Pre-IPO Position, 22 Sep) is the only thing this wallet qualifies for.
    expect(byKey.pre_ipo_position).toMatchObject({ status: "qualifies", note: QUALIFIES_NOTE, points: 100, assetSource: "prestocks" });
    expect(byKey.pre_ipo_position.proof).toMatchObject({ symbol: "SPACEX", qty: 5, usd: 500 });
    expect(data.qualifying).toBe(1);
    expect(data.qualifyingPoints).toBe(100);
    // No xStocks quest saw the pre-IPO holding: its mint appears in no proof but the pre-IPO quest's own.
    expect(JSON.stringify(data.plays.filter((p) => p.key !== "pre_ipo_position"))).not.toContain(SPACEX_MINT);
    expect(mocks.unexpected).toEqual([]);
  });

  // A quest written for the second issuer carries its own fence (Play.assetSource) through the
  // preview: it sees the pre-IPO holding, and an xStocks-only wallet reads "not yet" in its own words.
  it("evaluates a Play fenced to prestocks against pre-IPO holdings only, with the note in that issuer's words", async () => {
    const preAny = { key: "pre_any", title: "Pre-IPO Holder", desc: "Hold any pre-IPO token.", points: 50, badgeKey: null, rule: { type: "hold_any", minUsd: 0 }, assetSource: "prestocks" };
    mocks.playFindMany.mockResolvedValue([...DB_ROWS.map((r) => ({ ...r, assetSource: "xstocks" })), preAny]);

    const xstocksOnly = await call(ADDRESS);
    const onlyByKey = Object.fromEntries(xstocksOnly.body.data!.plays.map((p) => [p.key, p]));
    expect(onlyByKey.first_position.status).toBe("qualifies");
    expect(onlyByKey.pre_any).toMatchObject({ status: "not_yet", note: "No qualifying pre-IPO token in this wallet right now" });

    resetPreviewLimits();
    mocks.getTokenBalances.mockResolvedValue([{ chainId: SOL, mint: SPACEX_MINT, account: "acct_Pre", amountRaw: "1000000000", decimals: 9, program: "token-2022", multiplier: 5 }]);
    mocks.getPrices.mockResolvedValue(new Map([[SPACEX, { ...quote(SPACEX), symbol: "SPACEX", price: 100 }]]));
    const preOnly = await call(ADDRESS);
    const preByKey = Object.fromEntries(preOnly.body.data!.plays.map((p) => [p.key, p]));
    expect(preByKey.pre_any).toMatchObject({ status: "qualifies", note: QUALIFIES_NOTE, points: 50 });
    expect(preByKey.pre_any.proof).toMatchObject({ symbol: "SPACEX", usd: 500, priceSource: "jupiter" });
    expect(preByKey.first_position.status).toBe("not_yet");
    expect(preOnly.body.data!.qualifyingPoints).toBe(50);
    expect(mocks.unexpected).toEqual([]);
  });

  it("falls back to the bundled catalogue when the database is unavailable", async () => {
    mocks.seasonFindFirst.mockRejectedValue(new Error("db offline"));
    const { res, body } = await call(ADDRESS);
    expect(res.status).toBe(200);
    expect(body.data!.plays.map((p) => p.key).sort()).toEqual(activePlays().map((p) => p.key).sort());
    expect(console.warn).toHaveBeenCalled();
  });

  it("answers 400 (not cached) for an invalid address without touching the chain", async () => {
    for (const bad of ["not-an-address", "1".repeat(43)]) {
      const { res, body } = await call(bad);
      expect(res.status, bad).toBe(400);
      expect(body.ok).toBe(false);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(mocks.getTokenBalances).not.toHaveBeenCalled();
  });

  it("limits each client IP to 10 checks a minute (429 + Retry-After) without affecting other IPs", async () => {
    for (let i = 0; i < PREVIEW_PER_IP_PER_MINUTE; i++) expect((await call(ADDRESS, "198.51.100.1")).res.status).toBe(200);
    const limited = await call(ADDRESS, "198.51.100.1");
    expect(limited.res.status).toBe(429);
    expect(limited.res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(limited.res.headers.get("cache-control")).toBe("no-store");
    expect((await call(ADDRESS, "198.51.100.2")).res.status).toBe(200);
    expect(mocks.getTokenBalances).toHaveBeenCalledTimes(PREVIEW_PER_IP_PER_MINUTE + 1);
  });

  it("keeps s-maxage=300 only for a fully priced answer: an unpriced holding is no-store", async () => {
    mocks.getPrices.mockImplementation(
      async (ids: AssetId[]) => new Map(ids.map((id) => [id, id === AAPL ? { ...quote(id), price: null, source: "none" as const, stale: true } : quote(id)])),
    );
    const { res, body } = await call(ADDRESS);
    expect(res.status).toBe(200);
    expect(body.data!.holdings.find((h) => h.symbol === "AAPLx")?.quote.price).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 503 (not cached) when the chain read fails", async () => {
    mocks.getTokenBalances.mockRejectedValue(new Error("rpc down"));
    const { res, body } = await call(ADDRESS);
    expect(res.status).toBe(503);
    expect(body.error).toMatch(/Couldn't read this wallet/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.unexpected).toEqual([]);
  });
});

describe("preview status mapping", () => {
  const takenAt = new Date("2026-09-15T14:00:00.000Z");
  const dust: Holding = { assetId: TSLA, symbol: "TSLAx", source: "xstocks", raw: "1000000", multiplier: 1, qty: 0.01, price: 200, priceSource: "jupiter", usd: 2 };
  const ctx: EvalContext = {
    now: takenAt,
    snapshots: [{ walletId: "preview", takenAt, holdings: [dust] }],
    events: [],
    earnings: {},
    sectorOf: () => null,
    underlyingOf: () => null,
  };

  it("decides holdings Plays on one read and defers history and in-app Plays", () => {
    expect(previewKind({ type: "hold_any", minUsd: 5 })).toBe("snapshot");
    expect(previewKind({ type: "diversified", minAssets: 3, minSectors: 2 })).toBe("snapshot");
    expect(previewKind({ type: "hold_consecutive", days: 1 })).toBe("snapshot");
    expect(previewKind({ type: "hold_consecutive", days: 7 })).toBe("history");
    expect(previewKind({ type: "net_increase_days", count: 3, window: 14 })).toBe("history");
    expect(previewKind({ type: "hold_through_date", calendarKey: "earnings" })).toBe("history");
    expect(previewKind({ type: "mirror_match", tolerance: 0.2 })).toBe("activity");
    expect(previewKind({ type: "internal_event", event: "league_trade", count: 3 })).toBe("activity");
    expect(previewKind({ type: "internal_event", event: "game_action", count: 3, distinctBy: "day" })).toBe("activity");
    expect(previewKind({ type: "internal_event", event: "call_placed", count: 3, distinctBy: "ref" })).toBe("activity");
  });

  it("explains in-platform quests: game days and predictions run on starter points or virtual cash", () => {
    const empty: EvalContext = { ...ctx, snapshots: [] };
    const gameDays: PlayRule = { type: "internal_event", event: "game_action", count: 3, distinctBy: "day" };
    expect(GAME_ACTION_NOTE).toBe("Earned inside Dulo with starter points or virtual cash. Connect to take part");
    expect(previewStatus(gameDays, evaluatePlay(gameDays, empty))).toEqual({ status: "needs_activity", note: GAME_ACTION_NOTE });
    // Even a result that reads complete never turns an activity quest into "qualifies" on a wallet read.
    expect(previewStatus(gameDays, { complete: true, proof: {} })).toEqual({ status: "needs_activity", note: GAME_ACTION_NOTE });
    const predictions: PlayRule = { type: "internal_event", event: "call_placed", count: 3, distinctBy: "ref" };
    const note = previewStatus(predictions, evaluatePlay(predictions, empty)).note;
    expect(note).toBe("Earned by making predictions with your starter points. Connect to take part");
    expect(note).toMatch(/starter points/);
    const trades: PlayRule = { type: "internal_event", event: "league_trade", count: 3, distinctBy: "symbol" };
    expect(previewStatus(trades, evaluatePlay(trades, empty)).note).toBe("Earned in the weekly competition (virtual cash). Connect to take part");
    for (const n of [GAME_ACTION_NOTE, note]) expect(n).not.toMatch(/(stake|odds|payout|bet|buy)/i);
  });

  it("explains why a holdings Play is not met", () => {
    const below: PlayRule = { type: "hold_any", minUsd: 5 };
    expect(previewStatus(below, evaluatePlay(below, ctx))).toEqual({ status: "not_yet", note: "Largest position is $2; needs $5 or more" });
    const pending: PlayRule = { type: "hold_any", minUsd: 1, partnerAssetIds: [] };
    expect(previewStatus(pending, evaluatePlay(pending, ctx))).toEqual({ status: "not_yet", note: "Partner listing pending" });
    const oneDay: PlayRule = { type: "hold_consecutive", days: 1 };
    expect(previewStatus(oneDay, evaluatePlay(oneDay, ctx)).status).toBe("qualifies");
  });

  it("buildPreview skips invalid rules, drops empty positions and marks unquoted holdings as stale", () => {
    const empty: Holding = { ...dust, assetId: AAPL, symbol: "AAPLx", qty: 0, usd: 0 };
    const out = buildPreview({
      read: { address: ADDRESS, chainId: SOL, readAt: takenAt, holdings: [empty, dust], quotes: new Map() },
      plays: [
        { key: "broken", title: "Broken", desc: "", points: 1, badgeKey: null, rule: { type: "nope" } },
        { key: "first_position", title: "First Position", desc: "", points: 100, badgeKey: "first_position", rule: { type: "hold_any", minUsd: 1 } },
      ],
      catalogue: { sectorOf: () => null, underlyingOf: () => null },
      earnings: {},
      now: takenAt,
    });
    expect(out.plays.map((p) => [p.key, p.status])).toEqual([["first_position", "qualifies"]]);
    expect(out.holdings.map((h) => h.symbol)).toEqual(["TSLAx"]);
    expect(out.holdings[0].quote).toMatchObject({ price: null, source: "none", stale: true });
    expect(out).toMatchObject({ qualifying: 1, qualifyingPoints: 100, totalUsd: 2, readAt: takenAt.toISOString() });
  });
});

describe("preview rate limiter and client IP", () => {
  it("counts per key in a fixed window and reports Retry-After seconds", () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(rl.take("a", 0)).toEqual({ ok: true });
    expect(rl.take("a", 1_000)).toEqual({ ok: true });
    expect(rl.take("a", 1_000)).toEqual({ ok: false, retryAfterSeconds: 59 });
    expect(rl.take("b", 1_000)).toEqual({ ok: true });
    expect(rl.take("a", 60_000)).toEqual({ ok: true });
  });

  it("evicts the oldest key once maxKeys is reached", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    rl.take("x", 0);
    rl.take("y", 0);
    expect(rl.take("z", 10)).toEqual({ ok: true });
    // x was evicted, so it starts a fresh window instead of being refused.
    expect(rl.take("x", 20)).toEqual({ ok: true });
  });

  it("takes the first x-forwarded-for entry, then x-real-ip", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.1.1.1, 10.0.0.1" } }))).toBe("1.1.1.1");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "2.2.2.2" } }))).toBe("2.2.2.2");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });

  it("keys IPv6 clients on their /64 prefix and IPv4-mapped addresses on the IPv4 form", () => {
    expect(ipRateLimitKey("2001:db8:85a3:1234:5678:8a2e:370:7334")).toBe("2001:db8:85a3:1234::/64");
    expect(ipRateLimitKey("2001:0db8:85a3:1234::1")).toBe("2001:db8:85a3:1234::/64");
    expect(ipRateLimitKey("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(ipRateLimitKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipRateLimitKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipRateLimitKey("198.51.100.4")).toBe("198.51.100.4");
    expect(ipRateLimitKey("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
    const a = clientIp(new Request("http://x", { headers: { "x-forwarded-for": "2001:db8:1:2::a, 10.0.0.1" } }));
    const b = clientIp(new Request("http://x", { headers: { "x-real-ip": "2001:db8:1:2:ffff::b" } }));
    expect(a).toBe("2001:db8:1:2::/64");
    expect(b).toBe(a);
  });
});
