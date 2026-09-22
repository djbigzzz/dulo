import { describe, expect, it } from "vitest";
import { evaluatePlay, type EvalContext, type EvalResult } from "@/lib/plays/engine";
import { PlayRuleSchema, type PlayRule } from "@/lib/plays/rules";
import { SEASON0_ASSET_SOURCE, SEASON0_PLAYS, playAssetSource, playByKey } from "@/lib/plays/catalogue";
import { SOLANA_MAINNET, type AssetId } from "@/lib/core/caip";
import type { Holding, HoldingsSnapshot, InternalEvent } from "@/lib/core/types";

/**
 * Second-issuer regression: the seven xStocks quests that read wallet holdings must evaluate
 * exactly the same whether or not the wallet ALSO holds PreStocks pre-IPO tokens.
 *
 * The cron (src/lib/cron/evaluate.ts) calls `evaluatePlay(rule, context, play.assetSource)`;
 * every Season 0 Play is seeded with assetSource "xstocks" (SEASON0_ASSET_SOURCE), and the
 * engine's scopeOf/inScope drop any holding whose `source` differs. This file drives the engine
 * the same way, with the real catalogue rules and the real PreStocks mints, and proves:
 *   1. fenced ("xstocks"): result with the PreStocks bag === result without it, and no PreStocks
 *      mint or label appears anywhere in the proof;
 *   2. unfenced (assetSource null, the pre-Build-1 engine): the same bag DOES flip the quest, so
 *      the bag is large enough for the test to mean something;
 *   3. the inverse: a Play fenced to "prestocks" completes on a PreStocks holding and never on an
 *      xStocks-only wallet.
 *
 * Nothing here touches the network: every snapshot is built in-process.
 */

// ---------------------------------------------------------------------------
// Fixtures. Every date is relative to NOW; day offsets are UTC calendar days.
// ---------------------------------------------------------------------------

/** Tue 22 Sep 2026 12:00Z. dayOffset -1 = 21 Sep, -6 = 16 Sep. */
const NOW = new Date("2026-09-22T12:00:00.000Z");
const BASE_DAY = 22;

interface TestAsset {
  assetId: AssetId;
  mint: string;
  source: "xstocks" | "prestocks";
  underlying: string | null;
  sector: string | null;
  decimals: number;
}

function xstock(mint: string, underlying: string, sector: string): TestAsset {
  return { assetId: `${SOLANA_MAINNET}/token:${mint}`, mint, source: "xstocks", underlying, sector, decimals: 8 };
}
/** A PreStocks pre-IPO token: no underlying ticker, no Pyth feed, 9 decimals. The sector label is test data only. */
function prestock(mint: string, sector: string): TestAsset {
  return { assetId: `${SOLANA_MAINNET}/token:${mint}`, mint, source: "prestocks", underlying: null, sector, decimals: 9 };
}

const XSTOCKS = {
  TSLAx: xstock("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", "TSLA", "Consumer Cyclical"),
  AAPLx: xstock("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", "AAPL", "Technology"),
  NVDAx: xstock("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", "NVDA", "Technology"),
  METAx: xstock("Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", "META", "Communication Services"),
} as const;

/** The eight PreStocks mints on Solana mainnet (verified 17 Sep 2026). Labels are the issuer's names. */
const PRESTOCKS = {
  ANDURIL: prestock("PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", "Defense"),
  ANTHROPIC: prestock("Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", "Artificial Intelligence"),
  FIGUREAI: prestock("PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd", "Robotics"),
  KALSHI: prestock("PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", "Prediction Markets"),
  NEURALINK: prestock("PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", "Neurotechnology"),
  OPENAI: prestock("PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", "Artificial Intelligence"),
  POLYMARKET: prestock("Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", "Prediction Markets"),
  SPACEX: prestock("PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh", "Aerospace"),
} as const;

type XSym = keyof typeof XSTOCKS;
type PreSym = keyof typeof PRESTOCKS;

/** DEX prices observed on Jupiter Price v3, 22 Sep 2026 (tests/fixtures/prestocks-jupiter-2026-09-22.json), to the cent. */
const PRE_PRICE: Record<PreSym, number> = {
  ANDURIL: 153.37,
  ANTHROPIC: 1039.57,
  FIGUREAI: 173.46,
  KALSHI: 886.89,
  NEURALINK: 439.42,
  OPENAI: 1149.9,
  POLYMARKET: 142.47,
  SPACEX: 117.83,
};

const ASSETS: Record<string, TestAsset> = { ...XSTOCKS, ...PRESTOCKS };
const PRESTOCKS_MINTS = Object.values(PRESTOCKS).map((a) => a.mint);
const PRESTOCKS_IDS = new Set<string>(Object.values(PRESTOCKS).map((a) => a.assetId));
const PRESTOCKS_LABELS = new Set<string>(Object.keys(PRESTOCKS));
const id = (s: XSym | PreSym): AssetId => ASSETS[s].assetId;

function holding(symbol: XSym | PreSym, qty: number, price: number | null, extra: Partial<Holding> = {}): Holding {
  const a = ASSETS[symbol];
  return {
    assetId: a.assetId,
    symbol,
    source: a.source,
    raw: BigInt(Math.round(qty * 10 ** a.decimals)).toString(),
    multiplier: 1,
    qty,
    price,
    // PreStocks have no Pyth feed (pythFeedId null for all eight): their price comes from Jupiter.
    priceSource: price === null ? "none" : a.source === "prestocks" ? "jupiter" : "pyth",
    usd: price === null ? 0 : qty * price,
    ...extra,
  };
}
/** An xStocks position priced by Pyth. */
const xs = (symbol: XSym, qty: number, price: number | null) => holding(symbol, qty, price);
/** A PreStocks position at its observed DEX price (or an explicit one). */
const pre = (symbol: PreSym, qty: number, price: number | null = PRE_PRICE[symbol]) => holding(symbol, qty, price);

interface SnapshotOpts {
  hour?: number;
  minute?: number;
  walletId?: string;
}

/** A snapshot on NOW's day + dayOffset at hour:minute UTC (default 23:55, the day-end tick). */
function makeSnapshot(dayOffset: number, holdings: Holding[], opts: SnapshotOpts = {}): HoldingsSnapshot {
  const takenAt = new Date(Date.UTC(2026, 8, BASE_DAY + dayOffset, opts.hour ?? 23, opts.minute ?? 55, 0, 0));
  return { walletId: opts.walletId ?? "w1", takenAt, holdings };
}

function dayOffsetOf(s: HoldingsSnapshot): number {
  const day = Date.UTC(s.takenAt.getUTCFullYear(), s.takenAt.getUTCMonth(), s.takenAt.getUTCDate());
  return Math.round((day - Date.UTC(2026, 8, BASE_DAY)) / 86_400_000);
}

/** The same snapshots with a PreStocks bag appended to every one (the bag may vary by day). */
function withBag(snapshots: HoldingsSnapshot[], bag: (dayOffset: number, index: number) => Holding[]): HoldingsSnapshot[] {
  return snapshots.map((s, i) => ({ ...s, holdings: [...s.holdings, ...bag(dayOffsetOf(s), i)] }));
}

function lookup(assetId: string): TestAsset | undefined {
  return Object.values(ASSETS).find((a) => a.assetId === assetId);
}

/**
 * Sector / underlying lookups. In production these come from catalogueIndexFrom(xstocks.listAssets()),
 * which knows nothing about PreStocks (sector null). Giving the PreStocks mints a sector here makes
 * the UNFENCED flip stronger, so the fence, not an accidental null, is what the fenced case relies on.
 */
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
    ts: new Date(Date.UTC(2026, 8, BASE_DAY + dayOffset, opts.hour ?? 12, 0, 0, 0)),
    meta: opts.meta,
  };
}

const at = (dayOffset: number, hour = 23, minute = 55) => new Date(Date.UTC(2026, 8, BASE_DAY + dayOffset, hour, minute)).toISOString();

// ---------------------------------------------------------------------------
// Driving the engine the way the cron does
// ---------------------------------------------------------------------------

function rule(key: string): PlayRule {
  const play = playByKey(key);
  if (!play) throw new Error(`No catalogue quest "${key}"`);
  return play.rule;
}

/** What src/lib/cron/evaluate.ts does: `evaluatePlay(rule, context, play.assetSource ?? null)` with the seeded "xstocks". */
const fenced = (key: string, c: EvalContext): EvalResult => evaluatePlay(rule(key), c, SEASON0_ASSET_SOURCE);
/** The engine before holdings were source-tagged: no Play context, every holding counts. */
const unfenced = (key: string, c: EvalContext): EvalResult => evaluatePlay(rule(key), c, null);

interface ProofAssets {
  ids: string[];
  symbols: string[];
}

/** Every assetId and symbol mentioned anywhere in a proof (top level, legs, days, assets, checked), sorted. */
function proofAssets(proof: unknown): ProofAssets {
  const ids = new Set<string>();
  const symbols = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === "assetId" && typeof x === "string") ids.add(x);
        else if ((k === "symbol" || k.endsWith("Symbol")) && typeof x === "string") symbols.add(x);
        else walk(x);
      }
    }
  };
  walk(proof);
  return { ids: [...ids].sort(), symbols: [...symbols].sort() };
}

function expectNoPreStocks(res: EvalResult, label: string) {
  const { ids, symbols } = proofAssets(res.proof);
  for (const assetId of ids) {
    expect(PRESTOCKS_IDS.has(assetId), `${label}: proof names PreStocks asset ${assetId}`).toBe(false);
    expect(PRESTOCKS_MINTS.some((m) => assetId.includes(m)), `${label}: proof carries a PreStocks mint`).toBe(false);
  }
  for (const s of symbols) expect(PRESTOCKS_LABELS.has(s), `${label}: proof names PreStocks label ${s}`).toBe(false);
  expect(JSON.stringify(res.proof)).not.toMatch(/token:Pre[1-9A-HJ-NP-Za-km-z]{40,}/);
}

/**
 * The core assertion: fenced, the bag changes nothing (complete flag, progress, completedAt and the
 * whole proof, including its asset list); and the fenced proof never names a PreStocks asset.
 */
function expectUnchanged(key: string, base: EvalContext, bagged: EvalContext): { base: EvalResult; bagged: EvalResult } {
  const a = fenced(key, base);
  const b = fenced(key, bagged);
  expect(b.complete, `${key}: complete flag moved with the PreStocks bag`).toBe(a.complete);
  expect(b.progress, `${key}: progress moved with the PreStocks bag`).toEqual(a.progress);
  expect(b.completedAt, `${key}: completedAt moved with the PreStocks bag`).toBe(a.completedAt);
  expect(proofAssets(b.proof), `${key}: proof asset list moved with the PreStocks bag`).toEqual(proofAssets(a.proof));
  expect(b.proof, `${key}: proof moved with the PreStocks bag`).toEqual(a.proof);
  expectNoPreStocks(b, key);
  // Deterministic: evaluating the bagged wallet again gives the same result.
  expect(fenced(key, bagged)).toEqual(b);
  return { base: a, bagged: b };
}

// ---------------------------------------------------------------------------
// The catalogue rules under test
// ---------------------------------------------------------------------------

describe("the catalogue rules under test are the ones the seed writes", () => {
  it("pins the seven rules and the seeded issuer fence", () => {
    expect(SEASON0_ASSET_SOURCE).toBe("xstocks");
    expect(rule("first_position")).toEqual({ type: "hold_any", minUsd: 5 });
    expect(rule("thousand_club")).toEqual({ type: "hold_any", minUsd: 1000 });
    expect(rule("diamond_hands")).toEqual({ type: "hold_consecutive", days: 7 });
    expect(rule("dca_streak")).toEqual({ type: "net_increase_days", count: 3, window: 14 });
    expect(rule("diversified")).toEqual({ type: "diversified", minAssets: 3, minSectors: 2 });
    expect(rule("sector_spread")).toEqual({ type: "diversified", minAssets: 5, minSectors: 4 });
    expect(rule("mirror")).toEqual({ type: "mirror_match", tolerance: 0.2 });
    expect(playByKey("dca_streak")?.title).toBe("Steady Buyer");
    expect(playByKey("mirror")?.title).toBe("Portfolio Match");
  });
});

// ---------------------------------------------------------------------------
// The seven at-risk quests
// ---------------------------------------------------------------------------

describe("First Position (hold_any minUsd 5)", () => {
  it("an xStocks dust wallet stays incomplete when it also holds $1,178 of a pre-IPO token", () => {
    // TSLAx $3: below the $5 bar. SPACEX 10 x $117.83 = $1,178.30 would clear it on its own.
    const base = ctx({ snapshots: [makeSnapshot(0, [xs("TSLAx", 0.0075, 400)], { hour: 11 })] });
    const bagged = ctx({ snapshots: withBag(base.snapshots, () => [pre("SPACEX", 10)]) });

    const { base: res } = expectUnchanged("first_position", base, bagged);
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({ reason: "below_min_usd", symbol: "TSLAx", usd: 3, minUsd: 5 });
    expect(res.progress).toEqual({ current: 3, target: 5, unit: "usd" });

    // Without the fence the same bag completes the quest with the pre-IPO token as proof.
    const flipped = unfenced("first_position", bagged);
    expect(flipped.complete).toBe(true);
    expect(flipped.proof).toMatchObject({ assetId: id("SPACEX"), symbol: "SPACEX", usd: 1178.3 });
  });

  it("a completed First Position keeps its xStocks proof asset even when the pre-IPO position is larger", () => {
    const base = ctx({ snapshots: [makeSnapshot(0, [xs("TSLAx", 1, 400)], { hour: 11 })] });
    const bagged = ctx({ snapshots: withBag(base.snapshots, () => [pre("OPENAI", 5), pre("ANTHROPIC", 2)]) });

    const { base: res } = expectUnchanged("first_position", base, bagged);
    expect(res.complete).toBe(true);
    expect(res.proof).toEqual({ assetId: id("TSLAx"), symbol: "TSLAx", qty: 1, usd: 400, priceSource: "pyth", takenAt: at(0, 11, 55) });
    expect(res.completedAt).toBe(at(0, 11, 55));

    // Unfenced, the "largest qualifying holding" proof becomes OPENAI: the asset list moves.
    expect(unfenced("first_position", bagged).proof.symbol).toBe("OPENAI");
  });
});

describe("Thousand Club (hold_any minUsd 1000)", () => {
  it("a $460 xStocks position stays short of $1,000 next to $5,749 of a pre-IPO token", () => {
    const base = ctx({ snapshots: [makeSnapshot(0, [xs("AAPLx", 2, 230), xs("TSLAx", 1, 400)])] });
    const bagged = ctx({ snapshots: withBag(base.snapshots, () => [pre("OPENAI", 5), pre("KALSHI", 1)]) });

    const { base: res } = expectUnchanged("thousand_club", base, bagged);
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({ reason: "below_min_usd", symbol: "AAPLx", usd: 460, minUsd: 1000 });
    expect(res.progress).toEqual({ current: 460, target: 1000, unit: "usd" });

    const flipped = unfenced("thousand_club", bagged);
    expect(flipped.complete).toBe(true);
    expect(flipped.proof).toMatchObject({ symbol: "OPENAI", usd: 5749.5 });
  });
});

describe("Diamond Hands (hold_consecutive 7)", () => {
  /** TSLAx held for the last three days only; the pre-IPO token held on every one of the seven. */
  const base = ctx({
    snapshots: [-6, -5, -4, -3, -2, -1, 0].map((d) => makeSnapshot(d, d >= -2 ? [xs("TSLAx", 1, 400 + d)] : [])),
  });
  const bagged = ctx({ snapshots: withBag(base.snapshots, () => [pre("SPACEX", 10)]) });

  it("a three-day xStocks run stays a three-day run when a pre-IPO token was held all seven days", () => {
    const { base: res } = expectUnchanged("diamond_hands", base, bagged);
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({ reason: "run_too_short", assetId: id("TSLAx"), symbol: "TSLAx", run: 3, needed: 7, bridged: [] });
    expect(res.proof.days).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
    expect(res.progress).toEqual({ current: 3, target: 7, unit: "days" });

    const flipped = unfenced("diamond_hands", bagged);
    expect(flipped.complete).toBe(true);
    expect(flipped.proof).toMatchObject({ assetId: id("SPACEX"), run: 7 });
  });

  it("the four PreStocks-only days are not xStocks days either: nothing is bridged across them", () => {
    // Fenced, days -6..-3 have no in-scope position at all, so the run cannot start before day -2.
    const res = fenced("diamond_hands", bagged);
    expect(res.proof.bridged).toEqual([]);
    expect(res.proof.run).toBe(3);
  });
});

describe("Steady Buyer (net_increase_days 3 in 14)", () => {
  /** xStocks: one qty increase (day -2, 1 -> 1.5). PreStocks: SPACEX qty 1, 1, 2, 3, 4, 4, 4, so it grew on days -4, -3 and -2. */
  const PRE_QTY: Record<number, number> = { [-6]: 1, [-5]: 1, [-4]: 2, [-3]: 3, [-2]: 4, [-1]: 4, [0]: 4 };
  const base = ctx({ snapshots: [-6, -5, -4, -3, -2, -1, 0].map((d) => makeSnapshot(d, [xs("TSLAx", d >= -2 ? 1.5 : 1, 400)])) });
  const bagged = ctx({ snapshots: withBag(base.snapshots, (d) => [pre("SPACEX", PRE_QTY[d])]) });

  it("one xStocks increase day stays one when the pre-IPO balance grew on three days", () => {
    const { base: res } = expectUnchanged("dca_streak", base, bagged);
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({ reason: "not_enough_increase_days", count: 1, needed: 3 });
    expect(res.proof.days).toEqual([{ day: "2026-09-20", assetId: id("TSLAx"), symbol: "TSLAx", from: 1, to: 1.5, deltaUsd: 200 }]);
    expect(res.progress).toEqual({ current: 1, target: 3, unit: "days" });

    const flipped = unfenced("dca_streak", bagged);
    expect(flipped.complete).toBe(true);
    const days = flipped.proof.days as Array<{ day: string; assetId: string }>;
    expect(days.map((d) => d.day)).toEqual(["2026-09-18", "2026-09-19", "2026-09-20"]);
    expect(days.some((d) => PRESTOCKS_IDS.has(d.assetId))).toBe(true);
  });
});

describe("Diversified (3 assets / 2 sectors)", () => {
  it("two xStocks across two sectors stay two assets when three pre-IPO tokens sit beside them", () => {
    const base = ctx({ snapshots: [makeSnapshot(0, [xs("TSLAx", 1, 400), xs("AAPLx", 2, 230)], { hour: 11 })] });
    const bagged = ctx({ snapshots: withBag(base.snapshots, () => [pre("SPACEX", 1), pre("OPENAI", 1), pre("ANDURIL", 1)]) });

    const { base: res } = expectUnchanged("diversified", base, bagged);
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({
      reason: "too_few_assets",
      assets: [
        { symbol: "AAPLx", sector: "Technology", usd: 460 },
        { symbol: "TSLAx", sector: "Consumer Cyclical", usd: 400 },
      ],
      sectors: ["Consumer Cyclical", "Technology"],
      assetCount: 2,
      sectorCount: 2,
    });
    expect(res.progress).toEqual({ current: 2, target: 3, unit: "assets" });

    const flipped = unfenced("diversified", bagged);
    expect(flipped.complete).toBe(true);
    expect(flipped.proof.assetCount).toBe(5);
  });
});

describe("Sector Spread (5 assets / 4 sectors)", () => {
  it("four xStocks across three sectors stay four when five pre-IPO tokens across four sectors sit beside them", () => {
    const base = ctx({
      snapshots: [makeSnapshot(0, [xs("TSLAx", 1, 400), xs("AAPLx", 2, 230), xs("NVDAx", 1, 180), xs("METAx", 1, 500)], { hour: 11 })],
    });
    const bagged = ctx({
      snapshots: withBag(base.snapshots, () => [pre("SPACEX", 1), pre("OPENAI", 1), pre("ANDURIL", 1), pre("KALSHI", 1), pre("NEURALINK", 1)]),
    });

    const { base: res } = expectUnchanged("sector_spread", base, bagged);
    expect(res.complete).toBe(false);
    expect(res.proof).toMatchObject({ reason: "too_few_assets", assetCount: 4, sectorCount: 3, minAssets: 5, minSectors: 4 });
    expect((res.proof.assets as Array<{ symbol: string }>).map((a) => a.symbol)).toEqual(["METAx", "AAPLx", "TSLAx", "NVDAx"]);
    expect(res.progress).toEqual({ current: 4, target: 5, unit: "assets" });

    const flipped = unfenced("sector_spread", bagged);
    expect(flipped.complete).toBe(true);
    expect(flipped.proof).toMatchObject({ assetCount: 9, sectorCount: 8 });
  });
});

describe("Portfolio Match (mirror_match 0.2)", () => {
  const target = { [id("TSLAx")]: 0.6, [id("AAPLx")]: 0.4 };
  const copied = event("mirror_executed", -1, "mirror-1", { meta: { targetWallet: "LeaderWallet111", target } });
  /** Day -2 is before the copy and must be ignored; day -1 18:00Z is a 50/50 split, 0.1 off each leg. */
  const base = ctx({
    snapshots: [
      makeSnapshot(-2, [xs("TSLAx", 2.5, 400)]),
      makeSnapshot(-1, [xs("TSLAx", 1.25, 400), xs("AAPLx", 2.5, 200)], { hour: 18, minute: 0 }),
    ],
    events: [copied],
  });
  /** $5,749.50 of OPENAI beside a $1,000 copy: unfenced it would be 85% of the wallet. */
  const bagged = ctx({ ...base, snapshots: withBag(base.snapshots, () => [pre("OPENAI", 5)]) });

  it("a matching copy still matches, with exactly the two xStocks legs, beside a large pre-IPO position", () => {
    const { base: res, bagged: fencedRes } = expectUnchanged("mirror", base, bagged);
    expect(res.complete).toBe(true);
    expect(res.proof).toMatchObject({ targetWallet: "LeaderWallet111", totalUsd: 1000, distance: 0.1, tolerance: 0.2 });
    expect(res.proof.legs).toEqual([
      { assetId: id("TSLAx"), symbol: "TSLAx", target: 0.6, actual: 0.5, delta: -0.1, ok: true },
      { assetId: id("AAPLx"), symbol: "AAPLx", target: 0.4, actual: 0.5, delta: 0.1, ok: true },
    ]);
    expect(res.progress).toEqual({ current: 2, target: 2, unit: "legs" });
    expect(res.completedAt).toBe(at(-1, 18, 0));

    // The legs never include a PreStocks asset, and the in-scope total ignores the bag.
    const legs = fencedRes.proof.legs as Array<{ assetId: string }>;
    expect(legs).toHaveLength(2);
    expect(legs.some((l) => PRESTOCKS_IDS.has(l.assetId))).toBe(false);
    expect(fencedRes.proof.totalUsd).toBe(1000);

    const flipped = unfenced("mirror", bagged);
    expect(flipped.complete).toBe(false);
    expect(flipped.proof.reason).toBe("outside_tolerance");
    const extra = (flipped.proof.legs as Array<{ assetId: string; target: number; actual: number }>).find((l) => PRESTOCKS_IDS.has(l.assetId));
    expect(extra).toMatchObject({ target: 0 });
    expect(extra?.actual).toBeGreaterThan(0.8);
  });

  it("a copied target is never fenced: this is why /copy must build allocations from xStocks holdings only", () => {
    // If the copy tool ever recorded a PreStocks mint in the target, the engine would carry it as a
    // target leg (actual 0 under the xStocks fence) and the quest could never complete. The fence
    // protects the holdings side; the target side is the copy route's job (filter
    // holding.source === "xstocks" before recording a mirror_executed event).
    const mixedTarget = { [id("TSLAx")]: 0.5, [id("SPACEX")]: 0.5 };
    const mixed = event("mirror_executed", -1, "mirror-mixed", { meta: { targetWallet: "L", target: mixedTarget } });
    const wallet = ctx({
      snapshots: [makeSnapshot(-1, [xs("TSLAx", 1.25, 400), pre("SPACEX", 4.24)], { hour: 18, minute: 0 })],
      events: [mixed],
    });
    const res = fenced("mirror", wallet);
    expect(res.complete).toBe(false);
    expect(res.proof.reason).toBe("outside_tolerance");
    const spacexLeg = (res.proof.legs as Array<{ assetId: string; actual: number; ok: boolean }>).find((l) => l.assetId === id("SPACEX"));
    expect(spacexLeg).toMatchObject({ actual: 0, ok: false });
  });
});

// ---------------------------------------------------------------------------
// Every active on-chain catalogue quest, one wallet, one sweep
// ---------------------------------------------------------------------------

describe("every active on-chain quest is unchanged by the PreStocks bag", () => {
  const target = { [id("TSLAx")]: 0.5, [id("AAPLx")]: 0.5 };
  /** TSLAx grows a little from day -3 on; AAPLx appears on day -3; TSLA reported earnings on day -4. */
  const base = ctx({
    snapshots: [-6, -5, -4, -3, -2, -1, 0].map((d) =>
      makeSnapshot(d, [xs("TSLAx", 1 + Math.max(0, d + 3) * 0.1, 400), ...(d >= -3 ? [xs("AAPLx", 2, 230)] : [])]),
    ),
    events: [event("mirror_executed", -2, "mirror-sweep", { meta: { targetWallet: "L", target } })],
    earnings: { TSLA: ["2026-09-18"], AAPL: ["2026-10-29"] },
  });
  const bag = (i: number) => [pre("SPACEX", 10 + i), pre("OPENAI", 3), pre("ANTHROPIC", 1), pre("KALSHI", 2), pre("POLYMARKET", 7)];
  const bagged = ctx({ ...base, snapshots: withBag(base.snapshots, (_, i) => bag(i)) });

  // The nine xStocks-fenced quests. The PreStocks quest (pre_ipo_position, fenced to "prestocks") is
  // meant to flip on the bag, so it is covered by the inverse block below, not by this sweep.
  const onChain = SEASON0_PLAYS.filter((p) => !p.comingSoon && p.rule.type !== "internal_event" && playAssetSource(p) === SEASON0_ASSET_SOURCE);

  it("covers the nine xStocks on-chain quests, the seven at-risk ones included", () => {
    expect(onChain.map((p) => p.key).sort()).toEqual(
      ["dca_streak", "diamond_hands", "diversified", "earnings_holder", "first_position", "index_holder", "mirror", "sector_spread", "thousand_club"].sort(),
    );
  });

  for (const play of onChain) {
    it(`${play.title} (${play.key}) evaluates identically with and without the bag`, () => {
      const { base: res } = expectUnchanged(play.key, base, bagged);
      // The sweep wallet exercises real branches, never the empty-context short-circuit.
      expect(res.proof.reason).not.toBe("no_snapshots");
    });
  }
});

// ---------------------------------------------------------------------------
// The inverse: a Play fenced to "prestocks"
// ---------------------------------------------------------------------------

describe('a Play with assetSource "prestocks"', () => {
  /**
   * Schema finding (src/lib/plays/rules.ts): usdSchema is `z.number().finite().nonnegative()`, so
   * `hold_any` with `minUsd: 0` ("any dust") parses today and is the count-free form of "holds the
   * token at all"; the engine then completes on any in-scope position with qty > 0, price known or
   * not. There is NO token-count threshold (no minQty) in any rule type: strictObject rejects the key.
   * If a pre-IPO quest ever needs "at least N tokens", the smallest change is an optional
   * `minQty: z.number().finite().nonnegative()` on HoldAnyRuleSchema plus a `best.qty < minQty` check
   * in evalHoldAny. Nothing here needs it.
   */
  const anyDust: PlayRule = { type: "hold_any", minUsd: 0 };

  it("the schema accepts hold_any minUsd 0 and rejects a token-count threshold", () => {
    expect(PlayRuleSchema.safeParse(anyDust).success).toBe(true);
    expect(PlayRuleSchema.safeParse({ type: "hold_any", minUsd: -1 }).success).toBe(false);
    expect(PlayRuleSchema.safeParse({ type: "hold_any" }).success).toBe(false);
    expect(PlayRuleSchema.safeParse({ type: "hold_any", minUsd: 0, minQty: 1 }).success, "no minQty exists today").toBe(false);
  });

  it("completes on a PreStocks holding, priced by Jupiter or not priced at all", () => {
    const priced = evaluatePlay(anyDust, ctx({ snapshots: [makeSnapshot(0, [pre("SPACEX", 0.5)])] }), "prestocks");
    expect(priced.complete).toBe(true);
    expect(priced.proof).toEqual({ assetId: id("SPACEX"), symbol: "SPACEX", qty: 0.5, usd: 58.92, priceSource: "jupiter", takenAt: at(0) });
    expect(priced.progress).toBeUndefined();

    // No Pyth feed and no Jupiter quote either: minUsd 0 still counts the position.
    const unpriced = evaluatePlay(anyDust, ctx({ snapshots: [makeSnapshot(0, [pre("NEURALINK", 0.01, null)])] }), "prestocks");
    expect(unpriced.complete).toBe(true);
    expect(unpriced.proof).toMatchObject({ symbol: "NEURALINK", usd: 0, priceSource: "none" });
  });

  it("never completes on an xStocks-only wallet, however large", () => {
    const wallet = ctx({ snapshots: [makeSnapshot(0, [xs("TSLAx", 10, 400), xs("AAPLx", 10, 230)])] });
    const res = evaluatePlay(anyDust, wallet, "prestocks");
    expect(res.complete).toBe(false);
    expect(res.proof).toEqual({ reason: "no_in_scope_holding", takenAt: at(0), minUsd: 0 });
    expect(evaluatePlay({ type: "hold_any", minUsd: 5 }, wallet, "prestocks").proof.reason).toBe("no_in_scope_holding");
    // The same wallet completes the xStocks quest, so the wallet itself is not the problem.
    expect(fenced("first_position", wallet).complete).toBe(true);
  });

  it("picks the largest PreStocks position, never the larger xStocks one", () => {
    const mixed = ctx({ snapshots: [makeSnapshot(0, [xs("TSLAx", 100, 400), pre("ANDURIL", 2), pre("FIGUREAI", 1)])] });
    const res = evaluatePlay({ type: "hold_any", minUsd: 5 }, mixed, "prestocks");
    expect(res.complete).toBe(true);
    expect(res.proof).toMatchObject({ assetId: id("ANDURIL"), symbol: "ANDURIL", usd: 306.74 });
  });
});
