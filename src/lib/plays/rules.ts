import { z } from "zod";
import { isAssetId } from "@/lib/core/caip";
import earningsCalendar from "./earnings-2026.json";

/**
 * Play rules.
 *
 * A Play is a JSON rule stored on the Play row and evaluated by lib/plays/engine.ts.
 * Adding a Play is a DB row, not code — so the schema here is the contract between
 * the seed, the engine and the UI. Keep it strict: unknown keys are rejected so a
 * typo in a rule fails at seed time instead of silently never completing.
 *
 * This file is client-safe (zod + a JSON import only). No server imports.
 */

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** A Play symbol such as "TSLAx". Trimmed, non-empty, no whitespace. */
const symbolSchema = z
  .string()
  .trim()
  .min(1, "symbol must not be empty")
  .max(16, "symbol too long")
  .regex(/^[A-Za-z0-9.\-]+$/, "symbol must be alphanumeric");

/**
 * A CAIP-19 asset id such as "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:<mint>".
 * Asset IDs are CAIP-19 strings everywhere (DB JSON, API payloads); a bare mint is rejected
 * so a rule can never silently key on the wrong chain.
 */
const assetIdSchema = z
  .string()
  .trim()
  .max(256, "asset id too long")
  .refine(isAssetId, "must be a CAIP-19 asset id (chain:ref/namespace:ref)");

/** USD threshold. Zero is allowed ("any dust") but negatives are not. */
const usdSchema = z.number().finite().nonnegative();

/**
 * Fields every rule type may carry.
 *  - assetIds: restrict the rule to these assets (CAIP-19). Omit = any in-scope asset.
 *  - assetSymbols: the symbols the rule is scoped to, matched case-insensitively (e.g. ["NVDAx"]).
 *    Holding rules use it only when assetIds is absent (engine scopeOf) and hints name it. On an
 *    internal_event rule (22 Sep) it narrows the counted events to those whose meta.symbol is in
 *    the list, so an in-platform quest can be fenced to a symbol set (the eight pre-IPO tokens,
 *    say) with no new field: an internal_event rule without it counts every event as before.
 *  - partnerAssetIds: evaluate against these partner receipt / obligation assets (CAIP-19)
 *    instead of xStocks. An empty array means "partner listing pending": the engine must
 *    treat it as never satisfied.
 */
const scopeFields = {
  assetIds: z.array(assetIdSchema).max(64).optional(),
  assetSymbols: z.array(symbolSchema).max(64).optional(),
  partnerAssetIds: z.array(assetIdSchema).max(64).optional(),
};

/** Calendars a hold_through_date rule may reference. Only "earnings" ships in Season 0. */
export const CALENDAR_KEYS = ["earnings"] as const;
export type CalendarKey = (typeof CALENDAR_KEYS)[number];

/**
 * Internal event types emitted by game modules and consumed by internal_event rules.
 *  - league_trade     one paper trade in the weekly competition (ref: trade id; meta.symbol).
 *  - call_placed      one prediction position (ref: market id; both sides share it, top-ups add none).
 *  - mirror_executed  a recorded portfolio copy intent (read by mirror_match).
 *  - game_action      derived, read-only: one per paper trade (ref `trade:<id>`) and one per
 *                     prediction position (ref `prediction:<marketId>:<side>`, ts = createdAt),
 *                     so a day with any in-platform activity counts as a game day.
 */
export const INTERNAL_EVENT_TYPES = ["league_trade", "call_placed", "mirror_executed", "game_action"] as const;
export type InternalEventType = (typeof INTERNAL_EVENT_TYPES)[number];

/**
 * How an internal_event rule de-duplicates its events before counting (first occurrence wins):
 *  - ref     one per event ref (call_placed: one per question, whichever sides were taken);
 *  - symbol  one per upper-cased meta.symbol (league_trade: one per xStock); events without one are skipped;
 *  - day     one per UTC calendar day of the event ts (game_action: one per active day).
 */
export const DISTINCT_BY_KEYS = ["ref", "symbol", "day"] as const;
export type DistinctBy = (typeof DISTINCT_BY_KEYS)[number];

/** Event names are snake_case identifiers. Not an enum so a new game can emit a new event without a schema change. */
const eventNameSchema = z
  .string()
  .trim()
  .min(1, "event must not be empty")
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "event must be snake_case");

// ---------------------------------------------------------------------------
// Rule types
// ---------------------------------------------------------------------------

/** Hold any in-scope asset worth at least minUsd in the latest snapshot. */
export const HoldAnyRuleSchema = z.strictObject({
  type: z.literal("hold_any"),
  minUsd: usdSchema,
  ...scopeFields,
});

/** Hold the same asset (>= minUsd) in `days` consecutive daily snapshots. */
export const HoldConsecutiveRuleSchema = z.strictObject({
  type: z.literal("hold_consecutive"),
  days: z.int().positive().max(365),
  minUsd: usdSchema.optional(),
  ...scopeFields,
});

/** Net in-scope balance increased on `count` distinct days inside any rolling `window` of days. */
export const NetIncreaseDaysRuleSchema = z
  .strictObject({
    type: z.literal("net_increase_days"),
    count: z.int().positive().max(365),
    window: z.int().positive().max(365),
    minUsd: usdSchema.optional(),
    ...scopeFields,
  })
  .refine((r) => r.window >= r.count, { message: "window must be >= count", path: ["window"] });

/** Hold an asset (>= minUsd) across a date from the named calendar (e.g. its underlying's earnings). */
export const HoldThroughDateRuleSchema = z.strictObject({
  type: z.literal("hold_through_date"),
  calendarKey: z.enum(CALENDAR_KEYS),
  minUsd: usdSchema.optional(),
  ...scopeFields,
});

/** Hold at least minAssets distinct assets spanning at least minSectors sectors at the same time. */
export const DiversifiedRuleSchema = z
  .strictObject({
    type: z.literal("diversified"),
    minAssets: z.int().positive().max(100),
    minSectors: z.int().positive().max(50),
    minUsd: usdSchema.optional(),
    ...scopeFields,
  })
  .refine((r) => r.minSectors <= r.minAssets, {
    message: "minSectors cannot exceed minAssets",
    path: ["minSectors"],
  });

/** After a Mirror, the post-swap allocation is within `tolerance` (fraction, 0..1) of the target per asset. */
export const MirrorMatchRuleSchema = z.strictObject({
  type: z.literal("mirror_match"),
  tolerance: z.number().finite().min(0).max(1),
  ...scopeFields,
});

/**
 * `count` internal events of type `event` (league_trade, call_placed, game_action, ...) for the user.
 * With `distinctBy`, `count` distinct keys instead (see DISTINCT_BY_KEYS); absent = every event counts.
 * With `assetSymbols`, only events whose meta.symbol is in the list count (upper-cased match; an
 * event without a symbol is skipped); absent or empty = every event of the type counts.
 */
export const InternalEventRuleSchema = z.strictObject({
  type: z.literal("internal_event"),
  event: eventNameSchema,
  count: z.int().positive().max(10_000),
  distinctBy: z.enum(DISTINCT_BY_KEYS).optional(),
  ...scopeFields,
});

/**
 * An in-scope asset was held across a Token-2022 ScaledUiAmount change: the multiplier at a later
 * day-end snapshot differs from an earlier one while the raw balance was kept (a split, or an
 * issuer's periodic adjustment, changes the number of tokens shown, never the holder's raw
 * balance). No threshold: the wallet state is "the same raw balance, a new multiplier".
 */
export const MultiplierChangeRuleSchema = z.strictObject({
  type: z.literal("multiplier_change"),
  ...scopeFields,
});

export const PlayRuleSchema = z.discriminatedUnion("type", [
  HoldAnyRuleSchema,
  HoldConsecutiveRuleSchema,
  NetIncreaseDaysRuleSchema,
  HoldThroughDateRuleSchema,
  DiversifiedRuleSchema,
  MirrorMatchRuleSchema,
  InternalEventRuleSchema,
  MultiplierChangeRuleSchema,
]);

export type PlayRule = z.infer<typeof PlayRuleSchema>;
export type PlayRuleType = PlayRule["type"];

export type HoldAnyRule = z.infer<typeof HoldAnyRuleSchema>;
export type HoldConsecutiveRule = z.infer<typeof HoldConsecutiveRuleSchema>;
export type NetIncreaseDaysRule = z.infer<typeof NetIncreaseDaysRuleSchema>;
export type HoldThroughDateRule = z.infer<typeof HoldThroughDateRuleSchema>;
export type DiversifiedRule = z.infer<typeof DiversifiedRuleSchema>;
export type MirrorMatchRule = z.infer<typeof MirrorMatchRuleSchema>;
export type InternalEventRule = z.infer<typeof InternalEventRuleSchema>;
export type MultiplierChangeRule = z.infer<typeof MultiplierChangeRuleSchema>;

export const PLAY_RULE_TYPES = [
  "hold_any",
  "hold_consecutive",
  "net_increase_days",
  "hold_through_date",
  "diversified",
  "mirror_match",
  "internal_event",
  "multiplier_change",
] as const satisfies readonly PlayRuleType[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export class PlayRuleError extends Error {
  constructor(
    message: string,
    public readonly issues: z.core.$ZodIssue[],
  ) {
    super(message);
    this.name = "PlayRuleError";
  }
}

/** Parse unknown JSON (e.g. a Play.rule column) into a PlayRule. Throws PlayRuleError with a readable message. */
export function parsePlayRule(json: unknown): PlayRule {
  const r = PlayRuleSchema.safeParse(json);
  if (!r.success) {
    throw new PlayRuleError(`Invalid Play rule: ${z.prettifyError(r.error)}`, r.error.issues);
  }
  return r.data;
}

/** Non-throwing variant for UI code. */
export function safeParsePlayRule(json: unknown): PlayRule | null {
  const r = PlayRuleSchema.safeParse(json);
  return r.success ? r.data : null;
}

export function isPlayRule(json: unknown): json is PlayRule {
  return PlayRuleSchema.safeParse(json).success;
}

function fmtUsd(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Asset nouns per source
// ---------------------------------------------------------------------------

/** The AssetSource a hint is worded for when the caller passes none: Season 0's default. */
export const DEFAULT_HINT_ASSET_SOURCE = "xstocks";

export interface AssetNoun {
  singular: string;
  plural: string;
}

/**
 * Plain public noun for one asset of a source and for several. Kept here (not imported from
 * lib/assets/registry) so this file stays client-safe: the registry pulls in the issuer modules.
 * tests/pre-ipo-quest.test.ts pins it equal to the registry's `assetNoun`, so the two cannot drift.
 * An unknown source reads as the default one, exactly as the registry does for a legacy row.
 */
const ASSET_NOUNS: Readonly<Record<string, AssetNoun>> = {
  xstocks: { singular: "xStock", plural: "xStocks" },
  prestocks: { singular: "pre-IPO token", plural: "pre-IPO tokens" },
};

/** "xStock" / "xStocks" for xstocks, "pre-IPO token" / "pre-IPO tokens" for prestocks. */
export function hintAssetNoun(assetSource: string | null | undefined): AssetNoun {
  const key = typeof assetSource === "string" ? assetSource.trim() : "";
  return ASSET_NOUNS[key] ?? ASSET_NOUNS[DEFAULT_HINT_ASSET_SOURCE];
}

/** "a pre-IPO token" / "an xStock": the indefinite article for a noun read aloud ("x" opens with a vowel sound). */
export function withArticle(noun: string): string {
  return `${/^(?:[aeiou]|x)/i.test(noun) ? "an" : "a"} ${noun}`;
}

/** "any xStock" / "TSLAx" / "TSLAx or NVDAx" / "a selected xStock" / "a partner position" */
function scopeLabel(rule: PlayRule, assetSource: string | null | undefined): string {
  if (rule.partnerAssetIds) {
    return rule.partnerAssetIds.length === 0 ? "a partner position (listing pending)" : "a partner position";
  }
  const noun = hintAssetNoun(assetSource);
  const syms = rule.assetSymbols ?? [];
  if (syms.length === 0) {
    const n = rule.assetIds?.length ?? 0;
    if (n === 0) return `any ${noun.singular}`;
    return n === 1 ? `a selected ${noun.singular}` : `one of ${n} selected ${noun.plural}`;
  }
  if (syms.length === 1) return syms[0];
  if (syms.length === 2) return `${syms[0]} or ${syms[1]}`;
  return `${syms.slice(0, -1).join(", ")} or ${syms[syms.length - 1]}`;
}

function eventLabel(event: string): string {
  switch (event) {
    case "league_trade":
      return "paper trade";
    case "call_placed":
      return "prediction";
    case "mirror_executed":
      return "portfolio copy";
    case "game_action":
      return "paper trade or new prediction";
    default:
      return event.replace(/_/g, " ");
  }
}

/** Plural of an event label: "paper trade or new prediction" -> "paper trades or new predictions". */
function eventLabelPlural(event: string): string {
  if (event === "game_action") return "paper trades or new predictions";
  return `${eventLabel(event)}s`;
}

/** "3 paper trades" / "1 prediction" / "3 paper trades or new predictions". */
function eventCount(event: string, n: number): string {
  return `${n} ${n === 1 ? eventLabel(event) : eventLabelPlural(event)}`;
}

/** Hint for an internal_event rule, reading distinctBy when set. */
function internalEventHint(rule: InternalEventRule, assetSource: string | null | undefined): string {
  const n = rule.count;
  const noun = hintAssetNoun(assetSource);
  switch (rule.distinctBy) {
    case "ref":
      return rule.event === "call_placed"
        ? `Make predictions on ${plural(n, "different question")}.`
        : `Place ${eventLabelPlural(rule.event)} on ${plural(n, "different item")}.`;
    case "symbol":
      return `Place ${eventLabelPlural(rule.event)} in ${plural(n, `different ${noun.singular}`, `different ${noun.plural}`)}.`;
    case "day":
      return rule.event === "game_action"
        ? `Be active on ${plural(n, "different day")} (UTC).`
        : `Place a ${eventLabel(rule.event)} on ${plural(n, "different day")} (UTC).`;
    default:
      return `Place ${eventCount(rule.event, n)}.`;
  }
}

/**
 * Short, human hint for a rule (server-side copy; the UI uses the one in components/plays/rule-hint).
 * `assetSource` is the Play's fence (Play.assetSource): it picks the noun, "xStock" for the Season 0
 * default and "pre-IPO token" for prestocks, so a quest written for the second issuer never reads
 * as an xStocks one. Omitted or unknown means the default source.
 */
export function ruleToHint(rule: PlayRule, assetSource: string | null | undefined = DEFAULT_HINT_ASSET_SOURCE): string {
  const minUsd = "minUsd" in rule && rule.minUsd !== undefined && rule.minUsd > 0 ? ` worth ${fmtUsd(rule.minUsd)}+` : "";
  const noun = hintAssetNoun(assetSource);
  switch (rule.type) {
    case "hold_any":
      return `Hold ${scopeLabel(rule, assetSource)}${minUsd}.`;
    case "hold_consecutive":
      return `Hold the same ${rule.assetSymbols?.length === 1 ? rule.assetSymbols[0] : noun.singular}${minUsd} for ${plural(rule.days, "daily snapshot")} in a row.`;
    case "net_increase_days":
      return `Grow your ${scopeLabel(rule, assetSource)} balance on ${plural(rule.count, "separate day")} within ${plural(rule.window, "day")}.`;
    case "hold_through_date":
      return `Hold ${scopeLabel(rule, assetSource)}${minUsd} through an ${rule.calendarKey} date.`;
    case "diversified":
      return `Hold ${plural(rule.minAssets, noun.singular, noun.plural)} across ${plural(rule.minSectors, "sector")} at once${minUsd ? ` (each${minUsd})` : ""}.`;
    case "mirror_match":
      return `Copy a wallet's portfolio and land within ${Math.round(rule.tolerance * 100)}% of its mix.`;
    case "internal_event":
      return internalEventHint(rule, assetSource);
    case "multiplier_change":
      return `Hold ${withArticle(noun.singular)} across an on-chain adjustment (the same raw balance, a new multiplier).`;
  }
}

// ---------------------------------------------------------------------------
// Calendars (hold_through_date)
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Metadata keys in earnings-2026.json that are not tickers. */
const CALENDAR_META_KEYS = new Set(["_note", "asOf"]);

export interface EarningsCalendar {
  note: string;
  asOf: string;
  /** underlying ticker (e.g. "NVDA") -> sorted ISO dates (YYYY-MM-DD, US session date). */
  dates: Record<string, string[]>;
}

function parseEarningsCalendar(raw: Record<string, unknown>): EarningsCalendar {
  const dates: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (CALENDAR_META_KEYS.has(key)) continue;
    const list = Array.isArray(value) ? value : [value];
    const clean = list.filter((d): d is string => typeof d === "string" && ISO_DATE_RE.test(d)).sort();
    if (clean.length > 0) dates[key.toUpperCase()] = clean;
  }
  return {
    note: typeof raw._note === "string" ? raw._note : "",
    asOf: typeof raw.asOf === "string" ? raw.asOf : "",
    dates,
  };
}

const EARNINGS_2026: EarningsCalendar = parseEarningsCalendar(earningsCalendar as Record<string, unknown>);

/** Resolve a calendar by key. Only "earnings" exists in Season 0. */
export function getCalendar(key: CalendarKey): EarningsCalendar {
  switch (key) {
    case "earnings":
      return EARNINGS_2026;
  }
}

/** ISO dates (YYYY-MM-DD) for an underlying ticker in the named calendar. Empty when unknown. */
export function calendarDatesFor(key: CalendarKey, underlyingTicker: string): string[] {
  return getCalendar(key).dates[underlyingTicker.trim().toUpperCase()] ?? [];
}

/** Convenience for the earnings calendar. Accepts "NVDA" or an xStocks symbol like "NVDAx". */
export function earningsDatesFor(ticker: string): string[] {
  const t = ticker.trim();
  const underlying = /^[A-Z.]+x$/.test(t) ? t.slice(0, -1) : t;
  return calendarDatesFor("earnings", underlying);
}
