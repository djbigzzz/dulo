import type { PlayRule } from "@/lib/plays/rules";

/**
 * One-line hints for quest rules, shown under quest titles and in the proof drawer.
 * Presentation only: the engine (lib/plays/engine.ts) is the truth. On-chain rules are
 * phrased as the wallet state that completes them, never as an instruction: none of them
 * says to buy, add to or top up anything. In-platform rules (virtual cash, points) stay
 * second-person.
 *
 *   hold_any            -> "Any xStock worth $5+ in your wallet"
 *   diversified         -> "3+ xStocks across 2+ sectors in your wallet"
 *   hold_consecutive    -> "The same xStock held for 7 daily snapshots in a row"
 *   net_increase_days   -> "xStocks balance up on 3 separate days in any 14-day window"
 *   hold_through_date   -> "Held through an earnings date"
 *   mirror_match        -> "Wallet allocation within 20% of a portfolio you copied"
 *   internal_event      -> "Make 3 paper trades" / "Make a prediction"
 *     + distinctBy        -> "Make predictions on 3 different questions" (ref)
 *                            "Make paper trades in 3 different xStocks" (symbol)
 *                            "Be active on 3 different days (UTC)" (day)
 *
 * Client-safe; no server imports. Unknown rule types (a malformed DB row) degrade
 * to a generic sentence instead of throwing.
 */

/** "$5", "$1,000", "$2.50": thousands grouped, so a hint matches its quest's description. */
function usd(n: number): string {
  const digits = Number.isInteger(n) ? 0 : 2;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** First letter upper-cased, for a scope label that opens the sentence ("any xStock" -> "Any xStock"). */
function cap(text: string): string {
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

/** "any xStock" | "NVDAx" | "NVDAx or TSLAx" | "a selected xStock" | "a partner position". */
function scopeLabel(rule: PlayRule): string {
  if (Array.isArray(rule.partnerAssetIds)) return "a partner position";
  const syms = rule.assetSymbols ?? [];
  if (syms.length === 0) {
    // Scoped by CAIP-19 assetIds without display symbols: name the count, not the id.
    const n = Array.isArray(rule.assetIds) ? rule.assetIds.length : 0;
    if (n === 0) return "any xStock";
    return n === 1 ? "a selected xStock" : `one of ${n} selected xStocks`;
  }
  if (syms.length === 1) return syms[0];
  if (syms.length === 2) return `${syms[0]} or ${syms[1]}`;
  return `${syms.slice(0, -1).join(", ")} or ${syms[syms.length - 1]}`;
}

/** " worth $5+" or "" when the rule has no positive minUsd. */
function worth(rule: PlayRule): string {
  const min = "minUsd" in rule ? rule.minUsd : undefined;
  return typeof min === "number" && min > 0 ? ` worth ${usd(min)}+` : "";
}

type DistinctBy = "ref" | "symbol" | "day";

/** The hint for a rule that counts distinct keys, or null to fall back to the plain count. */
function distinctHint(event: string, count: number, distinctBy: DistinctBy): string | null {
  switch (distinctBy) {
    case "ref":
      if (event === "call_placed") return `Make predictions on ${plural(count, "different question")}`;
      return null;
    case "symbol":
      if (event === "league_trade") return `Make paper trades in ${plural(count, "different xStock")}`;
      return null;
    case "day":
      if (event === "game_action") return `Be active on ${plural(count, "different day")} (UTC)`;
      return null;
    default:
      return null;
  }
}

export function eventHint(event: string, count: number, distinctBy?: DistinctBy): string {
  if (distinctBy) {
    const hint = distinctHint(event, count, distinctBy);
    if (hint) return hint;
  }
  switch (event) {
    case "league_trade":
      return count === 1 ? "Make a paper trade" : `Make ${plural(count, "paper trade")}`;
    case "call_placed":
      return count === 1 ? "Make a prediction" : `Make ${plural(count, "prediction")}`;
    case "game_action":
      return count === 1 ? "Make a paper trade or a prediction" : `Make ${count} paper trades or predictions`;
    case "mirror_executed":
      return count === 1 ? "Copy a wallet's portfolio" : `Copy a wallet's portfolio ${plural(count, "time")}`;
    default: {
      const label = event.replace(/_/g, " ");
      return count === 1 ? `Trigger a ${label} event` : `Trigger ${count} ${label} events`;
    }
  }
}

export function ruleToHint(rule: PlayRule): string {
  switch (rule.type) {
    case "hold_any":
      return `${cap(scopeLabel(rule))}${worth(rule)} in your wallet`;
    case "diversified":
      return `${rule.minAssets}+ xStocks across ${rule.minSectors}+ ${rule.minSectors === 1 ? "sector" : "sectors"}${worth(rule) ? ` (each${worth(rule)})` : ""} in your wallet`;
    case "hold_consecutive": {
      const what = rule.assetSymbols?.length === 1 ? rule.assetSymbols[0] : "The same xStock";
      return `${what}${worth(rule)} held for ${plural(rule.days, "daily snapshot")} in a row`;
    }
    case "net_increase_days":
      return `xStocks balance up on ${plural(rule.count, "separate day")} in any ${rule.window}-day window`;
    case "hold_through_date": {
      const calendar = rule.calendarKey === "earnings" ? "an earnings date" : `a ${rule.calendarKey} date`;
      const what = rule.assetSymbols?.length === 1 ? `${rule.assetSymbols[0]} held` : "Held";
      return `${what} through ${calendar}`;
    }
    case "mirror_match":
      return `Wallet allocation within ${Math.round(rule.tolerance * 100)}% of a portfolio you copied`;
    case "internal_event":
      return eventHint(rule.event, rule.count, rule.distinctBy);
    default:
      // A rule type this build does not know (bad DB row or a newer engine). Never throw in the UI.
      return "Complete the on-chain action";
  }
}

export default ruleToHint;
