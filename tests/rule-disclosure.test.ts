import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PlayRule } from "@/lib/plays/rules";
import { ruleToHint } from "@/components/plays/rule-hint";
import { RULE_DISCLOSURE_GLOSS, RULE_DISCLOSURE_LABEL, RuleDisclosure } from "@/components/plays/RuleDisclosure";
import { PlayCard } from "@/components/plays/PlayCard";

/**
 * "See the rule": every reward prints the literal rule row the engine evaluates, next to its
 * proof. A reward is a JSON rule (lib/plays/engine.ts), so the rule is the promise — a judge
 * reads the exact object rather than a sentence about it.
 *
 * Native <details> is the contract under test: it is keyboard accessible and works with no JS,
 * and its panel is present in server-rendered markup (a useState panel would render collapsed
 * and empty in this node-environment suite).
 */

const ROOT = path.resolve(__dirname, "..");
const repoFile = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const NVDAX_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";

function render(rule: PlayRule, showHint?: boolean): string {
  return renderToStaticMarkup(createElement(RuleDisclosure, showHint === undefined ? { rule } : { rule, showHint }));
}

/** React escapes quotes and apostrophes; decode so the JSON can be compared literally. */
function decode(html: string): string {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Visible text of the <summary> control, tags stripped (the chevron is an aria-hidden svg). */
function summaryText(html: string): string {
  const m = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html);
  return (m?.[1] ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("RuleDisclosure — the literal rule beside the proof", () => {
  it("prints the exact pretty-printed rule JSON for every Season 0 rule shape", () => {
    const rules: PlayRule[] = [
      { type: "hold_any", minUsd: 5 },
      { type: "diversified", minAssets: 3, minSectors: 2 },
      { type: "hold_consecutive", days: 7, minUsd: 5, assetSymbols: ["NVDAx"] },
      { type: "internal_event", event: "league_trade", count: 3 },
      { type: "mirror_match", tolerance: 0.2 },
      { type: "hold_any", minUsd: 5, assetIds: [NVDAX_ID] },
    ];
    for (const rule of rules) {
      const text = decode(render(rule));
      // Byte-for-byte the stored row, two-space indented — not a re-description of it.
      expect(text, rule.type).toContain(JSON.stringify(rule, null, 2));
    }
    // Pretty-printed, not a single minified line.
    const html = decode(render({ type: "hold_any", minUsd: 5 }));
    expect(html).toContain('{\n  "type": "hold_any",\n  "minUsd": 5\n}');
    expect(html).not.toContain('{"type":"hold_any","minUsd":5}');
    // A long CAIP-19 asset id survives in full: the value is evidence, never shortened here.
    expect(decode(render({ type: "hold_any", minUsd: 5, assetIds: [NVDAX_ID] }))).toContain(NVDAX_ID);
  });

  it("labels the control with a plain name and no betting word", () => {
    expect(RULE_DISCLOSURE_LABEL).toBe("See the rule");
    const banned = [
      /\bplays?\b/i,
      /\bleagues?\b/i,
      /\bmirror(?:s|ed|ing)?\b/i,
      /\bcalls?\b/i,
      /\bscout\b/i,
      /\boracle\b/i,
      /\bstakes?\b|\bstaked\b|\bstaking\b/i,
      /\bodds\b/i,
      /\bpayouts?\b/i,
      /\bbets?\b|\bbetting\b/i,
    ];
    for (const re of banned) expect(re.test(RULE_DISCLOSURE_LABEL), `${re}`).toBe(false);
    // The rendered control says exactly that, and nothing else.
    expect(summaryText(render({ type: "internal_event", event: "league_trade", count: 3 }))).toBe(RULE_DISCLOSURE_LABEL);
  });

  it("shows the plain-English sentence above the JSON, and drops it when the card already prints it", () => {
    const rule: PlayRule = { type: "diversified", minAssets: 3, minSectors: 2 };
    const hint = ruleToHint(rule);
    expect(hint).toBe("3+ xStocks across 2+ sectors in your wallet");

    const withHint = decode(render(rule));
    expect(withHint).toContain(hint);
    // Above the JSON, not below it.
    expect(withHint.indexOf(hint)).toBeLessThan(withHint.indexOf('"minAssets"'));

    const withoutHint = decode(render(rule, false));
    expect(withoutHint).not.toContain(hint);
    expect(withoutHint).toContain(JSON.stringify(rule, null, 2));
  });

  it("is a collapsed, keyboard-accessible native disclosure with a visible focus ring", () => {
    const html = render({ type: "hold_any", minUsd: 5 });
    // Native details/summary: focusable and toggled by Enter/Space with no JS.
    expect(html).toMatch(/^<details/);
    expect(html).toContain("<summary");
    // Collapsed by default.
    expect(html).not.toMatch(/<details[^>]*\sopen[\s>]/);
    const summary = /<summary[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(summary).toContain("focus-visible:ring-2");
    expect(summary).toContain("focus-visible:ring-[var(--focus)]");
    expect(summary).toContain("cursor-pointer");
  });

  it("renders the JSON in its own horizontally scrolling inset well (375 px safe)", () => {
    const html = render({ type: "hold_any", minUsd: 5, assetIds: [NVDAX_ID] });
    const pre = /<pre[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
    // Wide content scrolls inside the block, so the page never scrolls sideways.
    expect(pre).toContain("overflow-x-auto");
    expect(pre).toContain("max-w-full");
    expect(pre).toContain("font-mono");
    expect(pre).toContain("text-xs");
    // docs/DESIGN.md inset well.
    expect(pre).toContain("rounded-xl");
    expect(pre).toContain("bg-black/25");
    expect(pre).toContain("border-white/[0.06]");
    // Gold is heritage and rank, never an action: the control does not wear it.
    expect(html).not.toContain("text-gold");
  });

  it("glosses game_action and distinctBy in plain words, keeping every earlier glossed name", () => {
    for (const token of ["league_trade", "call_placed", "mirror_match"]) expect(RULE_DISCLOSURE_GLOSS, token).toContain(token);
    expect(RULE_DISCLOSURE_GLOSS).toContain("game_action a paper trade or a new prediction");
    expect(RULE_DISCLOSURE_GLOSS).toContain("distinctBy");
    for (const value of ["(ref)", "(symbol)", "(day)"]) expect(RULE_DISCLOSURE_GLOSS, value).toContain(value);
    const rule: PlayRule = { type: "internal_event", event: "game_action", count: 3, distinctBy: "day" };
    const text = decode(render(rule));
    expect(text).toContain(JSON.stringify(rule, null, 2));
    expect(text).toContain(RULE_DISCLOSURE_GLOSS);
    expect(text).toContain("Be active on 3 different days (UTC)");
  });

  it("never throws on a malformed rule row", () => {
    for (const bad of [{ type: "unknown", raw: {} }, { type: "hold_any" }, {}]) {
      expect(() => render(bad as unknown as PlayRule)).not.toThrow();
    }
    // An unknown type still prints verbatim: the row is the evidence, whatever it holds.
    expect(decode(render({ type: "unknown", raw: {} } as unknown as PlayRule))).toContain('"type": "unknown"');
  });
});

describe("RuleDisclosure is mounted beside every reward's proof", () => {
  it("sits on the signed-in reward card without repeating the card's own sentence", () => {
    const card = repoFile("src/components/plays/PlayCard.tsx");
    expect(card).toContain('import { RuleDisclosure } from "@/components/plays/RuleDisclosure"');
    expect(card).toContain("<RuleDisclosure");
    expect(card).toContain("showHint={false}");
    // The card still prints the sentence itself, under the title (in the quest issuer's noun).
    expect(card).toContain("{ruleToHint(play.rule, assetSource)}");
    // 16 Sep: quest cards link to no buy, so the card carries no swap button and no swap note
    // (the compliance line prints once under the on-chain group instead; plays.test.ts).
    expect(card).not.toContain("START_IN_JUPITER_NOTE");
    expect(card).not.toContain("{where.note}");
    expect(card).not.toContain("jup.ag");
    expect(card).not.toMatch(/opens Jupiter/);
    const html = renderToStaticMarkup(
      createElement(PlayCard, {
        play: { key: "first_position", title: "First Position", desc: "", points: 100, badgeKey: null, rule: { type: "hold_any", minUsd: 5 }, completions: 0, comingSoon: false },
      }),
    );
    expect(html).toContain('data-slot="rule-disclosure"');
    expect(html).not.toMatch(/swap|jupiter|<a [^>]*target="_blank"/i);
  });

  it("sits on /check's preview card, which also already prints the sentence", () => {
    const card = repoFile("src/app/check/_components/PreviewPlayCard.tsx");
    expect(card).toContain('import { RuleDisclosure } from "@/components/plays/RuleDisclosure"');
    expect(card).toContain("<RuleDisclosure rule={play.rule} showHint={false} />");
    expect(card).toContain("{ruleToHint(play.rule, play.assetSource)}");
    // Unchanged pins from tests/preview-ui.test.ts.
    expect(card).toContain('import { ProofList } from "@/components/plays/ProofDrawer"');
    expect(card).toContain("<ProofList entries={entries} />");
    expect(card).not.toContain("{e.key}");
  });
});
