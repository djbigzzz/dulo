import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SOLANA_MAINNET, type AssetId } from "@/lib/core/caip";
import type { Holding, HoldingsSnapshot } from "@/lib/core/types";
import { evaluatePlay, type EvalContext } from "@/lib/plays/engine";
import { PRESTOCKS_ASSET_SOURCE, SEASON0_ASSET_SOURCE, SEASON0_PLAYS, activePlays, playAssetSource, playByKey } from "@/lib/plays/catalogue";
import { SEASON0_PARTNERS, campaignIdFor, isListedPartnerSlug, partnerBySlug } from "@/lib/plays/partners";
import { DEFAULT_HINT_ASSET_SOURCE, PlayRuleSchema, hintAssetNoun, ruleToHint, type PlayRule } from "@/lib/plays/rules";
import { assetNoun } from "@/lib/assets/registry";

/**
 * The second issuer's quest and Partner (22 Sep 2026): PreStocks pre-IPO tokens, read, priced and
 * scored through the same interfaces as xStocks. One quest, count-based, fenced to the "prestocks"
 * source. Every word about it says "pre-IPO token", never share, equity or stock, and never tells
 * anyone to buy. Nothing here touches the network.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** The tokens are pre-IPO tokens. "PreStocks" is the issuer's name and is allowed; a bare "stock" is not. */
const EQUITY_WORDS = /\b(shares?|equity|stocks?)\b(?!\s*Season)/i;
const PURCHASE_WORDS = /\b(buy|buys|buying|purchase|swap|swaps|deposit|broker|add to|top up)\b/i;
/** The issuer mark and the pool price are two numbers, never a discount or a premium. */
const DISCOUNT_WORDS = /\b(discount|premium)\b/i;

const SPACEX_MINT = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const TSLAX_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const NOW = new Date("2026-09-22T12:00:00.000Z");

function holding(mint: string, symbol: string, source: "xstocks" | "prestocks", qty: number, price: number | null): Holding {
  return {
    assetId: `${SOLANA_MAINNET}/token:${mint}` as AssetId,
    symbol,
    source,
    raw: String(Math.round(qty * 1e9)),
    multiplier: 1,
    qty,
    price,
    priceSource: price === null ? "none" : source === "prestocks" ? "jupiter" : "pyth",
    usd: price === null ? 0 : qty * price,
  };
}

function snapshot(holdings: Holding[]): HoldingsSnapshot {
  return { walletId: "w1", takenAt: NOW, holdings };
}

function ctx(holdings: Holding[]): EvalContext {
  return { now: NOW, snapshots: [snapshot(holdings)], events: [], earnings: {}, sectorOf: () => null, underlyingOf: () => null };
}

describe("the PreStocks Partner", () => {
  const partner = partnerBySlug("prestocks")!;

  it("is a listed issuer with the deterministic Season 0 campaign id, sorted right after xStocks", () => {
    expect(partner).toBeDefined();
    expect(partner.kind).toBe("issuer");
    expect(partner.name).toBe("PreStocks");
    expect(partner.hidden).toBeUndefined();
    expect(isListedPartnerSlug("prestocks")).toBe(true);
    expect(partner.campaign.id).toBe(campaignIdFor("prestocks"));
    expect(partner.campaign.id).toBe("camp-prestocks-season-0");
    expect(partner.campaign.title).toBe("Pre-IPO on Dulo · Stocks Season");
    expect(partner.chainIds).toEqual([SOLANA_MAINNET]);
    expect(partner.links).toEqual({ website: "https://www.prestocks.com", x: "https://x.com/PreStocks" });
    // No verified brand logo URL: the neutral initials placeholder renders instead.
    expect(partner.logoUrl).toBeNull();
    const xstocks = partnerBySlug("xstocks")!;
    expect(partner.sortOrder).toBe(xstocks.sortOrder + 1);
    // Every Partner keeps a unique sortOrder after the insert.
    expect(new Set(SEASON0_PARTNERS.map((p) => p.sortOrder)).size).toBe(SEASON0_PARTNERS.length);
    // The seed upserts every SEASON0_PARTNERS row and its Campaign, so the new Partner needs no seed change.
    const seed = read("prisma/seed.ts");
    expect(seed).toContain("for (const p of SEASON0_PARTNERS)");
    expect(seed).toContain("assetSource: playAssetSource(play)");
  });

  it("describes pre-IPO tokens in plain words: never shares, equity, stock, a discount or a purchase", () => {
    expect(partner.blurb).toMatch(/pre-IPO token/);
    expect(partner.blurb).not.toMatch(EQUITY_WORDS);
    expect(partner.blurb).not.toMatch(PURCHASE_WORDS);
    expect(partner.blurb).not.toMatch(DISCOUNT_WORDS);
    // The mark and the pool price are named as two different things.
    expect(partner.blurb).toMatch(/two different numbers/);
    // Not vacuous: the pattern catches the wording the rules forbid, and lets the issuer's name through.
    expect(EQUITY_WORDS.test("tokenized SpaceX stock")).toBe(true);
    expect(EQUITY_WORDS.test("pre-IPO shares")).toBe(true);
    expect(EQUITY_WORDS.test("PreStocks pre-IPO token")).toBe(false);
  });
});

describe("Pre-IPO Position: the one PreStocks quest", () => {
  const play = playByKey("pre_ipo_position")!;

  it("is a 100-point, count-based hold_any fenced to the prestocks source, with no badge", () => {
    expect(play).toBeDefined();
    expect(play.title).toBe("Pre-IPO Position");
    expect(play.partnerSlug).toBe("prestocks");
    expect(play.campaignTitle).toBe("Pre-IPO on Dulo · Stocks Season");
    expect(play.points).toBe(100);
    expect(play.badgeKey).toBeUndefined();
    expect(play.comingSoon).toBeUndefined();
    // Count-based on purpose: every pre-IPO token is Jupiter-only priced, so a USD floor could read
    // incomplete on a cold start. minUsd 0 is the count-free form the schema already accepts.
    expect(play.rule).toEqual({ type: "hold_any", minUsd: 0 });
    expect(PlayRuleSchema.safeParse(play.rule).success).toBe(true);
    expect(play.assetSource).toBe(PRESTOCKS_ASSET_SOURCE);
    expect(playAssetSource(play)).toBe("prestocks");
    // After the nine xStocks quests (sortOrder 0..8).
    const xstocksMax = Math.max(...SEASON0_PLAYS.filter((p) => p.partnerSlug === "xstocks").map((p) => p.sortOrder));
    expect(play.sortOrder).toBe(xstocksMax + 1);
    expect(activePlays().map((p) => p.key)).toContain("pre_ipo_position");
  });

  it("shares the prestocks fence with Held Through a Split only; every other row keeps the Season 0 default", () => {
    const split = playByKey("held_through_split")!;
    expect(split.assetSource).toBe(PRESTOCKS_ASSET_SOURCE);
    expect(split.partnerSlug).toBe("prestocks");
    expect(split.sortOrder).toBe(play.sortOrder + 1);
    for (const p of SEASON0_PLAYS) {
      if (p.key === "pre_ipo_position" || p.key === "held_through_split") continue;
      expect(p.assetSource, p.key).toBeUndefined();
      expect(playAssetSource(p), p.key).toBe(SEASON0_ASSET_SOURCE);
    }
    expect(SEASON0_ASSET_SOURCE).not.toBe(PRESTOCKS_ASSET_SOURCE);
  });

  it("states a wallet state in plain words: pre-IPO token, never a purchase, share, equity or stock", () => {
    expect(play.desc).toMatch(/^Your connected wallet holds/);
    expect(play.desc).toMatch(/pre-IPO token/);
    expect(play.desc).not.toMatch(PURCHASE_WORDS);
    expect(play.desc).not.toMatch(EQUITY_WORDS);
    expect(play.desc).not.toMatch(DISCOUNT_WORDS);
    expect(play.title).not.toMatch(EQUITY_WORDS);
  });

  it("completes on any PreStocks position, priced by Jupiter or not priced at all", () => {
    const source = playAssetSource(play);
    const priced = evaluatePlay(play.rule, ctx([holding(SPACEX_MINT, "SPACEX", "prestocks", 0.25, 117.83)]), source);
    expect(priced.complete).toBe(true);
    expect(priced.proof).toMatchObject({ symbol: "SPACEX", qty: 0.25, priceSource: "jupiter" });
    const unpriced = evaluatePlay(play.rule, ctx([holding(SPACEX_MINT, "SPACEX", "prestocks", 0.01, null)]), source);
    expect(unpriced.complete).toBe(true);
    expect(unpriced.proof).toMatchObject({ symbol: "SPACEX", usd: 0, priceSource: "none" });
  });

  it("never completes on an xStocks-only wallet, and no xStocks quest completes on a PreStocks-only wallet", () => {
    const xstocksOnly = ctx([holding(TSLAX_MINT, "TSLAx", "xstocks", 100, 400)]);
    const res = evaluatePlay(play.rule, xstocksOnly, playAssetSource(play));
    expect(res.complete).toBe(false);
    expect(res.proof.reason).toBe("no_in_scope_holding");

    const prestocksOnly = ctx([holding(SPACEX_MINT, "SPACEX", "prestocks", 50, 117.83)]);
    for (const p of activePlays()) {
      if (p.rule.type === "internal_event" || p.key === "pre_ipo_position") continue;
      expect(evaluatePlay(p.rule, prestocksOnly, playAssetSource(p)).complete, p.key).toBe(false);
    }
  });
});

describe("rule hints follow the Play's asset source", () => {
  it("names the noun from the fence: xStock by default, pre-IPO token for prestocks", () => {
    expect(DEFAULT_HINT_ASSET_SOURCE).toBe(SEASON0_ASSET_SOURCE);
    const anyDust: PlayRule = { type: "hold_any", minUsd: 0 };
    expect(ruleToHint(anyDust)).toBe("Hold any xStock.");
    expect(ruleToHint(anyDust, "xstocks")).toBe("Hold any xStock.");
    expect(ruleToHint(anyDust, "prestocks")).toBe("Hold any pre-IPO token.");
    expect(ruleToHint({ type: "hold_any", minUsd: 5 }, "prestocks")).toBe("Hold any pre-IPO token worth $5+.");
    // Unknown, null and undefined sources read as the default, exactly like a legacy Play row.
    for (const source of [null, undefined, "", "kamino"]) expect(ruleToHint(anyDust, source)).toBe("Hold any xStock.");
  });

  it("covers every hint that names the asset", () => {
    const TSLAX_ID = `${SOLANA_MAINNET}/token:${TSLAX_MINT}` as AssetId;
    const SPACEX_ID = `${SOLANA_MAINNET}/token:${SPACEX_MINT}` as AssetId;
    const cases: Array<[PlayRule, string]> = [
      [{ type: "hold_any", minUsd: 0, assetIds: [SPACEX_ID] }, "Hold a selected pre-IPO token."],
      [{ type: "hold_any", minUsd: 0, assetIds: [SPACEX_ID, TSLAX_ID] }, "Hold one of 2 selected pre-IPO tokens."],
      [{ type: "hold_any", minUsd: 0, assetSymbols: ["SPACEX"] }, "Hold SPACEX."],
      [{ type: "hold_consecutive", days: 7 }, "Hold the same pre-IPO token for 7 daily snapshots in a row."],
      [{ type: "net_increase_days", count: 3, window: 14 }, "Grow your any pre-IPO token balance on 3 separate days within 14 days."],
      [{ type: "hold_through_date", calendarKey: "earnings" }, "Hold any pre-IPO token through an earnings date."],
      [{ type: "diversified", minAssets: 3, minSectors: 2 }, "Hold 3 pre-IPO tokens across 2 sectors at once."],
      [{ type: "diversified", minAssets: 1, minSectors: 1 }, "Hold 1 pre-IPO token across 1 sector at once."],
      [{ type: "internal_event", event: "league_trade", count: 3, distinctBy: "symbol" }, "Place paper trades in 3 different pre-IPO tokens."],
      [{ type: "internal_event", event: "league_trade", count: 1, distinctBy: "symbol" }, "Place paper trades in 1 different pre-IPO token."],
    ];
    for (const [rule, expected] of cases) {
      expect(ruleToHint(rule, "prestocks"), JSON.stringify(rule)).toBe(expected);
      // The same rule under the default fence still says xStock, so nothing changed for Season 0 rows.
      expect(ruleToHint(rule), JSON.stringify(rule)).not.toMatch(/pre-IPO/);
      expect(ruleToHint(rule, "prestocks"), JSON.stringify(rule)).not.toMatch(/xStock/);
    }
    // Hints that never name the asset are identical under both fences.
    for (const rule of [
      { type: "hold_any", minUsd: 1, partnerAssetIds: [] },
      { type: "mirror_match", tolerance: 0.2 },
      { type: "internal_event", event: "call_placed", count: 3, distinctBy: "ref" },
      { type: "internal_event", event: "game_action", count: 3, distinctBy: "day" },
    ] as PlayRule[]) {
      expect(ruleToHint(rule, "prestocks")).toBe(ruleToHint(rule));
    }
  });

  it("the catalogue quest's own hint says pre-IPO token and never xStock", () => {
    const play = playByKey("pre_ipo_position")!;
    const hint = ruleToHint(play.rule, playAssetSource(play));
    expect(hint).toBe("Hold any pre-IPO token.");
    expect(hint).not.toMatch(PURCHASE_WORDS);
    for (const p of SEASON0_PLAYS) {
      const h = ruleToHint(p.rule, playAssetSource(p));
      expect(h.length, p.key).toBeGreaterThan(10);
      expect(h, p.key).not.toMatch(EQUITY_WORDS);
    }
  });

  it("keeps its client-safe noun table equal to the registry's", () => {
    for (const source of ["xstocks", "prestocks"]) expect(hintAssetNoun(source), source).toEqual(assetNoun(source));
    expect(hintAssetNoun(null)).toEqual(assetNoun(null));
    expect(hintAssetNoun("kamino")).toEqual(assetNoun("kamino"));
    expect(hintAssetNoun("prestocks")).toEqual({ singular: "pre-IPO token", plural: "pre-IPO tokens" });
  });
});

describe("every word about PreStocks in the docs", () => {
  const README = read("README.md");
  const SUBMISSION = read("docs/SUBMISSION.md");
  const HANDOFF = read("docs/HANDOFF.md");
  const BRIEF = read("CLAUDE.md");

  /** Text from `heading` up to the next heading of the same or a higher level. */
  function section(text: string, heading: string): string {
    const start = text.indexOf(heading);
    expect(start, heading).toBeGreaterThanOrEqual(0);
    const level = /^#+/.exec(heading)![0].length;
    const rest = text.slice(start + heading.length);
    const next = new RegExp(`\\n#{1,${level}} `).exec(rest);
    return text.slice(start, start + heading.length + (next ? next.index : rest.length));
  }

  it("no doc calls a pre-IPO token a share, equity or stock, or the mark-to-pool gap a discount", () => {
    const docs: Array<[string, string]> = [
      ["README.md", README],
      ["docs/SUBMISSION.md", SUBMISSION],
      ["docs/HANDOFF.md", HANDOFF],
      ["CLAUDE.md", BRIEF],
      ["src/lib/plays/partners.ts", read("src/lib/plays/partners.ts")],
      ["src/lib/plays/catalogue.ts", read("src/lib/plays/catalogue.ts")],
    ];
    let mentions = 0;
    for (const [rel, text] of docs) {
      for (const raw of text.split(/\r?\n/)) {
        if (!/prestocks|pre-ipo/i.test(raw)) continue;
        mentions++;
        // A vocabulary rule may quote the forbidden phrase to forbid it ('never "SpaceX stock"').
        const line = raw.replace(/never "[^"]*"/g, "").replace(/never (shares|share|equity|stock)\b[^.;]*/gi, "");
        expect(line, `${rel}: ${raw.slice(0, 120)}`).not.toMatch(/\b(pre-IPO|SpaceX|OpenAI|Anthropic)\s+(shares?|equity|stocks?)\b/i);
        expect(line, `${rel}: ${raw.slice(0, 120)}`).not.toMatch(/\bstock in\b|\bshares in\b|\bequity in\b/i);
        expect(line, `${rel}: ${raw.slice(0, 120)}`).not.toMatch(/\bat a (discount|premium)\b/i);
      }
    }
    expect(mentions).toBeGreaterThan(8);
  });

  it("HANDOFF §3.1 carries the quest and §3.10 the noun", () => {
    const catalogue = section(HANDOFF, "### 3.1 ");
    expect(catalogue).toMatch(/^\| pre_ipo_position \| Pre-IPO Position \| on-chain \| `hold_any` minUsd 0.*\| 100 \| +\|$/m);
    expect(catalogue).toContain("the 11 live on-chain quests 2,950");
    expect(catalogue).toMatch(/^\| held_through_split \| Held Through a Split \| on-chain \| `multiplier_change`.*\| 150 \| +\|$/m);
    const vocabulary = section(HANDOFF, "### 3.10 Vocabulary");
    expect(vocabulary).toMatch(/PreStocks/);
    expect(vocabulary).toMatch(/pre-IPO token/);
  });

  it("HANDOFF §6b's 2:10 beat is the demonstration, with the pinned names and without the hedge", () => {
    const beat = HANDOFF.split(/\r?\n/).find((l) => l.startsWith("| 2:10 |"))!;
    expect(beat).toBeDefined();
    expect(beat).toContain("Play.assetSource");
    expect(beat).toContain("AssetSource registry");
    expect(beat).toContain("src/lib/assets/registry.ts");
    expect(beat).toMatch(/pre-IPO token/);
    expect(beat).not.toMatch(/If the registry has not shipped/);
    expect(beat).not.toMatch(/\[If /);
  });

  it("CLAUDE.md names the quest and the noun", () => {
    expect(BRIEF).toContain("Added 22 Sep: Pre-IPO Position, Held Through a Split (PreStocks, source prestocks)");
    expect(BRIEF).toMatch(/^- PreStocks[^\n]*pre-IPO token/m);
  });

  it("README: the judging row, the Why Solana paragraph, the quest row, the Partner row and the limitation", () => {
    const judging = section(README, "## Judging criteria");
    expect(judging).toMatch(/\| \*\*Why Solana\*\* \|[^\n]*PreStocks[^\n]*same interfaces/);
    const why = section(README, "## Why Solana");
    expect(why).toMatch(/PreStocks[^\n]*(zero|no) extra RPC call/);
    expect(why).toMatch(/pre-IPO token/);
    const quests = section(README, "### 3. Quests");
    expect(quests).toMatch(/^\| Pre-IPO Position \| `hold_any` \|[^\n]*pre-IPO token[^\n]*\| 100 \| +\|$/m);
    const partners = section(README, "## Partners");
    expect(partners).toMatch(/^\| PreStocks \| Quests live \|[^\n]*pre-IPO token/m);
    const limits = section(README, "## Known limitations");
    const bullet = limits.split(/\r?\n/).find((l) => /PreStocks/.test(l))!;
    expect(bullet).toBeDefined();
    for (const needle of [/thin/i, /Jupiter/, /mark/i, /not a (tradeable|tradable) quote/i]) expect(bullet).toMatch(needle);
  });

  it("SUBMISSION says it once, in Where it goes, as a code fact", () => {
    const where = section(SUBMISSION, "## Where it goes");
    const sentences = where.split(/\r?\n/).filter((l) => /PreStocks/.test(l));
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toMatch(/second issuer/);
    expect(sentences[0]).toMatch(/same interfaces/);
    expect(sentences[0]).not.toMatch(/\b(users|players|holders) (have|completed|joined)\b/i);
  });
});
