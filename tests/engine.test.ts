import { describe, expect, it } from "vitest";
import { dailySnapshots, evaluatePlay, mergeSnapshots, type EvalContext, type EvalResult } from "@/lib/plays/engine";
import type { PlayRule } from "@/lib/plays/rules";
import { SEASON0_PLAYS } from "@/lib/plays/catalogue";
import { SOLANA_MAINNET, type AssetId } from "@/lib/core/caip";
import { DEFAULT_ASSET_SOURCE, type Holding, type HoldingsSnapshot, type InternalEvent } from "@/lib/core/types";
import fxDiamond7d from "./fixtures/snapshots/diamond-hands-7d.json";
import fxDiamondBridged from "./fixtures/snapshots/diamond-hands-bridged.json";
import fxDiamondGap from "./fixtures/snapshots/diamond-hands-gap.json";
import fxDca from "./fixtures/snapshots/dca-streak.json";
import fxEarnings from "./fixtures/snapshots/earnings-holder.json";
import fxDiversified from "./fixtures/snapshots/diversified.json";
import fxMirror from "./fixtures/snapshots/mirror.json";
import fxMultiWallet from "./fixtures/snapshots/multi-wallet.json";

// ---------------------------------------------------------------------------
// Helpers. Every date is relative to NOW; day offsets are UTC calendar days.
// ---------------------------------------------------------------------------

/** Mon 14 Sep 2026 12:00Z. dayOffset -1 = 13 Sep, -13 = 1 Sep. */
const NOW = new Date("2026-09-14T12:00:00.000Z");

interface TestAsset {
  assetId: AssetId;
  underlying: string | null;
  sector: string | null;
}

const ASSETS: Record<"TSLAx" | "AAPLx" | "NVDAx" | "METAx" | "kSPYx", TestAsset> = {
  TSLAx: { assetId: `${SOLANA_MAINNET}/token:XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB`, underlying: "TSLA", sector: "Consumer Cyclical" },
  AAPLx: { assetId: `${SOLANA_MAINNET}/token:XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`, underlying: "AAPL", sector: "Technology" },
  NVDAx: { assetId: `${SOLANA_MAINNET}/token:Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh`, underlying: "NVDA", sector: "Technology" },
  METAx: { assetId: `${SOLANA_MAINNET}/token:Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu`, underlying: "META", sector: "Communication Services" },
  /** A partner receipt token (Kamino collateral). Not an xStock: no underlying, no sector. */
  kSPYx: { assetId: `${SOLANA_MAINNET}/token:KaminoSPYxReceipt111111111111111111111111111`, underlying: null, sector: null },
};
type Sym = keyof typeof ASSETS;
const id = (s: Sym): AssetId => ASSETS[s].assetId;

function holding(symbol: Sym, qty: number, price: number | null, extra: Partial<Holding> = {}): Holding {
  return {
    assetId: ASSETS[symbol].assetId,
    symbol,
    source: DEFAULT_ASSET_SOURCE,
    raw: String(Math.round(qty * 1e6)),
    multiplier: 1,
    qty,
    price,
    priceSource: price === null ? "none" : "pyth",
    usd: price === null ? 0 : qty * price,
    ...extra,
  };
}

interface SnapshotOpts {
  hour?: number;
  minute?: number;
  walletId?: string;
}

/** A snapshot on NOW's day + dayOffset at hour:minute UTC (default 23:55, the day-end tick). */
function makeSnapshot(dayOffset: number, holdings: Holding[], opts: SnapshotOpts = {}): HoldingsSnapshot {
  const takenAt = new Date(Date.UTC(2026, 8, 14 + dayOffset, opts.hour ?? 23, opts.minute ?? 55, 0, 0));
  return { walletId: opts.walletId ?? "w1", takenAt, holdings };
}

interface FixtureHolding {
  symbol: string;
  qty: number;
  price: number | null;
  raw?: string;
}
interface FixtureSnapshot extends SnapshotOpts {
  dayOffset: number;
  holdings: FixtureHolding[];
}
interface Fixture {
  _note: string;
  snapshots: FixtureSnapshot[];
}

function load(fixture: unknown): HoldingsSnapshot[] {
  const f = fixture as Fixture;
  return f.snapshots.map((s) =>
    makeSnapshot(
      s.dayOffset,
      s.holdings.map((h) => holding(h.symbol as Sym, h.qty, h.price, h.raw ? { raw: h.raw } : {})),
      s,
    ),
  );
}

function lookup(assetId: string): TestAsset | undefined {
  return Object.values(ASSETS).find((a) => a.assetId === assetId);
}

function ctx(over: Partial<EvalContext> = {}): EvalContext {
  return {
    now: NOW,
    snapshots: [],
    events: [],
    earnings: {},
    sectorOf: (assetId) => lookup(assetId)?.sector ?? null,
    underlyingOf: (assetId) => lookup(assetId)?.underlying ?? null,
    ...over,
  };
}

function event(type: string, dayOffset: number, ref: string, opts: { hour?: number; meta?: Record<string, unknown> } = {}): InternalEvent {
  return {
    type,
    userId: "u1",
    ref,
    ts: new Date(Date.UTC(2026, 8, 14 + dayOffset, opts.hour ?? 12, 0, 0, 0)),
    meta: opts.meta,
  };
}

const at = (dayOffset: number, hour = 23, minute = 55) => new Date(Date.UTC(2026, 8, 14 + dayOffset, hour, minute)).toISOString();

/** The Proof drawer stores proof as JSON: it must round-trip losslessly. */
function expectSerialisable(res: EvalResult) {
  expect(JSON.parse(JSON.stringify(res.proof))).toEqual(res.proof);
  if (res.completedAt !== undefined) expect(new Date(res.completedAt).toISOString()).toBe(res.completedAt);
}

// ---------------------------------------------------------------------------
// dailySnapshots / mergeSnapshots
// ---------------------------------------------------------------------------

describe("dailySnapshots", () => {
  it("keeps the last snapshot of each UTC day, ascending by day, from unsorted input", () => {
    const early = makeSnapshot(-2, [], { hour: 9, minute: 5 });
    const late = makeSnapshot(-2, [holding("TSLAx", 1, 400)], { hour: 23, minute: 55 });
    const other = makeSnapshot(-1, [holding("TSLAx", 1, 400)], { hour: 0, minute: 10 });
    const days = dailySnapshots([late, other, early]);
    expect(days.map((d) => d.day)).toEqual(["2026-09-12", "2026-09-13"]);
    expect(days[0].snapshot).toBe(late);
    expect(days[1].snapshot).toBe(other);
  });

  it("uses the fixture: the day -2 empty morning snapshot is superseded by the evening one", () => {
    const days = dailySnapshots(load(fxDiamond7d));
    expect(days).toHaveLength(7);
    const dayMinus2 = days.find((d) => d.day === "2026-09-12")!;
    expect(dayMinus2.snapshot.holdings.map((h) => h.symbol)).toEqual(["TSLAx", "AAPLx"]);
  });

  it("skips rows without a valid takenAt and returns [] for empty input", () => {
    expect(dailySnapshots([])).toEqual([]);
    const bad = { walletId: "w1", takenAt: new Date("nope"), holdings: [] } as HoldingsSnapshot;
    expect(dailySnapshots([bad, makeSnapshot(0, [])])).toHaveLength(1);
  });
});

describe("mergeSnapshots", () => {
  it("sums qty, usd and raw per asset across wallets and joins the wallet ids", () => {
    const merged = mergeSnapshots(load(fxMultiWallet), NOW);
    expect(merged.walletId).toBe("w1+w2");
    expect(merged.takenAt).toBe(NOW);
    const tsla = merged.holdings.find((h) => h.symbol === "TSLAx")!;
    expect(tsla.qty).toBeCloseTo(1.5);
    expect(tsla.usd).toBeCloseTo(600);
    expect(tsla.raw).toBe("1500000");
    const aapl = merged.holdings.find((h) => h.symbol === "AAPLx")!;
    expect(aapl.qty).toBe(2);
    expect(aapl.usd).toBe(460);
    expect(merged.holdings).toHaveLength(2);
  });

  it("keeps a single wallet's id, fills a null price from a later wallet and drops junk rows", () => {
    const a = makeSnapshot(0, [holding("TSLAx", 1, null)], { walletId: "w1" });
    const b = makeSnapshot(0, [holding("TSLAx", 1, 400), { nope: true } as unknown as Holding], { walletId: "w1" });
    const merged = mergeSnapshots([a, b], NOW);
    expect(merged.walletId).toBe("w1");
    expect(merged.holdings).toHaveLength(1);
    expect(merged.holdings[0]).toMatchObject({ qty: 2, usd: 400, price: 400, priceSource: "pyth" });
  });

  it("returns an empty snapshot for no input", () => {
    expect(mergeSnapshots([], NOW)).toEqual({ walletId: "", takenAt: NOW, holdings: [] });
  });
});

// ---------------------------------------------------------------------------
// hold_any
// ---------------------------------------------------------------------------

describe("hold_any", () => {
  const snapshots = load(fxDiversified);

  it("completes on the latest snapshot with the largest qualifying holding as proof", () => {
    const res = evaluatePlay({ type: "hold_any", minUsd: 5 }, ctx({ snapshots }));
    expect(res.complete).toBe(true);
    expect(res.proof).toEqual({ assetId: id("AAPLx"), symbol: "AAPLx", qty: 2, usd: 460, priceSource: "pyth", takenAt: at(0, 11, 55) });
    expect(res.completedAt).toBe(at(0, 11, 55));
    expect(res.progress).toEqual({ current: 5, target: 5, unit: "usd" });
    expectSerialisable(res);
  });

  it("fails below minUsd with usd progress", () => {
    const res = evaluatePlay({ type: "hold_any", minUsd: 1000 }, ctx({ snapshots }));
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({ reason: "below_min_usd", symbol: "AAPLx", usd: 460, minUsd: 1000 });
    expect(res.progress).toEqual({ current: 460, target: 1000, unit: "usd" });
    expect(res.completedAt).toBeUndefined();
  });

  it("only looks at the latest snapshot", () => {
    const older = [makeSnapshot(-1, [holding("TSLAx", 1, 400)]), makeSnapshot(0, [])];
    const res = evaluatePlay({ type: "hold_any", minUsd: 5 }, ctx({ snapshots: older }));
    expect(res.complete).toBe(false);
    expect(res.proof.reason).toBe("no_in_scope_holding");
  });

  it("scopes by assetIds", () => {
    const nvda = evaluatePlay({ type: "hold_any", minUsd: 5, assetIds: [id("NVDAx")] }, ctx({ snapshots }));
    expect(nvda.complete).toBe(true);
    expect(nvda.proof.symbol).toBe("NVDAx");
    const meta = evaluatePlay({ type: "hold_any", minUsd: 5, assetIds: [id("METAx")] }, ctx({ snapshots }));
    expect(meta.complete).toBe(false);
    expect(meta.proof).toMatchObject({ reason: "below_min_usd", symbol: "METAx", usd: 0.5 });
  });

  it("scopes by assetSymbols case-insensitively when no assetIds are given", () => {
    const res = evaluatePlay({ type: "hold_any", minUsd: 5, assetSymbols: ["nvdax"] }, ctx({ snapshots }));
    expect(res.complete).toBe(true);
    expect(res.proof.symbol).toBe("NVDAx");
  });

  it("assetIds win over assetSymbols", () => {
    const res = evaluatePlay({ type: "hold_any", minUsd: 5, assetIds: [id("NVDAx")], assetSymbols: ["TSLAx"] }, ctx({ snapshots }));
    expect(res.proof.symbol).toBe("NVDAx");
  });

  it("partnerAssetIds: empty list is never satisfied, a listed receipt is", () => {
    const pending = evaluatePlay({ type: "hold_any", minUsd: 1, partnerAssetIds: [] }, ctx({ snapshots }));
    expect(pending).toEqual({ complete: false, proof: { reason: "partner_pending" } });

    const withReceipt = [makeSnapshot(0, [holding("TSLAx", 1, 400), holding("kSPYx", 3, 1)])];
    const live = evaluatePlay({ type: "hold_any", minUsd: 1, partnerAssetIds: [id("kSPYx")] }, ctx({ snapshots: withReceipt }));
    expect(live.complete).toBe(true);
    expect(live.proof.symbol).toBe("kSPYx");

    const missing = evaluatePlay({ type: "hold_any", minUsd: 1, partnerAssetIds: [id("kSPYx")] }, ctx({ snapshots }));
    expect(missing.complete).toBe(false);
    expect(missing.proof.reason).toBe("no_in_scope_holding");
  });

  it("no snapshots -> no_snapshots; zero-qty rows are not holdings; a priced-null holding satisfies minUsd 0", () => {
    expect(evaluatePlay({ type: "hold_any", minUsd: 0 }, ctx())).toEqual({ complete: false, proof: { reason: "no_snapshots" } });

    const empty = evaluatePlay({ type: "hold_any", minUsd: 0 }, ctx({ snapshots: [makeSnapshot(0, [holding("TSLAx", 0, 400)])] }));
    expect(empty.complete).toBe(false);
    expect(empty.proof.reason).toBe("no_in_scope_holding");

    const dust = evaluatePlay({ type: "hold_any", minUsd: 0 }, ctx({ snapshots: [makeSnapshot(0, [holding("TSLAx", 0.01, null)])] }));
    expect(dust.complete).toBe(true);
    expect(dust.proof).toMatchObject({ symbol: "TSLAx", usd: 0, priceSource: "none" });
    expect(dust.progress).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hold_consecutive
// ---------------------------------------------------------------------------

describe("hold_consecutive", () => {
  it("completes on 7 day-end snapshots in a row (the empty morning snapshot on day -2 does not count)", () => {
    const res = evaluatePlay({ type: "hold_consecutive", days: 7 }, ctx({ snapshots: load(fxDiamond7d) }));
    expect(res.complete).toBe(true);
    expect(res.proof).toMatchObject({ assetId: id("TSLAx"), symbol: "TSLAx", run: 7, needed: 7, bridged: [], minUsd: 1 });
    expect(res.proof.days).toEqual(["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"]);
    expect(res.proof.usdByDay).toEqual({
      "2026-09-08": 400,
      "2026-09-09": 405,
      "2026-09-10": 398,
      "2026-09-11": 410,
      "2026-09-12": 412,
      "2026-09-13": 415,
      "2026-09-14": 420,
    });
    expect(res.progress).toEqual({ current: 7, target: 7, unit: "days" });
    expect(res.completedAt).toBe(at(0, 11, 55));
    expectSerialisable(res);
  });

  it("completedAt is the day the run first reached `days`, not the latest snapshot", () => {
    const res = evaluatePlay({ type: "hold_consecutive", days: 3 }, ctx({ snapshots: load(fxDiamond7d) }));
    expect(res.complete).toBe(true);
    expect(res.proof.run).toBe(7);
    expect(res.completedAt).toBe(at(-4));
  });

  it("reports the run and progress when too short", () => {
    const res = evaluatePlay({ type: "hold_consecutive", days: 8 }, ctx({ snapshots: load(fxDiamond7d) }));
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({ reason: "run_too_short", symbol: "TSLAx", run: 7, needed: 8 });
    expect(res.progress).toEqual({ current: 7, target: 8, unit: "days" });
    expect(res.completedAt).toBeUndefined();
  });

  it("bridges a single missing day (cron outage) and lists it in the proof", () => {
    const res = evaluatePlay({ type: "hold_consecutive", days: 7 }, ctx({ snapshots: load(fxDiamondBridged) }));
    expect(res.complete).toBe(true);
    expect(res.proof).toMatchObject({ run: 7, bridged: ["2026-09-11"] });
    expect((res.proof.usdByDay as Record<string, number | null>)["2026-09-11"]).toBeNull();
    expect((res.proof.days as string[]).length).toBe(7);
  });

  it("a two-day gap breaks the run", () => {
    const res = evaluatePlay({ type: "hold_consecutive", days: 7 }, ctx({ snapshots: load(fxDiamondGap) }));
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({ reason: "run_too_short", run: 3, bridged: [] });
    expect(res.proof.days).toEqual(["2026-09-12", "2026-09-13", "2026-09-14"]);
    expect(res.progress).toEqual({ current: 3, target: 7, unit: "days" });
  });

  it("does not bridge when the day before the gap no longer qualifies", () => {
    const snapshots = [
      makeSnapshot(-3, [holding("TSLAx", 1, 400)]),
      makeSnapshot(-2, []), // sold
      // -1 missing
      makeSnapshot(0, [holding("TSLAx", 1, 400)]),
    ];
    const res = evaluatePlay({ type: "hold_consecutive", days: 2 }, ctx({ snapshots }));
    expect(res.complete).toBe(false);
    expect(res.proof.run).toBe(1);
  });

  it("selling restarts the count: the run ends on the latest day", () => {
    const snapshots = [
      makeSnapshot(-3, [holding("TSLAx", 1, 400)]),
      makeSnapshot(-2, [holding("TSLAx", 1, 400)]),
      makeSnapshot(-1, []),
      makeSnapshot(0, [holding("TSLAx", 1, 400)]),
    ];
    const res = evaluatePlay({ type: "hold_consecutive", days: 2 }, ctx({ snapshots }));
    expect(res.complete).toBe(false);
    expect(res.proof.run).toBe(1);
  });

  it("scopes to assetIds and applies minUsd", () => {
    const snapshots = load(fxDiamond7d);
    const aapl3 = evaluatePlay({ type: "hold_consecutive", days: 3, assetIds: [id("AAPLx")] }, ctx({ snapshots }));
    expect(aapl3.complete).toBe(true);
    expect(aapl3.proof.symbol).toBe("AAPLx");
    const aapl4 = evaluatePlay({ type: "hold_consecutive", days: 4, assetSymbols: ["AAPLx"] }, ctx({ snapshots }));
    expect(aapl4.complete).toBe(false);
    expect(aapl4.proof).toMatchObject({ symbol: "AAPLx", run: 3 });
    const rich = evaluatePlay({ type: "hold_consecutive", days: 1, minUsd: 1000 }, ctx({ snapshots }));
    expect(rich.complete).toBe(false);
    expect(rich.proof.reason).toBe("no_qualifying_holding");
  });

  it("no snapshots / partner pending", () => {
    expect(evaluatePlay({ type: "hold_consecutive", days: 7 }, ctx()).proof.reason).toBe("no_snapshots");
    expect(evaluatePlay({ type: "hold_consecutive", days: 7, partnerAssetIds: [] }, ctx({ snapshots: load(fxDiamond7d) })).proof.reason).toBe("partner_pending");
  });
});

// ---------------------------------------------------------------------------
// net_increase_days
// ---------------------------------------------------------------------------

describe("net_increase_days", () => {
  const snapshots = load(fxDca);

  it("counts qty-up days only (not price moves, not the baseline, not decreases) and completes at the count-th", () => {
    const res = evaluatePlay({ type: "net_increase_days", count: 3, window: 14 }, ctx({ snapshots }));
    expect(res.complete).toBe(true);
    expect(res.proof.days).toEqual([
      { day: "2026-09-04", assetId: id("TSLAx"), symbol: "TSLAx", from: 1, to: 1.5, deltaUsd: 220 },
      { day: "2026-09-09", assetId: id("TSLAx"), symbol: "TSLAx", from: 1.2, to: 1.4, deltaUsd: 78 },
      { day: "2026-09-11", assetId: id("AAPLx"), symbol: "AAPLx", from: 0, to: 2, deltaUsd: 460 },
    ]);
    expect(res.proof).toMatchObject({ count: 3, needed: 3, window: { from: "2026-09-04", to: "2026-09-17" } });
    expect(res.progress).toEqual({ current: 3, target: 3, unit: "days" });
    expect(res.completedAt).toBe(at(-3));
    expectSerialisable(res);
  });

  it("reports the trailing window when incomplete", () => {
    const res = evaluatePlay({ type: "net_increase_days", count: 4, window: 14 }, ctx({ snapshots }));
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({ reason: "not_enough_increase_days", count: 3, needed: 4, window: { from: "2026-09-01", to: "2026-09-14" } });
    expect(res.progress).toEqual({ current: 3, target: 4, unit: "days" });
  });

  it("the window is rolling: a past span that qualifies completes even if the trailing one does not", () => {
    const res = evaluatePlay({ type: "net_increase_days", count: 2, window: 3 }, ctx({ snapshots }));
    expect(res.complete).toBe(true);
    expect((res.proof.days as Array<{ day: string }>).map((d) => d.day)).toEqual(["2026-09-09", "2026-09-11"]);
    expect(res.completedAt).toBe(at(-3));

    const narrow = evaluatePlay({ type: "net_increase_days", count: 3, window: 5 }, ctx({ snapshots }));
    expect(narrow.complete).toBe(false);
    expect(narrow.proof.window).toEqual({ from: "2026-09-10", to: "2026-09-14" });
    expect(narrow.progress).toEqual({ current: 1, target: 3, unit: "days" });
  });

  it("price-only moves never count", () => {
    const priceOnly = [
      makeSnapshot(-3, [holding("TSLAx", 1, 300)]),
      makeSnapshot(-2, [holding("TSLAx", 1, 350)]),
      makeSnapshot(-1, [holding("TSLAx", 1, 400)]),
      makeSnapshot(0, [holding("TSLAx", 1, 450)]),
    ];
    const res = evaluatePlay({ type: "net_increase_days", count: 1, window: 14 }, ctx({ snapshots: priceOnly }));
    expect(res.complete).toBe(false);
    expect(res.proof.days).toEqual([]);
    expect(res.progress).toEqual({ current: 0, target: 1, unit: "days" });
  });

  it("holdings with a null price count for qty increases; minUsd then needs a known price", () => {
    const unpriced = [makeSnapshot(-1, [holding("TSLAx", 1, null)]), makeSnapshot(0, [holding("TSLAx", 2, null)])];
    const res = evaluatePlay({ type: "net_increase_days", count: 1, window: 7 }, ctx({ snapshots: unpriced }));
    expect(res.complete).toBe(true);
    expect(res.proof.days).toEqual([{ day: "2026-09-14", assetId: id("TSLAx"), symbol: "TSLAx", from: 1, to: 2, deltaUsd: null }]);

    const withMin = evaluatePlay({ type: "net_increase_days", count: 1, window: 7, minUsd: 5 }, ctx({ snapshots: unpriced }));
    expect(withMin.complete).toBe(false);

    const priced = [makeSnapshot(-1, [holding("TSLAx", 1, 400)]), makeSnapshot(0, [holding("TSLAx", 2, 400)])];
    expect(evaluatePlay({ type: "net_increase_days", count: 1, window: 7, minUsd: 5 }, ctx({ snapshots: priced })).complete).toBe(true);
    expect(evaluatePlay({ type: "net_increase_days", count: 1, window: 7, minUsd: 1000 }, ctx({ snapshots: priced })).complete).toBe(false);
  });

  it("scopes to assetIds", () => {
    const res = evaluatePlay({ type: "net_increase_days", count: 3, window: 14, assetIds: [id("AAPLx")] }, ctx({ snapshots }));
    expect(res.complete).toBe(false);
    expect((res.proof.days as Array<{ symbol: string }>).map((d) => d.symbol)).toEqual(["AAPLx"]);
    expect(res.progress).toEqual({ current: 1, target: 3, unit: "days" });
  });

  it("the first snapshot ever is a baseline, never an increase; no snapshots -> no_snapshots", () => {
    const one = evaluatePlay({ type: "net_increase_days", count: 1, window: 7 }, ctx({ snapshots: [makeSnapshot(0, [holding("TSLAx", 5, 400)])] }));
    expect(one.complete).toBe(false);
    expect(one.proof.days).toEqual([]);
    expect(evaluatePlay({ type: "net_increase_days", count: 1, window: 7 }, ctx()).proof.reason).toBe("no_snapshots");
  });
});

// ---------------------------------------------------------------------------
// hold_through_date
// ---------------------------------------------------------------------------

describe("hold_through_date", () => {
  const snapshots = load(fxEarnings);
  const earnings = { TSLA: ["2026-09-11"], AAPL: ["2026-09-11"] };

  it("completes when held the day before and after, using the first snapshotted day after D when D has none", () => {
    const res = evaluatePlay({ type: "hold_through_date", calendarKey: "earnings" }, ctx({ snapshots, earnings }));
    expect(res.complete).toBe(true);
    expect(res.proof).toEqual({
      assetId: id("TSLAx"),
      symbol: "TSLAx",
      underlying: "TSLA",
      calendar: "earnings",
      earningsDate: "2026-09-11",
      before: { day: "2026-09-10", usd: 398 },
      after: { day: "2026-09-12", usd: 430 },
      minUsd: 1,
    });
    expect(res.completedAt).toBe(at(-2));
    expect(res.progress).toBeUndefined();
    expectSerialisable(res);
  });

  it("uses D itself when D has a snapshot", () => {
    const held = [-3, -2, -1, 0].map((d) => makeSnapshot(d, [holding("TSLAx", 1, 400)]));
    const res = evaluatePlay({ type: "hold_through_date", calendarKey: "earnings" }, ctx({ snapshots: held, earnings: { TSLA: ["2026-09-13"] } }));
    expect(res.complete).toBe(true);
    expect(res.proof).toMatchObject({ before: { day: "2026-09-12", usd: 400 }, after: { day: "2026-09-13", usd: 400 } });
    expect(res.completedAt).toBe(at(-1));
  });

  it("fails when the asset was not held before the date (scoped to AAPLx) and shows what was checked", () => {
    const res = evaluatePlay({ type: "hold_through_date", calendarKey: "earnings", assetIds: [id("AAPLx")] }, ctx({ snapshots, earnings }));
    expect(res.complete).toBe(false);
    expect(res.proof.reason).toBe("not_held_through");
    expect(res.proof.checked).toEqual([
      { symbol: "AAPLx", earningsDate: "2026-09-11", before: { day: "2026-09-10", usd: null }, after: { day: "2026-09-12", usd: 460 } },
    ]);
  });

  it("fails when sold before the after-snapshot", () => {
    const sold = [
      makeSnapshot(-3, [holding("TSLAx", 1, 400)]),
      makeSnapshot(-2, [holding("TSLAx", 1, 400)]),
      makeSnapshot(-1, [holding("AAPLx", 1, 200)]),
      makeSnapshot(0, [holding("AAPLx", 1, 200)]),
    ];
    const res = evaluatePlay({ type: "hold_through_date", calendarKey: "earnings" }, ctx({ snapshots: sold, earnings: { TSLA: ["2026-09-13"] } }));
    expect(res.complete).toBe(false);
    expect(res.proof.reason).toBe("not_held_through");
    expect(res.proof.checked).toEqual([
      { symbol: "TSLAx", earningsDate: "2026-09-13", before: { day: "2026-09-12", usd: 400 }, after: { day: "2026-09-13", usd: null } },
    ]);
  });

  it("names the next upcoming date for a held asset when nothing has passed yet", () => {
    const res = evaluatePlay({ type: "hold_through_date", calendarKey: "earnings" }, ctx({ snapshots, earnings: { TSLA: ["2026-10-21"], AAPL: ["2026-10-29"] } }));
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({ reason: "earnings_upcoming", nextEarningsDate: "2026-10-21", nextEarningsSymbol: "TSLAx", nextEarningsUnderlying: "TSLA" });
    expect(res.proof.checked).toBeUndefined();
  });

  it("no calendar entry / unknown underlying / no snapshots / minUsd", () => {
    expect(evaluatePlay({ type: "hold_through_date", calendarKey: "earnings" }, ctx({ snapshots, earnings: {} })).proof.reason).toBe("no_earnings_date");
    expect(
      evaluatePlay({ type: "hold_through_date", calendarKey: "earnings" }, ctx({ snapshots, earnings, underlyingOf: () => null })).proof.reason,
    ).toBe("no_earnings_date");
    expect(evaluatePlay({ type: "hold_through_date", calendarKey: "earnings" }, ctx({ earnings })).proof.reason).toBe("no_snapshots");
    const rich = evaluatePlay({ type: "hold_through_date", calendarKey: "earnings", minUsd: 1000 }, ctx({ snapshots, earnings }));
    expect(rich.complete).toBe(false);
    expect(rich.proof.reason).toBe("no_held_assets");
  });

  it("matches calendar keys case-insensitively and ignores malformed dates", () => {
    const res = evaluatePlay(
      { type: "hold_through_date", calendarKey: "earnings" },
      ctx({ snapshots, earnings: { tsla: ["not-a-date", "2026-09-11"] } as Record<string, string[]> }),
    );
    expect(res.complete).toBe(true);
    expect(res.proof.earningsDate).toBe("2026-09-11");
  });
});

// ---------------------------------------------------------------------------
// diversified
// ---------------------------------------------------------------------------

describe("diversified", () => {
  const snapshots = load(fxDiversified);

  it("completes with 3 assets across 2 sectors on the latest snapshot; dust is excluded", () => {
    const res = evaluatePlay({ type: "diversified", minAssets: 3, minSectors: 2 }, ctx({ snapshots }));
    expect(res.complete).toBe(true);
    expect(res.proof).toEqual({
      takenAt: at(0, 11, 55),
      assets: [
        { symbol: "AAPLx", sector: "Technology", usd: 460 },
        { symbol: "TSLAx", sector: "Consumer Cyclical", usd: 400 },
        { symbol: "NVDAx", sector: "Technology", usd: 180 },
      ],
      sectors: ["Consumer Cyclical", "Technology"],
      assetCount: 3,
      sectorCount: 2,
      minAssets: 3,
      minSectors: 2,
      minUsd: 1,
    });
    expect(res.progress).toEqual({ current: 3, target: 3, unit: "assets" });
    expect(res.completedAt).toBe(at(0, 11, 55));
    expectSerialisable(res);
  });

  it("fails on too few sectors or too few assets, with asset progress", () => {
    const sectors = evaluatePlay({ type: "diversified", minAssets: 3, minSectors: 3 }, ctx({ snapshots }));
    expect(sectors.complete).toBe(false);
    expect(sectors.proof.reason).toBe("too_few_sectors");
    expect(sectors.progress).toEqual({ current: 3, target: 3, unit: "assets" });

    const assets = evaluatePlay({ type: "diversified", minAssets: 4, minSectors: 2 }, ctx({ snapshots }));
    expect(assets.complete).toBe(false);
    expect(assets.proof.reason).toBe("too_few_assets");
    expect(assets.progress).toEqual({ current: 3, target: 4, unit: "assets" });
  });

  it("minUsd lowers or raises the bar", () => {
    const dust = evaluatePlay({ type: "diversified", minAssets: 4, minSectors: 3, minUsd: 0.1 }, ctx({ snapshots }));
    expect(dust.complete).toBe(true);
    expect(dust.proof.sectors).toEqual(["Communication Services", "Consumer Cyclical", "Technology"]);
    const rich = evaluatePlay({ type: "diversified", minAssets: 2, minSectors: 2, minUsd: 200 }, ctx({ snapshots }));
    expect(rich.complete).toBe(true);
    expect(rich.proof.assetCount).toBe(2);
  });

  it("scopes by assetIds / assetSymbols and ignores unknown (null) sectors", () => {
    const ids = evaluatePlay({ type: "diversified", minAssets: 2, minSectors: 2, assetIds: [id("TSLAx"), id("AAPLx")] }, ctx({ snapshots }));
    expect(ids.complete).toBe(true);
    expect(ids.proof.assetCount).toBe(2);
    const sameSector = evaluatePlay({ type: "diversified", minAssets: 2, minSectors: 2, assetSymbols: ["AAPLx", "NVDAx"] }, ctx({ snapshots }));
    expect(sameSector.complete).toBe(false);
    expect(sameSector.proof.sectors).toEqual(["Technology"]);
    const noSectors = evaluatePlay({ type: "diversified", minAssets: 3, minSectors: 1 }, ctx({ snapshots, sectorOf: () => null }));
    expect(noSectors.complete).toBe(false);
    expect(noSectors.proof).toMatchObject({ reason: "too_few_sectors", sectors: [] });
  });

  it("no snapshots", () => {
    expect(evaluatePlay({ type: "diversified", minAssets: 3, minSectors: 2 }, ctx()).proof.reason).toBe("no_snapshots");
  });
});

// ---------------------------------------------------------------------------
// mirror_match
// ---------------------------------------------------------------------------

describe("mirror_match", () => {
  const snapshots = load(fxMirror);
  const target = { [id("TSLAx")]: 0.6, [id("AAPLx")]: 0.4 };
  const mirror = event("mirror_executed", -1, "mirror-1", { meta: { targetWallet: "LeaderWallet111", target } });

  it("completes when every leg is within tolerance on the latest snapshot after the event", () => {
    const res = evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, ctx({ snapshots, events: [mirror] }));
    expect(res.complete).toBe(true);
    expect(res.proof).toEqual({
      targetWallet: "LeaderWallet111",
      executedAt: at(-1, 12, 0),
      takenAt: at(-1, 18, 0),
      tolerance: 0.2,
      totalUsd: 1000,
      distance: 0.1,
      legs: [
        { assetId: id("TSLAx"), symbol: "TSLAx", target: 0.6, actual: 0.5, delta: -0.1, ok: true },
        { assetId: id("AAPLx"), symbol: "AAPLx", target: 0.4, actual: 0.5, delta: 0.1, ok: true },
      ],
    });
    expect(res.progress).toEqual({ current: 2, target: 2, unit: "legs" });
    expect(res.completedAt).toBe(at(-1, 18, 0));
    expectSerialisable(res);
  });

  it("fails outside tolerance", () => {
    const res = evaluatePlay({ type: "mirror_match", tolerance: 0.05 }, ctx({ snapshots, events: [mirror] }));
    expect(res.complete).toBe(false);
    expect(res.proof.reason).toBe("outside_tolerance");
    expect(res.progress).toEqual({ current: 0, target: 2, unit: "legs" });
  });

  it("no mirror event / snapshot only before the event / malformed meta", () => {
    expect(evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, ctx({ snapshots }))).toEqual({ complete: false, proof: { reason: "no_mirror" } });

    const late = event("mirror_executed", 0, "mirror-2", { meta: { targetWallet: "LeaderWallet111", target } });
    const noAfter = evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, ctx({ snapshots, events: [late] }));
    expect(noAfter.complete).toBe(false);
    expect(noAfter.proof).toMatchObject({ reason: "no_snapshot_after_mirror", targetWallet: "LeaderWallet111" });

    const bad = event("mirror_executed", -1, "mirror-3", { meta: { targetWallet: "LeaderWallet111" } });
    const malformed = evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, ctx({ snapshots, events: [bad] }));
    expect(malformed.complete).toBe(false);
    expect(malformed.proof).toMatchObject({ reason: "malformed_mirror", ref: "mirror-3" });

    const badWeight = event("mirror_executed", -1, "mirror-4", { meta: { targetWallet: "x", target: { [id("TSLAx")]: 1.5 } } });
    expect(evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, ctx({ snapshots, events: [badWeight] })).proof.reason).toBe("malformed_mirror");
  });

  it("an asset outside the target counts as a leg with target 0 and must stay within tolerance", () => {
    const after = [makeSnapshot(0, [holding("TSLAx", 1, 45), holding("AAPLx", 1, 45), holding("NVDAx", 1, 10)])];
    const ev = event("mirror_executed", -1, "mirror-5", { meta: { targetWallet: "L", target: { [id("TSLAx")]: 0.5, [id("AAPLx")]: 0.5 } } });
    const tight = evaluatePlay({ type: "mirror_match", tolerance: 0.05 }, ctx({ snapshots: after, events: [ev] }));
    expect(tight.complete).toBe(false);
    expect(tight.proof.legs).toEqual([
      { assetId: id("TSLAx"), symbol: "TSLAx", target: 0.5, actual: 0.45, delta: -0.05, ok: true },
      { assetId: id("AAPLx"), symbol: "AAPLx", target: 0.5, actual: 0.45, delta: -0.05, ok: true },
      { assetId: id("NVDAx"), symbol: "NVDAx", target: 0, actual: 0.1, delta: 0.1, ok: false },
    ]);
    expect(tight.progress).toEqual({ current: 2, target: 3, unit: "legs" });
    expect(evaluatePlay({ type: "mirror_match", tolerance: 0.1 }, ctx({ snapshots: after, events: [ev] })).complete).toBe(true);
  });

  it("a target asset the user never bought is a leg with actual 0; symbols come from meta when unknown", () => {
    const after = [makeSnapshot(0, [holding("AAPLx", 1, 100)])];
    const ev = event("mirror_executed", -1, "mirror-6", {
      meta: { targetWallet: "L", target: { [id("TSLAx")]: 1 }, symbols: { [id("TSLAx")]: "TSLAx" } },
    });
    const res = evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, ctx({ snapshots: after, events: [ev] }));
    expect(res.complete).toBe(false);
    expect(res.proof.legs).toEqual([
      { assetId: id("TSLAx"), symbol: "TSLAx", target: 1, actual: 0, delta: -1, ok: false },
      { assetId: id("AAPLx"), symbol: "AAPLx", target: 0, actual: 1, delta: 1, ok: false },
    ]);
  });

  it("an empty wallet never completes, even against a flat target where every leg is within tolerance", () => {
    // 4 legs of 0.25: an empty wallet (actual 0 everywhere) sits within a 0.25 tolerance of each.
    const flat = { [id("TSLAx")]: 0.25, [id("AAPLx")]: 0.25, [id("NVDAx")]: 0.25, [id("METAx")]: 0.25 };
    const ev = event("mirror_executed", -1, "mirror-flat", { meta: { targetWallet: "L", target: flat } });
    const empty = evaluatePlay({ type: "mirror_match", tolerance: 0.25 }, ctx({ snapshots: [makeSnapshot(0, [])], events: [ev] }));
    expect(empty.complete).toBe(false);
    expect(empty.proof).toMatchObject({ reason: "empty_wallet", totalUsd: 0, distance: 0.5 });
    expect(empty.progress).toEqual({ current: 0, target: 4, unit: "legs" });
    expect((empty.proof.legs as Array<{ ok: boolean }>).every((l) => l.ok)).toBe(true);

    // Unpriced holdings count as $0 too.
    const unpriced = evaluatePlay({ type: "mirror_match", tolerance: 0.25 }, ctx({ snapshots: [makeSnapshot(0, [holding("TSLAx", 3, null)])], events: [ev] }));
    expect(unpriced.proof.reason).toBe("empty_wallet");
  });

  it("a dust copy under $1 never completes, even with the exact target weights", () => {
    const ev = event("mirror_executed", -1, "mirror-dust", { meta: { targetWallet: "L", target: { [id("TSLAx")]: 0.5, [id("AAPLx")]: 0.5 } } });
    const dust = evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, ctx({ snapshots: [makeSnapshot(0, [holding("TSLAx", 1, 0.45), holding("AAPLx", 1, 0.45)])], events: [ev] }));
    expect(dust.complete).toBe(false);
    expect(dust.proof).toMatchObject({ reason: "empty_wallet", totalUsd: 0.9, distance: 0 });

    const justEnough = evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, ctx({ snapshots: [makeSnapshot(0, [holding("TSLAx", 1, 0.5), holding("AAPLx", 1, 0.5)])], events: [ev] }));
    expect(justEnough.complete).toBe(true);
  });

  it("a partial copy (2 of 7 legs) fails the total-distance check although every leg is within tolerance", () => {
    const seven = {
      [id("TSLAx")]: 0.3,
      [id("AAPLx")]: 0.3,
      [id("NVDAx")]: 0.1,
      [id("METAx")]: 0.1,
      [`${SOLANA_MAINNET}/token:XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W`]: 0.1,
      [`${SOLANA_MAINNET}/token:Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ`]: 0.05,
      [`${SOLANA_MAINNET}/token:XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN`]: 0.05,
    };
    const ev = event("mirror_executed", -1, "mirror-partial", { meta: { targetWallet: "L", target: seven } });
    // $1 each in the two biggest legs: actual 0.5 / 0.5, deltas +0.2 / +0.2, the five missing legs -0.1 / -0.05.
    const partial = evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, ctx({ snapshots: [makeSnapshot(0, [holding("TSLAx", 1, 1), holding("AAPLx", 1, 1)])], events: [ev] }));
    expect((partial.proof.legs as Array<{ ok: boolean }>).every((l) => l.ok)).toBe(true);
    expect(partial.complete).toBe(false);
    expect(partial.proof).toMatchObject({ reason: "total_distance", totalUsd: 2, distance: 0.4, tolerance: 0.2 });
    // Never "7 / 7" while incomplete.
    expect(partial.progress).toEqual({ current: 6, target: 7, unit: "legs" });

    // The same wallet against a looser Play (distance 0.4 <= 0.4) completes.
    expect(evaluatePlay({ type: "mirror_match", tolerance: 0.4 }, ctx({ snapshots: [makeSnapshot(0, [holding("TSLAx", 1, 1), holding("AAPLx", 1, 1)])], events: [ev] })).complete).toBe(true);
  });

  it("the total distance counts assets outside the target (a clean copy plus old holdings)", () => {
    const ev = event("mirror_executed", -1, "mirror-extra", { meta: { targetWallet: "L", target: { [id("TSLAx")]: 0.5, [id("AAPLx")]: 0.5 } } });
    // Exact 50/50 copy of $80 plus $20 of an unrelated xStock: legs 0.4 / 0.4 / 0.2, distance 0.2.
    const snaps = [makeSnapshot(0, [holding("TSLAx", 1, 40), holding("AAPLx", 1, 40), holding("NVDAx", 1, 20)])];
    const res = evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, ctx({ snapshots: snaps, events: [ev] }));
    expect(res.complete).toBe(true);
    expect(res.proof.distance).toBe(0.2);
    const tight = evaluatePlay({ type: "mirror_match", tolerance: 0.15 }, ctx({ snapshots: snaps, events: [ev] }));
    expect(tight.complete).toBe(false);
    expect(tight.proof.reason).toBe("outside_tolerance");
  });

  it("uses the latest mirror event", () => {
    const older = event("mirror_executed", -2, "mirror-old", { hour: 1, meta: { targetWallet: "Old", target: { [id("NVDAx")]: 1 } } });
    const res = evaluatePlay({ type: "mirror_match", tolerance: 0.2 }, ctx({ snapshots, events: [older, mirror] }));
    expect(res.complete).toBe(true);
    expect(res.proof.targetWallet).toBe("LeaderWallet111");
  });
});

// ---------------------------------------------------------------------------
// internal_event
// ---------------------------------------------------------------------------

describe("internal_event", () => {
  const trades = [1, 2, 3].map((i) => event("league_trade", -4 + i, `trade-${i}`));

  it("completes at the count-th event with completedAt = its ts", () => {
    const res = evaluatePlay({ type: "internal_event", event: "league_trade", count: 3 }, ctx({ events: trades }));
    expect(res.complete).toBe(true);
    expect(res.proof).toEqual({ event: "league_trade", count: 3, needed: 3, refs: ["trade-1", "trade-2", "trade-3"], lastAt: at(-1, 12, 0) });
    expect(res.progress).toEqual({ current: 3, target: 3, unit: "events" });
    expect(res.completedAt).toBe(at(-1, 12, 0));
    expectSerialisable(res);
  });

  it("reports progress when short and ignores other event types", () => {
    const res = evaluatePlay({ type: "internal_event", event: "league_trade", count: 3 }, ctx({ events: trades.slice(0, 2) }));
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({ reason: "not_enough_events", count: 2, needed: 3, refs: ["trade-1", "trade-2"] });
    expect(res.progress).toEqual({ current: 2, target: 3, unit: "events" });

    const calls = evaluatePlay({ type: "internal_event", event: "call_placed", count: 1 }, ctx({ events: trades }));
    expect(calls.complete).toBe(false);
    expect(calls.proof).toEqual({ reason: "not_enough_events", event: "call_placed", count: 0, needed: 1, refs: [] });
  });

  it("keeps the last 5 refs and completes at the count-th event even when more follow (unsorted input)", () => {
    const many = [7, 3, 1, 6, 2, 5, 4].map((i) => event("league_trade", -8 + i, `t${i}`));
    const res = evaluatePlay({ type: "internal_event", event: "league_trade", count: 3 }, ctx({ events: many }));
    expect(res.complete).toBe(true);
    expect(res.proof.refs).toEqual(["t3", "t4", "t5", "t6", "t7"]);
    expect(res.completedAt).toBe(at(-5, 12, 0));
  });

  /**
   * The pre-distinctBy path is untouched: these are the exact proofs the three catalogue quests
   * without distinctBy produced before the field existed (no distinctBy key, unit "events").
   */
  it("leaves the proof of scout, oracle and ten_paper_trades exactly as before (no distinctBy)", () => {
    const rule = (key: string) => SEASON0_PLAYS.find((p) => p.key === key)!.rule;
    const events = [
      event("league_trade", -3, "trade-1", { meta: { symbol: "NVDAx" } }),
      event("call_placed", -3, "m1", { hour: 13, meta: { side: "yes", points: 100 } }),
      event("league_trade", -2, "trade-2", { meta: { symbol: "NVDAx" } }),
      event("game_action", -2, "trade:trade-2"),
      event("league_trade", -1, "trade-3", { meta: { symbol: "TSLAx" } }),
    ];
    const c = ctx({ events });

    const scout = evaluatePlay(rule("scout"), c);
    expect(scout).toEqual({
      complete: true,
      proof: { event: "league_trade", count: 3, needed: 3, refs: ["trade-1", "trade-2", "trade-3"], lastAt: at(-1, 12, 0) },
      progress: { current: 3, target: 3, unit: "events" },
      completedAt: at(-1, 12, 0),
    });

    const oracle = evaluatePlay(rule("oracle"), c);
    expect(oracle).toEqual({
      complete: true,
      proof: { event: "call_placed", count: 1, needed: 1, refs: ["m1"], lastAt: at(-3, 13, 0) },
      progress: { current: 1, target: 1, unit: "events" },
      completedAt: at(-3, 13, 0),
    });

    const ten = evaluatePlay(rule("ten_paper_trades"), c);
    expect(ten).toEqual({
      complete: false,
      proof: { reason: "not_enough_events", event: "league_trade", count: 3, needed: 10, refs: ["trade-1", "trade-2", "trade-3"], lastAt: at(-1, 12, 0) },
      progress: { current: 3, target: 10, unit: "events" },
    });
    for (const res of [scout, oracle, ten]) expect("distinctBy" in res.proof).toBe(false);
  });
});

describe("internal_event distinctBy", () => {
  it("ref: both sides of one question count once, and completedAt is the count-th question's first entry", () => {
    const events = [
      event("call_placed", -4, "m1", { meta: { side: "yes", points: 100 } }),
      event("call_placed", -3, "m1", { meta: { side: "no", points: 50 } }),
      event("call_placed", -2, "m2", { meta: { side: "yes", points: 100 } }),
    ];
    const rule: PlayRule = { type: "internal_event", event: "call_placed", count: 3, distinctBy: "ref" };
    const short = evaluatePlay(rule, ctx({ events }));
    expect(short).toEqual({
      complete: false,
      proof: { reason: "not_enough_events", event: "call_placed", count: 2, needed: 3, distinctBy: "ref", refs: ["m1", "m2"], lastAt: at(-2, 12, 0) },
      progress: { current: 2, target: 3, unit: "questions" },
    });
    // Without distinctBy the same three positions would already complete it.
    expect(evaluatePlay({ type: "internal_event", event: "call_placed", count: 3 }, ctx({ events })).complete).toBe(true);

    const more = [...events, event("call_placed", -1, "m2", { meta: { side: "no" } }), event("call_placed", 0, "m3", { hour: 9 })];
    const done = evaluatePlay(rule, ctx({ events: more }));
    expect(done.complete).toBe(true);
    expect(done.proof).toEqual({ event: "call_placed", count: 3, needed: 3, distinctBy: "ref", refs: ["m1", "m2", "m3"], lastAt: at(0, 9, 0) });
    expect(done.progress).toEqual({ current: 3, target: 3, unit: "questions" });
    expect(done.completedAt).toBe(at(0, 9, 0));
    expectSerialisable(done);

    // count 2: the second question first appeared on day -2 (its later "no" side changes nothing).
    expect(evaluatePlay({ ...rule, count: 2 }, ctx({ events: more })).completedAt).toBe(at(-2, 12, 0));
    // An event without a ref carries no key and never counts.
    const blank = evaluatePlay({ ...rule, count: 1 }, ctx({ events: [event("call_placed", 0, "")] }));
    expect(blank.complete).toBe(false);
    expect(blank.proof).toMatchObject({ count: 0, refs: [] });
    expect(blank.proof.lastAt).toBeUndefined();
  });

  it("symbol: counts distinct xStocks case-insensitively and skips trades without a symbol", () => {
    const events = [
      event("league_trade", -6, "t1", { meta: { symbol: "NVDAx", side: "buy" } }),
      event("league_trade", -5, "t2", { meta: { symbol: "nvdax", side: "sell" } }),
      event("league_trade", -5, "t3", { hour: 13 }),
      event("league_trade", -4, "t4", { meta: { symbol: "" } }),
      event("league_trade", -4, "t5", { hour: 13, meta: { symbol: "   " } }),
      event("league_trade", -3, "t6", { meta: { symbol: 42 } }),
      event("league_trade", -2, "t7", { meta: { symbol: " TSLAx " } }),
      event("call_placed", -2, "m1", { hour: 14, meta: { symbol: "AAPLx" } }),
      event("league_trade", -1, "t8", { meta: { symbol: "AAPLx" } }),
      event("league_trade", 0, "t9", { hour: 8, meta: { symbol: "NVDAX" } }),
    ];
    const rule: PlayRule = { type: "internal_event", event: "league_trade", count: 3, distinctBy: "symbol" };
    const res = evaluatePlay(rule, ctx({ events }));
    expect(res.complete).toBe(true);
    expect(res.proof).toEqual({
      event: "league_trade",
      count: 3,
      needed: 3,
      distinctBy: "symbol",
      refs: ["NVDAX", "TSLAX", "AAPLX"],
      // The latest trade that carried a symbol, repeats included.
      lastAt: at(0, 8, 0),
    });
    expect(res.progress).toEqual({ current: 3, target: 3, unit: "xStocks" });
    // The third distinct xStock (AAPLx) first traded on day -1; the prediction carrying AAPLx is another event type.
    expect(res.completedAt).toBe(at(-1, 12, 0));

    const five = evaluatePlay({ ...rule, count: 5 }, ctx({ events }));
    expect(five.complete).toBe(false);
    expect(five.proof).toMatchObject({ reason: "not_enough_events", count: 3, needed: 5 });
    expect(five.progress).toEqual({ current: 3, target: 5, unit: "xStocks" });

    // Only symbol-less trades: nothing counts.
    const none = evaluatePlay({ ...rule, count: 1 }, ctx({ events: events.slice(2, 6) }));
    expect(none.complete).toBe(false);
    expect(none.proof).toEqual({ reason: "not_enough_events", event: "league_trade", count: 0, needed: 1, distinctBy: "symbol", refs: [] });
  });

  it("day: three trades on one UTC day count once; a trade and a prediction on different days count twice", () => {
    const rule: PlayRule = { type: "internal_event", event: "game_action", count: 3, distinctBy: "day" };
    const sameDay = [0, 12, 23].map((hour, i) => event("game_action", -2, `trade:t${i}`, { hour }));
    const one = evaluatePlay(rule, ctx({ events: sameDay }));
    expect(one.complete).toBe(false);
    expect(one.proof).toEqual({
      reason: "not_enough_events",
      event: "game_action",
      count: 1,
      needed: 3,
      distinctBy: "day",
      refs: ["2026-09-12"],
      lastAt: at(-2, 23, 0),
    });
    expect(one.progress).toEqual({ current: 1, target: 3, unit: "days" });

    const mixed = [event("game_action", -1, "trade:t9"), event("game_action", 0, "prediction:m1:yes", { hour: 9 })];
    const two = evaluatePlay(rule, ctx({ events: mixed }));
    expect(two.proof).toMatchObject({ count: 2, refs: ["2026-09-13", "2026-09-14"] });
    expect(two.progress).toEqual({ current: 2, target: 3, unit: "days" });

    const all = evaluatePlay(rule, ctx({ events: [...sameDay, ...mixed] }));
    expect(all.complete).toBe(true);
    expect(all.proof.refs).toEqual(["2026-09-12", "2026-09-13", "2026-09-14"]);
    expect(all.completedAt).toBe(at(0, 9, 0));
    expectSerialisable(all);

    // Days are UTC: 23:59 and 00:01 are two days; other event types never make a day.
    const edge = [
      { type: "game_action", userId: "u1", ref: "a", ts: new Date("2026-09-13T23:59:00.000Z") },
      { type: "game_action", userId: "u1", ref: "b", ts: new Date("2026-09-14T00:01:00.000Z") },
      event("league_trade", -3, "t1"),
      event("call_placed", -4, "m1"),
    ];
    const utc = evaluatePlay({ ...rule, count: 2 }, ctx({ events: edge }));
    expect(utc.complete).toBe(true);
    expect(utc.proof.refs).toEqual(["2026-09-13", "2026-09-14"]);
    expect(utc.completedAt).toBe("2026-09-14T00:01:00.000Z");
  });

  it("completedAt is the count-th distinct first occurrence, whatever the input order", () => {
    const rule: PlayRule = { type: "internal_event", event: "game_action", count: 2, distinctBy: "day" };
    const events = [
      event("game_action", -1, "e1", { hour: 12 }),
      event("game_action", -3, "e2", { hour: 20 }),
      event("game_action", -3, "e3", { hour: 8 }),
      event("game_action", -2, "e4", { hour: 18 }),
      event("game_action", -2, "e5", { hour: 6 }),
    ];
    const two = evaluatePlay(rule, ctx({ events }));
    expect(two.complete).toBe(true);
    // Day -2 first appeared at 06:00, not at 18:00.
    expect(two.completedAt).toBe(at(-2, 6, 0));
    expect(evaluatePlay({ ...rule, count: 1 }, ctx({ events })).completedAt).toBe(at(-3, 8, 0));
    expect(evaluatePlay({ ...rule, count: 3 }, ctx({ events })).completedAt).toBe(at(-1, 12, 0));
  });

  it("keeps the last 5 distinct keys and never throws on an unknown distinctBy", () => {
    const events = [1, 2, 3, 4, 5, 6, 7].map((i) => event("call_placed", -8 + i, `m${i}`));
    const res = evaluatePlay({ type: "internal_event", event: "call_placed", count: 7, distinctBy: "ref" }, ctx({ events }));
    expect(res.complete).toBe(true);
    expect(res.proof.refs).toEqual(["m3", "m4", "m5", "m6", "m7"]);
    const odd = evaluatePlay({ type: "internal_event", event: "call_placed", count: 1, distinctBy: "week" } as unknown as PlayRule, ctx({ events }));
    expect(odd.complete).toBe(false);
    expect(odd.proof).toMatchObject({ reason: "not_enough_events", count: 0 });
    expect(odd.progress).toEqual({ current: 0, target: 1, unit: "items" });
    // ref on another event type reads as "items".
    const copies = evaluatePlay({ type: "internal_event", event: "mirror_executed", count: 1, distinctBy: "ref" }, ctx({ events: [event("mirror_executed", 0, "x")] }));
    expect(copies.progress).toEqual({ current: 1, target: 1, unit: "items" });
  });

  it("every catalogue distinctBy quest evaluates from ctx events alone", () => {
    const events = [
      ...["m1", "m2", "m3", "m4", "m5"].flatMap((m, i) => [event("call_placed", -6 + i, m), event("game_action", -6 + i, `prediction:${m}:yes`)]),
      ...["NVDAx", "TSLAx", "AAPLx", "METAx", "SPYx"].flatMap((symbol, i) => [
        event("league_trade", -6 + i, `t${i}`, { hour: 15, meta: { symbol } }),
        event("game_action", -6 + i, `trade:t${i}`, { hour: 15 }),
      ]),
    ];
    for (const key of ["three_predictions", "paper_portfolio", "paper_portfolio_five", "game_days", "five_predictions"]) {
      const play = SEASON0_PLAYS.find((p) => p.key === key)!;
      expect(play.rule, key).toMatchObject({ type: "internal_event" });
      const res = evaluatePlay(play.rule, ctx({ events }));
      expect(res.complete, key).toBe(true);
      expectSerialisable(res);
    }
  });
});

// ---------------------------------------------------------------------------
// Robustness: never throw
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// assetSource scope
// ---------------------------------------------------------------------------

describe("assetSource scope", () => {
  const OTHER = "prestocks";
  const foreign = (symbol: Sym, qty: number, price: number) => holding(symbol, qty, price, { source: OTHER });
  const oneForeign = () => [makeSnapshot(0, [foreign("TSLAx", 1, 400)])];

  it("no Play source: every holding counts, as it did before holdings were source-tagged", () => {
    const res = evaluatePlay({ type: "hold_any", minUsd: 5 }, ctx({ snapshots: oneForeign() }));
    expect(res.complete).toBe(true);
  });

  it("an xStocks quest is not completed by another issuer's token", () => {
    const res = evaluatePlay({ type: "hold_any", minUsd: 5 }, ctx({ snapshots: oneForeign() }), "xstocks");
    expect(res.complete).toBe(false);
    expect(res.proof.reason).toBe("no_in_scope_holding");
  });

  it("the same token completes the same quest for its own issuer", () => {
    const res = evaluatePlay({ type: "hold_any", minUsd: 5 }, ctx({ snapshots: oneForeign() }), OTHER);
    expect(res.complete).toBe(true);
    expect(res.proof.symbol).toBe("TSLAx");
  });

  it("a symbol-scoped rule still obeys the issuer fence: both filters apply, the list does not replace it", () => {
    const rule: PlayRule = { type: "hold_any", minUsd: 5, assetSymbols: ["TSLAx"] };
    expect(evaluatePlay(rule, ctx({ snapshots: oneForeign() }), "xstocks").complete).toBe(false);
    expect(evaluatePlay(rule, ctx({ snapshots: oneForeign() }), OTHER).complete).toBe(true);
  });

  it("an assetIds-scoped rule obeys it too", () => {
    const rule: PlayRule = { type: "hold_any", minUsd: 5, assetIds: [id("TSLAx")] };
    expect(evaluatePlay(rule, ctx({ snapshots: oneForeign() }), "xstocks").complete).toBe(false);
    expect(evaluatePlay(rule, ctx({ snapshots: oneForeign() }), OTHER).complete).toBe(true);
  });

  it("another issuer's holdings never inflate diversified", () => {
    const snapshots = [makeSnapshot(0, [holding("TSLAx", 1, 400), holding("AAPLx", 1, 230), foreign("NVDAx", 1, 180)])];
    const res = evaluatePlay({ type: "diversified", minAssets: 3, minSectors: 2 }, ctx({ snapshots }), "xstocks");
    expect(res.complete).toBe(false);
    expect(res.proof.assetCount).toBe(2);
    expect(evaluatePlay({ type: "diversified", minAssets: 3, minSectors: 2 }, ctx({ snapshots })).complete).toBe(true);
  });

  it("another issuer's position is not a mirror leg", () => {
    const target = { [id("TSLAx")]: 0.6, [id("AAPLx")]: 0.4 };
    const mirror = event("mirror_executed", -1, "mirror-1", { meta: { targetWallet: "LeaderWallet111", target } });
    const rows = load(fxMirror);
    const snapshots = rows.map((s, i) => (i === rows.length - 1 ? { ...s, holdings: [...s.holdings, foreign("NVDAx", 1, 500)] } : s));
    const rule: PlayRule = { type: "mirror_match", tolerance: 0.2 };

    const scoped = evaluatePlay(rule, ctx({ snapshots, events: [mirror] }), "xstocks");
    expect(scoped.complete).toBe(true);
    expect((scoped.proof.legs as unknown[]).length).toBe(2);

    // Unscoped, the foreign position becomes a leg with target 0 and the copy stops matching.
    const unscoped = evaluatePlay(rule, ctx({ snapshots, events: [mirror] }));
    expect(unscoped.complete).toBe(false);
    expect(unscoped.proof.reason).toBe("outside_tolerance");
  });

  it("a blank or whitespace source means no fence", () => {
    expect(evaluatePlay({ type: "hold_any", minUsd: 5 }, ctx({ snapshots: oneForeign() }), "   ").complete).toBe(true);
  });
});

describe("robustness", () => {
  it("malformed rules yield a reason instead of throwing", () => {
    expect(evaluatePlay({} as unknown as PlayRule, ctx())).toEqual({ complete: false, proof: { reason: "invalid_rule" } });
    expect(evaluatePlay(null as unknown as PlayRule, ctx())).toEqual({ complete: false, proof: { reason: "invalid_rule" } });
    expect(evaluatePlay({ type: "teleport" } as unknown as PlayRule, ctx())).toEqual({ complete: false, proof: { reason: "unknown_rule_type", type: "teleport" } });
  });

  it("junk snapshots, holdings and events are dropped, not fatal", () => {
    const junk = [
      null,
      { walletId: "w1" },
      { walletId: "w1", takenAt: "garbage", holdings: [] },
      { walletId: "w1", takenAt: at(0, 11, 55), holdings: [null, { symbol: "X" }, { assetId: id("TSLAx"), symbol: "TSLAx", qty: "1", usd: NaN }, holding("AAPLx", 1, 100)] },
    ] as unknown as HoldingsSnapshot[];
    const junkEvents = [null, { type: 42 }, { type: "league_trade", ts: "nope" }, event("league_trade", 0, "ok")] as unknown as InternalEvent[];
    const res = evaluatePlay({ type: "hold_any", minUsd: 5 }, ctx({ snapshots: junk }));
    expect(res.complete).toBe(true);
    expect(res.proof.symbol).toBe("AAPLx");
    const ev = evaluatePlay({ type: "internal_event", event: "league_trade", count: 1 }, ctx({ events: junkEvents }));
    expect(ev.complete).toBe(true);
    expect(ev.proof.refs).toEqual(["ok"]);
  });

  it("accepts ISO strings for takenAt (JSON-shaped input) and a missing context", () => {
    const snap = { walletId: "w1", takenAt: at(0, 11, 55), holdings: [holding("TSLAx", 1, 400)] } as unknown as HoldingsSnapshot;
    expect(evaluatePlay({ type: "hold_any", minUsd: 5 }, ctx({ snapshots: [snap] })).complete).toBe(true);
    expect(evaluatePlay({ type: "hold_any", minUsd: 5 }, undefined as unknown as EvalContext).proof.reason).toBe("no_snapshots");
  });

  it("throwing lookups are treated as unknown", () => {
    const snapshots = load(fxDiversified);
    const boom = () => {
      throw new Error("boom");
    };
    const div = evaluatePlay({ type: "diversified", minAssets: 3, minSectors: 1 }, ctx({ snapshots, sectorOf: boom }));
    expect(div.complete).toBe(false);
    expect(div.proof.reason).toBe("too_few_sectors");
    const htd = evaluatePlay({ type: "hold_through_date", calendarKey: "earnings" }, ctx({ snapshots, underlyingOf: boom, earnings: { TSLA: ["2026-09-01"] } }));
    expect(htd.complete).toBe(false);
    expect(htd.proof.reason).toBe("no_earnings_date");
  });

  it("every Season 0 catalogue rule evaluates against an empty context with a reason", () => {
    for (const play of SEASON0_PLAYS) {
      const res = evaluatePlay(play.rule, ctx());
      expect(res.complete, play.key).toBe(false);
      expect(typeof res.proof.reason, play.key).toBe("string");
      expectSerialisable(res);
    }
  });

  it("is deterministic: the same context evaluates identically twice", () => {
    const c = ctx({ snapshots: load(fxDca) });
    const rule: PlayRule = { type: "net_increase_days", count: 3, window: 14 };
    expect(evaluatePlay(rule, c)).toEqual(evaluatePlay(rule, c));
  });
});
