import { describe, expect, it } from "vitest";
import {
  CALENDAR_KEYS,
  DISTINCT_BY_KEYS,
  INTERNAL_EVENT_TYPES,
  PLAY_RULE_TYPES,
  PlayRuleError,
  PlayRuleSchema,
  calendarDatesFor,
  earningsDatesFor,
  getCalendar,
  isPlayRule,
  parsePlayRule,
  ruleToHint,
  safeParsePlayRule,
  type PlayRule,
} from "@/lib/plays/rules";
import { SEASON0_ASSET_SOURCE, SEASON0_BADGE_KEYS, SEASON0_PLAYS, activePlays, playAssetSource, playByKey } from "@/lib/plays/catalogue";
import { evaluatePlay, type EvalContext } from "@/lib/plays/engine";
import {
  HIDDEN_PARTNER_SLUGS,
  HOUSE_PARTNER_SLUG,
  SEASON0,
  SEASON0_ID,
  SEASON0_PARTNERS,
  campaignIdFor,
  isListedPartnerSlug,
  partnerBySlug,
} from "@/lib/plays/partners";
import { SOLANA_MAINNET, type AssetId } from "@/lib/core/caip";
import { RETIRED_PLACEHOLDERS, leagueWeekFor, pruneRetiredPlaceholders, type PruneDb } from "../prisma/seed";

const TSLAX_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
// The schema's isAssetId refine narrows assetIds / partnerAssetIds to AssetId, hence the casts.
const TSLAX_ID = `${SOLANA_MAINNET}/token:${TSLAX_MINT}` as AssetId;
const NVDAX_ID = `${SOLANA_MAINNET}/token:Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` as AssetId;

describe("PlayRuleSchema — catalogue", () => {
  it("every Season 0 catalogue rule validates and round-trips unchanged", () => {
    for (const play of SEASON0_PLAYS) {
      const parsed = parsePlayRule(play.rule);
      expect(parsed, play.key).toEqual(play.rule);
      expect(isPlayRule(play.rule), play.key).toBe(true);
      expect(safeParsePlayRule(play.rule), play.key).toEqual(play.rule);
    }
  });

  /**
   * multiplier_change (the eighth type, 22 Sep) has an engine, a schema and tests
   * (tests/multiplier-change.test.ts) and, since the same day, one catalogue row: held_through_split
   * (Held Through a Split, PreStocks). Every rule type has a row again.
   */
  it("covers every rule type at least once across the catalogue", () => {
    const seen = new Set(SEASON0_PLAYS.map((p) => p.rule.type));
    for (const t of PLAY_RULE_TYPES) expect(seen.has(t), t).toBe(true);
    expect(PLAY_RULE_TYPES).toHaveLength(8);
    expect(SEASON0_PLAYS.filter((p) => p.rule.type === "multiplier_change").map((p) => p.key)).toEqual(["held_through_split"]);
  });

  it("matches HANDOFF §3.1 keys, points and badges", () => {
    const expected: Array<[string, number, string | undefined, PlayRule["type"]]> = [
      ["first_position", 100, "first_position", "hold_any"],
      ["diversified", 250, undefined, "diversified"],
      ["diamond_hands", 300, "diamond_hands", "hold_consecutive"],
      ["dca_streak", 300, undefined, "net_increase_days"],
      ["earnings_holder", 400, "earnings_holder", "hold_through_date"],
      ["mirror", 500, "mirror", "mirror_match"],
      ["scout", 50, undefined, "internal_event"],
      ["oracle", 50, undefined, "internal_event"],
      ["kamino_collateral", 300, undefined, "hold_any"],
      ["jupiter_dca", 200, undefined, "hold_any"],
    ];
    for (const [key, points, badgeKey, type] of expected) {
      const play = playByKey(key);
      expect(play, key).toBeDefined();
      expect(play!.points, key).toBe(points);
      expect(play!.badgeKey, key).toBe(badgeKey);
      expect(play!.rule.type, key).toBe(type);
    }
    expect(playByKey("first_position")!.rule).toEqual({ type: "hold_any", minUsd: 5 });
    expect(playByKey("diversified")!.rule).toEqual({ type: "diversified", minAssets: 3, minSectors: 2 });
    expect(playByKey("diamond_hands")!.rule).toEqual({ type: "hold_consecutive", days: 7 });
    expect(playByKey("dca_streak")!.rule).toEqual({ type: "net_increase_days", count: 3, window: 14 });
    expect(playByKey("earnings_holder")!.rule).toEqual({ type: "hold_through_date", calendarKey: "earnings" });
    expect(playByKey("mirror")!.rule).toEqual({ type: "mirror_match", tolerance: 0.2 });
    expect(playByKey("scout")!.rule).toEqual({ type: "internal_event", event: "league_trade", count: 3 });
    expect(playByKey("oracle")!.rule).toEqual({ type: "internal_event", event: "call_placed", count: 1 });
  });

  it("has unique keys, positive integer points and known partners", () => {
    const keys = SEASON0_PLAYS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of SEASON0_PLAYS) {
      expect(Number.isInteger(p.points) && p.points > 0, p.key).toBe(true);
      expect(partnerBySlug(p.partnerSlug), p.key).toBeDefined();
      expect(p.campaignTitle).toBe(partnerBySlug(p.partnerSlug)!.campaign.title);
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.desc.length).toBeGreaterThan(0);
      // Vocabulary is binding. Quest is the public noun since 16 Sep; mission and task stay out.
      expect(`${p.title} ${p.desc}`.toLowerCase()).not.toMatch(/\b(mission|task)s?\b/);
    }
    expect(SEASON0_ASSET_SOURCE).toBe("xstocks");
  });

  it("keeps comingSoon out of the rule JSON and pairs it with empty partnerAssetIds", () => {
    const coming = SEASON0_PLAYS.filter((p) => p.comingSoon);
    expect(coming.map((p) => p.key).sort()).toEqual(["jupiter_dca", "kamino_collateral"]);
    for (const p of coming) {
      expect("comingSoon" in p.rule).toBe(false);
      expect(p.rule).toEqual({ type: "hold_any", minUsd: 1, partnerAssetIds: [] });
      // The bare-mint key is gone from every catalogue row.
      expect("partnerMints" in p.rule).toBe(false);
    }
    expect(activePlays().map((p) => p.key)).toEqual([
      "first_position",
      "diversified",
      "diamond_hands",
      "dca_streak",
      "earnings_holder",
      "mirror",
      "thousand_club",
      "index_holder",
      "sector_spread",
      "pre_ipo_position",
      "held_through_split",
      "oracle",
      "scout",
      "three_predictions",
      "paper_portfolio",
      "ten_paper_trades",
      "paper_portfolio_five",
      "game_days",
      "five_predictions",
      "first_preipo_trade",
      "preipo_trio",
    ]);
  });

  it("is the 23-row quest catalogue: 10 in-platform, 11 on-chain (9 xStocks + 2 PreStocks), 2 partner quests coming soon", () => {
    expect(SEASON0_PLAYS).toHaveLength(23);
    const live = activePlays();
    const inPlatform = live.filter((p) => p.rule.type === "internal_event");
    const onChain = live.filter((p) => p.rule.type !== "internal_event");
    expect(inPlatform).toHaveLength(10);
    expect(onChain).toHaveLength(11);
    // 22 Sep: +50 First Pre-IPO Trade, +100 Pre-IPO Trio (850 -> 1,000).
    expect(inPlatform.reduce((n, p) => n + p.points, 0)).toBe(1000);
    expect(onChain.reduce((n, p) => n + p.points, 0)).toBe(2950);
    // Every in-platform quest files under the hidden house Partner; every live on-chain quest under an
    // issuer Partner, and its fence (Play.assetSource) is that issuer's AssetSource name.
    for (const p of inPlatform) expect(p.partnerSlug, p.key).toBe(HOUSE_PARTNER_SLUG);
    for (const p of onChain) {
      expect(["xstocks", "prestocks"], p.key).toContain(p.partnerSlug);
      expect(playAssetSource(p), p.key).toBe(p.partnerSlug);
    }
    expect(onChain.filter((p) => p.partnerSlug === "xstocks")).toHaveLength(9);
    expect(onChain.filter((p) => p.partnerSlug === "prestocks").map((p) => p.key)).toEqual(["pre_ipo_position", "held_through_split"]);
    // Every internal_event the catalogue reads is a known event name.
    for (const p of SEASON0_PLAYS) {
      if (p.rule.type === "internal_event") expect(INTERNAL_EVENT_TYPES as readonly string[], p.key).toContain(p.rule.event);
    }
  });

  it("keeps the xStocks sortOrders and titles unchanged", () => {
    const xstocks = SEASON0_PLAYS.filter((p) => p.partnerSlug === "xstocks").map((p) => [p.key, p.sortOrder, p.title]);
    expect(xstocks).toEqual([
      ["first_position", 0, "First Position"],
      ["diversified", 1, "Diversified"],
      ["diamond_hands", 2, "Diamond Hands"],
      ["dca_streak", 3, "Steady Buyer"],
      ["earnings_holder", 4, "Earnings Holder"],
      ["mirror", 5, "Portfolio Match"],
      ["thousand_club", 6, "Thousand Club"],
      ["index_holder", 7, "Index Holder"],
      ["sector_spread", 8, "Sector Spread"],
    ]);
  });

  /** The five in-platform quests added on 16 Sep, pinned row by row (titles, points, rules, order). */
  it("adds five in-platform quests on the distinctBy engine path, badge-free", () => {
    const added: Array<[string, string, number, number, PlayRule]> = [
      ["three_predictions", "Three Predictions", 75, 2, { type: "internal_event", event: "call_placed", count: 3, distinctBy: "ref" }],
      ["paper_portfolio", "Paper Portfolio", 75, 3, { type: "internal_event", event: "league_trade", count: 3, distinctBy: "symbol" }],
      ["paper_portfolio_five", "Five-Stock Paper Portfolio", 150, 5, { type: "internal_event", event: "league_trade", count: 5, distinctBy: "symbol" }],
      ["game_days", "Three Game Days", 150, 6, { type: "internal_event", event: "game_action", count: 3, distinctBy: "day" }],
      ["five_predictions", "Five Predictions", 150, 7, { type: "internal_event", event: "call_placed", count: 5, distinctBy: "ref" }],
    ];
    for (const [key, title, points, sortOrder, rule] of added) {
      const play = playByKey(key);
      expect(play, key).toBeDefined();
      expect(play!.title, key).toBe(title);
      expect(play!.points, key).toBe(points);
      expect(play!.sortOrder, key).toBe(sortOrder);
      expect(play!.rule, key).toEqual(rule);
      expect(play!.partnerSlug, key).toBe(HOUSE_PARTNER_SLUG);
      expect(play!.badgeKey, key).toBeUndefined();
      expect(play!.comingSoon, key).toBeUndefined();
    }
    expect(playByKey("three_predictions")!.desc).toBe(
      "Make predictions on three different questions. Your starter points cover it, and both sides of one question count once.",
    );
    expect(playByKey("paper_portfolio")!.desc).toBe("Place paper trades in three different xStocks. Virtual cash only, and sells count too.");
    expect(playByKey("paper_portfolio_five")!.desc).toBe("Place paper trades in five different xStocks. Virtual cash only, and trades from any week count.");
    expect(playByKey("game_days")!.desc).toBe("Be active on three different days (UTC). A paper trade or a new prediction counts for that day.");
    expect(playByKey("five_predictions")!.desc).toBe(
      "Make predictions on five different questions. New questions open every week, and both sides of one question count once.",
    );
  });

  it("exposes the four badge keys", () => {
    expect([...SEASON0_BADGE_KEYS].sort()).toEqual(["diamond_hands", "earnings_holder", "first_position", "mirror"]);
    // The 16 Sep catalogue rows ship badge-free, so the badge set stays exactly these four.
    expect(SEASON0_BADGE_KEYS).toHaveLength(4);
  });

  /**
   * Four rewards added on 16 Sep as catalogue rows only: existing rule types, no badge, no engine
   * or schema change. Each one's rule is pinned here so the row cannot drift from what it claims.
   */
  it("adds four catalogue-only rewards on rule types the engine already has", () => {
    const added: Array<[string, number, string, PlayRule]> = [
      ["thousand_club", 300, "xstocks", { type: "hold_any", minUsd: 1000 }],
      ["index_holder", 150, "xstocks", { type: "hold_any", minUsd: 5, assetSymbols: ["SPYx", "QQQx", "VOOx", "VTIx"] }],
      ["sector_spread", 400, "xstocks", { type: "diversified", minAssets: 5, minSectors: 4 }],
      ["ten_paper_trades", 150, HOUSE_PARTNER_SLUG, { type: "internal_event", event: "league_trade", count: 10 }],
    ];
    for (const [key, points, partnerSlug, rule] of added) {
      const play = playByKey(key);
      expect(play, key).toBeDefined();
      expect(play!.points, key).toBe(points);
      expect(play!.partnerSlug, key).toBe(partnerSlug);
      expect(play!.rule, key).toEqual(rule);
      expect(play!.badgeKey, key).toBeUndefined();
      expect(play!.comingSoon, key).toBeUndefined();
      // No new rule type: the engine and the schema are untouched by these rows.
      expect(PLAY_RULE_TYPES, key).toContain(play!.rule.type);
    }
  });

  /**
   * Index Holder is scoped by assetSymbols, and rules.ts documents that field as a display
   * convenience ("symbols are never used to select holdings"). The ENGINE disagrees: scopeOf
   * selects on the holding's symbol, upper-cased on both sides. That behaviour is what the row
   * relies on, so it is pinned here rather than left to a stale comment.
   */
  it("Index Holder is really scoped by symbol, case-insensitively", () => {
    const rule = playByKey("index_holder")!.rule;
    const takenAt = new Date("2026-09-16T12:00:00.000Z");
    const ctx = (symbol: string) =>
      ({
        now: takenAt,
        // The assetId is deliberately the same every time: this rule keys on the SYMBOL.
        snapshots: [
          {
            walletId: "w1",
            takenAt,
            holdings: [{ assetId: TSLAX_ID, symbol, raw: "100000000", multiplier: 1, qty: 1, price: 600, priceSource: "jupiter", usd: 600 }],
          },
        ],
        events: [],
        earnings: {},
        sectorOf: () => null,
        underlyingOf: () => null,
      }) as unknown as EvalContext;

    for (const symbol of ["SPYx", "spyx", "QQQX", "VOOx", "VTIx"]) {
      expect(evaluatePlay(rule, ctx(symbol)).complete, symbol).toBe(true);
    }
    const out = evaluatePlay(rule, ctx("TSLAx"));
    expect(out.complete).toBe(false);
    expect(out.proof.reason).toBe("no_in_scope_holding");
  });
});

describe("PlayRuleSchema — rejects bad rules", () => {
  const bad: Array<[string, unknown]> = [
    ["unknown type", { type: "hodl", minUsd: 5 }],
    ["missing discriminator", { minUsd: 5 }],
    ["not an object", "hold_any"],
    ["null", null],
    ["negative minUsd", { type: "hold_any", minUsd: -1 }],
    ["NaN minUsd", { type: "hold_any", minUsd: Number.NaN }],
    ["unknown key (strict)", { type: "hold_any", minUsd: 5, comingSoon: true }],
    ["typo key (strict)", { type: "hold_any", minUSD: 5 }],
    ["zero days", { type: "hold_consecutive", days: 0 }],
    ["fractional days", { type: "hold_consecutive", days: 2.5 }],
    ["window < count", { type: "net_increase_days", count: 5, window: 3 }],
    ["unknown calendar", { type: "hold_through_date", calendarKey: "dividends" }],
    ["minSectors > minAssets", { type: "diversified", minAssets: 2, minSectors: 3 }],
    ["tolerance > 1", { type: "mirror_match", tolerance: 1.5 }],
    ["tolerance < 0", { type: "mirror_match", tolerance: -0.1 }],
    ["event not snake_case", { type: "internal_event", event: "League Trade", count: 1 }],
    ["zero count", { type: "internal_event", event: "league_trade", count: 0 }],
    ["empty symbol", { type: "hold_any", minUsd: 1, assetSymbols: [""] }],
    ["empty partner asset id", { type: "hold_any", minUsd: 1, partnerAssetIds: [""] }],
    ["bare mint as partner asset id", { type: "hold_any", minUsd: 1, partnerAssetIds: [TSLAX_MINT] }],
    ["empty asset id", { type: "hold_any", minUsd: 1, assetIds: [""] }],
    ["bare mint as asset id", { type: "hold_any", minUsd: 1, assetIds: [TSLAX_MINT] }],
    ["symbol as asset id", { type: "hold_any", minUsd: 1, assetIds: ["TSLAx"] }],
    ["chain id only as asset id", { type: "hold_any", minUsd: 1, assetIds: [SOLANA_MAINNET] }],
    ["legacy partnerMints key (strict)", { type: "hold_any", minUsd: 1, partnerMints: [] }],
  ];

  for (const [label, rule] of bad) {
    it(`fails: ${label}`, () => {
      expect(PlayRuleSchema.safeParse(rule).success).toBe(false);
      expect(isPlayRule(rule)).toBe(false);
      expect(safeParsePlayRule(rule)).toBeNull();
      expect(() => parsePlayRule(rule)).toThrow(PlayRuleError);
    });
  }

  it("throws a readable message with issues attached", () => {
    try {
      parsePlayRule({ type: "mirror_match", tolerance: 2 });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PlayRuleError);
      const err = e as PlayRuleError;
      expect(err.message).toMatch(/Invalid Play rule/);
      expect(err.message).toMatch(/tolerance/);
      expect(err.issues.length).toBeGreaterThan(0);
    }
  });

  it("accepts optional scope fields", () => {
    expect(parsePlayRule({ type: "hold_any", minUsd: 0, assetSymbols: ["TSLAx", "NVDAx"] })).toEqual({
      type: "hold_any",
      minUsd: 0,
      assetSymbols: ["TSLAx", "NVDAx"],
    });
    expect(parsePlayRule({ type: "hold_any", minUsd: 1, partnerAssetIds: [TSLAX_ID] }).partnerAssetIds).toEqual([TSLAX_ID]);
    expect(parsePlayRule({ type: "hold_consecutive", days: 7, minUsd: 10, assetSymbols: ["NVDAx"] }).type).toBe(
      "hold_consecutive",
    );
  });

  it("accepts distinctBy ref, symbol and day on internal_event rules, and nothing else", () => {
    expect(DISTINCT_BY_KEYS).toEqual(["ref", "symbol", "day"]);
    for (const distinctBy of DISTINCT_BY_KEYS) {
      const rule = { type: "internal_event", event: "call_placed", count: 3, distinctBy };
      expect(parsePlayRule(rule), distinctBy).toEqual(rule);
    }
    // Absent is the pre-16 Sep shape and still parses unchanged (no default is added).
    expect(parsePlayRule({ type: "internal_event", event: "league_trade", count: 3 })).toEqual({ type: "internal_event", event: "league_trade", count: 3 });
    for (const distinctBy of ["week", "", "REF", "Symbol", 1, null, true, ["day"]]) {
      const rule = { type: "internal_event", event: "call_placed", count: 3, distinctBy };
      expect(isPlayRule(rule), JSON.stringify(distinctBy)).toBe(false);
      expect(() => parsePlayRule(rule), JSON.stringify(distinctBy)).toThrow(PlayRuleError);
    }
    // distinctBy is an internal_event field only (strict objects elsewhere).
    expect(isPlayRule({ type: "hold_any", minUsd: 5, distinctBy: "day" })).toBe(false);
    expect(isPlayRule({ type: "diversified", minAssets: 3, minSectors: 2, distinctBy: "symbol" })).toBe(false);
  });

  it("lists game_action as an internal event type", () => {
    expect(INTERNAL_EVENT_TYPES).toEqual(["league_trade", "call_placed", "mirror_executed", "game_action"]);
    expect(isPlayRule({ type: "internal_event", event: "game_action", count: 3, distinctBy: "day" })).toBe(true);
  });

  it("scopes by CAIP-19 assetIds, with assetSymbols as an optional display convenience", () => {
    const scoped = parsePlayRule({ type: "hold_any", minUsd: 1, assetIds: [TSLAX_ID, NVDAX_ID] });
    expect(scoped.assetIds).toEqual([TSLAX_ID, NVDAX_ID]);
    expect(scoped.assetSymbols).toBeUndefined();
    const withSymbols = parsePlayRule({
      type: "hold_consecutive",
      days: 7,
      assetIds: [` ${NVDAX_ID} `],
      assetSymbols: ["NVDAx"],
    });
    expect(withSymbols.assetIds).toEqual([NVDAX_ID]); // trimmed
    expect(withSymbols.assetSymbols).toEqual(["NVDAx"]);
    // Every rule type accepts the scope fields.
    for (const rule of [
      { type: "net_increase_days", count: 1, window: 1, assetIds: [TSLAX_ID] },
      { type: "hold_through_date", calendarKey: "earnings", assetIds: [TSLAX_ID] },
      { type: "diversified", minAssets: 1, minSectors: 1, assetIds: [TSLAX_ID] },
      { type: "mirror_match", tolerance: 0.1, partnerAssetIds: [TSLAX_ID] },
      { type: "internal_event", event: "league_trade", count: 1, assetIds: [TSLAX_ID] },
    ]) {
      expect(isPlayRule(rule), rule.type).toBe(true);
    }
  });
});

describe("ruleToHint", () => {
  const cases: Array<[PlayRule, RegExp[]]> = [
    [{ type: "hold_any", minUsd: 5 }, [/hold any xstock/i, /\$5\+/]],
    [{ type: "hold_any", minUsd: 0 }, [/hold any xstock\.$/i]],
    [{ type: "hold_any", minUsd: 2.5, assetSymbols: ["TSLAx"] }, [/TSLAx/, /\$2\.50\+/]],
    [{ type: "hold_any", minUsd: 1, assetSymbols: ["TSLAx", "NVDAx"] }, [/TSLAx or NVDAx/]],
    [{ type: "hold_any", minUsd: 1, partnerAssetIds: [] }, [/partner position/i, /pending/i]],
    [{ type: "hold_any", minUsd: 1, partnerAssetIds: [TSLAX_ID] }, [/partner position/i]],
    [{ type: "hold_any", minUsd: 1, assetIds: [TSLAX_ID] }, [/a selected xStock/]],
    [{ type: "hold_any", minUsd: 1, assetIds: [TSLAX_ID, NVDAX_ID] }, [/one of 2 selected xStocks/]],
    [{ type: "hold_any", minUsd: 1, assetIds: [TSLAX_ID], assetSymbols: ["TSLAx"] }, [/Hold TSLAx/]],
    [{ type: "hold_consecutive", days: 7 }, [/7 daily snapshots/i, /in a row/i]],
    [{ type: "hold_consecutive", days: 1 }, [/1 daily snapshot in a row/i]],
    [{ type: "net_increase_days", count: 3, window: 14 }, [/3 separate days/i, /14 days/i]],
    [{ type: "hold_through_date", calendarKey: "earnings" }, [/through an earnings date/i]],
    [{ type: "diversified", minAssets: 3, minSectors: 2 }, [/3 xStocks/i, /2 sectors/i]],
    [{ type: "mirror_match", tolerance: 0.2 }, [/copy a wallet's portfolio/i, /20%/]],
    [{ type: "internal_event", event: "league_trade", count: 3 }, [/3 paper trades/]],
    [{ type: "internal_event", event: "call_placed", count: 1 }, [/1 prediction\./]],
    [{ type: "internal_event", event: "some_new_thing", count: 2 }, [/some new things/]],
    [{ type: "internal_event", event: "call_placed", count: 3, distinctBy: "ref" }, [/^Make predictions on 3 different questions\.$/]],
    [{ type: "internal_event", event: "league_trade", count: 3, distinctBy: "symbol" }, [/^Place paper trades in 3 different xStocks\.$/]],
    [{ type: "internal_event", event: "game_action", count: 3, distinctBy: "day" }, [/^Be active on 3 different days \(UTC\)\.$/]],
    [{ type: "internal_event", event: "game_action", count: 2 }, [/^Place 2 paper trades or new predictions\.$/]],
    [{ type: "internal_event", event: "game_action", count: 1 }, [/^Place 1 paper trade or new prediction\.$/]],
    [{ type: "internal_event", event: "league_trade", count: 2, distinctBy: "day" }, [/^Place a paper trade on 2 different days \(UTC\)\.$/]],
    [{ type: "internal_event", event: "some_new_thing", count: 2, distinctBy: "ref" }, [/some new things on 2 different items/]],
  ];

  for (const [rule, patterns] of cases) {
    it(`${rule.type}: ${JSON.stringify(rule)}`, () => {
      const hint = ruleToHint(rule);
      expect(hint.length).toBeGreaterThan(0);
      expect(hint.length).toBeLessThan(120);
      for (const p of patterns) expect(hint).toMatch(p);
    });
  }

  it("produces a hint for every catalogue Play", () => {
    for (const p of SEASON0_PLAYS) expect(ruleToHint(p.rule).length, p.key).toBeGreaterThan(10);
  });
});

describe("earnings calendar", () => {
  it("carries a verified (not estimated) note, its sources and an asOf date", () => {
    const cal = getCalendar("earnings");
    expect(cal.note.length).toBeGreaterThan(0);
    expect(cal.note).not.toMatch(/estimat/i);
    expect(cal.note).toMatch(/_sources/);
    expect(cal.asOf).toBe("2026-09-14");
    expect(CALENDAR_KEYS).toEqual(["earnings"]);
  });

  it("covers the required tickers with ISO dates in the rest of 2026", () => {
    const required = ["NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "COIN", "MSTR", "HOOD", "PLTR", "AMD", "NFLX", "AVGO", "CRCL"];
    // In-window reporters (M13): the exact dates are asserted in tests/earnings.test.ts.
    required.push("LEN", "AZO", "GIS", "CTAS", "PAYX", "DRI", "MU", "ACN", "NKE");
    const cal = getCalendar("earnings");
    for (const t of required) {
      const dates = cal.dates[t];
      expect(dates, t).toBeDefined();
      expect(dates.length, t).toBeGreaterThan(0);
    }
    for (const [ticker, dates] of Object.entries(cal.dates)) {
      for (const d of dates) {
        expect(d, ticker).toMatch(/^2026-\d{2}-\d{2}$/);
        expect(d >= cal.asOf, `${ticker} ${d} is before asOf`).toBe(true);
        expect(Number.isNaN(Date.parse(`${d}T00:00:00Z`)), ticker).toBe(false);
      }
      expect([...dates].sort()).toEqual(dates);
    }
    // NVDA reports mid/late November; TSLA in late October.
    expect(cal.dates.NVDA[0]).toMatch(/^2026-11-(1[5-9]|2[0-9])$/);
    expect(cal.dates.TSLA[0]).toMatch(/^2026-10-(1[5-9]|2[0-9])$/);
  });

  it("resolves by underlying ticker or xStocks symbol", () => {
    expect(earningsDatesFor("NVDA")).toEqual(getCalendar("earnings").dates.NVDA);
    expect(earningsDatesFor("NVDAx")).toEqual(getCalendar("earnings").dates.NVDA);
    expect(earningsDatesFor(" tsla ")).toEqual(getCalendar("earnings").dates.TSLA);
    expect(calendarDatesFor("earnings", "SPY")).toEqual([]);
    expect(earningsDatesFor("NOPE")).toEqual([]);
    // Multi-date tickers stay sorted.
    expect(earningsDatesFor("MU").length).toBeGreaterThan(1);
  });
});

describe("Season 0 partners", () => {
  it("defines Season 0 per HANDOFF", () => {
    expect(SEASON0_ID).toBe("season-0");
    expect(SEASON0.name).toBe("Stocks Season");
    expect(SEASON0.chainScope).toEqual([SOLANA_MAINNET]);
    expect(new Date(SEASON0.startsAt).toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(new Date(SEASON0.endsAt).toISOString()).toBe("2026-12-31T23:59:59.000Z");
  });

  it("seeds four listed partners (PreStocks since 22 Sep) plus the hidden house partner, one campaign each, no placeholders", () => {
    expect(SEASON0_PARTNERS.map((p) => p.slug)).toEqual(["xstocks", "prestocks", "jupiter", "kamino", "dulo"]);
    expect(SEASON0_PARTNERS.filter((p) => isListedPartnerSlug(p.slug)).map((p) => p.slug)).toEqual(["xstocks", "prestocks", "jupiter", "kamino"]);
    expect(new Set(SEASON0_PARTNERS.map((p) => p.sortOrder)).size).toBe(SEASON0_PARTNERS.length);
    for (const p of SEASON0_PARTNERS) {
      expect(`${p.name} ${p.blurb} ${p.campaign.title}`).not.toMatch(/stocklana builder|listing pending/i);
      expect(p.campaign.id).toBe(campaignIdFor(p.slug));
      expect(p.campaign.id).toBe(`camp-${p.slug}-season-0`);
      expect(p.campaign.title).toContain("Stocks Season");
      expect(p.chainIds).toEqual([SOLANA_MAINNET]);
      expect(p.blurb.length).toBeGreaterThan(0);
      for (const url of Object.values(p.links)) expect(url).toMatch(/^https:\/\//);
    }
    expect(partnerBySlug("xstocks")!.links).toEqual({
      website: "https://xstocks.fi",
      x: "https://x.com/xStocksFi",
      docs: "https://docs.xstocks.fi",
    });
    expect(partnerBySlug("jupiter")!.links.docs).toBe("https://dev.jup.ag");
    expect(partnerBySlug("kamino")!.links.x).toBe("https://x.com/KaminoFinance");
    // M-N: no claim that Dulo reads a Kamino position from the wallet itself.
    expect(partnerBySlug("kamino")!.blurb).toContain("will read your Kamino xStocks position from Kamino's public API");
    expect(partnerBySlug("kamino")!.blurb).not.toMatch(/straight from your wallet/i);
    expect(playByKey("kamino_collateral")!.desc).not.toMatch(/in your wallet/i);
    expect(partnerBySlug("stocklana-builder-1")).toBeUndefined();
    expect(partnerBySlug("stocklana-builder-2")).toBeUndefined();
  });

  it("files Scout and Oracle under the hidden 'Dulo games' house campaign; Mirror stays under xStocks", () => {
    const house = partnerBySlug(HOUSE_PARTNER_SLUG)!;
    expect(HOUSE_PARTNER_SLUG).toBe("dulo");
    expect(house).toMatchObject({ name: "Dulo games", hidden: true, links: {} });
    expect(house.campaign).toEqual({ id: "camp-dulo-season-0", title: "Dulo games · Stocks Season" });
    expect(HIDDEN_PARTNER_SLUGS).toEqual(["dulo"]);
    expect(isListedPartnerSlug("dulo")).toBe(false);
    expect(isListedPartnerSlug("xstocks")).toBe(true);
    expect(SEASON0_PARTNERS.filter((p) => p.hidden).map((p) => p.slug)).toEqual(["dulo"]);

    const housePlays = SEASON0_PLAYS.filter((p) => p.partnerSlug === HOUSE_PARTNER_SLUG);
    // Every in-platform quest files under the same hidden house Partner, in this order.
    expect(housePlays.map((p) => p.key)).toEqual([
      "oracle",
      "scout",
      "three_predictions",
      "paper_portfolio",
      "ten_paper_trades",
      "paper_portfolio_five",
      "game_days",
      "five_predictions",
      "first_preipo_trade",
      "preipo_trio",
    ]);
    expect(housePlays.map((p) => p.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const p of housePlays) expect(p.campaignTitle).toBe("Dulo games · Stocks Season");
    expect(playByKey("mirror")).toMatchObject({ partnerSlug: "xstocks", campaignTitle: "xStocks · Stocks Season" });
    expect(SEASON0_PLAYS.some((p) => p.key.startsWith("stocklana_builder"))).toBe(false);
  });

  it("Scout copy does not promise a weekly window: the engine counts League trades from every week", () => {
    expect(playByKey("scout")!.desc).toBe("Place three paper trades in the weekly competition. Virtual cash, real xStock prices, no real money.");
    expect(playByKey("scout")!.desc).not.toMatch(/this week/i);
  });

  it("every Play's partner has a campaign the seed can attach it to", () => {
    for (const play of SEASON0_PLAYS) {
      expect(campaignIdFor(play.partnerSlug)).toBe(partnerBySlug(play.partnerSlug)!.campaign.id);
    }
  });
});

describe("seed — League week", () => {
  const iso = (d: Date) => d.toISOString();

  it("spans Monday 00:00 UTC to Friday 20:00 UTC of the week containing now", () => {
    for (const now of ["2026-09-14T00:00:00Z", "2026-09-14T09:30:00Z", "2026-09-16T12:00:00Z", "2026-09-18T19:59:59Z"]) {
      const w = leagueWeekFor(new Date(now));
      expect(iso(w.weekStart), now).toBe("2026-09-14T00:00:00.000Z");
      expect(iso(w.weekEnd), now).toBe("2026-09-18T20:00:00.000Z");
      expect(w.rolledForward, now).toBe(false);
    }
  });

  it("rolls forward to next week once Friday 20:00 UTC has passed (weekend seed)", () => {
    for (const now of ["2026-09-18T20:00:00Z", "2026-09-19T03:00:00Z", "2026-09-20T23:59:59Z"]) {
      const w = leagueWeekFor(new Date(now));
      expect(iso(w.weekStart), now).toBe("2026-09-21T00:00:00.000Z");
      expect(iso(w.weekEnd), now).toBe("2026-09-25T20:00:00.000Z");
      expect(w.rolledForward, now).toBe(true);
    }
  });

  it("handles the year boundary", () => {
    const thu = leagueWeekFor(new Date("2026-12-31T12:00:00Z"));
    expect(iso(thu.weekStart)).toBe("2026-12-28T00:00:00.000Z");
    expect(iso(thu.weekEnd)).toBe("2027-01-01T20:00:00.000Z");
    const sun = leagueWeekFor(new Date("2027-01-03T12:00:00Z"));
    expect(iso(sun.weekStart)).toBe("2027-01-04T00:00:00.000Z");
    expect(sun.rolledForward).toBe(true);
  });
});

describe("seed — retired placeholder prune (M-M)", () => {
  function stubDb(counts: { play: number; campaign: number; partner: number }) {
    const calls: Array<[string, unknown]> = [];
    const db: PruneDb = {
      play: { deleteMany: async (args) => (calls.push(["play", args]), { count: counts.play }) },
      campaign: { deleteMany: async (args) => (calls.push(["campaign", args]), { count: counts.campaign }) },
      partner: { deleteMany: async (args) => (calls.push(["partner", args]), { count: counts.partner }) },
    };
    return { db, calls };
  }

  it("targets exactly the two known placeholders, children first, and none of the current catalogue", async () => {
    const { db, calls } = stubDb({ play: 2, campaign: 2, partner: 2 });
    const rows = await pruneRetiredPlaceholders(db);
    expect(calls).toEqual([
      ["play", { where: { key: { in: ["stocklana_builder_1", "stocklana_builder_2"] } } }],
      ["campaign", { where: { id: { in: ["camp-stocklana-builder-1-season-0", "camp-stocklana-builder-2-season-0"] } } }],
      ["partner", { where: { slug: { in: ["stocklana-builder-1", "stocklana-builder-2"] } } }],
    ]);
    expect(RETIRED_PLACEHOLDERS.campaignIds).toEqual(RETIRED_PLACEHOLDERS.partnerSlugs.map((s) => campaignIdFor(s)));
    // Never prunes anything the seed still writes.
    for (const key of RETIRED_PLACEHOLDERS.playKeys) expect(playByKey(key)).toBeUndefined();
    for (const slug of RETIRED_PLACEHOLDERS.partnerSlugs) expect(partnerBySlug(slug)).toBeUndefined();
    expect(rows.map((r) => [r.entity, r.action])).toEqual([
      ["Play", "deleted"],
      ["Campaign", "deleted"],
      ["Partner", "deleted"],
    ]);
  });

  it("is a silent no-op on a database that never had them", async () => {
    const { db, calls } = stubDb({ play: 0, campaign: 0, partner: 0 });
    expect(await pruneRetiredPlaceholders(db)).toEqual([]);
    expect(calls).toHaveLength(3);
  });
});
