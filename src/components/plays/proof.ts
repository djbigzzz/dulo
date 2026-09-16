import type { PriceSourceName } from "@/lib/core";
import { formatDateTime, formatUsd } from "@/components/common/format";
import { priceSourceLabel } from "@/components/common/PriceChip";

/**
 * Turn a quest progress proof JSON blob into labelled rows for the proof drawer and the
 * /check proof sheet. Pure, client-safe and total: unexpected shapes degrade to JSON text,
 * never to a throw.
 *
 * - Keys read as labels ("takenAt" -> "Snapshot time"); nested paths join with " · ".
 * - An array of objects is ONE row with one compact line per item
 *   ("NVDAx · Technology · $12,400.00"), not one row per field per index.
 * - A CAIP-19 assetId shows the sibling ticker, else a shortened mint; the full id stays in `raw`.
 * - Every formatted value keeps its unformatted JSON in `raw` for a `title` tooltip.
 * - Nothing is dropped silently: a null field reads "—", long lists end in "+N more", and a
 *   proof larger than the row budget ends in a "More" row.
 */
export interface ProofItem {
  value: string;
  /** Raw JSON for a `title` tooltip. */
  raw?: string;
}

export interface ProofEntry {
  /** Stable dot path of the value ("assets", "progress"). Unique per row: React key and label tooltip. */
  key: string;
  /** Human label ("Snapshot time", "Portfolio copy · Target wallet"). */
  label: string;
  /** Display value. For a list row, the items joined with "; " (plain-text readers). */
  value: string;
  /** Raw JSON for a `title` tooltip when the display value was shortened or formatted. */
  raw?: string;
  /** A list row: one compact line per array item (or map entry). */
  items?: ProofItem[];
  /** The value is an address, mint or id: render monospace. */
  mono?: boolean;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_RE = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** An xStocks ticker used as a map key ("NVDAx"): data, not a field name. */
const TICKER_RE = /^[A-Z][A-Z0-9]{0,9}x$/;
/** CAIP-19 asset id: chain namespace:reference / asset namespace:reference. Capture group 1 is the asset reference (the mint). */
const CAIP19_RE = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}\/[-a-z0-9]{3,8}:([-.%a-zA-Z0-9]{1,128})$/;
const MAX_DEPTH = 4;
/** Row budget. A list row spends one unit per item shown. */
const MAX_ENTRIES = 60;
/** Items shown in one list row (or values in one comma list) before a "+N more" line. */
const MAX_ITEMS = 20;
/** A flat object with at most this many fixed keys reads as one line; more (or dynamic keys) becomes a list. */
const MAX_INLINE_KEYS = 5;
const MAX_VALUE_CHARS = 120;
/** Key of the trailing row that says the proof had more than the row budget. */
export const PROOF_TRUNCATED_KEY = "…more";

/** Key-name conventions the engine writes (engine.ts): qty, usd / minUsd / totalUsd, priceSource, tolerance, distance. */
const QTY_KEY = /(?:qty|Qty|QTY)$/;
const USD_KEY = /(?:usd|Usd|USD)$/;
const SOURCE_KEY = /(?:^|[a-z0-9])(?:source|Source)$/;
const RATIO_KEY = /weight|tolerance|distance/i;
const PRICE_SOURCES = new Set<string>(["pyth", "jupiter", "cache", "none"]);

/** Labels for the keys the engine and the preview write. Anything else falls back to split camelCase. */
const LABELS: Record<string, string> = {
  assetId: "Asset",
  symbol: "Stock",
  qty: "Quantity",
  usd: "Value",
  priceSource: "Price source",
  takenAt: "Snapshot time",
  minUsd: "Minimum value",
  minAssets: "Minimum stocks",
  minSectors: "Minimum sectors",
  assetCount: "Stocks held",
  // "Sectors held", not "Sectors": a diversified proof also carries the `sectors` list.
  sectorCount: "Sectors held",
  sectors: "Sectors",
  days: "Days",
  distance: "Distance from target",
  tolerance: "Tolerance",
  targetWallet: "Target wallet",
  earningsDate: "Earnings date",
  reason: "Status",
  progress: "Progress",
  assets: "Stocks",
  sector: "Sector",
  totalUsd: "Total value",
  deltaUsd: "Added value",
  budgetUsd: "Budget",
  usdByDay: "Value by day",
  legs: "Legs",
  target: "Target weights",
  executedAt: "Copied at",
  recordedAt: "Recorded at",
  readAt: "Read at",
  lastAt: "Last event",
  nextEarningsDate: "Next earnings date",
  nextEarningsSymbol: "Next earnings stock",
  nextEarningsUnderlying: "Next earnings company",
  nextEarningsHoldBy: "Hold by",
  checked: "Dates checked",
  bridged: "Bridged days",
  run: "Current run",
  intent: "Portfolio copy",
  latestDay: "Latest day",
  // internal_event proofs (in-platform quests).
  event: "Activity",
  needed: "Needed",
  distinctBy: "Counted once per",
  refs: "Latest counted",
};

/** Plain words for the internal event names an in-platform quest's proof carries. */
const EVENT_NAMES: Record<string, string> = {
  league_trade: "Paper trades",
  call_placed: "Predictions",
  game_action: "Paper trades or new predictions",
  mirror_executed: "Portfolio copies",
};

/** Plain words for an internal_event rule's distinctBy value. */
const DISTINCT_BY_NAMES: Record<string, string> = {
  ref: "question",
  symbol: "xStock",
  day: "day",
};

const ACRONYMS: Record<string, string> = { usd: "USD", id: "ID", ids: "IDs", url: "URL", api: "API" };
/** Item fields that read without a label prefix ("NVDAx · Technology · $12.00"). */
const BARE_KEYS = new Set(["symbol", "sector", "usd", "day", "date", "underlying", "name", "title", "label"]);
const UNIT_WORDS: Record<string, string> = { assets: "stocks", asset: "stock" };

const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const pctFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
/** Fallback for dust: a non-zero value the fixed-decimal formats would round to zero. */
const sigFmt = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });

/** Own-property lookup, so keys like "constructor" never read Object.prototype. */
function own(map: Record<string, string>, k: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : undefined;
}

/** True when a formatted number shows no non-zero digit ("0", "$0.0000", "0%"). */
function showsZero(display: string): boolean {
  return !/[1-9]/.test(display);
}

/** `display` unless it would hide a non-zero `n` as zero; then `n` to 3 significant digits. */
function keepNonZero(n: number, display: string, dust: (abs: string) => string): string {
  if (n === 0 || !showsZero(display)) return display;
  return `${n < 0 ? "-" : ""}${dust(sigFmt.format(Math.abs(n)))}`;
}

/** A JSON-style object (any realm). Dates, Maps and class instances are leaves, not field bags. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === null || Object.getPrototypeOf(proto) === null;
}

function isPrimitive(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== "object";
}

function short(s: string): string {
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS - 1)}…` : s;
}

/** JSON text that never throws (BigInt, cycles): falls back to String(). */
function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return typeof s === "string" ? s : String(v);
  } catch {
    try {
      return String(v);
    } catch {
      return "?";
    }
  }
}

/** The name that describes a value: the last dot segment that is not an array index ("legs.0" -> "legs"). */
function leafName(key: string | undefined): string {
  if (!key) return "";
  const parts = key.split(".");
  for (let i = parts.length - 1; i >= 0; i--) if (!/^\d+$/.test(parts[i])) return parts[i];
  return "";
}

/** A finite number from a number or a plain numeric string; null otherwise. */
function numeric(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && NUMERIC_RE.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** True for a CAIP-19 asset id ("solana:5eykt…/token:Xsc9…"). */
export function isAssetId(v: unknown): v is string {
  return typeof v === "string" && CAIP19_RE.test(v);
}

/** "Xsc9…9qEh": the asset reference (mint) of a CAIP-19 id, shortened. Non-ids come back unchanged. */
export function shortAssetId(id: string): string {
  const m = CAIP19_RE.exec(id);
  if (!m) return id;
  const ref = m[1];
  return ref.length > 12 ? `${ref.slice(0, 4)}…${ref.slice(-4)}` : ref;
}

/** A map key that is data, not a field name: a date, an asset id, an index, an address or a ticker. */
function isDynamicKey(k: string): boolean {
  return DAY_RE.test(k) || ISO_RE.test(k) || /^\d+$/.test(k) || isAssetId(k) || BASE58_RE.test(k) || TICKER_RE.test(k);
}

/**
 * Human label for a proof key: the label map, else split camelCase / snake_case and capitalise.
 * A key that is data (a date, address, ticker) keeps its exact spelling; an asset id is shortened.
 */
export function humaniseKey(key: string): string {
  const known = own(LABELS, key);
  if (known !== undefined) return known;
  if (CAIP19_RE.test(key)) return shortAssetId(key);
  if (isDynamicKey(key)) return key;
  const words = key
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => own(ACRONYMS, w.toLowerCase()) ?? w.toLowerCase());
  return words.length > 0 ? capitalise(words.join(" ")) : key;
}

/** The label as an in-line prefix: lower-cased unless it is data or starts with an acronym ("USD …"). */
function inlineLabel(key: string): string {
  const label = humaniseKey(key);
  if (isDynamicKey(key) || /^[A-Z]{2}/.test(label)) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** "needs_daily_snapshots" -> "Needs daily snapshots". */
function sentence(code: string): string {
  return capitalise(
    code
      .split("_")
      .filter(Boolean)
      .map((w) => own(ACRONYMS, w) ?? w)
      .join(" "),
  );
}

/** Key-aware display for a named leaf; null when the key carries no convention for this value. */
function formatByKey(v: unknown, name: string): string | null {
  if (isAssetId(v)) return shortAssetId(v);
  if (!name) return null;
  if (name === "reason" && typeof v === "string" && /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(v)) return sentence(v);
  if (name === "event" && typeof v === "string") return own(EVENT_NAMES, v) ?? null;
  if (name === "distinctBy" && typeof v === "string") return own(DISTINCT_BY_NAMES, v) ?? null;
  if (SOURCE_KEY.test(name) && typeof v === "string" && v) {
    return PRICE_SOURCES.has(v) ? priceSourceLabel(v as PriceSourceName) : short(capitalise(v));
  }
  const n = numeric(v);
  if (n === null) return null;
  // Dust never shows as zero: a value the fixed decimals would round away falls back to 3 significant digits.
  if (QTY_KEY.test(name)) return keepNonZero(n, qtyFmt.format(n), (abs) => abs);
  if (USD_KEY.test(name)) return keepNonZero(n, formatUsd(n), (abs) => `$${abs}`);
  if (RATIO_KEY.test(name) && n >= 0 && n <= 1) return keepNonZero(n * 100, `${pctFmt.format(n * 100)}%`, (abs) => `${abs}%`);
  return null;
}

/**
 * Display string for a leaf value. `key` (the dot path, or just the field name) turns on the
 * engine's naming conventions: `*qty` to at most 6 decimals, `*usd` as dollars, `*source` as a
 * source label, weight / tolerance / distance ratios (0..1) as percentages, and a snake_case
 * `reason` as a sentence. A CAIP-19 asset id shows its shortened mint. The unformatted value is
 * kept in `raw` for the tooltip whenever the display differs.
 */
export function formatProofValue(v: unknown, key?: string): { value: string; raw?: string } {
  if (v === null || v === undefined) return { value: "—" };
  const byKey = formatByKey(v, leafName(key));
  if (byKey !== null) {
    const plain = String(v);
    return byKey === plain ? { value: byKey } : { value: byKey, raw: plain };
  }
  if (typeof v === "boolean") return { value: v ? "yes" : "no" };
  if (typeof v === "number") return { value: Number.isFinite(v) ? String(v) : "—" };
  if (typeof v === "string") {
    if (ISO_RE.test(v)) {
      const pretty = formatDateTime(v);
      return pretty ? { value: pretty, raw: v } : { value: v };
    }
    return v.length > MAX_VALUE_CHARS ? { value: short(v), raw: v } : { value: v };
  }
  if (v instanceof Date) {
    if (!Number.isFinite(v.getTime())) return { value: "—" };
    const iso = v.toISOString();
    return { value: formatDateTime(iso) || iso, raw: iso };
  }
  const json = safeJson(v);
  return json.length > MAX_VALUE_CHARS || typeof v === "object" ? { value: short(json), raw: json } : { value: json };
}

/** "a, b, c" for a list of primitives, at most MAX_ITEMS values then "+N more". */
function joinPrimitives(arr: readonly unknown[], name: string): { value: string; cut: boolean; formatted: boolean } {
  const cells = arr.slice(0, MAX_ITEMS).map((x) => formatProofValue(x, name));
  const more = arr.length - cells.length;
  const value = cells.map((c) => c.value).join(", ") + (more > 0 ? `, +${more} more` : "");
  return { value, cut: more > 0, formatted: cells.some((c) => c.raw !== undefined) };
}

/** { current, target, unit } as "2 of 3 days" / "$4.00 of $5.00"; null when it is not that shape. */
function progressText(o: Record<string, unknown>): string | null {
  const keys = Object.keys(o);
  if (!keys.every((k) => k === "current" || k === "target" || k === "unit")) return null;
  const current = numeric(o.current);
  const target = numeric(o.target);
  if (current === null || target === null) return null;
  const unit = typeof o.unit === "string" ? o.unit.trim() : "";
  if (unit.toLowerCase() === "usd") return `${formatUsd(current)} of ${formatUsd(target)}`;
  const word = own(UNIT_WORDS, unit) ?? unit;
  return `${qtyFmt.format(current)} of ${qtyFmt.format(target)}${word ? ` ${word}` : ""}`;
}

/** The value convention for entries of a map named `name` ("usdByDay" values are dollars, "target" values are weights). */
function mapValueName(name: string): string {
  if (/usd/i.test(name)) return "usd";
  if (/weight|^target$/i.test(name)) return "weight";
  if (/qty/i.test(name)) return "qty";
  return name;
}

/** The item's ticker: a non-empty `symbol` that is not itself an asset id (the engine falls back to the id). */
function tickerOf(o: Record<string, unknown>): string | null {
  return typeof o.symbol === "string" && o.symbol.trim() && !isAssetId(o.symbol) ? o.symbol : null;
}

/** The engine's fallback: `symbol` is the same asset id as `assetId`, so it adds nothing. */
function symbolRepeatsId(o: Record<string, unknown>): boolean {
  return isAssetId(o.assetId) && o.symbol === o.assetId;
}

function isMono(v: unknown): boolean {
  return isAssetId(v) || (typeof v === "string" && BASE58_RE.test(v));
}

/** A flat map keyed by asset ids (Mirror intent target weights): its rows can carry tickers from `symbols`. */
function isFlatAssetMap(v: unknown): v is Record<string, unknown> {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.some(isAssetId) && keys.every((k) => isPrimitive(v[k]));
}

/**
 * One compact line for an array item: "NVDAx · Technology · $12,400.00" for a stock,
 * "SPYx · target 33.33% · actual 30% · within tolerance" for a Mirror leg. Nested objects
 * inside the item join with spaces ("before 2026-07-29 $12.00"). A null field reads
 * "after —" rather than vanishing: in an earnings check the null is the reason it failed.
 */
function summarise(item: unknown, parentName: string, depth: number, sep = " · "): string {
  if (isPrimitive(item)) return formatProofValue(item, parentName).value;
  if (Array.isArray(item)) {
    return item.every(isPrimitive) ? short(joinPrimitives(item, parentName).value) || "—" : short(safeJson(item));
  }
  if (!isPlainObject(item) || depth >= MAX_DEPTH) return short(safeJson(item));
  const o = item;
  const progress = progressText(o);
  if (progress !== null) return progress;

  const symbol = tickerOf(o);
  const legs = parentName === "legs";
  const fromTo = "from" in o && "to" in o && isPrimitive(o.from) && isPrimitive(o.to) && o.from !== null && o.to !== null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    if (k === "assetId" && symbol !== null) continue; // the ticker says it; the full id is in raw
    if (k === "symbol" && symbolRepeatsId(o)) continue; // the shortened id already shows it
    if (v === null) {
      parts.push(`${inlineLabel(k)} —`);
      continue;
    }
    if (fromTo && k === "to") continue;
    if (fromTo && k === "from") {
      parts.push(`${formatProofValue(o.from, "qty").value} → ${formatProofValue(o.to, "qty").value}`);
      continue;
    }
    if (legs && k === "delta") continue; // target and actual already show it
    if (legs && (k === "target" || k === "actual")) {
      parts.push(`${k} ${formatProofValue(v, "weight").value}`);
      continue;
    }
    if (typeof v === "boolean") {
      if (k === "ok") parts.push(legs ? (v ? "within tolerance" : "outside tolerance") : v ? "ok" : "not ok");
      else parts.push(`${inlineLabel(k)}: ${v ? "yes" : "no"}`);
      continue;
    }
    const shown = isPrimitive(v) ? formatProofValue(v, k).value : summarise(v, k, depth + 1, " ");
    parts.push(BARE_KEYS.has(k) || k === "assetId" ? shown : `${inlineLabel(k)} ${shown}`);
  }
  return parts.length > 0 ? parts.join(sep) : "—";
}

export function flattenProof(proof: unknown): ProofEntry[] {
  const out: ProofEntry[] = [];
  let budget = MAX_ENTRIES;
  /** Something was left out for the row budget (or an unexpected throw): say so in a last row. */
  let truncated = false;

  const add = (entry: ProofEntry, cost = 1) => {
    if (budget <= 0) {
      truncated = true;
      return;
    }
    const clean: ProofEntry = { key: entry.key, label: entry.label, value: entry.value };
    if (entry.raw !== undefined) clean.raw = entry.raw;
    if (entry.items) clean.items = entry.items;
    if (entry.mono) clean.mono = true;
    out.push(clean);
    budget -= Math.max(1, cost);
  };

  const leaf = (key: string, label: string, v: unknown, name: string) => {
    const { value, raw } = formatProofValue(v, name);
    add({ key, label, value, raw, mono: isMono(v) });
  };

  const list = (key: string, label: string, items: ProofItem[], total: number) => {
    const shown = items.slice(0, Math.max(1, Math.min(MAX_ITEMS, budget)));
    const rows = total > shown.length ? [...shown, { value: `+${total - shown.length} more` }] : shown;
    add({ key, label, value: rows.map((r) => r.value).join("; "), items: rows }, shown.length);
  };

  const walkValue = (v: unknown, path: string[], labels: string[], depth: number, siblings?: Record<string, unknown>) => {
    if (budget <= 0) {
      truncated = true;
      return;
    }
    const key = path.join(".") || "value";
    const label = labels.join(" · ") || "Value";
    const name = path.length > 0 ? path[path.length - 1] : "";

    if (depth >= MAX_DEPTH || isPrimitive(v)) return leaf(key, label, v, name);

    if (Array.isArray(v)) {
      if (v.length === 0) return add({ key, label, value: "None", raw: "[]" });
      if (v.every(isPrimitive)) {
        const joined = joinPrimitives(v, name);
        const raw = joined.cut || joined.formatted ? safeJson(v) : undefined;
        return add({ key, label, value: joined.value, raw, mono: v.every(isMono) });
      }
      const items = v.slice(0, MAX_ITEMS).map((item) => {
        const value = summarise(item, name, depth + 1);
        const raw = isPrimitive(item) ? formatProofValue(item, name).raw : safeJson(item);
        return raw !== undefined && raw !== value ? { value, raw } : { value };
      });
      return list(key, label, items, v.length);
    }

    if (!isPlainObject(v)) return leaf(key, label, v, name);
    // The proof itself always reads key by key.
    if (path.length === 0) return walkObject(v, path, labels, depth);
    const keys = Object.keys(v);
    if (keys.length === 0) return add({ key, label, value: "None", raw: "{}" });

    const progress = progressText(v);
    if (progress !== null) return add({ key, label, value: progress, raw: safeJson(v) });

    if (keys.every((k) => isPrimitive(v[k]))) {
      const dynamic = keys.some(isDynamicKey);
      if (dynamic || keys.length > MAX_INLINE_KEYS) {
        // A map (usdByDay, Mirror target weights): one line per entry. Asset-id keys use a sibling `symbols` map when present.
        // Never for the `symbols` map itself: its values are the tickers, its heads stay the (shortened) ids.
        const symbols = name !== "symbols" && siblings && isPlainObject(siblings.symbols) ? siblings.symbols : null;
        const valueName = mapValueName(name);
        const items = keys.slice(0, MAX_ITEMS).map((k) => {
          const ticker = symbols && typeof symbols[k] === "string" ? (symbols[k] as string) : null;
          const head = ticker ?? (isDynamicKey(k) ? formatProofValue(k).value : humaniseKey(k));
          const cell = formatProofValue(v[k], valueName);
          return { value: `${head} · ${cell.value}`, raw: safeJson({ [k]: v[k] }) };
        });
        return list(key, label, items, keys.length);
      }
      return add({ key, label, value: summarise(v, name, depth), raw: safeJson(v) });
    }

    walkObject(v, path, labels, depth);
  };

  const walkObject = (obj: Record<string, unknown>, path: string[], labels: string[], depth: number) => {
    const symbol = tickerOf(obj);
    const foldSymbol = symbol !== null && isAssetId(obj.assetId);
    // A `symbols` map is only hidden when every ticker in it labels a row of a sibling asset map.
    const mapped = new Set<string>();
    for (const [k, x] of Object.entries(obj)) if (k !== "symbols" && isFlatAssetMap(x)) for (const id of Object.keys(x)) mapped.add(id);
    const symbolsShownElsewhere = isPlainObject(obj.symbols) && mapped.size > 0 && Object.keys(obj.symbols).every((id) => mapped.has(id));
    for (const k of Object.keys(obj)) {
      if (budget <= 0) {
        truncated = true;
        return;
      }
      const v = obj[k];
      const nextPath = [...path, k];
      const nextLabels = [...labels, humaniseKey(k)];
      // The ticker is shown on the Asset row; a `symbols` map is shown through the asset map it labels.
      if (k === "symbol" && (foldSymbol || symbolRepeatsId(obj))) continue;
      if (k === "symbols" && symbolsShownElsewhere) continue;
      if (k === "assetId" && foldSymbol) {
        add({ key: nextPath.join("."), label: nextLabels.join(" · "), value: symbol!, raw: v as string });
        continue;
      }
      walkValue(v, nextPath, nextLabels, depth + 1, obj);
    }
  };

  if (proof === null || proof === undefined) return out;
  try {
    walkValue(proof, [], [], 0);
  } catch {
    // Never throw on an unexpected shape: keep the rows built so far.
    truncated = true;
  }
  if (truncated) out.push({ key: PROOF_TRUNCATED_KEY, label: "More", value: "Further evidence not shown" });
  return out;
}

/** True when there is nothing worth rendering (null, {}, []). */
export function isEmptyProof(proof: unknown): boolean {
  if (proof === null || proof === undefined) return true;
  if (Array.isArray(proof)) return proof.length === 0;
  if (isPlainObject(proof)) return Object.keys(proof).length === 0;
  return false;
}
