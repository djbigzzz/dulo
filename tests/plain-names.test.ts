import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POSITIONING } from "@/lib/config";
import { MOBILE_TABS, NAV_ITEMS } from "@/components/layout/nav";
import { activePlays } from "@/lib/plays/catalogue";
import type { PlayRule } from "@/lib/plays/rules";
import { RULE_DISCLOSURE_GLOSS, RuleDisclosure } from "@/components/plays/RuleDisclosure";

/**
 * Plain names (founder decision, 15 Sep 2026, updated 16 Sep). Play / Streak / Call / League / Mirror
 * survive as internal code names only: Prisma models, playKey values, /api/v1 paths, file and module
 * names. Every user-facing string says quests, the competition (virtual cash), predictions, copy a
 * portfolio, points. "Rewards" was the public noun for a Play until 16 Sep; it is retired too.
 *
 * This scan is a net, not a proof: it reads string literals and JSX text out of the files that
 * carry copy, and skips the places the old words legitimately survive (import specifiers,
 * data-slot and class tokens, ledger refs, server logs and thrown developer errors).
 */

const ROOT = path.resolve(__dirname, "..");

const BANNED: { re: RegExp; use: string }[] = [
  // The noun only: "to play" and "as you play" are the ordinary verb (the welcome offer line, the
  // landing steps). "a Play", "Plays live" and "your play" still fail.
  { re: /(?<!\b(?:to|you|we|they) )\bplays?\b/i, use: "quest / quests" },
  { re: /\bleagues?\b/i, use: "the competition (virtual cash)" },
  { re: /\bmirror(?:s|ed|ing)?\b/i, use: "copy a portfolio / portfolio match" },
  { re: /\bcalls?\b/i, use: "prediction / predictions" },
  { re: /\bscout\b/i, use: "First Paper Trades" },
  { re: /\boracle\b/i, use: "First Prediction" },
  { re: /\bDCA streak\b/i, use: "Steady Buyer" },
  { re: /\bstakes?\b|\bstaked\b|\bstaking\b/i, use: '"points in" / "put in points"' },
  { re: /\bodds\b/i, use: '"current split" / "share of the pool"' },
  { re: /\bpayouts?\b/i, use: '"points back"' },
  { re: /\bbets?\b|\bbetting\b/i, use: "prediction" },
  { re: /\bprediction markets?\b/i, use: "predictions" },
  { re: /every transaction is a play/i, use: "the current positioning line" },
  // Word-bounded, so the positioning line's "get rewarded" (byte-exact, shipped) is not caught.
  { re: /\brewards?\b/i, use: "quest / quests (renamed 16 Sep)" },
];

/**
 * Code identifiers that are a banned word on their own: playKey and badgeKey values, ledger ref
 * kinds, an API path segment and two keys of a `Pick<...>` type literal. The decision keeps all of
 * these as they are and none of them reaches a screen. Lowercase is the point: a capitalised
 * "Mirror" or "League" is a label, and still fails.
 */
const ALLOWED_TOKENS = new Set(["plays", "payout", "odds", "mirror", "scout", "oracle", "league", "call", "calls"]);

const isTest = (name: string) => /\.test\.tsx?$/.test(name);

function walk(rel: string, keep: (name: string, rel: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(child, keep, out);
    else if (keep(entry.name, child)) out.push(child);
  }
  return out;
}

/** Every file that holds a string a user can read. */
function copyFiles(): string[] {
  const files = [
    // Pages, layouts, the OG/Twitter images, the manifest, the not-found and offline shells,
    // the per-page _components, and the preview payload the landing renders.
    ...walk(
      "src/app",
      (name, rel) =>
        !isTest(name) &&
        (name.endsWith(".tsx") || name === "manifest.ts" || rel.endsWith("/_components/check-format.ts") || rel.endsWith("/api/v1/preview/preview.ts")),
    ),
    // Components and the copy constants that sit beside them (play-meta, calls-format, nav, ...).
    ...walk("src/components", (name) => !isTest(name) && /\.tsx?$/.test(name)),
    "src/lib/config.ts",
    "src/lib/plays/catalogue.ts",
    "src/lib/plays/partners.ts",
    "src/lib/badges/keys.ts",
    // The badge metadata document: wallets and explorers render it, and the mint's uri is permanent.
    "src/lib/badges/designs.ts",
    "src/lib/games/league.ts",
    "src/lib/games/calls.ts",
    "src/lib/mirror/events.ts",
    // The points policy: its welcome and hint sentences are shown verbatim.
    "src/lib/games/ledger-policy.ts",
  ];
  for (const rel of files) expect(existsSync(path.join(ROOT, rel)), rel).toBe(true);
  return files;
}

interface Candidate {
  kind: "string" | "jsx";
  text: string;
}

/** Text that is code rather than prose, so JSX runs captured between tags can be dropped. */
const CODEY = /[=;`\\_?|()[\]{}]|\.\w|\$\{/;

/**
 * String literals, and (in .tsx) the text between JSX tags. Comments are dropped, template
 * expressions collapse to  so `call:${id}:stake:` stays one token, and strings handed to
 * console.* or `new Error(...)` are dropped: they are logs and developer errors, not copy.
 */
function candidates(src: string, jsx: boolean): Candidate[] {
  const out: Candidate[] = [];
  let buf = "";
  let collecting = false;
  let i = 0;
  const flush = () => {
    const text = buf.trim();
    if (text) out.push({ kind: "jsx", text });
    buf = "";
  };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      flush();
      collecting = false;
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      flush();
      collecting = false;
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      flush();
      collecting = false;
      const logged = /(?:console\.\w+|new [A-Z]\w*Error|new Error)\s*\(\s*$/.test(src.slice(Math.max(0, i - 120), i));
      const quote = c;
      let text = "";
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          text += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
          let depth = 1;
          i += 2;
          while (i < src.length && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            i++;
          }
          text += "";
          continue;
        }
        text += src[i++];
      }
      if (!logged) out.push({ kind: "string", text });
      continue;
    }
    if (jsx) {
      if (c === ">") {
        flush();
        collecting = src[i - 1] !== "=";
        i++;
        continue;
      }
      if (c === "<" || c === "{" || c === ";") {
        flush();
        collecting = false;
        i++;
        continue;
      }
      if (c === "}") {
        flush();
        collecting = true;
        i++;
        continue;
      }
      if (collecting) {
        buf += src[i++];
        continue;
      }
    }
    i++;
  }
  flush();
  return out;
}

/** A Tailwind class list: all lowercase, and most of its tokens carry a -, : or / . */
function classLike(t: string): boolean {
  if (/[A-Z]/.test(t)) return false;
  const tokens = t.split(/\s+/);
  return tokens.length > 1 && tokens.filter((tok) => /^[a-z0-9[]/.test(tok) && /[-:/]/.test(tok)).length >= Math.ceil(tokens.length / 2);
}

/** A candidate worth checking, or null when it is an identifier, a path or a class list. */
function prose({ kind, text }: Candidate): string | null {
  const t = text.replace(//g, "").trim();
  if (!t || !/[A-Za-z]/.test(t)) return null;
  if (kind === "jsx") return CODEY.test(t) ? null : t;
  // No whitespace: an import specifier, a route, a data-slot, a ledger ref or a class fragment.
  // Only a bare word ("Mirror" as a button label) is still copy.
  if (!/\s/.test(t)) return /^[A-Za-z]+$/.test(t) && !ALLOWED_TOKENS.has(t) ? t : null;
  return classLike(t) ? null : t;
}

describe("plain names — no retired vocabulary in user-facing copy", () => {
  it("scans the files that carry copy", () => {
    expect(copyFiles().length).toBeGreaterThan(40);
  });

  it("no user-facing string says Play, League, Call, Mirror, Scout, Oracle or a betting word", () => {
    const offenders: string[] = [];
    for (const rel of copyFiles()) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      for (const candidate of candidates(src, rel.endsWith(".tsx"))) {
        const text = prose(candidate);
        if (!text) continue;
        for (const { re, use } of BANNED) {
          if (re.test(text)) offenders.push(`${rel}: ${JSON.stringify(text.slice(0, 120))} — say ${use}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the positioning line is the plain-names one", () => {
    expect(POSITIONING).toBe("The entertainment layer for xStocks. Compete, predict and get rewarded, for points.");
    // The rewards ban is word-bounded: the positioning line's "rewarded" is not a retired noun.
    for (const { re } of BANNED) expect(re.test(POSITIONING), String(re)).toBe(false);
  });

  it("quest is the public noun: no banned pattern matches it", () => {
    for (const word of ["Quests", "quest", "quests", "Quest complete", "On-chain quest"]) {
      for (const { re } of BANNED) expect(re.test(word), `${re} matches ${word}`).toBe(false);
    }
    // Not vacuous: the ban does fire on the retired noun.
    expect(BANNED.some(({ re }) => re.test("Rewards live"))).toBe(true);
    expect(BANNED.some(({ re }) => re.test("earn a reward"))).toBe(true);
  });

  it("play the verb is allowed, Play the noun is not", () => {
    const hits = (text: string) => BANNED.some(({ re }) => re.test(text));
    expect(hits("$10,000 of virtual cash to play.")).toBe(false);
    expect(hits("in-platform ones as you play, on-chain ones from your wallet")).toBe(false);
    for (const noun of ["Complete a Play", "Plays live", "your play is verified", "Play completed", "This play"]) {
      expect(hits(noun), noun).toBe(true);
    }
  });

  it("every nav label is a plain name", () => {
    const labels = [...NAV_ITEMS, ...MOBILE_TABS].map((item) => item.label);
    expect(labels).toContain("Quests");
    expect(labels).toContain("Competition");
    expect(labels).toContain("Predictions");
    expect(labels).toContain("Copy a portfolio");
    expect(labels).toContain("Leaderboard");
    // Desktop only (22 Sep): Pre-IPO sits between Quests and Copy a portfolio; the phone keeps five tabs.
    expect(NAV_ITEMS.map((item) => item.label)).toEqual(["Predictions", "Competition", "Quests", "Pre-IPO", "Copy a portfolio", "Leaderboard"]);
    expect(MOBILE_TABS).toHaveLength(5);
    expect(MOBILE_TABS.map((item) => item.label)).not.toContain("Pre-IPO");
    expect(labels).not.toContain("Rewards");
    expect(labels).not.toContain("Paper trading");
    for (const label of labels) for (const { re } of BANNED) expect(re.test(label), label).toBe(false);
  });
});

/**
 * The scan above reads source: string literals and JSX text. It cannot see the stored rule JSON,
 * which is serialised at render time — and ALLOWED_TOKENS deliberately whitelists the lowercase
 * identifiers inside it as code. So the retired nouns the engine keys on (league_trade,
 * call_placed, mirror_match) do reach the screen, through "See the rule" on every quest card
 * (/quests, /partners/[slug]) and every card on /check/[address].
 *
 * Printing the rule verbatim is the honest call; shipping it bare is what would break plain names.
 * These cases pin the gloss that travels with it, so a new rule type cannot reintroduce a bare
 * internal noun on the most judge-facing board in the app.
 */
describe("plain names — the verbatim rule JSON ships a gloss", () => {
  /** Retired product nouns, found inside snake_case identifiers where a \b anchor cannot reach them. */
  const RETIRED = /league|call|mirror|scout|oracle|play/i;

  /** Every string in a rule's serialised form that still carries a retired product noun. */
  function retiredTokens(rule: PlayRule): string[] {
    const quoted = JSON.stringify(rule, null, 2).match(/"[^"]*"/g) ?? [];
    return [...new Set(quoted.map((s) => s.slice(1, -1)).filter((s) => RETIRED.test(s)))];
  }

  it("names every internal identifier a live quest's rule can print", () => {
    const tokens = [...new Set(activePlays().flatMap((play) => retiredTokens(play.rule)))].sort();
    // Not vacuous: the live catalogue really does serialise these three today.
    expect(tokens).toEqual(expect.arrayContaining(["call_placed", "league_trade", "mirror_match"]));
    for (const token of tokens) {
      expect(RULE_DISCLOSURE_GLOSS, `${token} is printed verbatim but never glossed`).toContain(token);
    }
  });

  it("renders the gloss beside the JSON for every live rule, hint or no hint", () => {
    for (const play of activePlays()) {
      for (const showHint of [true, false]) {
        const html = renderToStaticMarkup(createElement(RuleDisclosure, { rule: play.rule, showHint }));
        const text = html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
        // The rule stays byte-exact...
        expect(text, play.key).toContain(JSON.stringify(play.rule, null, 2));
        // ...and never travels without the sentence that reads its internal names back in plain words.
        expect(text, play.key).toContain(RULE_DISCLOSURE_GLOSS);
      }
    }
  });
});
