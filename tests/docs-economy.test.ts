import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { SEASON0_PLAYS } from "@/lib/plays/catalogue";
import { HOUSE_PARTNER_SLUG } from "@/lib/plays/partners";
import {
  MIN_TRADES_FOR_WEEKLY_POINTS,
  NON_SCORING_SOURCES,
  STARTER_POINTS,
  VIRTUAL_CASH_USD,
  openStakePrefix,
  starterRef,
  summariseLedger,
} from "@/lib/games/ledger-policy";
import { MAX_CALL_POINTS, MIN_CALL_POINTS } from "@/lib/games/calls-limits";
import { RANK_POINTS, STARTING_CASH_USD } from "@/lib/games/league";

// league.ts is a server module: keep its Prisma client from being built at import time (hoisted).
vi.mock("@/lib/server/db", () => ({ db: {} }));

/**
 * The judge-facing and internal docs describe the 16 Sep economy: three games on one Season
 * leaderboard, 1,000 starter points that never score, virtual cash, the Season points rule, the
 * quest catalogue and the honest limits. The numbers a doc states must be the numbers the code
 * uses, and no doc may claim players, partners, revenue or a quest that was never built.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const README = read("README.md");
const SUBMISSION = read("docs/SUBMISSION.md");
const HANDOFF = read("docs/HANDOFF.md");
const BRIEF = read("CLAUDE.md");

/** Every tracked Markdown doc: the root README and brief, and the top-level docs/*.md files (subfolders are not scanned). */
function trackedDocs(): Array<[string, string]> {
  const docs = readdirSync(path.join(ROOT, "docs"), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => `docs/${e.name}`);
  return ["README.md", "CLAUDE.md", ...docs].map((rel) => [rel, read(rel)]);
}

/** Text from `heading` up to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const start = text.indexOf(heading);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const level = /^#+/.exec(heading)![0].length;
  const rest = text.slice(start + heading.length);
  const next = new RegExp(`\\n#{1,${level}} `).exec(rest);
  return text.slice(start, start + heading.length + (next ? next.index : rest.length));
}

/** A SUBMISSION paste block (the text between the four-backtick fences under the heading). */
function pasteBlock(name: "Short Description" | "Full Description"): { measured: number; body: string } {
  const m = new RegExp(`### ${name}[^\\n]*: ([\\d,]+) measured\\n[\\s\\S]*?\`{4}\\w*\\n([\\s\\S]*?)\\n\`{4}`).exec(SUBMISSION);
  expect(m, name).not.toBeNull();
  return { measured: Number(m![1].replace(/,/g, "")), body: m![2] };
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Live catalogue rows by the group /quests shows them in. */
const inPlatform = SEASON0_PLAYS.filter((p) => !p.comingSoon && p.partnerSlug === HOUSE_PARTNER_SLUG);
const onChain = SEASON0_PLAYS.filter((p) => !p.comingSoon && p.partnerSlug !== HOUSE_PARTNER_SLUG);
const comingSoon = SEASON0_PLAYS.filter((p) => p.comingSoon);
const total = (plays: readonly { points: number }[]) => plays.reduce((n, p) => n + p.points, 0);

describe("docs economy — starter points, virtual cash, points only", () => {
  it("README and SUBMISSION state the welcome grant, virtual cash and no cash value", () => {
    for (const [rel, text] of [
      ["README.md", README],
      ["docs/SUBMISSION.md", SUBMISSION],
    ] as const) {
      expect(text, rel).toContain("1,000 starter points");
      expect(text, rel).toContain("virtual cash");
      expect(text, rel).toContain("no cash value");
    }
    // The judge reads the paste block, not the checklist around it.
    const full = pasteBlock("Full Description").body;
    for (const needle of ["1,000 starter points", "$10,000 of virtual cash", "Points only, no cash value", "never count toward rank"]) {
      expect(full, needle).toContain(needle);
    }
  });

  it("the numbers the docs state are the numbers the policy uses", () => {
    expect(fmt(STARTER_POINTS)).toBe("1,000");
    expect(VIRTUAL_CASH_USD).toBe(STARTING_CASH_USD);
    expect(README).toContain(`$${fmt(VIRTUAL_CASH_USD)} of virtual cash per competition week`);
    expect(README).toContain(`at least ${MIN_TRADES_FOR_WEEKLY_POINTS} trades that week`);
    expect(README).toContain(`${fmt(MIN_CALL_POINTS)} to ${fmt(MAX_CALL_POINTS)} points`);
    // The weekly ladder, exactly as RANK_POINTS pays it.
    const ladder = RANK_POINTS.map(fmt).join(" / ");
    expect(README).toContain(ladder);
    expect(HANDOFF).toContain("MIN_TRADES_FOR_WEEKLY_POINTS");
    expect(HANDOFF).toMatch(/MIN_TRADES_FOR_WEEKLY_POINTS|3 trades/);
    // Ledger refs and the non-scoring sources, as the code writes them.
    expect(HANDOFF).toContain(`\`${starterRef("<seasonId>")}\``);
    expect(README).toContain(`\`${starterRef("<seasonId>")}\``);
    expect(HANDOFF).toContain(openStakePrefix("<marketId>"));
    expect(HANDOFF).toContain(`\`${JSON.stringify([...NON_SCORING_SOURCES]).replace(/,/g, ", ")}\``);
  });

  it("README explains how points work: three games, the Season points rule, the quest totals and the plan", () => {
    const how = section(README, "## How points work");
    for (const needle of [
      "Three games, one Season leaderboard",
      "Copy a portfolio is a tool",
      "once per player per Season",
      "never count toward Season points or rank",
      "House bots never get them",
      "Season points = quests + weekly finishes (top 10 with 3+ trades) + settled prediction results",
      "points in open predictions are left out",
      `${inPlatform.length} in-platform quests are worth ${fmt(total(inPlatform))} points`,
      `${onChain.length} on-chain quests are worth ${fmt(total(onChain))} points`,
      "Kamino Collateral, Jupiter Recurring",
      "coming soon",
      "pay per verified completion",
      "nothing is billed",
      "no partner has signed",
      "cannot be bought, cashed out or sent to another player",
    ]) {
      expect(how, needle).toContain(needle);
    }
    // The approved totals, so a catalogue change is a deliberate docs change too.
    expect(total(inPlatform)).toBe(850);
    expect(total(onChain)).toBe(2700);
    expect(total(comingSoon)).toBe(500);
    const economy = pasteBlock("Full Description").body;
    expect(economy).toContain(`In-platform quests are worth ${fmt(total(inPlatform))} points and on-chain quests ${fmt(total(onChain))}`);
  });

  it("README lists every live quest and every coming-soon partner quest by its shipped title", () => {
    const quests = section(README, "### 3. Quests");
    for (const play of SEASON0_PLAYS) {
      expect(quests, play.key).toContain(`| ${play.title} |`);
      const row = quests.split("\n").find((l) => l.startsWith(`| ${play.title} |`))!;
      expect(row, play.key).toMatch(new RegExp(`\\| ${fmt(play.points)} \\|`));
    }
  });

  it("the judge path goes connect, welcome, predict, compete, quests, on the new routes", () => {
    const quick = section(README, "## Judge quick path");
    const order = ["**Connect.**", "**Welcome.**", "`/predictions`", "`/competition`", "`/quests`"].map((s) => quick.indexOf(s));
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(quick).toContain('press "I\'ve done my swaps"');

    const judge = section(SUBMISSION, "## Judge path");
    const subOrder = ["**Connect**", "**Welcome.**", "`/predictions`", "`/competition`", "`/quests`"].map((s) => judge.indexOf(s));
    for (const i of subOrder) expect(i).toBeGreaterThanOrEqual(0);
    expect([...subOrder].sort((a, b) => a - b)).toEqual(subOrder);

    // No 15 Sep route survives in the README, and no shot in either video opens one.
    for (const stale of ["/rewards`", "/paper-trading`", "/plays`", "/league`", "/calls`", "/mirror`"]) expect(README, stale).not.toContain(stale);
    const videos = HANDOFF.slice(HANDOFF.indexOf("## 6. Pitch Video"), HANDOFF.indexOf("## 7. Risks"));
    for (const stale of ["$APP/rewards", "$APP/paper-trading", "$APP/plays", "$APP/league", "$APP/calls", "$APP/mirror"]) {
      expect(videos, stale).not.toContain(stale);
    }
    for (const route of ["$APP/predictions", "$APP/competition", "$APP/quests", "$APP/copy/"]) expect(videos, route).toContain(route);
  });

  it("SUBMISSION's old-links check covers every renamed route", () => {
    const live = section(SUBMISSION, "### Live app");
    for (const pair of ["`/plays` and `/rewards` go to `/quests`", "`/league` and `/paper-trading` go to `/competition`", "`/calls` goes to `/predictions`", "`/mirror` goes to `/copy`"]) {
      expect(live, pair).toContain(pair);
    }
  });

  it("SUBMISSION paste blocks fit the form and their measured counts are current", () => {
    const short = pasteBlock("Short Description");
    const full = pasteBlock("Full Description");
    expect(short.body.length).toBeLessThanOrEqual(280);
    expect(full.body.length).toBeLessThanOrEqual(5000);
    expect(short.measured).toBe(short.body.length);
    expect(full.measured).toBe(full.body.length);
  });

  it("README, SUBMISSION and HANDOFF quote the same test count", () => {
    const readme = [...README.matchAll(/([\d,]+) tests across (\d+) files/g)].map((m) => `${m[1]}/${m[2]}`);
    const handoff = [...HANDOFF.matchAll(/([\d,]+) tests across (\d+) files/g)].map((m) => `${m[1]}/${m[2]}`);
    expect(readme.length).toBeGreaterThanOrEqual(2);
    expect(handoff.length).toBeGreaterThanOrEqual(1);
    expect(new Set([...readme, ...handoff]).size).toBe(1);
    const count = readme[0].split("/")[0];
    expect(pasteBlock("Full Description").body).toContain(`${count} tests`);
    expect(SUBMISSION).toContain(`printed **${count}**`);
  });
});

describe("docs economy — the HANDOFF catalogue, economy and known limits", () => {
  /** §3.1 table rows as { key, title, kind, points, badge }. */
  function catalogueRows() {
    const table = section(HANDOFF, "### 3.1 ");
    return table
      .split("\n")
      .filter((l) => /^\| [a-z_0-9]+ \|/.test(l))
      .map((l) => {
        const cells = l.split("|").slice(1, -1).map((c) => c.trim());
        return { key: cells[0], title: cells[1], kind: cells[2], points: cells[4], badge: cells[5] };
      });
  }

  it("§3.1 is the 19-row catalogue, row for row", () => {
    const rows = catalogueRows();
    expect(SEASON0_PLAYS).toHaveLength(19);
    expect(rows.map((r) => r.key).sort()).toEqual(SEASON0_PLAYS.map((p) => p.key).sort());
    for (const play of SEASON0_PLAYS) {
      const row = rows.find((r) => r.key === play.key)!;
      expect(row.title, play.key).toBe(play.title);
      expect(row.points, play.key).toBe(String(play.points));
      expect(row.badge === "yes", play.key).toBe(Boolean(play.badgeKey));
      const expectedKind = play.comingSoon ? "partner, coming soon (isActive=false)" : play.partnerSlug === HOUSE_PARTNER_SLUG ? "in-platform" : "on-chain";
      expect(row.kind, play.key).toBe(expectedKind);
    }
    const notes = section(HANDOFF, "### 3.1 ");
    expect(notes).toContain(`The ${inPlatform.length} live in-platform quests are worth ${fmt(total(inPlatform))} points, the ${onChain.length} live on-chain quests ${fmt(total(onChain))}, and the ${comingSoon.length} coming-soon partner quests ${fmt(total(comingSoon))}`);
  });

  it("§3.8 records the ledger rows, the Season points rule and identity, the grant paths, the bot refusals, the claim and the minimum", () => {
    const economy = section(HANDOFF, "### 3.8 Economy");
    for (const needle of [
      // ledger refs
      "`starter:<seasonId>`",
      "`play:<playKey>`",
      "`league:<leagueId>:rank:<n>`",
      "`call:<marketId>:stake:<userId>:<side>`",
      "`call:<marketId>:payout:<userId>`",
      "`call:<marketId>:refund:<userId>:<side>`",
      "`admin:seed:<marketId>:<botUserId>`",
      // idempotency and no negative balances
      "@@unique([userId, seasonId, ref])",
      "granted = (count === 1)",
      "a balance never goes below 0",
      // the rule and the identity
      "Season points = quest points + weekly competition finishes + the net result of settled predictions",
      "balance = Season points + starter points + admin points - points in open predictions",
      "seasonScoreWhere",
      // where starter points are written
      "`POST /api/v1/auth/verify`",
      "`POST /api/v1/calls/place`",
      "backfillStarterPoints",
      "20 per hour",
      // bot refusals
      "House bot wallets cannot sign in",
      "`calls/place` and `league/trade` answer 403",
      "`evaluateUser` returns early for a bot",
      // the rollover claim and the 3-trade minimum
      'tx.league.updateMany({ where: { id, status: "open" } })',
      "**The 3-trade minimum.**",
      // honesty
      "No Prisma schema change and no migration",
      "The only way points move between players is a shared prediction pool",
    ]) {
      expect(economy, needle).toContain(needle);
    }
  });

  it("the documented identity and settlement claims hold for the ledger policy", () => {
    const open = new Set(["m1"]);
    const rows = [
      { source: "starter", ref: starterRef("s0"), delta: STARTER_POINTS },
      { source: "call", ref: `${openStakePrefix("m1")}u1:yes`, delta: -100 },
      { source: "play", ref: "play:oracle", delta: 50 },
    ];
    // Judge path step 3: 950 balance, 50 Season points, on the board at once.
    const s = summariseLedger(rows, open);
    expect(s).toMatchObject({ balance: 950, seasonPoints: 50, starterPoints: STARTER_POINTS, inPredictions: 100, adminPoints: 0 });
    expect(s.balance).toBe(s.seasonPoints + s.starterPoints + s.adminPoints - s.inPredictions);
    expect(README).toContain("you are on the Season leaderboard with 50 Season points");
    // A lost prediction counts against Season points once it settles; a refund nets to zero.
    expect(summariseLedger(rows, new Set()).seasonPoints).toBe(-50);
    const refunded = [...rows, { source: "call", ref: "call:m1:refund:u1:yes", delta: 100 }];
    expect(summariseLedger(refunded, new Set()).seasonPoints).toBe(50);
    expect(README).toContain("minus the points you put in if it does not, and zero on a refund");
  });

  it("§3.9 lists the known limitations of 16 Sep", () => {
    expect(HANDOFF).toContain("Known limitations (16 Sep)");
    const limits = section(HANDOFF, "### 3.9 Known limitations (16 Sep)");
    for (const needle of [
      "open until the Friday close",
      "open next week's questions at that lock",
      "Sybil starter-point funnelling",
      "in memory, per instance, 20 per hour",
      "account-age or wallet-age signal",
      "Scoring must never depend on holding xStocks",
      "derivable from their public handles",
      "HMAC-derived keys plus a reseed",
      "PlayProgress and internal events are not Season-scoped",
      "new quest keys",
      "`evaluateUser` can briefly show a completed quest as in progress for one tick",
      "overwritten by a stale read",
      "first tick after the Friday close",
      "`finaliseMarket` reads positions before its claim",
      "No admin void tool",
    ]) {
      expect(limits, needle).toContain(needle);
    }
    expect(limits.match(/^\d+\. \*\*/gm)).toHaveLength(9);
  });
});

describe("docs economy — honest claims across every doc", () => {
  it("no doc presents Spot On, Top 10 Finish or Green Week except to say they are not built", () => {
    const cut = /spot on|top 10 finish|green week/i;
    let mentions = 0;
    for (const [rel, text] of trackedDocs()) {
      for (const line of text.split(/\r?\n/)) {
        if (!cut.test(line)) continue;
        mentions++;
        expect(line, `${rel}: ${line.slice(0, 120)}`).toMatch(/not built/i);
      }
    }
    // Not vacuous: SUBMISSION states the cut plainly, as the handoff asks.
    expect(mentions).toBeGreaterThan(0);
    expect(SUBMISSION).toContain("Spot On-style settlement quests are not built");
  });

  it("no doc claims a player count", () => {
    for (const [rel, text] of trackedDocs()) {
      expect(text, rel).not.toMatch(/\b(\d[\d,]*) (players|users) (have|joined|completed)\b/i);
    }
  });

  it("the partner model is always a plan, and nothing is claimed as deployed or billed", () => {
    for (const [rel, text] of [
      ["README.md", README],
      ["docs/SUBMISSION.md", SUBMISSION],
      ["docs/HANDOFF.md", HANDOFF],
      ["CLAUDE.md", BRIEF],
    ] as const) {
      const lines = text.split(/\r?\n/).filter((l) => /pay per verified completion/i.test(l));
      expect(lines.length, rel).toBeGreaterThan(0);
      for (const line of lines) expect(line, `${rel}: ${line.slice(0, 120)}`).toMatch(/\bplan\b|\bwould\b/i);
      expect(text, rel).toMatch(/onboarding, not churn/i);
    }
    // The wording moved into a GitHub note callout on 21 Sep; what must survive any redesign is
    // that the README says it is not deployed and denies each of the three things a judge counts.
    expect(README).toMatch(/\*\*Not deployed yet\*\*/);
    for (const denial of [/no public URL/i, /no players/i, /no minted badge/i]) {
      expect(README, String(denial)).toMatch(denial);
    }
    expect(README).toContain("A plan, not revenue: nothing is billed today");
    expect(pasteBlock("Full Description").body).toContain("Nothing is charged today: a plan, not revenue.");
    expect(HANDOFF).toContain("no live URL, no users, no partners, no minted Badge, no billing");
    expect(BRIEF).toContain("not deployed. No public URL, no players, no partner has signed anything, no badge has been minted, no billing.");
  });

  it("the deadline and the vision stay in step", () => {
    // 17 Sep: the page countdown, header and press confirm the close moved to Fri 25 Sep 16:00 ET,
    // judging to 2 Oct. Every doc states that one date; the stale 18 Sep close must not survive.
    for (const [rel, text] of [
      ["README.md", README],
      ["docs/SUBMISSION.md", SUBMISSION],
      ["docs/HANDOFF.md", HANDOFF],
      ["CLAUDE.md", BRIEF],
    ] as const) {
      expect(text, rel).toMatch(/Fri 25 Sep 2026,? 16:00 ET/);
      expect(text, rel).toMatch(/judging runs to 2 Oct/i);
      expect(text, rel).not.toMatch(/(close|deadline)[^.]{0,60}18 Sep 2026|9 Oct|which is binding|(work|plan) (to|for) the earlier (date|one)/i);
    }
    expect(SUBMISSION).toContain("Thu 17 Sep: press Submit Project");
    const vision = "any app or issuer runs competitions, predictions and rewards for its own holders on Dulo's API, and a player carries one score across them";
    for (const text of [README, SUBMISSION, HANDOFF, BRIEF]) {
      expect(text).toContain("the entertainment layer for tokenized assets");
      expect(text).toContain(vision);
    }
  });

  it("CLAUDE.md carries the 16 Sep names and the points rules", () => {
    for (const needle of [
      "Play (code) -> a quest",
      '"Weekly competition (virtual cash)"',
      "Nav order: Predictions · Competition · Quests · Copy a portfolio · Leaderboard.",
      "/predictions, /competition, /quests, /copy",
      "(/plays, /rewards, /league, /paper-trading, /calls, /mirror)",
    ]) {
      expect(BRIEF, needle).toContain(needle);
    }
    const points = BRIEF.split(/\r?\n/).find((l) => l.startsWith("Points (founder decision, 16 Sep 2026"));
    expect(points).toBeDefined();
    for (const needle of [
      "append-only PointsEvent ledger",
      "1,000 starter points once per user per Season",
      'source "starter"',
      "never score",
      "NON_SCORING_SOURCES",
      "open predictions",
      "at least 3 trades that week (MIN_TRADES_FOR_WEEKLY_POINTS)",
      "House bots never get starter or quest points",
      "cannot sign in",
      "A quest never instructs anyone to buy a security",
    ]) {
      expect(points!, needle).toContain(needle);
    }
    // The pins tests/copy.test.ts holds CLAUDE.md to survive the rewrite.
    expect(BRIEF).not.toMatch(/degrade/i);
    expect(BRIEF).toMatch(/Mirror ships as "view allocation \+ open Jupiter with a prefilled swap per leg" by decision/);
  });
});
