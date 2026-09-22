import { describe, expect, it } from "vitest";
import { evaluatePlay, type EvalContext, type EvalResult, type OnRecordAdjustment } from "@/lib/plays/engine";
import { PLAY_RULE_TYPES, PlayRuleSchema, ruleToHint, type PlayRule } from "@/lib/plays/rules";
import { SOLANA_MAINNET, type AssetId } from "@/lib/core/caip";
import type { Holding, HoldingsSnapshot } from "@/lib/core/types";

/**
 * The eighth rule type: multiplier_change.
 *
 * A Token-2022 ScaledUiAmount adjustment (a split, or PreStocks' periodic rebase) changes the
 * multiplier on the mint, never the holder's raw balance. The rule completes when one in-scope
 * asset shows THE SAME raw balance at two day-end snapshots on CONSECUTIVE days with the
 * multiplier changed between them, and the change is the one the mint records
 * (ctx.corporateActions: multiplierBefore -> multiplierAfter, effective between the two
 * snapshots). A snapshot pair alone never scores: a degraded mint read that wrote a wrong
 * multiplier into one tick has no record behind it. Live facts (22 Sep 2026): SPACEX 1 -> 5
 * effective 2026-06-10T04:30Z and OPENAI 1 -> 1.4861347 effective 2026-07-17T16:30Z, both before
 * Dulo's first production snapshot, so no wallet on record can have held through them yet.
 *
 * Same idiom as tests/engine.test.ts (its factories are copied, not imported).
 */

/** Mon 14 Sep 2026 12:00Z. dayOffset -1 = 13 Sep. */
const NOW = new Date("2026-09-14T12:00:00.000Z");

interface TestAsset {
  assetId: AssetId;
  source: string;
  decimals: number;
}

const ASSETS: Record<"SPACEX" | "OPENAI" | "TSLAx", TestAsset> = {
  SPACEX: { assetId: `${SOLANA_MAINNET}/token:PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh`, source: "prestocks", decimals: 9 },
  OPENAI: { assetId: `${SOLANA_MAINNET}/token:PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF`, source: "prestocks", decimals: 9 },
  TSLAx: { assetId: `${SOLANA_MAINNET}/token:XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB`, source: "xstocks", decimals: 8 },
};
type Sym = keyof typeof ASSETS;
const id = (s: Sym): AssetId => ASSETS[s].assetId;

/** A holding from its RAW base units and multiplier: qty = raw / 10^decimals * multiplier (the adapter's rule). */
function holding(symbol: Sym, rawUnits: number, multiplier: number, extra: Partial<Holding> = {}): Holding {
  const a = ASSETS[symbol];
  const qty = (rawUnits / 10 ** a.decimals) * multiplier;
  return {
    assetId: a.assetId,
    symbol,
    source: a.source,
    raw: String(rawUnits),
    multiplier,
    qty,
    price: null,
    priceSource: "none",
    usd: 0,
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

/**
 * The adjustment a mint records (what lib/corporate-actions reads from its ScaledUiAmount state),
 * effective on NOW's day + dayOffset at 04:30Z: between the day-end tick before it and the one on
 * that day, so the snapshot pair (dayOffset - 1, dayOffset) is the one it corroborates.
 */
function record(symbol: Sym, multiplierBefore: number, multiplierAfter: number, dayOffset: number, hour = 4, minute = 30): OnRecordAdjustment {
  return { assetId: id(symbol), multiplierBefore, multiplierAfter, effectiveAt: new Date(Date.UTC(2026, 8, 14 + dayOffset, hour, minute)).toISOString() };
}

/** The two live facts, exactly as the mints record them (both months before any snapshot here). */
const SPACEX_SPLIT: OnRecordAdjustment = { assetId: id("SPACEX"), multiplierBefore: 1, multiplierAfter: 5, effectiveAt: "2026-06-10T04:30:00.000Z" };
const OPENAI_ADJUSTMENT: OnRecordAdjustment = { assetId: id("OPENAI"), multiplierBefore: 1, multiplierAfter: 1.4861347, effectiveAt: "2026-07-17T16:30:00.000Z" };

function ctx(over: Partial<EvalContext> = {}): EvalContext {
  return { now: NOW, snapshots: [], events: [], earnings: {}, sectorOf: () => null, underlyingOf: () => null, ...over };
}

const at = (dayOffset: number, hour = 23, minute = 55) => new Date(Date.UTC(2026, 8, 14 + dayOffset, hour, minute)).toISOString();
const day = (dayOffset: number) => at(dayOffset).slice(0, 10);

/** The Proof drawer stores proof as JSON: it must round-trip losslessly. */
function expectSerialisable(res: EvalResult) {
  expect(JSON.parse(JSON.stringify(res.proof))).toEqual(res.proof);
  if (res.completedAt !== undefined) expect(new Date(res.completedAt).toISOString()).toBe(res.completedAt);
}

const RULE: PlayRule = { type: "multiplier_change" };
const TEN = 10_000_000_000; // 10 tokens at 9 decimals, as raw base units

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

describe("multiplier_change", () => {
  it("(a) completes when the mint's recorded adjustment lands between two consecutive day-ends that show the same raw balance under the old and the new multiplier", () => {
    const snapshots = [
      makeSnapshot(-3, [holding("SPACEX", TEN, 1)]),
      makeSnapshot(-2, [holding("SPACEX", TEN, 1)]),
      // The adjustment lands: same raw, multiplier 5, so the shown quantity is 50 instead of 10.
      makeSnapshot(-1, [holding("SPACEX", TEN, 5)]),
      makeSnapshot(0, [holding("SPACEX", TEN, 5)], { hour: 11 }),
    ];
    const res = evaluatePlay(RULE, ctx({ snapshots, corporateActions: [record("SPACEX", 1, 5, -1)] }), "prestocks");
    expect(res.complete).toBe(true);
    expect(res.proof).toEqual({
      assetId: id("SPACEX"),
      symbol: "SPACEX",
      before: { day: day(-2), multiplier: 1, qty: 10, raw: String(TEN) },
      after: { day: day(-1), multiplier: 5, qty: 50, raw: String(TEN) },
      ratio: 5,
    });
    expect(res.completedAt).toBe(at(-1));
    expect(res.progress).toEqual({ current: 1, target: 1, unit: "adjustments" });
    expectSerialisable(res);
  });

  it("(a) the day-END snapshot is the one read, and the record may take effect right at that tick", () => {
    const snapshots = [
      makeSnapshot(-2, [holding("SPACEX", TEN, 1)]),
      // A morning read still on the old multiplier is superseded by the evening one.
      makeSnapshot(-1, [holding("SPACEX", TEN, 1)], { hour: 9 }),
      makeSnapshot(-1, [holding("SPACEX", TEN, 5)]),
    ];
    const res = evaluatePlay(RULE, ctx({ snapshots, corporateActions: [record("SPACEX", 1, 5, -1, 23, 55)] }), "prestocks");
    expect(res.complete).toBe(true);
    expect(res.proof).toMatchObject({
      symbol: "SPACEX",
      before: { day: day(-2), multiplier: 1, raw: String(TEN) },
      after: { day: day(-1), multiplier: 5, raw: String(TEN) },
      ratio: 5,
    });
    expect(res.completedAt).toBe(at(-1));
    // A record effective one minute AFTER the later day-end belongs to the next pair, which is not observed yet.
    const later = evaluatePlay(RULE, ctx({ snapshots, corporateActions: [record("SPACEX", 1, 5, -1, 23, 56)] }), "prestocks");
    expect(later.complete).toBe(false);
    expect(later.proof.reason).toBe("no_adjustment_yet");
  });

  it("(b) is incomplete when the adjustment landed but the raw balance at the later snapshot is 0 (sold before it)", () => {
    const snapshots = [
      makeSnapshot(-3, [holding("SPACEX", TEN, 1)]),
      makeSnapshot(-2, [holding("SPACEX", TEN, 1)]),
      makeSnapshot(-1, [holding("SPACEX", 0, 5)]),
      makeSnapshot(0, [holding("SPACEX", 0, 5)], { hour: 11 }),
    ];
    const res = evaluatePlay(RULE, ctx({ snapshots, corporateActions: [record("SPACEX", 1, 5, -1)] }), "prestocks");
    expect(res.complete).toBe(false);
    expect(res.completedAt).toBe(undefined);
    expect(res.proof.reason).toBe("not_held_through");
    expect(res.proof.missed).toEqual([
      { assetId: id("SPACEX"), symbol: "SPACEX", before: { day: day(-2), multiplier: 1, qty: 10, raw: String(TEN) }, after: { day: day(-1), multiplier: 5, qty: 0, raw: "0" } },
    ]);
    expect(res.progress).toEqual({ current: 0, target: 1, unit: "adjustments" });
    expectSerialisable(res);
  });

  it("(b) selling out before the adjustment, trimming across it or adding to the position across it is not holding the same raw balance through it", () => {
    // Sold out the day before the adjustment (no row at all), bought back after: the record dates the miss.
    const soldAndRebought = [
      makeSnapshot(-3, [holding("SPACEX", TEN, 1)]),
      makeSnapshot(-2, []),
      makeSnapshot(-1, [holding("SPACEX", TEN, 5)]),
    ];
    const a = evaluatePlay(RULE, ctx({ snapshots: soldAndRebought, corporateActions: [record("SPACEX", 1, 5, -2)] }), "prestocks");
    expect(a.complete).toBe(false);
    expect(a.proof.reason).toBe("not_held_through");
    expect(a.proof.missed).toEqual([
      { assetId: id("SPACEX"), symbol: "SPACEX", before: { day: day(-3), multiplier: 1, qty: 10, raw: String(TEN) }, after: { day: day(-2), multiplier: 5, qty: 0, raw: "0" } },
    ]);

    const trimmed = [makeSnapshot(-2, [holding("SPACEX", TEN, 1)]), makeSnapshot(-1, [holding("SPACEX", TEN / 2, 5)])];
    const b = evaluatePlay(RULE, ctx({ snapshots: trimmed, corporateActions: [record("SPACEX", 1, 5, -1)] }), "prestocks");
    expect(b.complete).toBe(false);
    expect(b.proof.reason).toBe("not_held_through");

    // The quest says "the same raw balance": a larger one after the change is a different balance, and the proof would show two numbers.
    const added = [makeSnapshot(-2, [holding("SPACEX", TEN, 1)]), makeSnapshot(-1, [holding("SPACEX", TEN * 2, 5)])];
    const c = evaluatePlay(RULE, ctx({ snapshots: added, corporateActions: [record("SPACEX", 1, 5, -1)] }), "prestocks");
    expect(c.complete).toBe(false);
    expect(c.proof.reason).toBe("not_held_through");
    expect(c.proof.missed).toEqual([
      { assetId: id("SPACEX"), symbol: "SPACEX", before: { day: day(-2), multiplier: 1, qty: 10, raw: String(TEN) }, after: { day: day(-1), multiplier: 5, qty: 100, raw: String(TEN * 2) } },
    ]);
  });

  it("(b) days without a snapshot are not a pair: selling out and buying back across missed cron days never completes, and neither does an unobserved hold", () => {
    // 20 Sep raw TEN m=1; no day-ends 21-22 Sep; 23 Sep raw 2*TEN m=5 after selling everything and buying double.
    const rebought = [makeSnapshot(-4, [holding("SPACEX", TEN, 1)]), makeSnapshot(-1, [holding("SPACEX", TEN * 2, 5)])];
    const a = evaluatePlay(RULE, ctx({ snapshots: rebought, corporateActions: [record("SPACEX", 1, 5, -2)] }), "prestocks");
    expect(a.complete).toBe(false);
    expect(a.proof.reason).toBe("no_adjustment_yet");
    // The same raw balance either side of missed days cannot be observed as held through either.
    const unobserved = [makeSnapshot(-4, [holding("SPACEX", TEN, 1)]), makeSnapshot(-1, [holding("SPACEX", TEN, 5)])];
    const b = evaluatePlay(RULE, ctx({ snapshots: unobserved, corporateActions: [record("SPACEX", 1, 5, -2)] }), "prestocks");
    expect(b.complete).toBe(false);
    expect(b.proof.reason).toBe("no_adjustment_yet");
  });

  it("(b) a snapshot pair alone never scores: a degraded mint read (5 -> 1 -> 5, or 5 -> 1) has no adjustment on record behind it", () => {
    // SPACEX's real record: 1 -> 5, effective 10 Jun 2026, months before these snapshots.
    const glitch = [
      makeSnapshot(-3, [holding("SPACEX", TEN, 5)]),
      makeSnapshot(-2, [holding("SPACEX", TEN, 1)]), // the tick that read the mint as 1
      makeSnapshot(-1, [holding("SPACEX", TEN, 5)]),
    ];
    const a = evaluatePlay(RULE, ctx({ snapshots: glitch, corporateActions: [SPACEX_SPLIT, OPENAI_ADJUSTMENT] }), "prestocks");
    expect(a.complete).toBe(false);
    expect(a.proof.reason).toBe("no_adjustment_yet");
    const b = evaluatePlay(RULE, ctx({ snapshots: glitch.slice(0, 2), corporateActions: [SPACEX_SPLIT, OPENAI_ADJUSTMENT] }), "prestocks");
    expect(b.complete).toBe(false);
    expect(b.proof.reason).toBe("no_adjustment_yet");

    // The honest pair (1 -> 5, same raw, consecutive days) still needs the record to say so.
    const pair = [makeSnapshot(-2, [holding("SPACEX", TEN, 1)]), makeSnapshot(-1, [holding("SPACEX", TEN, 5)])];
    expect(evaluatePlay(RULE, ctx({ snapshots: pair }), "prestocks").proof.reason).toBe("no_adjustment_yet");
    expect(evaluatePlay(RULE, ctx({ snapshots: pair, corporateActions: [] }), "prestocks").proof.reason).toBe("no_adjustment_yet");
    // On record, but dated outside the pair (the real June split): not this pair's change.
    expect(evaluatePlay(RULE, ctx({ snapshots: pair, corporateActions: [SPACEX_SPLIT] }), "prestocks").proof.reason).toBe("no_adjustment_yet");
    // On record and dated inside the pair, but the snapshots disagree with the multipliers it names.
    expect(evaluatePlay(RULE, ctx({ snapshots: pair, corporateActions: [record("SPACEX", 1, 4, -1)] }), "prestocks").proof.reason).toBe("no_adjustment_yet");
    expect(evaluatePlay(RULE, ctx({ snapshots: pair, corporateActions: [record("SPACEX", 2, 5, -1)] }), "prestocks").proof.reason).toBe("no_adjustment_yet");
    // A record without a date cannot be placed between two snapshots and never scores.
    const undated: OnRecordAdjustment = { assetId: id("SPACEX"), multiplierBefore: 1, multiplierAfter: 5, effectiveAt: null };
    expect(evaluatePlay(RULE, ctx({ snapshots: pair, corporateActions: [undated] }), "prestocks").proof.reason).toBe("no_adjustment_yet");
    // Another mint's record says nothing about this one.
    expect(evaluatePlay(RULE, ctx({ snapshots: pair, corporateActions: [record("OPENAI", 1, 5, -1)] }), "prestocks").proof.reason).toBe("no_adjustment_yet");
    // The matching record completes the very same pair.
    expect(evaluatePlay(RULE, ctx({ snapshots: pair, corporateActions: [record("SPACEX", 1, 5, -1)] }), "prestocks").complete).toBe(true);
  });

  it("(c) is incomplete with no_adjustment_yet and a 0 / 1 adjustments progress when no multiplier ever changes", () => {
    const snapshots = [-3, -2, -1, 0].map((d) => makeSnapshot(d, [holding("SPACEX", TEN, 5), holding("OPENAI", TEN, 1.4861347)]));
    const res = evaluatePlay(RULE, ctx({ snapshots, corporateActions: [SPACEX_SPLIT, OPENAI_ADJUSTMENT] }), "prestocks");
    expect(res.complete).toBe(false);
    expect(res.proof.reason).toBe("no_adjustment_yet");
    expect(res.progress).toEqual({ current: 0, target: 1, unit: "adjustments" });
    expect(res.completedAt).toBe(undefined);
    expectSerialisable(res);

    // One snapshot is a baseline only; none at all is the usual no_snapshots.
    const one = evaluatePlay(RULE, ctx({ snapshots: [makeSnapshot(0, [holding("SPACEX", TEN, 5)])], corporateActions: [SPACEX_SPLIT] }), "prestocks");
    expect(one.proof.reason).toBe("no_adjustment_yet");
    expect(one.progress).toEqual({ current: 0, target: 1, unit: "adjustments" });
    expect(evaluatePlay(RULE, ctx({ corporateActions: [SPACEX_SPLIT] }), "prestocks").proof.reason).toBe("no_snapshots");
  });

  it("(d) ignores holdings from another issuer (the fence) and holdings whose multiplier is identical", () => {
    // TSLAx (xstocks) goes 1 -> 2 on record while SPACEX (prestocks) stays at 1.
    const snapshots = [
      makeSnapshot(-2, [holding("TSLAx", 100_000_000, 1), holding("SPACEX", TEN, 1)]),
      makeSnapshot(-1, [holding("TSLAx", 100_000_000, 2), holding("SPACEX", TEN, 1)]),
    ];
    const actions = [record("TSLAx", 1, 2, -1)];
    const fenced = evaluatePlay(RULE, ctx({ snapshots, corporateActions: actions }), "prestocks");
    expect(fenced.complete).toBe(false);
    expect(fenced.proof.reason).toBe("no_adjustment_yet");
    // Without a fence (no Play context) the xStock's own adjustment completes it: the fence is what excluded it above.
    const unfenced = evaluatePlay(RULE, ctx({ snapshots, corporateActions: actions }));
    expect(unfenced.complete).toBe(true);
    expect(unfenced.proof).toMatchObject({ symbol: "TSLAx", ratio: 2 });

    // Identical multipliers are skipped even when the raw balance moves; the one that changed is the proof.
    const mixed = [
      makeSnapshot(-2, [holding("SPACEX", TEN, 1), holding("OPENAI", TEN, 1)]),
      makeSnapshot(-1, [holding("SPACEX", TEN * 3, 1), holding("OPENAI", TEN, 1.4861347)]),
    ];
    const res = evaluatePlay(RULE, ctx({ snapshots: mixed, corporateActions: [record("OPENAI", 1, 1.4861347, -1)] }), "prestocks");
    expect(res.complete).toBe(true);
    expect(res.proof).toMatchObject({ assetId: id("OPENAI"), symbol: "OPENAI", ratio: 1.4861347 });
  });

  it("(d) the rule's own scope narrows the fence: assetIds and assetSymbols", () => {
    const snapshots = [
      makeSnapshot(-2, [holding("SPACEX", TEN, 1), holding("OPENAI", TEN, 1)]),
      makeSnapshot(-1, [holding("SPACEX", TEN, 5), holding("OPENAI", TEN, 1.4861347)]),
    ];
    const corporateActions = [record("SPACEX", 1, 5, -1), record("OPENAI", 1, 1.4861347, -1)];
    const byId = evaluatePlay({ type: "multiplier_change", assetIds: [id("OPENAI")] }, ctx({ snapshots, corporateActions }), "prestocks");
    expect(byId.complete).toBe(true);
    expect(byId.proof.symbol).toBe("OPENAI");
    const bySymbol = evaluatePlay({ type: "multiplier_change", assetSymbols: ["openai"] }, ctx({ snapshots, corporateActions }), "prestocks");
    expect(bySymbol.proof.symbol).toBe("OPENAI");
    const pending = evaluatePlay({ type: "multiplier_change", partnerAssetIds: [] }, ctx({ snapshots, corporateActions }), "prestocks");
    expect(pending).toEqual({ complete: false, proof: { reason: "partner_pending" } });
  });

  it("(e) picks the largest ratio when several assets qualify, whichever adjusted first", () => {
    const snapshots = [
      makeSnapshot(-3, [holding("SPACEX", TEN, 1), holding("OPENAI", TEN, 1)]),
      // OPENAI adjusts first...
      makeSnapshot(-2, [holding("SPACEX", TEN, 1), holding("OPENAI", TEN, 1.4861347)]),
      // ...then SPACEX, with the bigger ratio.
      makeSnapshot(-1, [holding("SPACEX", TEN, 5), holding("OPENAI", TEN, 1.4861347)]),
    ];
    const corporateActions = [record("OPENAI", 1, 1.4861347, -2), record("SPACEX", 1, 5, -1)];
    const res = evaluatePlay(RULE, ctx({ snapshots, corporateActions }), "prestocks");
    expect(res.complete).toBe(true);
    expect(res.proof).toEqual({
      assetId: id("SPACEX"),
      symbol: "SPACEX",
      before: { day: day(-2), multiplier: 1, qty: 10, raw: String(TEN) },
      after: { day: day(-1), multiplier: 5, qty: 50, raw: String(TEN) },
      ratio: 5,
    });
    expect(res.completedAt).toBe(at(-1));
  });

  it("the two adjustments on record predate every snapshot Dulo has: a SPACEX or OPENAI holder is honestly 'no adjustment yet'", () => {
    // 21 and 22 Sep 2026, the first production snapshots.
    const snapshots = [7, 8].map((d) => makeSnapshot(d, [holding("SPACEX", TEN, 5), holding("OPENAI", TEN, 1.4861347)]));
    const res = evaluatePlay(RULE, ctx({ snapshots, corporateActions: [SPACEX_SPLIT, OPENAI_ADJUSTMENT] }), "prestocks");
    expect(res.complete).toBe(false);
    expect(res.proof.reason).toBe("no_adjustment_yet");
  });

  it("never throws on junk snapshots or junk records and stays deterministic", () => {
    const junk = [{ walletId: "w1", takenAt: new Date("nope"), holdings: [{ nope: true }] }, null] as unknown as HoldingsSnapshot[];
    expect(evaluatePlay(RULE, ctx({ snapshots: junk }), "prestocks").proof.reason).toBe("no_snapshots");
    const snapshots = [makeSnapshot(-2, [holding("SPACEX", TEN, 1)]), makeSnapshot(-1, [holding("SPACEX", TEN, 5)])];
    const junkRecords = [
      null,
      4,
      { assetId: id("SPACEX") },
      { assetId: id("SPACEX"), multiplierBefore: "1", multiplierAfter: 5, effectiveAt: "nope" },
      { assetId: id("SPACEX"), multiplierBefore: 0, multiplierAfter: 5, effectiveAt: at(-1) },
    ] as unknown as OnRecordAdjustment[];
    const res = evaluatePlay(RULE, ctx({ snapshots, corporateActions: junkRecords }), "prestocks");
    expect(res.complete).toBe(false);
    expect(res.proof.reason).toBe("no_adjustment_yet");
    expect(evaluatePlay(RULE, ctx({ snapshots, corporateActions: "nope" as unknown as OnRecordAdjustment[] }), "prestocks").proof.reason).toBe("no_adjustment_yet");
    const good = ctx({ snapshots, corporateActions: [record("SPACEX", 1, 5, -1)] });
    expect(evaluatePlay(RULE, good, "prestocks")).toEqual(evaluatePlay(RULE, good, "prestocks"));
  });
});

// ---------------------------------------------------------------------------
// Schema + hint
// ---------------------------------------------------------------------------

describe("multiplier_change schema and hint", () => {
  it("is the eighth rule type", () => {
    expect(PLAY_RULE_TYPES).toHaveLength(8);
    expect(PLAY_RULE_TYPES).toContain("multiplier_change");
  });

  it("PlayRuleSchema accepts the bare rule and the shared scope fields, and rejects unknown keys", () => {
    expect(PlayRuleSchema.safeParse({ type: "multiplier_change" }).success).toBe(true);
    expect(PlayRuleSchema.safeParse({ type: "multiplier_change", assetSymbols: ["SPACEX", "OPENAI"] }).success).toBe(true);
    expect(PlayRuleSchema.safeParse({ type: "multiplier_change", assetIds: [id("SPACEX")] }).success).toBe(true);
    expect(PlayRuleSchema.safeParse({ type: "multiplier_change", days: 3 }).success).toBe(false);
    expect(PlayRuleSchema.safeParse({ type: "multiplier_change", minUsd: 5 }).success).toBe(false);
    expect(PlayRuleSchema.safeParse({ type: "multiplier_change", assetIds: ["SPACEX"] }).success).toBe(false);
    // Round-trips unchanged.
    expect(PlayRuleSchema.parse({ type: "multiplier_change" })).toEqual({ type: "multiplier_change" });
  });

  it("hints with the issuer noun and never tells anyone to buy", () => {
    expect(ruleToHint(RULE, "prestocks")).toBe("Hold a pre-IPO token across an on-chain adjustment (the same raw balance, a new multiplier).");
    expect(ruleToHint(RULE, "xstocks")).toBe("Hold an xStock across an on-chain adjustment (the same raw balance, a new multiplier).");
    expect(ruleToHint(RULE)).toBe(ruleToHint(RULE, "xstocks"));
    for (const source of ["prestocks", "xstocks"]) {
      expect(ruleToHint(RULE, source)).not.toMatch(/\b(buy|purchase|share|stock|equity)\b/i);
    }
  });
});
