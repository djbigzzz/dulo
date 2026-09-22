import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SEASON0_PLAYS, activePlays } from "@/lib/plays/catalogue";
import { ruleToHint } from "@/components/plays/rule-hint";
import { playHref, questKind } from "@/components/plays/play-meta";

/**
 * Quest compliance (16 Sep 2026). A quest must never instruct anyone to buy a security: an
 * on-chain quest describes the wallet state to reach, and its proof shows that state was
 * reached. Speculation lives only in the virtual-cash competition and the points-only
 * predictions. Points only, no cash value; no betting words anywhere.
 *
 * These rows are seeded into Play.title / Play.desc and served on /quests, /partners and
 * /check, so this file pins the whole catalogue, not a sample.
 */

const onChainRows = SEASON0_PLAYS.filter((p) => p.rule.type !== "internal_event");

/** A description that opens with an imperative verb reads as an instruction to act on a holding. */
const IMPERATIVE_OPENING = /^(Hold|Keep|Buy|Get|Grow|Deposit|Run|Swap|Copy|Open)\b/;
/** Purchase and custody-transfer words an on-chain quest may never use. */
const PURCHASE_WORDS = /\b(buy|buys|buying|purchase|swap|swaps|deposit|broker|add to|top up)\b/i;
/** Betting words, banned in every title and description. */
const BETTING_WORDS = /prediction markets?|\bstakes?\b|\bstaked\b|\bstaking\b|\bodds\b|\bpayouts?\b|\bbets?\b|\bbetting\b/i;

describe("quest compliance — on-chain quests describe a wallet state", () => {
  it("covers every row whose rule is not internal_event (11 live on-chain quests + 2 partner quests)", () => {
    expect(onChainRows.map((p) => p.key)).toEqual([
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
      "kamino_collateral",
      "jupiter_dca",
    ]);
  });

  for (const play of onChainRows) {
    it(`${play.key}: no imperative opening and no purchase word`, () => {
      expect(play.desc).not.toMatch(IMPERATIVE_OPENING);
      expect(play.desc).not.toMatch(PURCHASE_WORDS);
      // Not vacuous: the description names the wallet or the partner position it reads.
      expect(play.desc).toMatch(/wallet|xStocks balance|Kamino|order account|largest position/i);
    });
  }

  it("the patterns are not vacuous: they catch the retired instruction-style copy", () => {
    for (const old of [
      "Hold any xStock worth $5 or more in a connected wallet. No broker, no form.",
      "Keep the same xStock in your wallet for seven daily snapshots in a row.",
      "Grow your xStocks balance on three separate days inside any 14-day window.",
      "Deposit SPYx or QQQx into the Kamino xStocks market.",
      "Run an active Jupiter Recurring order into an xStock.",
      "Copying a portfolio opens one prefilled Jupiter swap per leg from your own wallet",
    ]) {
      expect(IMPERATIVE_OPENING.test(old) || PURCHASE_WORDS.test(old), old).toBe(true);
    }
    expect(BETTING_WORDS.test("Place a bet")).toBe(true);
    expect(BETTING_WORDS.test("Join the prediction market")).toBe(true);
    expect(BETTING_WORDS.test("Make your first prediction.")).toBe(false);
  });

  it("no on-chain quest has an action link, so nothing on its card points at a buy", () => {
    for (const play of onChainRows) {
      const where = playHref(play.rule);
      if (play.rule.type === "mirror_match") {
        // Portfolio Match links to the copy tool inside Dulo, never to a swap.
        expect(where, play.key).toEqual({ kind: "internal", href: "/copy", label: "Copy a portfolio" });
      } else {
        expect(where, play.key).toBeNull();
      }
    }
  });

  it("no on-chain hint says to buy, swap or deposit", () => {
    for (const play of onChainRows) expect(ruleToHint(play.rule), play.key).not.toMatch(PURCHASE_WORDS);
  });
});

describe("quest compliance — every quest", () => {
  it("no title or description uses a betting word or says prediction market", () => {
    for (const play of SEASON0_PLAYS) {
      expect(play.title, play.key).not.toMatch(BETTING_WORDS);
      expect(play.desc, play.key).not.toMatch(BETTING_WORDS);
    }
  });

  it("no quest promises cash, a return or advice", () => {
    const MONEY = /\b(profits?|returns?|yield|guaranteed|cash value|make money|earn money|investment advice)\b/i;
    for (const play of SEASON0_PLAYS) expect(`${play.title} ${play.desc}`, play.key).not.toMatch(MONEY);
  });

  it("in-platform quests say virtual cash or points, never real money at risk", () => {
    const inPlatform = SEASON0_PLAYS.filter((p) => p.rule.type === "internal_event");
    expect(inPlatform).toHaveLength(8);
    for (const play of inPlatform) {
      expect(play.desc, play.key).not.toMatch(PURCHASE_WORDS);
      if (play.rule.type === "internal_event" && play.rule.event === "league_trade") {
        expect(play.desc, play.key).toMatch(/virtual cash/i);
        expect(play.desc, play.key).toMatch(/paper trades?/i);
      }
    }
  });

  it("live points: in-platform 850, on-chain 2,950 (2,700 xStocks + 250 PreStocks)", () => {
    const live = activePlays();
    const total = (kind: "in-platform" | "on-chain") =>
      live.filter((p) => questKind({ rule: p.rule, comingSoon: p.comingSoon === true }) === kind).reduce((n, p) => n + p.points, 0);
    expect(total("in-platform")).toBe(850);
    expect(total("on-chain")).toBe(2950);
    expect(live.reduce((n, p) => n + p.points, 0)).toBe(3800);
  });

  it("the only quests coming soon are the two partner quests, seeded inactive with no asset to read yet", () => {
    const soon = SEASON0_PLAYS.filter((p) => p.comingSoon);
    expect(soon.map((p) => p.key).sort()).toEqual(["jupiter_dca", "kamino_collateral"]);
    for (const p of soon) {
      expect(questKind({ rule: p.rule, comingSoon: true }), p.key).toBe("partner-coming-soon");
      expect(p.rule, p.key).toMatchObject({ partnerAssetIds: [] });
      expect(p.desc, p.key).toMatch(/Coming soon/);
      expect(p.points, p.key).toBeGreaterThan(0);
    }
    expect(soon.reduce((n, p) => n + p.points, 0)).toBe(500);
  });

  it("the seed writes coming-soon quests as inactive", () => {
    const seed = readFileSync(path.join(__dirname, "..", "prisma", "seed.ts"), "utf8");
    expect(seed).toMatch(/const isActive = !play\.comingSoon;/);
  });
});
