import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { POSITIONING } from "@/lib/config";
import { SEASON0_PLAYS, playByKey } from "@/lib/plays/catalogue";
import { SEASON0_PARTNERS, partnerBySlug } from "@/lib/plays/partners";
import { BADGES } from "@/lib/badges/keys";

/**
 * Copy matches the locked decisions (docs/REVIEW-2026-09-14.md M6 / L32):
 *  - Mirror is deep links only: nothing in the app executes a swap.
 *  - Calls settle from the Friday close with the source printed on the card; no Pyth promise.
 * These strings are seeded into the DB (Play.desc, Partner.blurb) and served by
 * /api/v1/plays, /api/v1/partners and the badge metadata route, so drift is judge-visible.
 */

/** 17 Sep: the Jupiter blurb says the copy tool only links out; the swap is the player's own. */
const MIRROR_DEEP_LINK_COPY = "Dulo's copy tool links out to Jupiter, where any swap is yours to make from your own wallet.";
/** Retired instruction-style blurb (tests/quest-compliance.test.ts lists it too). */
const RETIRED_JUPITER_COPY = "Copying a portfolio opens one prefilled Jupiter swap per leg from your own wallet";
const CALLS_SETTLE_COPY = "settled from the Friday close, source shown on the card";

// Anything that reads as in-app execution or as a Pyth settlement promise.
const BANNED = /real (jupiter )?swaps|\bexecut(e|es|ed|ing|ion)\b|swap v2|settled (by|from) pyth|pyth settles/i;

function repoFile(rel: string): string {
  return readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("copy — Mirror is deep links, Calls settle from the close", () => {
  it("every Play desc, Partner blurb and Badge description avoids execution / Pyth-settlement wording", () => {
    for (const p of SEASON0_PLAYS) expect(p.desc, p.key).not.toMatch(BANNED);
    for (const p of SEASON0_PARTNERS) expect(p.blurb, p.slug).not.toMatch(BANNED);
    for (const b of Object.values(BADGES)) expect(b.description, b.key).not.toMatch(BANNED);
  });

  it("the Jupiter blurb carries the deep-link sentence and no buy instruction", () => {
    const blurb = partnerBySlug("jupiter")!.blurb;
    expect(blurb).toContain(MIRROR_DEEP_LINK_COPY);
    expect(blurb).not.toContain(RETIRED_JUPITER_COPY);
    expect(blurb).not.toMatch(/\bDCA\b|\binto an xStock\b|\bbuy\b/i);
    expect(blurb).toMatch(/coming soon/i);
  });

  // 16 Sep: Portfolio Match is an on-chain quest, so its description is the wallet state the
  // snapshot compares, with no swap or buy wording. The copy tool keeps the deep-link sentence.
  it("the Mirror Play describes the wallet state within 20%, with no swap or buy wording", () => {
    const desc = playByKey("mirror")!.desc;
    expect(desc).toBe(
      "Your wallet's xStocks allocation lands within 20% of a portfolio you chose to copy. The next snapshot compares the two.",
    );
    expect(desc).toContain("within 20%");
    expect(desc).not.toMatch(/swap|buy/i);
    expect(desc).not.toContain(MIRROR_DEEP_LINK_COPY);
  });

  it("the Mirror Badge description says the swaps were prefilled and signed from the user's own wallet", () => {
    expect(BADGES.mirror.description).toMatch(/prefilled Jupiter swaps? from your own wallet/);
    expect(BADGES.mirror.description).toContain("within 20%");
  });

  it("the Oracle Play and the landing Calls tile say where settlement comes from", () => {
    expect(playByKey("oracle")!.desc).toContain(CALLS_SETTLE_COPY);
    const landing = repoFile("src/app/page.tsx");
    expect(landing).toContain(CALLS_SETTLE_COPY);
    expect(landing).not.toMatch(/settled (by|from) Pyth/);
  });

  it("CLAUDE.md states the deep-link decision rather than a degrade path", () => {
    const brief = repoFile("CLAUDE.md");
    expect(brief).not.toMatch(/degrade/i);
    expect(brief).toMatch(/Mirror ships as "view allocation \+ open Jupiter with a prefilled swap per leg" by decision/);
  });

  it("HANDOFF carries the status banner and no longer claims ported code or real swaps", () => {
    const handoff = repoFile("docs/HANDOFF.md");
    expect(handoff.split(/\r?\n/)[2]).toMatch(/^> \*\*Status \(16 Sep 2026\):\*\*/);
    expect(handoff).not.toMatch(/Mirror executes real Jupiter swaps/);
    expect(handoff).not.toMatch(/copy another wallet's allocation with real swaps/);
    expect(handoff).not.toMatch(/dividend-aware Plays/);
    expect(handoff).not.toMatch(/Thirty apps/);
    expect(handoff).not.toMatch(/paste verbatim/);
    expect(handoff).toContain("no code was ported");
    expect(handoff).toContain("multiplier-correct holdings (splits and dividends normalised)");
    // Plain names (15 Sep): the banner still states how copying a portfolio ships, and that nothing executes a swap.
    expect(handoff).toMatch(/Copying a portfolio ships as an allocation view \+ one prefilled Jupiter swap per leg by decision/);
    expect(handoff).toContain("nothing in the app signs or sends a swap");
    expect(handoff).toContain("## 6. Pitch Video script (≤ 3:00");
    expect(handoff).toContain("## 6b. Technical Video script (≤ 5:00)");
  });
});

/**
 * The four rewards added on 16 Sep are catalogue rows only: no badge, no engine change. Their copy
 * is therefore the whole product, and a judge can check it against the rule beside it — so every
 * number a description states must match its own rule, and none may imply cash, a return or advice.
 */
describe("copy — the added catalogue rewards state their own rule", () => {
  const ADDED = ["thousand_club", "index_holder", "sector_spread", "ten_paper_trades"];
  const MONEY = /\b(profits?|returns?|yield|guaranteed|cash value|make money|earn money)\b/i;

  it("states each threshold and every scoped symbol in the reward's own words", () => {
    const thousand = playByKey("thousand_club")!;
    expect(thousand.rule).toMatchObject({ type: "hold_any", minUsd: 1000 });
    expect(thousand.desc).toContain("$1,000");
    // hold_any reads the LARGEST single position, so the copy may not promise a wallet total.
    expect(thousand.desc).toMatch(/largest position/i);
    expect(thousand.desc).not.toMatch(/\b(total|combined|altogether|across your wallet)\b/i);

    const index = playByKey("index_holder")!;
    const symbols = (index.rule as { assetSymbols?: readonly string[] }).assetSymbols ?? [];
    expect(symbols).toEqual(["SPYx", "QQQx", "VOOx", "VTIx"]);
    for (const symbol of symbols) expect(index.desc, symbol).toContain(symbol);
    expect(index.desc).toContain("$5");

    const spread = playByKey("sector_spread")!;
    expect(spread.rule).toMatchObject({ type: "diversified", minAssets: 5, minSectors: 4 });
    expect(spread.desc).toMatch(/\bfive\b/i);
    expect(spread.desc).toMatch(/\bfour sectors\b/i);

    const trades = playByKey("ten_paper_trades")!;
    expect(trades.rule).toMatchObject({ type: "internal_event", event: "league_trade", count: 10 });
    expect(trades.desc).toMatch(/\bten paper trades\b/i);
    // The engine counts these events from every week, so the copy may not promise a weekly window.
    expect(trades.desc).not.toMatch(/this week/i);
  });

  it("promises points only: no cash, no return, no badge it does not mint", () => {
    for (const key of ADDED) {
      const play = playByKey(key);
      expect(play, key).toBeDefined();
      expect(`${play!.title} ${play!.desc}`, key).not.toMatch(MONEY);
      expect(play!.badgeKey, key).toBeUndefined();
    }
  });
});

/**
 * Docs pass 1 (15 Sep): the repo goes public, so tracked docs must not carry claims a judge can
 * disprove, unsourced stats, entrant counts or internal odds; the videos have hard length limits.
 */
describe("public docs — sourced claims, private planning, video scripts", () => {
  const TRACKED_DOCS = ["docs/HANDOFF.md", "docs/REVIEW-2026-09-14.md", ".env.example", "README.md", "docs/SUBMISSION.md", "src/app/page.tsx"];
  const FALSE_OR_UNSOURCED = [
    /only consumer/i,
    /not one has a reason/i,
    /nobody gives users a reason/i,
    /no reason to come back/i,
    /only works on Solana/i,
    /impossible on a brokerage/i,
    /727,?000|727k/i,
    /\$0\.43|43 cents/i,
    /only 3% hold/i,
    /\b54 (apps|hackathon entries|submissions)\b|\b465 registered\b|\b(514|517|59|62) submissions\b/i,
    /probability|odds today|~0%/i,
  ];

  it("tracked docs carry no disprovable, unsourced or internal-odds claims", () => {
    for (const rel of TRACKED_DOCS) {
      const text = repoFile(rel);
      for (const re of FALSE_OR_UNSOURCED) expect(text, `${rel} matches ${re}`).not.toMatch(re);
    }
  });

  it("the landing hero leads with the sourced holder stat and the Solana section makes no exclusivity claim", () => {
    const landing = repoFile("src/app/page.tsx");
    expect(landing).toContain("800,000+ Solana addresses hold a tokenized stock (Blockworks via Solana Compass, 12 Sep 2026)");
    expect(landing).toContain("Why it works");
    expect(landing).toContain("{PARTNER_MARKS_NOTICE}");
  });

  it("REVIEW carries no spend or prize-share reasoning", () => {
    const review = repoFile("docs/REVIEW-2026-09-14.md");
    expect(review).not.toMatch(/\$\d[\d,]*\/mo|main pot|Vercel Pro for the judging window|removes the risk|a day of unfamiliar work/i);
  });

  it("README claims a Badge mint mechanism, and HANDOFF advertises no domain or handle availability", () => {
    const readme = repoFile("README.md");
    expect(readme).not.toMatch(/Badge is minted on mainnet/);
    // Plain names (15 Sep): the mechanism pin survives the rename. "queue" is the honest verb —
    // a completion queues a Badge row and a later tick mints it.
    expect(readme).toContain("queue a soulbound Token-2022 badge mint");
    expect(readme).toContain("press \"I've done my swaps\"");
    const handoff = repoFile("docs/HANDOFF.md");
    expect(handoff).not.toMatch(/unregistered|`dulofun` free|@dulofun` free/);
    expect(handoff).not.toMatch(/600\+ unit tests/);
    expect(handoff).toContain("The keypair file must live outside the repo");
    // 21 Sep: dulo.fun is NOT registered and hello@dulo.fun is not a mailbox. The repo is public
    // at github.com/djbigzzz/dulo and the app is served from Vercel, so no public file may present
    // dulo.fun as an address that resolves. Mentions are allowed only as "until/when it resolves".
    const submission = repoFile("docs/SUBMISSION.md");
    expect(submission).toContain("None is registered as of 21 Sep 2026");
    for (const [file, text] of [
      ["README.md", readme],
      ["docs/SUBMISSION.md", submission],
      ["CLAUDE.md", repoFile("CLAUDE.md")],
    ] as const) {
      expect(text, `${file} must not present dulo.fun as a live address`).not.toMatch(
        /(?:live|hosted|visit|available|deployed|app)\s+(?:at\s+)?(?:https?:\/\/)?dulo\.fun|https?:\/\/dulo\.fun\/?(?=[\s.,)]|$)(?![^\n]*resolv)/i,
      );
      expect(text, `${file} must not advertise a dulo.fun mailbox`).not.toMatch(/@dulo\.fun/);
    }
  });

  /**
   * README is the judge-facing front door (16 Sep rewrite). It opens with the shipped positioning
   * line, and carries the three claims a judge can check against reality: the compliance line as
   * the app words it, independence from the xStocks brand, and the ported-code disclosure.
   */
  it("README opens with the shipped positioning line and keeps the compliance, independence and origin claims", () => {
    const readme = repoFile("README.md");
    expect(readme).toContain(POSITIONING);
    expect(readme).toContain("Points only, no cash value.");
    expect(readme).toContain("Not investment advice. xStocks are not available to U.S. persons or in restricted jurisdictions.");
    expect(readme).toContain("Dulo is independent and not affiliated with xStocks");
    expect(readme).toContain("no code was ported");
    // Public page routes moved to plain names; an old path in the judge path would 308 at best.
    for (const stale of ["/plays`", "/rewards`", "/league`", "/paper-trading`", "/calls`", "/mirror`"]) expect(readme, stale).not.toContain(stale);
  });

  it("keypair files are git-ignored next to *.pem", () => {
    const ignore = repoFile(".gitignore").split(/\r?\n/).map((l) => l.trim());
    for (const pattern of ["*.pem", "badge-wallet.json", "*keypair*.json", "*-wallet.json", "id.json", "/keys/", "*.key"]) expect(ignore).toContain(pattern);
  });

  it("HANDOFF uses the sourced holder stat and the partner business model", () => {
    const handoff = repoFile("docs/HANDOFF.md");
    expect(handoff).toContain("800,000+ Solana addresses hold a tokenized stock (Blockworks via Solana Compass, 12 Sep 2026)");
    expect(handoff).toMatch(/Players are free, forever\. Partners list Plays and pay per verified completion, or sponsor a Season/);
    expect(handoff).not.toMatch(/competitor repos/i);
  });

  it("HANDOFF §4.3 marks the Jupiter key required and gives the Supabase / app URL production settings", () => {
    const handoff = repoFile("docs/HANDOFF.md");
    const env = handoff.slice(handoff.indexOf("### 4.3 Env"), handoff.indexOf("### 4.4"));
    expect(env).toMatch(/`JUPITER_API_KEY`: \*\*required\*\*/);
    expect(env).not.toMatch(/JUPITER_API_KEY` only lifts rate limits/);
    expect(env).toContain("us-east-1");
    expect(env).toContain("?pgbouncer=true&connection_limit=1&connect_timeout=5");
    expect(env).toMatch(/`NEXT_PUBLIC_APP_URL`: `https:\/\/<project>\.vercel\.app` until dulo\.fun actually resolves/);
    const example = repoFile(".env.example");
    expect(example).toMatch(/^JUPITER_API_KEY=.*REQUIRED in production/m);
    expect(example).toContain("pgbouncer=true&connection_limit=1&connect_timeout=5");
    expect(example).toMatch(/^NEXT_PUBLIC_APP_URL=.*<project>\.vercel\.app until dulo\.fun/m);
    expect(repoFile(".github/workflows/tick.yml")).toMatch(/APP_URL\s+= https:\/\/<project>\.vercel\.app/);
  });

  it("HANDOFF §8 says register + submit early (Wed), edit Friday", () => {
    const handoff = repoFile("docs/HANDOFF.md");
    const checklist = handoff.slice(handoff.indexOf("## 8. Submission checklist"), handoff.indexOf("## 9."));
    // 16 Sep: the hedge submission moved to Thu 17 (docs/SUBMISSION.md says the same). The pin still
    // holds the doc to "submit early, keep editing", never "wait for the deadline".
    expect(checklist).toContain("Register + submit early (Thu 17 Sep), edit until the close");
  });

  /** "m:ss" -> seconds. */
  const secs = (t: string) => {
    const [m, s] = t.split(":").map(Number);
    return m * 60 + s;
  };
  /** Rows of the first markdown table after `heading` whose first cell is a timestamp: [startSeconds, beat]. */
  function timedRows(text: string, heading: string): Array<[number, string]> {
    const from = text.indexOf(heading);
    expect(from, heading).toBeGreaterThanOrEqual(0);
    const rows: Array<[number, string]> = [];
    for (const line of text.slice(from).split(/\r?\n/).slice(1)) {
      if (/^#{2,3} /.test(line)) break;
      const m = /^\| (\d:\d{2}) \| ([^|]+) \|/.exec(line);
      if (m) rows.push([secs(m[1]), m[2].trim()]);
    }
    return rows;
  }

  it("the Pitch Video fits 3:00, opens on the vision and spends its core on verified rewards", () => {
    const handoff = repoFile("docs/HANDOFF.md");
    const target = /## 6\. Pitch Video[\s\S]*?\*\*Target (\d:\d{2})\.\*\*/.exec(handoff);
    expect(target).not.toBeNull();
    const end = secs(target![1]);
    expect(end).toBeLessThanOrEqual(180);
    const rows = timedRows(handoff, "### 6.2 Shot list");
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows[0][0]).toBe(0);
    // The vision hook owns the first 12 seconds: the second beat may not start later.
    expect(rows[1][0]).toBeLessThanOrEqual(12);
    let rewards = 0;
    rows.forEach(([start, beat], i) => {
      const next = i + 1 < rows.length ? rows[i + 1][0] : end;
      expect(next).toBeGreaterThan(start);
      if (/^(Check a wallet|Proof|Sign in and quests)$/.test(beat)) rewards += next - start;
    });
    // Verified rewards (check a wallet, its proof, sign in) stay the longest block of the film.
    expect(rewards / end).toBeGreaterThanOrEqual(0.33);
    const beats = rows.map(([, b]) => b).join(" | ");
    for (const b of ["Hook", "Problem", "Founder", "Check a wallet", "Proof", "Sign in and quests", "Compete", "Where it goes", "Ask"]) {
      expect(beats).toContain(b);
    }
    const section = handoff.slice(handoff.indexOf("## 6. Pitch Video"), handoff.indexOf("## 6b."));
    expect(section).toContain("built solo");
    expect(section).not.toMatch(/founder of|dum\.fun/i);
    expect(section).toContain("The entertainment layer for xStocks");
    expect(section).toMatch(/apps and issuers/);
    // Compliance and honesty: the sourced stat, the points line, and no invented traction number.
    expect(section).toContain("800,000+ Solana addresses hold a tokenized stock (Blockworks via Solana Compass, 12 Sep 2026)");
    expect(section).toContain("Points only, no cash value");
    expect(section).toContain("npm run -s stats");
    // Plain names and the new routes: the old page paths never appear in a shot.
    for (const oldPath of ["$APP/plays", "$APP/league", "$APP/calls", "$APP/mirror"]) expect(section, oldPath).not.toContain(oldPath);
    expect(section).toContain("### 6.3 Plan B");
  });

  it("the Technical Video fits 5:00 and tours the interfaces, the adapter, a reward row, the ledger, the tick, the swap links, the Badge and tests", () => {
    const handoff = repoFile("docs/HANDOFF.md");
    const target = /## 6b\. Technical Video[\s\S]*?\*\*Target (\d:\d{2})\.\*\*/.exec(handoff);
    expect(target).not.toBeNull();
    expect(secs(target![1])).toBeLessThanOrEqual(300);
    const rows = timedRows(handoff, "## 6b. Technical Video");
    expect(rows.at(-1)![0]).toBeLessThan(secs(target![1]));
    const section = handoff.slice(handoff.indexOf("## 6b."), handoff.indexOf("## 7. Risks"));
    for (const needle of [
      "src/lib/core/types.ts",
      "src/lib/core/caip.ts",
      "ScaledUiAmount",
      "src/lib/plays/engine.ts",
      "@@unique([userId, seasonId, ref])",
      "TICK_STEPS",
      ".data.health",
      "jupiterSwapUrl",
      "NonTransferable",
      "solscan.io/tx/",
      "npx vitest run",
    ]) {
      expect(section, needle).toContain(needle);
    }
    // The one engine change a second issuer needs is named on camera, not implied.
    expect(section).toContain("Play.assetSource");
    expect(section).toMatch(/AssetSource registry/);
    // The test count is read off the terminal on the day, never remembered.
    expect(section).toMatch(/Quote the number it prints/i);
  });

  it("internal planning notes live in a gitignored docs/private/, not in tracked docs/", () => {
    const ignore = repoFile(".gitignore").split(/\r?\n/).map((l) => l.trim());
    expect(ignore).toContain("/docs/private/");
    expect(existsSync(path.join(__dirname, "..", "docs/WIN-PLAN-2026-09-15.md"))).toBe(false);
    const review = repoFile("docs/REVIEW-2026-09-14.md");
    expect(review).toContain("Internal planning notes are kept privately");
    // The findings code comments cite stay tracked...
    for (const id of ["**H2.", "**H5.", "**M1.", "**M6.", "**M13.", "| L10 |", "| L13 |"]) expect(review).toContain(id);
    // ...the verdict, day plan, checklist and field notes do not.
    for (const heading of ["## 1. Win thesis", "## 2. Verdict", "## 4. Day plan", "## 7.", "## 8. Field notes"]) expect(review).not.toContain(heading);
  });

  it("tracked code never cites a path inside the gitignored docs/private/ notes", () => {
    const root = path.join(__dirname, "..");
    const privatePath = /docs\/(private\/)?WIN-PLAN|docs\/private\//;
    const self = path.join("tests", "copy.test.ts");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx|mts|js|mjs|css|json)$/.test(entry.name) && rel !== self && privatePath.test(readFileSync(path.join(root, rel), "utf8"))) offenders.push(rel);
      }
    };
    for (const dir of ["src", "scripts", "tests", "prisma", "public"]) walk(dir);
    expect(offenders).toEqual([]);
  });
});
