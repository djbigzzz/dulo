import { describe, expect, it } from "vitest";
import { evaluatePlay, type EvalContext } from "@/lib/plays/engine";
import { isPlayRule, parsePlayRule, ruleToHint, type PlayRule } from "@/lib/plays/rules";
import { PRESTOCKS_ASSET_SOURCE, PRE_IPO_SYMBOLS, SEASON0_PLAYS, activePlays, playByKey } from "@/lib/plays/catalogue";
import { HOUSE_PARTNER_SLUG } from "@/lib/plays/partners";
import { PRESTOCKS_STATIC } from "@/lib/assets/prestocks";
import type { InternalEvent } from "@/lib/core/types";

/**
 * 22 Sep: pre-IPO tokens are tradable in the virtual-cash competition, so an in-platform quest can
 * be scoped to a symbol set. The filter is the existing `assetSymbols` scope field, which every
 * rule type already accepts: on an internal_event rule it narrows the counted events to those whose
 * meta.symbol (trimmed, upper-cased) is in the list. No schema change, no EvalContext change, and a
 * rule without it counts exactly as before.
 */

const NOW = new Date("2026-09-22T12:00:00.000Z");

function ev(type: string, dayOffset: number, ref: string, meta?: Record<string, unknown>): InternalEvent {
  return { type, userId: "u1", ref, ts: new Date(Date.UTC(2026, 8, 22 + dayOffset, 12, 0, 0, 0)), meta };
}

function ctx(events: InternalEvent[]): EvalContext {
  return { now: NOW, snapshots: [], events, earnings: {}, sectorOf: () => null, underlyingOf: () => null };
}

const iso = (dayOffset: number) => new Date(Date.UTC(2026, 8, 22 + dayOffset, 12, 0, 0, 0)).toISOString();

const PRE_IPO: PlayRule = { type: "internal_event", event: "league_trade", count: 1, assetSymbols: [...PRE_IPO_SYMBOLS] };
const PRE_IPO_TRIO: PlayRule = { type: "internal_event", event: "league_trade", count: 3, distinctBy: "symbol", assetSymbols: [...PRE_IPO_SYMBOLS] };

describe("internal_event assetSymbols: the symbol set the events must belong to", () => {
  it("counts only events whose meta.symbol is in the set, case-insensitively, and completes at the count-th such event", () => {
    const events = [
      ev("league_trade", -5, "t1", { symbol: "NVDAx" }),
      ev("league_trade", -4, "t2", { symbol: "spacex" }),
      ev("league_trade", -3, "t3", { symbol: "TSLAx" }),
      ev("league_trade", -2, "t4", { symbol: " OpenAI " }),
    ];
    const res = evaluatePlay(PRE_IPO, ctx(events));
    expect(res.complete).toBe(true);
    expect(res.completedAt).toBe(iso(-4));
    expect(res.proof).toEqual({ event: "league_trade", count: 2, needed: 1, refs: ["t2", "t4"], lastAt: iso(-2), symbols: [...PRE_IPO_SYMBOLS] });
    expect(res.progress).toEqual({ current: 1, target: 1, unit: "events" });
  });

  it("three xStock trades never complete a pre-IPO-scoped quest, and events without a symbol are skipped", () => {
    const events = [
      ev("league_trade", -3, "t1", { symbol: "NVDAx" }),
      ev("league_trade", -2, "t2", { symbol: "TSLAx" }),
      ev("league_trade", -1, "t3", { symbol: "AAPLx" }),
      ev("league_trade", 0, "t4"),
      ev("league_trade", 0, "t5", { symbol: "" }),
      ev("league_trade", 0, "t6", { symbol: 42 }),
    ];
    const res = evaluatePlay(PRE_IPO, ctx(events));
    expect(res.complete).toBe(false);
    expect(res.proof).toEqual({ reason: "not_enough_events", event: "league_trade", count: 0, needed: 1, refs: [], symbols: [...PRE_IPO_SYMBOLS] });
    expect(res.progress).toEqual({ current: 0, target: 1, unit: "events" });
  });

  it("combines with distinctBy symbol: three different pre-IPO tokens, repeats and xStocks not counted", () => {
    const events = [
      ev("league_trade", -6, "t1", { symbol: "SPACEX" }),
      ev("league_trade", -5, "t2", { symbol: "SPACEX" }),
      ev("league_trade", -4, "t3", { symbol: "NVDAx" }),
      ev("league_trade", -3, "t4", { symbol: "openai" }),
      ev("league_trade", -2, "t5", { symbol: "TSLAx" }),
    ];
    const short = evaluatePlay(PRE_IPO_TRIO, ctx(events));
    expect(short.complete).toBe(false);
    expect(short.proof).toMatchObject({ reason: "not_enough_events", count: 2, needed: 3, distinctBy: "symbol", refs: ["SPACEX", "OPENAI"], symbols: [...PRE_IPO_SYMBOLS] });
    expect(short.progress).toEqual({ current: 2, target: 3, unit: "xStocks" });

    const done = evaluatePlay(PRE_IPO_TRIO, ctx([...events, ev("league_trade", -1, "t6", { symbol: "KALSHI" })]));
    expect(done.complete).toBe(true);
    expect(done.completedAt).toBe(iso(-1));
    expect(done.proof).toEqual({ event: "league_trade", count: 3, needed: 3, distinctBy: "symbol", refs: ["SPACEX", "OPENAI", "KALSHI"], lastAt: iso(-1), symbols: [...PRE_IPO_SYMBOLS] });
  });

  it("labels the distinct-symbol progress unit by the Play's issuer: xStocks by default, assets (the UI reads pre-IPO tokens) for prestocks", () => {
    const events = [ev("league_trade", -2, "t1", { symbol: "SPACEX" }), ev("league_trade", -1, "t2", { symbol: "OPENAI" })];
    expect(evaluatePlay(PRE_IPO_TRIO, ctx(events)).progress?.unit).toBe("xStocks");
    expect(evaluatePlay(PRE_IPO_TRIO, ctx(events), "xstocks").progress?.unit).toBe("xStocks");
    expect(evaluatePlay(PRE_IPO_TRIO, ctx(events), "prestocks").progress?.unit).toBe("assets");
    // Without distinctBy the unit is the event count whatever the issuer.
    expect(evaluatePlay(PRE_IPO, ctx(events), "prestocks").progress?.unit).toBe("events");
  });

  it("without assetSymbols every event of the type counts, exactly as before (no symbols key in the proof)", () => {
    const events = [ev("league_trade", -3, "t1", { symbol: "NVDAx" }), ev("league_trade", -2, "t2"), ev("league_trade", -1, "t3", { symbol: "SPACEX" })];
    const plain = evaluatePlay({ type: "internal_event", event: "league_trade", count: 3 }, ctx(events));
    expect(plain.complete).toBe(true);
    expect(plain.proof).toEqual({ event: "league_trade", count: 3, needed: 3, refs: ["t1", "t2", "t3"], lastAt: iso(-1) });
    expect("symbols" in plain.proof).toBe(false);
    // An empty list is no filter either.
    const empty = evaluatePlay({ type: "internal_event", event: "league_trade", count: 3, assetSymbols: [] }, ctx(events));
    expect(empty.complete).toBe(true);
    expect("symbols" in empty.proof).toBe(false);
  });

  it("parses on an internal_event rule (strict object: nothing else new is accepted)", () => {
    expect(parsePlayRule(PRE_IPO)).toEqual(PRE_IPO);
    expect(parsePlayRule(PRE_IPO_TRIO)).toEqual(PRE_IPO_TRIO);
    expect(isPlayRule({ type: "internal_event", event: "league_trade", count: 1, symbols: ["SPACEX"] })).toBe(false);
    expect(isPlayRule({ type: "internal_event", event: "league_trade", count: 1, source: "prestocks" })).toBe(false);
  });
});

describe("the two pre-IPO in-platform quests (22 Sep)", () => {
  const first = playByKey("first_preipo_trade")!;
  const trio = playByKey("preipo_trio")!;

  it("PRE_IPO_SYMBOLS is the PreStocks static catalogue, symbol for symbol", () => {
    expect([...PRE_IPO_SYMBOLS]).toEqual(PRESTOCKS_STATIC.map((e) => e.symbol));
    expect(PRE_IPO_SYMBOLS).toHaveLength(8);
    expect(Object.isFrozen(PRE_IPO_SYMBOLS)).toBe(true);
  });

  it("are in-platform rows under the house partner, scoped to the eight pre-IPO symbols, fenced to prestocks for the noun", () => {
    expect(first).toMatchObject({ partnerSlug: HOUSE_PARTNER_SLUG, title: "First Pre-IPO Trade", points: 50, assetSource: PRESTOCKS_ASSET_SOURCE });
    expect(first.rule).toEqual({ type: "internal_event", event: "league_trade", count: 1, assetSymbols: [...PRE_IPO_SYMBOLS] });
    expect(trio).toMatchObject({ partnerSlug: HOUSE_PARTNER_SLUG, title: "Pre-IPO Trio", points: 100, assetSource: PRESTOCKS_ASSET_SOURCE });
    expect(trio.rule).toEqual({ type: "internal_event", event: "league_trade", count: 3, distinctBy: "symbol", assetSymbols: [...PRE_IPO_SYMBOLS] });
    for (const p of [first, trio]) {
      expect(p.comingSoon).toBeUndefined();
      expect(p.desc).toMatch(/virtual cash/i);
      expect(p.desc).toMatch(/paper trades?/i);
      expect(p.desc).toMatch(/pre-IPO token/);
      expect(`${p.title} ${p.desc}`).not.toMatch(/\b(shares?|stocks?|equity|buy|purchase)\b/i);
      expect(ruleToHint(p.rule, p.assetSource)).not.toMatch(/xStock/);
    }
    expect(ruleToHint(trio.rule, trio.assetSource)).toBe("Place paper trades in 3 different pre-IPO tokens.");
  });

  it("complete on pre-IPO paper trades only", () => {
    const xstocks = [ev("league_trade", -3, "t1", { symbol: "NVDAx" }), ev("league_trade", -2, "t2", { symbol: "TSLAx" }), ev("league_trade", -1, "t3", { symbol: "AAPLx" })];
    expect(evaluatePlay(first.rule, ctx(xstocks), first.assetSource).complete).toBe(false);
    expect(evaluatePlay(trio.rule, ctx(xstocks), trio.assetSource).complete).toBe(false);

    const one = [...xstocks, ev("league_trade", 0, "t4", { symbol: "SPACEX" })];
    expect(evaluatePlay(first.rule, ctx(one), first.assetSource)).toMatchObject({ complete: true, completedAt: iso(0) });
    expect(evaluatePlay(trio.rule, ctx(one), trio.assetSource).progress).toEqual({ current: 1, target: 3, unit: "assets" });

    const three = [...one, ev("league_trade", 0, "t5", { symbol: "ANTHROPIC" }), ev("league_trade", 0, "t6", { symbol: "SPACEX" }), ev("league_trade", 0, "t7", { symbol: "FIGUREAI" })];
    expect(evaluatePlay(trio.rule, ctx(three), trio.assetSource).complete).toBe(true);
  });

  it("every other internal_event quest is unchanged: no symbol scope, same rule JSON as 16 Sep", () => {
    const others = SEASON0_PLAYS.filter((p) => p.rule.type === "internal_event" && !["first_preipo_trade", "preipo_trio"].includes(p.key));
    expect(others.map((p) => p.key)).toEqual(["oracle", "scout", "three_predictions", "paper_portfolio", "ten_paper_trades", "paper_portfolio_five", "game_days", "five_predictions"]);
    for (const p of others) {
      expect("assetSymbols" in p.rule, p.key).toBe(false);
      expect(p.assetSource, p.key).toBeUndefined();
    }
    // The in-platform group is now ten quests worth 1,000 points; nothing on-chain moved.
    const inPlatform = activePlays().filter((p) => p.partnerSlug === HOUSE_PARTNER_SLUG);
    expect(inPlatform).toHaveLength(10);
    expect(inPlatform.reduce((n, p) => n + p.points, 0)).toBe(1000);
    expect(activePlays().filter((p) => p.partnerSlug !== HOUSE_PARTNER_SLUG).reduce((n, p) => n + p.points, 0)).toBe(2950);
  });
});
