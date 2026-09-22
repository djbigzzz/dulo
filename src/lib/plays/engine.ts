import type { AssetId } from "@/lib/core/caip";
import { DEFAULT_ASSET_SOURCE, type Holding, type HoldingsSnapshot, type InternalEvent, type PriceSourceName } from "@/lib/core/types";
import type {
  DiversifiedRule,
  HoldAnyRule,
  HoldConsecutiveRule,
  HoldThroughDateRule,
  InternalEventRule,
  MirrorMatchRule,
  MultiplierChangeRule,
  NetIncreaseDaysRule,
  PlayRule,
} from "./rules";

/**
 * Play rule engine.
 *
 * Pure functions over a user's holdings history + internal events. No I/O, no clock
 * reads (everything comes from EvalContext), deterministic for a given context, and
 * never throws: malformed rows are dropped and a malformed rule / context yields
 * `{ complete: false, proof: { reason } }`.
 *
 * Conventions shared by every evaluator
 *  - A "day" is a UTC calendar day (YYYY-MM-DD). The day-end snapshot is the LAST
 *    snapshot taken on that day (see dailySnapshots).
 *  - Snapshots are expected to already be merged across the user's wallets per tick
 *    (see mergeSnapshots). Duplicate assetIds inside a snapshot are summed anyway.
 *  - Positions with qty <= 0 are ignored everywhere (an empty token account is not a holding).
 *  - Scope: partnerAssetIds wins (an EMPTY partner list means "listing pending" and is never
 *    satisfied), then assetIds, then assetSymbols (case-insensitive), else every holding.
 *  - usd thresholds: `minUsd ?? 1` unless the rule type documents otherwise. A holding with
 *    price null has usd 0, so it fails any positive usd threshold but still counts for the
 *    qty-based net_increase_days rule.
 *  - Every incomplete result carries proof.reason (snake_case). Complete results carry
 *    completedAt (ISO) and never carry reason.
 *  - Proof numbers are rounded for display (usd to cents, weights to 4 dp); qty is kept as is.
 *
 * Per-rule semantics are documented on each evaluator below.
 */

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface EvalContext {
  now: Date;
  /** The user's holdings over time, ALL wallets already merged per tick, ascending by takenAt. May be empty. */
  snapshots: HoldingsSnapshot[];
  /** Internal events for this user (league_trade, call_placed, mirror_executed, ...), ascending by ts. */
  events: InternalEvent[];
  /** Earnings calendar: underlying ticker -> ISO dates (YYYY-MM-DD). */
  earnings: Record<string, string[]>;
  /** Sector for an asset id (from the AssetSource), null when unknown. */
  sectorOf: (assetId: string) => string | null;
  /** Underlying ticker for an asset id, e.g. "TSLA" for TSLAx; null when unknown. */
  underlyingOf: (assetId: string) => string | null;
  /**
   * The corporate actions on record per mint (lib/corporate-actions listCorporateActions: the
   * ScaledUiAmount state read from the mint itself). multiplier_change completes ONLY for a
   * change that one of these corroborates: a snapshot pair alone never scores, so a degraded
   * mint read in one tick can never look like an adjustment. Omitted or empty means nothing
   * is on record and the rule stays incomplete.
   */
  corporateActions?: readonly OnRecordAdjustment[];
}

/** One ScaledUiAmount change read from a mint, as the engine needs it (CorporateActionView satisfies it). */
export interface OnRecordAdjustment {
  assetId: string;
  multiplierBefore: number;
  multiplierAfter: number;
  /** When the new multiplier took (or takes) effect on chain; null when the mint carries no timestamp. */
  effectiveAt: string | Date | null;
}

export interface EvalResult {
  complete: boolean;
  /** Human-readable, JSON-serialisable evidence shown in the Proof drawer. Always present, even when incomplete. */
  proof: Record<string, unknown>;
  /** Progress toward completion for the UI, when meaningful. */
  progress?: { current: number; target: number; unit: string };
  /** ISO timestamp of the moment the rule became satisfied, when known (else now). */
  completedAt?: string;
}

export function evaluatePlay(rule: PlayRule, ctx: EvalContext, assetSource: string | null = null): EvalResult {
  try {
    if (!isObj(rule) || typeof rule.type !== "string") return incomplete("invalid_rule");
    const c = cleanContext(ctx, assetSource);
    switch (rule.type) {
      case "hold_any":
        return evalHoldAny(rule, c);
      case "hold_consecutive":
        return evalHoldConsecutive(rule, c);
      case "net_increase_days":
        return evalNetIncreaseDays(rule, c);
      case "hold_through_date":
        return evalHoldThroughDate(rule, c);
      case "diversified":
        return evalDiversified(rule, c);
      case "mirror_match":
        return evalMirrorMatch(rule, c);
      case "internal_event":
        return evalInternalEvent(rule, c);
      case "multiplier_change":
        return evalMultiplierChange(rule, c);
      default:
        return incomplete("unknown_rule_type", { type: (rule as { type: string }).type });
    }
  } catch (err) {
    return incomplete("engine_error", { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Group snapshots into UTC calendar days, keeping the LAST snapshot of each day
 * (latest takenAt; on an exact tie the later one in the array wins). Rows without a
 * valid takenAt are skipped. Returned ascending by day. Exported for the cron and tests.
 */
export function dailySnapshots(snapshots: HoldingsSnapshot[]): Array<{ day: string; snapshot: HoldingsSnapshot }> {
  const byDay = new Map<string, { snapshot: HoldingsSnapshot; t: number }>();
  for (const s of Array.isArray(snapshots) ? snapshots : []) {
    if (!isObj(s)) continue;
    const d = toDate(s.takenAt);
    if (!d) continue;
    const day = dayKey(d);
    const t = d.getTime();
    const cur = byDay.get(day);
    if (!cur || t >= cur.t) byDay.set(day, { snapshot: s, t });
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => cmpStr(a, b))
    .map(([day, { snapshot }]) => ({ day, snapshot }));
}

/**
 * Merge several wallets' snapshots taken in the same tick into one HoldingsSnapshot:
 * qty, usd and raw are summed per assetId; symbol / multiplier / price / priceSource come
 * from the first row that has them (a null price is replaced by a later non-null one).
 * walletId is the sorted, "+"-joined set of wallet ids ("w1+w2"); a single wallet keeps its id.
 * Malformed rows are dropped. `takenAt` falls back to the latest input takenAt when invalid.
 */
export function mergeSnapshots(snapshots: HoldingsSnapshot[], takenAt: Date): HoldingsSnapshot {
  const list = Array.isArray(snapshots) ? snapshots : [];
  const wallets = new Set<string>();
  const byAsset = new Map<string, Holding>();
  let latest: Date | null = null;

  for (const s of list) {
    if (!isObj(s)) continue;
    if (typeof s.walletId === "string" && s.walletId.length > 0) wallets.add(s.walletId);
    const at = toDate(s.takenAt);
    if (at && (!latest || at.getTime() > latest.getTime())) latest = at;
    for (const raw of Array.isArray(s.holdings) ? s.holdings : []) {
      const h = cleanHolding(raw);
      if (!h) continue;
      const cur = byAsset.get(h.assetId);
      if (!cur) {
        byAsset.set(h.assetId, { ...h });
        continue;
      }
      cur.qty += h.qty;
      cur.usd += h.usd;
      cur.raw = addRaw(cur.raw, h.raw);
      if (cur.price === null && h.price !== null) {
        cur.price = h.price;
        cur.priceSource = h.priceSource;
      }
      if (!cur.symbol && h.symbol) cur.symbol = h.symbol;
    }
  }

  const ids = [...wallets].sort(cmpStr);
  return {
    walletId: ids.join("+"),
    takenAt: toDate(takenAt) ?? latest ?? new Date(0),
    holdings: [...byAsset.values()],
  };
}

// ---------------------------------------------------------------------------
// Rule evaluators
// ---------------------------------------------------------------------------

/**
 * hold_any { minUsd }
 * The LATEST snapshot has an in-scope position with usd >= minUsd. When several qualify the
 * largest one is the proof. completedAt = that snapshot's takenAt. Progress is "$x of $minUsd"
 * when minUsd > 0.
 */
function evalHoldAny(rule: HoldAnyRule, c: Ctx): EvalResult {
  const scope = scopeOf(rule, c.assetSource);
  if (scope.kind === "none") return incomplete(scope.reason);
  const latest = last(c.snapshots);
  if (!latest) return incomplete("no_snapshots");

  const minUsd = numOr(rule.minUsd, 0);
  const positions = [...positionsOf(latest, scope).values()].sort(byUsdDesc);
  const best = positions[0];
  const progress =
    minUsd > 0 ? { current: Math.min(round2(best?.usd ?? 0), minUsd), target: minUsd, unit: "usd" } : undefined;

  if (!best) return incomplete("no_in_scope_holding", { takenAt: iso(latest.takenAt), minUsd }, progress);
  if (best.usd < minUsd) {
    return incomplete(
      "below_min_usd",
      { assetId: best.assetId, symbol: best.symbol, qty: best.qty, usd: round2(best.usd), minUsd, takenAt: iso(latest.takenAt) },
      progress,
    );
  }
  return {
    complete: true,
    proof: {
      assetId: best.assetId,
      symbol: best.symbol,
      qty: best.qty,
      usd: round2(best.usd),
      priceSource: best.priceSource,
      takenAt: iso(latest.takenAt),
    },
    progress,
    completedAt: iso(latest.takenAt),
  };
}

/**
 * hold_consecutive { days, minUsd? }
 * Some single in-scope asset has usd >= (minUsd ?? 1) in the day-end snapshot of `days`
 * consecutive UTC days ending on the latest day that has a snapshot.
 *
 * Outage bridging: a calendar day with NO snapshot at all is bridged (counted as held) when
 * the day before it has a day-end snapshot where the asset still qualifies; two or more
 * missing days in a row break the run. Bridged days are listed in proof.bridged and show
 * usdByDay[day] = null. The user cannot fix a cron outage, so it must not cost them the run.
 *
 * Best candidate = longest run, then highest usd on the latest day, then assetId.
 * completedAt = takenAt of the day-end snapshot on which the run first reached `days`
 * (the next snapshotted day when that day was bridged). Progress: run / days.
 */
function evalHoldConsecutive(rule: HoldConsecutiveRule, c: Ctx): EvalResult {
  const scope = scopeOf(rule, c.assetSource);
  if (scope.kind === "none") return incomplete(scope.reason);
  const days = dayEntries(c.snapshots, scope);
  if (days.length === 0) return incomplete("no_snapshots");

  const needed = Math.max(1, Math.floor(numOr(rule.days, 1)));
  const threshold = numOr(rule.minUsd, 1);
  const byDay = new Map(days.map((d) => [d.day, d]));
  const latest = days[days.length - 1];
  const qualifies = (day: string, assetId: string): number | null => {
    const p = byDay.get(day)?.positions.get(assetId);
    return p && p.usd >= threshold ? p.usd : null;
  };

  interface Run {
    assetId: string;
    symbol: string;
    days: string[]; // descending while walking, reversed at the end
    usdByDay: Record<string, number | null>;
    bridged: string[];
    latestUsd: number;
  }
  let best: Run | null = null;
  const candidates = [...latest.positions.values()].filter((p) => p.usd >= threshold).sort(byUsdDesc);
  for (const cand of candidates) {
    const run: Run = { assetId: cand.assetId, symbol: cand.symbol, days: [], usdByDay: {}, bridged: [], latestUsd: cand.usd };
    let day = latest.day;
    for (;;) {
      if (byDay.has(day)) {
        const usd = qualifies(day, cand.assetId);
        if (usd === null) break;
        run.days.push(day);
        run.usdByDay[day] = round2(usd);
        day = addDays(day, -1);
        continue;
      }
      // Missing day: bridge only if the previous calendar day is snapshotted and still qualifies.
      const prevDay = addDays(day, -1);
      if (!byDay.has(prevDay) || qualifies(prevDay, cand.assetId) === null) break;
      run.days.push(day);
      run.usdByDay[day] = null;
      run.bridged.push(day);
      day = prevDay;
    }
    if (
      !best ||
      run.days.length > best.days.length ||
      (run.days.length === best.days.length &&
        (run.latestUsd > best.latestUsd || (run.latestUsd === best.latestUsd && cmpStr(run.assetId, best.assetId) < 0)))
    ) {
      best = run;
    }
  }

  if (!best) return incomplete("no_qualifying_holding", { latestDay: latest.day, minUsd: threshold, needed });

  const asc = best.days.slice().reverse();
  const shown = asc.slice(-MAX_PROOF_DAYS);
  const usdByDay: Record<string, number | null> = {};
  for (const d of shown) usdByDay[d] = best.usdByDay[d];
  const run = asc.length;
  const proof: Record<string, unknown> = {
    assetId: best.assetId,
    symbol: best.symbol,
    days: shown,
    usdByDay,
    bridged: best.bridged.slice().reverse(),
    run,
    needed,
    minUsd: threshold,
  };
  const progress = { current: Math.min(run, needed), target: needed, unit: "days" };
  if (run < needed) return incomplete("run_too_short", proof, progress);

  // The day the run first reached `needed`; if that day was bridged, the next snapshotted day.
  let completedAt: string | undefined;
  for (let i = needed - 1; i < asc.length; i++) {
    const entry = byDay.get(asc[i]);
    if (entry) {
      completedAt = iso(entry.takenAt);
      break;
    }
  }
  return { complete: true, proof, progress, completedAt: completedAt ?? iso(c.now) };
}

/**
 * net_increase_days { count, window, minUsd? }
 * A UTC day D is an "increase day" when, for at least one in-scope asset, the day-end qty on
 * D is greater than the day-end qty of the PREVIOUS snapshotted day (so an outage day is
 * skipped, not treated as zero). Price moves never count: the comparison is on qty. The first
 * snapshot ever is only a baseline (connecting a wallet that already holds is not a buy).
 * minUsd, when set and > 0, requires the increment to be worth at least minUsd at that day's
 * price ((to - from) * price); with an unknown price the day does not count.
 *
 * Completion follows the schema doc ("inside ANY rolling window of `window` days"): `count`
 * increase days inside any span of `window` consecutive days completes the Play, so a Play
 * added late or a cron outage never loses a finished streak. Progress and the incomplete proof
 * use the trailing window (the last `window` days ending on ctx.now's UTC day), which is what
 * the user can still act on. completedAt = takenAt of the count-th increase day.
 */
function evalNetIncreaseDays(rule: NetIncreaseDaysRule, c: Ctx): EvalResult {
  const scope = scopeOf(rule, c.assetSource);
  if (scope.kind === "none") return incomplete(scope.reason);
  const days = dayEntries(c.snapshots, scope);
  if (days.length === 0) return incomplete("no_snapshots");

  const count = Math.max(1, Math.floor(numOr(rule.count, 1)));
  const window = Math.max(count, Math.floor(numOr(rule.window, count)));
  const minUsd = numOr(rule.minUsd, 0);

  interface Increase {
    day: string;
    takenAt: Date;
    assetId: string;
    symbol: string;
    from: number;
    to: number;
    deltaUsd: number | null;
  }
  const increases: Increase[] = [];
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1].positions;
    const cur = days[i].positions;
    let best: Increase | null = null;
    for (const assetId of [...new Set([...prev.keys(), ...cur.keys()])].sort(cmpStr)) {
      const p = prev.get(assetId);
      const q = cur.get(assetId);
      const from = p?.qty ?? 0;
      const to = q?.qty ?? 0;
      if (to - from <= QTY_EPS) continue;
      const price = q?.price ?? p?.price ?? null;
      const deltaUsd = price === null ? null : (to - from) * price;
      if (minUsd > 0 && (deltaUsd === null || deltaUsd < minUsd)) continue;
      if (!best || to - from > best.to - best.from) {
        best = {
          day: days[i].day,
          takenAt: days[i].takenAt,
          assetId,
          symbol: q?.symbol ?? p?.symbol ?? assetId,
          from,
          to,
          deltaUsd: deltaUsd === null ? null : round2(deltaUsd),
        };
      }
    }
    if (best) increases.push(best);
  }

  const show = (list: Increase[]) =>
    list.slice(-MAX_PROOF_DAYS).map(({ day, assetId, symbol, from, to, deltaUsd }) => ({ day, assetId, symbol, from, to, deltaUsd }));

  // Any rolling window.
  for (let s = 0; s < increases.length; s++) {
    const start = increases[s].day;
    const end = addDays(start, window - 1);
    const inWindow = increases.slice(s).filter((x) => x.day <= end);
    if (inWindow.length >= count) {
      return {
        complete: true,
        proof: { days: show(inWindow), window: { from: start, to: end }, count: inWindow.length, needed: count },
        progress: { current: count, target: count, unit: "days" },
        completedAt: iso(inWindow[count - 1].takenAt),
      };
    }
  }

  // Trailing window for progress.
  const end = c.today;
  const start = addDays(end, -(window - 1));
  const trailing = increases.filter((x) => x.day >= start && x.day <= end);
  return incomplete(
    "not_enough_increase_days",
    { days: show(trailing), window: { from: start, to: end }, count: trailing.length, needed: count },
    { current: Math.min(trailing.length, count), target: count, unit: "days" },
  );
}

/**
 * hold_through_date { calendarKey, minUsd? }
 * For an in-scope asset whose underlying (ctx.underlyingOf) has a calendar date D <= today
 * (UTC), the asset was held (usd >= minUsd ?? 1) on the day-end snapshot BEFORE D and on the
 * day-end snapshot AFTER D:
 *   before = the latest snapshotted day in [D-3, D-1]   (D-1 normally; earlier only on an outage)
 *   after  = the earliest snapshotted day in [D, D+3]   (D normally; later only on an outage)
 * Both must qualify. The earliest completion (by the after-snapshot's takenAt) wins;
 * completedAt is that snapshot's takenAt. When incomplete, proof.nextEarningsDate names the
 * earliest upcoming (>= today) date among assets held right now, with proof.nextEarningsHoldBy
 * = D-1 (the day-end snapshot the before-check reads), plus proof.checked with the past dates
 * that did not qualify. No progress (a date is not a counter).
 */
function evalHoldThroughDate(rule: HoldThroughDateRule, c: Ctx): EvalResult {
  const scope = scopeOf(rule, c.assetSource);
  if (scope.kind === "none") return incomplete(scope.reason);
  const days = dayEntries(c.snapshots, scope);
  if (days.length === 0) return incomplete("no_snapshots");

  const threshold = numOr(rule.minUsd, 1);
  const calendarKey = rule.calendarKey;
  const byDay = new Map(days.map((d) => [d.day, d]));
  const latest = days[days.length - 1];

  // Every in-scope asset ever seen, with a display symbol.
  const seen = new Map<string, string>();
  for (const d of days) for (const p of d.positions.values()) if (!seen.has(p.assetId)) seen.set(p.assetId, p.symbol);

  const heldNow = new Set([...latest.positions.values()].filter((p) => p.usd >= threshold).map((p) => p.assetId));
  const usdOn = (day: string, assetId: string): number | null => {
    const p = byDay.get(day)?.positions.get(assetId);
    return p && p.usd >= threshold ? p.usd : null;
  };
  const latestSnapshottedDay = (from: string, to: string): string | null => {
    for (let d = to; d >= from; d = addDays(d, -1)) if (byDay.has(d)) return d;
    return null;
  };
  const earliestSnapshottedDay = (from: string, to: string): string | null => {
    for (let d = from; d <= to; d = addDays(d, 1)) if (byDay.has(d)) return d;
    return null;
  };

  interface Match {
    assetId: string;
    symbol: string;
    underlying: string;
    earningsDate: string;
    before: { day: string; usd: number };
    after: { day: string; usd: number };
    completedAt: Date;
  }
  let match: Match | null = null;
  const checked: Array<Record<string, unknown>> = [];
  let next: { symbol: string; underlying: string; date: string } | null = null;
  let anyDates = false;

  for (const [assetId, symbol] of [...seen.entries()].sort(([a], [b]) => cmpStr(a, b))) {
    const underlying = c.underlyingOf(assetId);
    if (!underlying) continue;
    const dates = calendarDates(c.earnings, underlying);
    if (dates.length === 0) continue;
    anyDates = true;
    for (const D of dates) {
      if (D > c.today) {
        if (heldNow.has(assetId) && (!next || D < next.date)) next = { symbol, underlying, date: D };
        continue;
      }
      const beforeDay = latestSnapshottedDay(addDays(D, -3), addDays(D, -1));
      const afterDay = earliestSnapshottedDay(D, addDays(D, 3));
      const beforeUsd = beforeDay ? usdOn(beforeDay, assetId) : null;
      const afterUsd = afterDay ? usdOn(afterDay, assetId) : null;
      if (beforeDay && afterDay && beforeUsd !== null && afterUsd !== null) {
        const completedAt = byDay.get(afterDay)!.takenAt;
        if (!match || completedAt.getTime() < match.completedAt.getTime()) {
          match = {
            assetId,
            symbol,
            underlying,
            earningsDate: D,
            before: { day: beforeDay, usd: round2(beforeUsd) },
            after: { day: afterDay, usd: round2(afterUsd) },
            completedAt,
          };
        }
        continue;
      }
      // A date still inside its after-window may complete on a later tick; treat it as upcoming.
      if (!afterDay && D >= addDays(c.today, -3) && heldNow.has(assetId) && (!next || D < next.date)) {
        next = { symbol, underlying, date: D };
      }
      if (checked.length < MAX_PROOF_CHECKED) {
        checked.push({
          symbol,
          earningsDate: D,
          before: beforeDay ? { day: beforeDay, usd: beforeUsd === null ? null : round2(beforeUsd) } : null,
          after: afterDay ? { day: afterDay, usd: afterUsd === null ? null : round2(afterUsd) } : null,
        });
      }
    }
  }

  if (match) {
    return {
      complete: true,
      proof: {
        assetId: match.assetId,
        symbol: match.symbol,
        underlying: match.underlying,
        calendar: calendarKey,
        earningsDate: match.earningsDate,
        before: match.before,
        after: match.after,
        minUsd: threshold,
      },
      completedAt: iso(match.completedAt),
    };
  }

  const extra: Record<string, unknown> = { calendar: calendarKey, minUsd: threshold, takenAt: iso(latest.takenAt) };
  if (next) {
    extra.nextEarningsDate = next.date;
    extra.nextEarningsSymbol = next.symbol;
    extra.nextEarningsUnderlying = next.underlying;
    // The "hold by" hint shown in the Proof drawer: the before-check reads the D-1 day-end snapshot.
    extra.nextEarningsHoldBy = addDays(next.date, -1);
  }
  if (checked.length > 0) extra.checked = checked;
  if (heldNow.size === 0) return incomplete("no_held_assets", extra);
  if (!anyDates) return incomplete("no_earnings_date", extra);
  if (checked.length === 0) return incomplete("earnings_upcoming", extra);
  return incomplete("not_held_through", extra);
}

/**
 * diversified { minAssets, minSectors, minUsd? }
 * On the latest snapshot, in-scope positions with usd >= (minUsd ?? 1): distinct assetIds >=
 * minAssets AND distinct non-null sectors (ctx.sectorOf) >= minSectors. Assets are listed by
 * usd descending. Progress: assets / minAssets (sectors are in the proof). completedAt = takenAt.
 */
function evalDiversified(rule: DiversifiedRule, c: Ctx): EvalResult {
  const scope = scopeOf(rule, c.assetSource);
  if (scope.kind === "none") return incomplete(scope.reason);
  const latest = last(c.snapshots);
  if (!latest) return incomplete("no_snapshots");

  const threshold = numOr(rule.minUsd, 1);
  const minAssets = Math.max(1, Math.floor(numOr(rule.minAssets, 1)));
  const minSectors = Math.max(1, Math.floor(numOr(rule.minSectors, 1)));
  const assets = [...positionsOf(latest, scope).values()]
    .filter((p) => p.usd >= threshold)
    .sort(byUsdDesc)
    .map((p) => ({ symbol: p.symbol, sector: c.sectorOf(p.assetId), usd: round2(p.usd) }));
  const sectors = [...new Set(assets.map((a) => a.sector).filter((s): s is string => typeof s === "string" && s.length > 0))].sort(cmpStr);

  const proof: Record<string, unknown> = {
    takenAt: iso(latest.takenAt),
    assets,
    sectors,
    assetCount: assets.length,
    sectorCount: sectors.length,
    minAssets,
    minSectors,
    minUsd: threshold,
  };
  const progress = { current: Math.min(assets.length, minAssets), target: minAssets, unit: "assets" };
  if (assets.length < minAssets) return incomplete("too_few_assets", proof, progress);
  if (sectors.length < minSectors) return incomplete("too_few_sectors", proof, progress);
  return { complete: true, proof, progress, completedAt: iso(latest.takenAt) };
}

/**
 * mirror_match { tolerance }
 * Take the LATEST "mirror_executed" event whose meta is { targetWallet: string,
 * target: Record<assetId, weight 0..1> } (optionally meta.symbols: Record<assetId, string>),
 * then the latest snapshot taken strictly AFTER it. User weights = in-scope usd / total in-scope
 * usd. Complete when ALL of:
 *   - the in-scope total is at least MIRROR_MIN_TOTAL_USD ($1): an empty or dust wallet has
 *     weight 0 everywhere, which would sit "within tolerance" of any flat target
 *     (reason "empty_wallet");
 *   - every target asset satisfies |actual - target| <= tolerance and no user asset outside
 *     the target exceeds tolerance (those appear as legs with target 0) (reason "outside_tolerance");
 *   - the total distance Σ|actual - target| / 2 over all legs is <= tolerance: the share of
 *     the portfolio that would have to move to match the target. Per-leg checks alone pass a
 *     copy of 2 legs out of 7 (15 Sep review, Mirror engine) (reason "total_distance").
 * Weights are compared as given (no renormalisation). completedAt = that snapshot's takenAt.
 * Progress: legs within tolerance / legs (capped one below the total while the Play is
 * incomplete, so a failed distance check never reads as n / n).
 */
function evalMirrorMatch(rule: MirrorMatchRule, c: Ctx): EvalResult {
  const scope = scopeOf(rule, c.assetSource);
  if (scope.kind === "none") return incomplete(scope.reason);
  const tolerance = Math.min(1, Math.max(0, numOr(rule.tolerance, 0)));

  const mirrors = c.events.filter((e) => e.type === "mirror_executed");
  const ev = last(mirrors);
  if (!ev) return incomplete("no_mirror");
  const target = parseMirrorTarget(ev.meta);
  if (!target) return incomplete("malformed_mirror", { executedAt: iso(ev.ts), ref: ev.ref });

  const after = c.snapshots.filter((s) => s.takenAt.getTime() > ev.ts.getTime());
  const snap = last(after);
  if (!snap) return incomplete("no_snapshot_after_mirror", { targetWallet: target.wallet, executedAt: iso(ev.ts) });

  const positions = positionsOf(snap, scope);
  let total = 0;
  for (const p of positions.values()) total += p.usd;
  const weightOf = (assetId: string) => (total > 0 ? (positions.get(assetId)?.usd ?? 0) / total : 0);
  const symbolOf = (assetId: string) =>
    positions.get(assetId)?.symbol ?? target.symbols[assetId] ?? symbolFromHistory(c.snapshots, assetId) ?? assetId;

  const legs: Array<{ assetId: string; symbol: string; target: number; actual: number; delta: number; ok: boolean }> = [];
  for (const [assetId, weight] of [...target.weights.entries()].sort(([a, wa], [b, wb]) => wb - wa || cmpStr(a, b))) {
    const actual = weightOf(assetId);
    const delta = actual - weight;
    legs.push({ assetId, symbol: symbolOf(assetId), target: round4(weight), actual: round4(actual), delta: round4(delta), ok: Math.abs(delta) <= tolerance + WEIGHT_EPS });
  }
  for (const p of [...positions.values()].sort(byUsdDesc)) {
    if (target.weights.has(p.assetId)) continue;
    const actual = weightOf(p.assetId);
    legs.push({ assetId: p.assetId, symbol: p.symbol, target: 0, actual: round4(actual), delta: round4(actual), ok: actual <= tolerance + WEIGHT_EPS });
  }

  const ok = legs.filter((l) => l.ok).length;
  // Unrounded deltas: the proof rows are rounded to 4 dp for display only.
  let absDelta = 0;
  for (const [assetId, weight] of target.weights) absDelta += Math.abs(weightOf(assetId) - weight);
  for (const p of positions.values()) if (!target.weights.has(p.assetId)) absDelta += weightOf(p.assetId);
  const distance = absDelta / 2;
  const proof: Record<string, unknown> = {
    targetWallet: target.wallet,
    executedAt: iso(ev.ts),
    takenAt: iso(snap.takenAt),
    tolerance,
    totalUsd: round2(total),
    distance: round4(distance),
    legs,
  };
  const incompleteProgress = { current: Math.min(ok, Math.max(0, legs.length - 1)), target: legs.length, unit: "legs" };
  if (total < MIRROR_MIN_TOTAL_USD) return incomplete("empty_wallet", proof, { current: 0, target: legs.length, unit: "legs" });
  if (ok < legs.length) return incomplete("outside_tolerance", proof, incompleteProgress);
  if (distance > tolerance + WEIGHT_EPS) return incomplete("total_distance", proof, incompleteProgress);
  return { complete: true, proof, progress: { current: ok, target: legs.length, unit: "legs" }, completedAt: iso(snap.takenAt) };
}

/** A Mirror copy worth less than this (in-scope USD) never completes mirror_match. */
export const MIRROR_MIN_TOTAL_USD = 1;

/**
 * internal_event { event, count, distinctBy? }
 * Number of ctx.events with type === event is >= count. Scope fields are ignored (events are
 * not holdings). completedAt = ts of the count-th event. Proof lists the last 5 refs.
 *
 * With distinctBy, the matching events (ascending by ts) are reduced to the FIRST event per key
 * (see distinctKey) and the rule counts keys instead: complete when the number of distinct keys
 * reaches count, completedAt = ts of the count-th first occurrence, proof.refs = the last 5
 * distinct keys. Progress units: "days" (day), "xStocks" (symbol), "questions" (call_placed by
 * ref), else "items". The incomplete reason stays not_enough_events.
 */
function evalInternalEvent(rule: InternalEventRule, c: Ctx): EvalResult {
  const count = Math.max(1, Math.floor(numOr(rule.count, 1)));
  if (rule.distinctBy !== undefined) return evalInternalEventDistinct(rule, rule.distinctBy, count, c);
  const matches = c.events.filter((e) => e.type === rule.event);
  const n = matches.length;
  const proof: Record<string, unknown> = {
    event: rule.event,
    count: n,
    needed: count,
    refs: matches.slice(-5).map((e) => e.ref),
  };
  const lastEv = last(matches);
  if (lastEv) proof.lastAt = iso(lastEv.ts);
  const progress = { current: Math.min(n, count), target: count, unit: "events" };
  if (n < count) return incomplete("not_enough_events", proof, progress);
  return { complete: true, proof, progress, completedAt: iso(matches[count - 1].ts) };
}

type DistinctByKey = NonNullable<InternalEventRule["distinctBy"]>;

/**
 * The de-duplication key of one event, or null when the event carries none (and is skipped):
 *   ref    -> e.ref (an empty ref is no key);
 *   symbol -> meta.symbol, trimmed and upper-cased, when it is a non-empty string;
 *   day    -> the UTC calendar day (YYYY-MM-DD) of e.ts.
 */
function distinctKey(e: InternalEvent, by: DistinctByKey): string | null {
  switch (by) {
    case "ref":
      return e.ref.length > 0 ? e.ref : null;
    case "symbol": {
      const symbol = e.meta?.symbol;
      if (typeof symbol !== "string") return null;
      const key = symbol.trim().toUpperCase();
      return key.length > 0 ? key : null;
    }
    case "day":
      return dayKey(e.ts);
    default:
      return null;
  }
}

function distinctUnit(event: string, by: DistinctByKey): string {
  if (by === "day") return "days";
  if (by === "symbol") return "xStocks";
  if (by === "ref" && event === "call_placed") return "questions";
  return "items";
}

function evalInternalEventDistinct(rule: InternalEventRule, by: DistinctByKey, count: number, c: Ctx): EvalResult {
  // c.events is already ascending by ts (cleanEvents), so the first event seen per key is its first occurrence.
  const firsts: Array<{ key: string; ts: Date }> = [];
  const seen = new Set<string>();
  let lastEv: InternalEvent | undefined;
  for (const e of c.events) {
    if (e.type !== rule.event) continue;
    const key = distinctKey(e, by);
    if (key === null) continue;
    // lastAt: the latest event that carried a key, repeats included (a second trade in NVDAx still counts as activity).
    lastEv = e;
    if (seen.has(key)) continue;
    seen.add(key);
    firsts.push({ key, ts: e.ts });
  }
  const n = firsts.length;
  const proof: Record<string, unknown> = {
    event: rule.event,
    count: n,
    needed: count,
    distinctBy: by,
    refs: firsts.slice(-5).map((f) => f.key),
  };
  if (lastEv) proof.lastAt = iso(lastEv.ts);
  const progress = { current: Math.min(n, count), target: count, unit: distinctUnit(rule.event, by) };
  if (n < count) return incomplete("not_enough_events", proof, progress);
  return { complete: true, proof, progress, completedAt: iso(firsts[count - 1].ts) };
}

/**
 * multiplier_change {}
 * A Token-2022 ScaledUiAmount change (a split, or an issuer's periodic adjustment) rewrites the
 * multiplier on the mint and leaves every holder's raw balance alone. The rule completes when,
 * for one in-scope asset, two day-end snapshots on CONSECUTIVE calendar days both hold the asset
 * with THE SAME raw balance while the multiplier changed between them, and the change is the
 * one the mint itself records (ctx.corporateActions, read by lib/corporate-actions): the earlier
 * snapshot shows the record's multiplierBefore, the later one its multiplierAfter, and the
 * record's effectiveAt lies in (before.takenAt, after.takenAt]. A snapshot pair alone never
 * scores, in either direction: a degraded mint read that writes a wrong multiplier into one
 * tick has no record behind it and is ignored. A missed day (a cron outage) is not a pair, so
 * selling out and buying back across missed days never counts; a day-end without the asset, or
 * a different raw balance (trimmed or added to) across the change, is "not held through".
 * Price plays no part: the adjustment changes the number of tokens shown, not the holder's
 * value, and the proof shows exactly that (same raw, new multiplier).
 *
 * When several assets qualify the largest ratio (after / before) wins, then the earliest
 * completedAt, then assetId. completedAt = takenAt of the later snapshot. Progress is 0 or 1
 * "adjustments". Incomplete reasons: not_held_through (an adjustment on record landed between
 * two consecutive day-ends but the balance was not kept across it; proof.missed lists them) and
 * no_adjustment_yet (no adjustment on record has landed between two observed day-ends,
 * including a single baseline snapshot).
 */
function evalMultiplierChange(rule: MultiplierChangeRule, c: Ctx): EvalResult {
  const scope = scopeOf(rule, c.assetSource);
  if (scope.kind === "none") return incomplete(scope.reason);
  const days = dailySnapshots(c.snapshots);
  if (days.length === 0) return incomplete("no_snapshots");

  interface Obs {
    day: string;
    takenAt: Date;
    symbol: string;
    multiplier: number;
    raw: string;
    qty: number;
  }
  interface Point {
    day: string;
    multiplier: number;
    qty: number;
    raw: string;
  }
  const point = (o: Obs): Point => ({ day: o.day, multiplier: o.multiplier, qty: o.qty, raw: o.raw });

  // Per day, the in-scope observation of every asset present (duplicate rows summed; qty 0 rows kept as "not held").
  const perDay = days.map(({ day, snapshot }) => {
    const obs = new Map<string, Obs>();
    for (const h of snapshot.holdings) {
      if (!inScope(scope, h)) continue;
      const cur = obs.get(h.assetId);
      if (!cur) {
        obs.set(h.assetId, { day, takenAt: snapshot.takenAt, symbol: h.symbol, multiplier: h.multiplier, raw: h.raw, qty: h.qty });
        continue;
      }
      cur.qty += h.qty;
      cur.raw = addRaw(cur.raw, h.raw);
    }
    return { day, takenAt: snapshot.takenAt, obs };
  });
  const assetIds = [...new Set(perDay.flatMap((d) => [...d.obs.keys()]))].sort(cmpStr);
  const isHeld = (o: Obs | undefined): o is Obs => o !== undefined && o.qty > 0 && cmpRaw(o.raw, "0") > 0;

  interface Match {
    assetId: string;
    symbol: string;
    before: Obs;
    after: Obs;
    ratio: number;
  }
  const matches: Match[] = [];
  const missed: Array<Record<string, unknown>> = [];

  for (const assetId of assetIds) {
    const records = c.corporateActions.get(assetId) ?? [];
    if (records.length === 0) continue;
    let symbol = assetId;
    for (let i = 1; i < perDay.length; i++) {
      const prev = perDay[i - 1];
      const cur = perDay[i];
      if (cur.day !== addDays(prev.day, 1)) continue;
      const before = prev.obs.get(assetId);
      const after = cur.obs.get(assetId);
      symbol = after?.symbol ?? before?.symbol ?? symbol;
      // The record that landed between these two day-ends and agrees with what each of them shows.
      const record = records.find(
        (r) =>
          r.effectiveAt.getTime() > prev.takenAt.getTime() &&
          r.effectiveAt.getTime() <= cur.takenAt.getTime() &&
          (!isHeld(before) || !multiplierDiffers(before.multiplier, r.multiplierBefore)) &&
          (!isHeld(after) || !multiplierDiffers(after.multiplier, r.multiplierAfter)),
      );
      if (!record) continue;
      if (isHeld(before) && isHeld(after) && cmpRaw(after.raw, before.raw) === 0) {
        matches.push({ assetId, symbol, before, after, ratio: round8(after.multiplier / before.multiplier) });
      } else if (missed.length < MAX_PROOF_CHECKED) {
        missed.push({
          assetId,
          symbol,
          before: before ? point(before) : { day: prev.day, multiplier: record.multiplierBefore, qty: 0, raw: "0" },
          after: after ? point(after) : { day: cur.day, multiplier: record.multiplierAfter, qty: 0, raw: "0" },
        });
      }
    }
  }

  if (matches.length > 0) {
    matches.sort(
      (a, b) => b.ratio - a.ratio || a.after.takenAt.getTime() - b.after.takenAt.getTime() || cmpStr(a.assetId, b.assetId),
    );
    const best = matches[0];
    return {
      complete: true,
      proof: { assetId: best.assetId, symbol: best.symbol, before: point(best.before), after: point(best.after), ratio: best.ratio },
      progress: { current: 1, target: 1, unit: "adjustments" },
      completedAt: iso(best.after.takenAt),
    };
  }

  const progress = { current: 0, target: 1, unit: "adjustments" };
  const latest = days[days.length - 1];
  if (missed.length > 0) return incomplete("not_held_through", { takenAt: iso(latest.snapshot.takenAt), missed }, progress);
  return incomplete("no_adjustment_yet", { takenAt: iso(latest.snapshot.takenAt), days: days.length }, progress);
}

/** Multipliers are chain-reported decimals; anything beyond float noise is a change. */
function multiplierDiffers(a: number, b: number): boolean {
  return Math.abs(a - b) > MULTIPLIER_EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Compare two base-unit amounts; exact via BigInt when both are integer strings, numeric otherwise (NaN reads as 0). */
function cmpRaw(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = Number(a) || 0;
  const y = Number(b) || 0;
  return x < y ? -1 : x > y ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Context + input sanitising
// ---------------------------------------------------------------------------

interface Ctx {
  now: Date;
  /** UTC day of `now`. */
  today: string;
  /** Sanitised, ascending by takenAt. */
  snapshots: HoldingsSnapshot[];
  /** Sanitised, ascending by ts. */
  events: InternalEvent[];
  earnings: Record<string, string[]>;
  sectorOf: (assetId: string) => string | null;
  underlyingOf: (assetId: string) => string | null;
  /** The evaluating Play's AssetSource; null when the caller has no Play context. */
  assetSource: string | null;
  /** Sanitised adjustments on record, per assetId (only those with a date and two different positive multipliers). */
  corporateActions: Map<string, CleanAdjustment[]>;
}

interface CleanAdjustment {
  multiplierBefore: number;
  multiplierAfter: number;
  effectiveAt: Date;
}

function cleanContext(ctx: EvalContext, assetSource: string | null): Ctx {
  const raw = isObj(ctx) ? ctx : ({} as Partial<EvalContext>);
  const now = toDate(raw.now) ?? new Date();
  const sectorOf = safeLookup(raw.sectorOf);
  const underlyingOf = safeLookup(raw.underlyingOf);
  return {
    now,
    today: dayKey(now),
    snapshots: cleanSnapshots(raw.snapshots),
    events: cleanEvents(raw.events),
    earnings: isObj(raw.earnings) ? (raw.earnings as Record<string, string[]>) : {},
    sectorOf,
    underlyingOf,
    assetSource: typeof assetSource === "string" && assetSource.trim().length > 0 ? assetSource.trim() : null,
    corporateActions: cleanAdjustments(raw.corporateActions),
  };
}

/**
 * Adjustments on record, per assetId. An entry without an effective date cannot be placed
 * between two snapshots and is dropped: a change the mint does not date is never scored.
 */
function cleanAdjustments(input: unknown): Map<string, CleanAdjustment[]> {
  const out = new Map<string, CleanAdjustment[]>();
  for (const a of Array.isArray(input) ? input : []) {
    if (!isObj(a) || typeof a.assetId !== "string" || a.assetId.length === 0) continue;
    const multiplierBefore = num(a.multiplierBefore);
    const multiplierAfter = num(a.multiplierAfter);
    const effectiveAt = toDate(a.effectiveAt);
    if (multiplierBefore === null || multiplierAfter === null || multiplierBefore <= 0 || multiplierAfter <= 0 || !effectiveAt) continue;
    if (!multiplierDiffers(multiplierBefore, multiplierAfter)) continue;
    const list = out.get(a.assetId) ?? [];
    list.push({ multiplierBefore, multiplierAfter, effectiveAt });
    out.set(a.assetId, list);
  }
  return out;
}

function safeLookup(fn: unknown): (assetId: string) => string | null {
  if (typeof fn !== "function") return () => null;
  const f = fn as (assetId: string) => unknown;
  return (assetId) => {
    try {
      const v = f(assetId);
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    } catch {
      return null;
    }
  };
}

function cleanSnapshots(input: unknown): HoldingsSnapshot[] {
  const out: HoldingsSnapshot[] = [];
  for (const s of Array.isArray(input) ? input : []) {
    if (!isObj(s)) continue;
    const takenAt = toDate(s.takenAt);
    if (!takenAt) continue;
    const holdings: Holding[] = [];
    for (const raw of Array.isArray(s.holdings) ? s.holdings : []) {
      const h = cleanHolding(raw);
      if (h) holdings.push(h);
    }
    out.push({ walletId: typeof s.walletId === "string" ? s.walletId : "", takenAt, holdings });
  }
  return out.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
}

function cleanEvents(input: unknown): InternalEvent[] {
  const out: InternalEvent[] = [];
  for (const e of Array.isArray(input) ? input : []) {
    if (!isObj(e) || typeof e.type !== "string") continue;
    const ts = toDate(e.ts);
    if (!ts) continue;
    out.push({
      type: e.type,
      userId: typeof e.userId === "string" ? e.userId : "",
      ref: typeof e.ref === "string" ? e.ref : "",
      ts,
      meta: isObj(e.meta) ? e.meta : undefined,
    });
  }
  return out.sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

const PRICE_SOURCES: ReadonlySet<string> = new Set<PriceSourceName>(["pyth", "jupiter", "cache", "none"]);

/** Coerce one holding row; null when it has no usable assetId. Negative qty/usd clamp to 0. */
function cleanHolding(v: unknown): Holding | null {
  if (!isObj(v)) return null;
  if (typeof v.assetId !== "string" || v.assetId.length === 0) return null;
  const assetId = v.assetId as AssetId;
  const price = num(v.price);
  return {
    assetId,
    symbol: typeof v.symbol === "string" && v.symbol.length > 0 ? v.symbol : assetId,
    source: typeof v.source === "string" && v.source.trim().length > 0 ? v.source.trim() : DEFAULT_ASSET_SOURCE,
    raw: typeof v.raw === "string" ? v.raw : "0",
    multiplier: num(v.multiplier) ?? 1,
    qty: Math.max(0, num(v.qty) ?? 0),
    price,
    priceSource: typeof v.priceSource === "string" && PRICE_SOURCES.has(v.priceSource) ? (v.priceSource as PriceSourceName) : "none",
    usd: Math.max(0, num(v.usd) ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

type Scope =
  | { kind: "all"; source: string | null }
  | { kind: "ids"; ids: ReadonlySet<string>; source: string | null }
  | { kind: "symbols"; symbols: ReadonlySet<string>; source: string | null }
  | { kind: "none"; reason: string };

/**
 * Two filters, and BOTH apply. The Play's assetSource fences the quest to one issuer, so an
 * xStocks quest can never be completed by another issuer's token — that is the whole point of
 * tagging holdings. A rule's own assetIds / assetSymbols then narrow it further; they do not
 * replace the issuer fence, because two issuers may one day ship the same symbol.
 *
 * `assetSource` null means the caller has no Play context (a unit test, say), and the scope is
 * every holding — exactly what it meant before holdings were source-tagged.
 */
function scopeOf(rule: PlayRule, source: string | null): Scope {
  if (Array.isArray(rule.partnerAssetIds)) {
    if (rule.partnerAssetIds.length === 0) return { kind: "none", reason: "partner_pending" };
    return { kind: "ids", ids: new Set(rule.partnerAssetIds), source };
  }
  if (Array.isArray(rule.assetIds) && rule.assetIds.length > 0) return { kind: "ids", ids: new Set(rule.assetIds), source };
  if (Array.isArray(rule.assetSymbols) && rule.assetSymbols.length > 0) {
    return { kind: "symbols", symbols: new Set(rule.assetSymbols.map((s) => String(s).trim().toUpperCase())), source };
  }
  return { kind: "all", source };
}

function inScope(scope: Scope, h: Holding): boolean {
  if (scope.kind === "none") return false;
  if (scope.source !== null && h.source !== scope.source) return false;
  switch (scope.kind) {
    case "all":
      return true;
    case "ids":
      return scope.ids.has(h.assetId);
    case "symbols":
      return scope.symbols.has(h.symbol.trim().toUpperCase());
  }
}

// ---------------------------------------------------------------------------
// Positions + days
// ---------------------------------------------------------------------------

/** One asset's position inside a snapshot after summing duplicate rows. */
interface Position {
  assetId: string;
  symbol: string;
  qty: number;
  usd: number;
  price: number | null;
  priceSource: PriceSourceName;
}

interface DayEntry {
  day: string;
  takenAt: Date;
  positions: Map<string, Position>;
}

/** In-scope positions of a (sanitised) snapshot keyed by assetId. qty <= 0 rows are dropped. */
function positionsOf(snapshot: HoldingsSnapshot, scope: Scope): Map<string, Position> {
  const out = new Map<string, Position>();
  for (const h of snapshot.holdings) {
    if (h.qty <= 0 || !inScope(scope, h)) continue;
    const cur = out.get(h.assetId);
    if (!cur) {
      out.set(h.assetId, { assetId: h.assetId, symbol: h.symbol, qty: h.qty, usd: h.usd, price: h.price, priceSource: h.priceSource });
      continue;
    }
    cur.qty += h.qty;
    cur.usd += h.usd;
    if (cur.price === null && h.price !== null) {
      cur.price = h.price;
      cur.priceSource = h.priceSource;
    }
  }
  return out;
}

/** Day-end (last of each UTC day) in-scope positions, ascending by day. */
function dayEntries(snapshots: HoldingsSnapshot[], scope: Scope): DayEntry[] {
  return dailySnapshots(snapshots).map(({ day, snapshot }) => ({
    day,
    takenAt: snapshot.takenAt,
    positions: positionsOf(snapshot, scope),
  }));
}

function symbolFromHistory(snapshots: HoldingsSnapshot[], assetId: string): string | null {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const h = snapshots[i].holdings.find((x) => x.assetId === assetId);
    if (h) return h.symbol;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mirror event meta
// ---------------------------------------------------------------------------

interface MirrorTarget {
  wallet: string;
  weights: Map<string, number>;
  symbols: Record<string, string>;
}

/** Validate a mirror_executed meta; null when it cannot be evaluated. */
function parseMirrorTarget(meta: unknown): MirrorTarget | null {
  if (!isObj(meta)) return null;
  const wallet = typeof meta.targetWallet === "string" ? meta.targetWallet : null;
  if (!wallet || !isObj(meta.target)) return null;
  const weights = new Map<string, number>();
  for (const [assetId, w] of Object.entries(meta.target)) {
    const n = num(w);
    if (assetId.length === 0 || n === null || n < 0 || n > 1) return null;
    weights.set(assetId, n);
  }
  if (weights.size === 0) return null;
  const symbols: Record<string, string> = {};
  if (isObj(meta.symbols)) {
    for (const [assetId, s] of Object.entries(meta.symbols)) if (typeof s === "string" && s.length > 0) symbols[assetId] = s;
  }
  return { wallet, weights, symbols };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valid, sorted, de-duplicated ISO dates for an underlying (case-insensitive key). */
function calendarDates(earnings: Record<string, string[]>, underlying: string): string[] {
  const key = underlying.trim();
  const raw = earnings[key] ?? earnings[key.toUpperCase()] ?? findKeyInsensitive(earnings, key);
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return [...new Set(list.filter((d): d is string => typeof d === "string" && ISO_DAY_RE.test(d)))].sort(cmpStr);
}

function findKeyInsensitive(obj: Record<string, unknown>, key: string): unknown {
  const upper = key.toUpperCase();
  for (const k of Object.keys(obj)) if (k.toUpperCase() === upper) return obj[k];
  return undefined;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
/** Tolerance for float noise on qty comparisons. */
const QTY_EPS = 1e-9;
const WEIGHT_EPS = 1e-9;
/** Relative tolerance for "the multiplier changed" (chain multipliers carry up to ~10 decimals). */
const MULTIPLIER_EPS = 1e-9;
/** Cap on per-day lists in proofs so a 365-day rule keeps the JSON small. */
const MAX_PROOF_DAYS = 60;
const MAX_PROOF_CHECKED = 10;

function incomplete(reason: string, extra: Record<string, unknown> = {}, progress?: EvalResult["progress"]): EvalResult {
  const res: EvalResult = { complete: false, proof: { reason, ...extra } };
  if (progress) res.progress = progress;
  return res;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function numOr(v: unknown, fallback: number): number {
  return num(v) ?? fallback;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

function iso(d: Date): string {
  return d.toISOString();
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byUsdDesc(a: Position, b: Position): number {
  return b.usd - a.usd || b.qty - a.qty || cmpStr(a.assetId, b.assetId);
}

function last<T>(list: T[]): T | undefined {
  return list.length > 0 ? list[list.length - 1] : undefined;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function round8(n: number): number {
  return Math.round(n * 100_000_000) / 100_000_000;
}

/** Sum two base-unit amounts; exact via BigInt when both are integer strings. */
function addRaw(a: string, b: string): string {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return (BigInt(a) + BigInt(b)).toString();
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? String(x + y) : a;
}
