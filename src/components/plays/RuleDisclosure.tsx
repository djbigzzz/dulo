import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import type { PlayRule } from "@/lib/plays/rules";
import { ruleToHint } from "@/components/plays/rule-hint";

/**
 * "See the rule": the literal stored rule, collapsed, beside a quest's proof.
 *
 * A quest is a JSON rule row evaluated by lib/plays/engine.ts, so the rule IS the promise.
 * Printing it verbatim lets anyone read the exact object the engine checks instead of trusting
 * a sentence about it — the same honesty the proof drawer gives the evidence.
 *
 * Native <details>: keyboard accessible, works with no JS, and (unlike a useState panel) its
 * content is present in server-rendered markup, so the JSON is assertable in tests.
 *
 * The block is the stored machine rule, printed unedited, so it carries internal identifiers.
 * The plain-English sentence is the copy a player reads: the cards already print it under the
 * title and pass showHint={false}; standalone callers get it above the JSON.
 */

export const RULE_DISCLOSURE_LABEL = "See the rule";

/**
 * The caption under the control and above the JSON. The stored rule is printed byte-exact, so the
 * engine's internal identifiers reach the screen — including the retired product nouns
 * (league_trade, call_placed, mirror_match). Naming them as internal names is what keeps them from
 * reading as product vocabulary; tests/plain-names.test.ts pins that every identifier a live rule
 * can print is named here.
 */
export const RULE_DISCLOSURE_GLOSS =
  "The stored rule, exactly as the engine reads it. Internal names: league_trade is a paper trade, call_placed a prediction, game_action a paper trade or a new prediction, mirror_match a copied portfolio. distinctBy counts each question (ref), xStock (symbol) or UTC day (day) once.";

/** JSON text that never throws (a malformed row, a cycle) and never renders "undefined". */
function ruleJson(rule: PlayRule): string {
  try {
    return JSON.stringify(rule, null, 2) ?? "null";
  } catch {
    return "null";
  }
}

export interface RuleDisclosureProps {
  rule: PlayRule;
  /**
   * Print the plain-English hint above the JSON. False on a card that already shows
   * ruleToHint under its title, so the sentence is never duplicated.
   */
  showHint?: boolean;
  className?: string;
}

export function RuleDisclosure({ rule, showHint = true, className }: RuleDisclosureProps) {
  return (
    <details data-slot="rule-disclosure" className={cn("group min-w-0", className)}>
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg py-2 text-xs font-medium text-muted-foreground outline-none transition-colors select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
        {RULE_DISCLOSURE_LABEL}
        <ChevronDownIcon
          className="size-3.5 shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="flex min-w-0 flex-col gap-2 pb-1">
        {showHint ? <p className="text-xs leading-relaxed text-muted-foreground">{ruleToHint(rule)}</p> : null}
        {/* Always shown, never gated on showHint: the JSON below carries internal identifiers on
            every surface that mounts this, so the caption travels with it. */}
        <p className="text-xs leading-relaxed text-muted-foreground">{RULE_DISCLOSURE_GLOSS}</p>
        <pre className="max-w-full overflow-x-auto rounded-xl border border-white/[0.06] bg-black/25 p-3 font-mono text-xs leading-relaxed text-foreground shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]">
          {ruleJson(rule)}
        </pre>
      </div>
    </details>
  );
}

export default RuleDisclosure;
