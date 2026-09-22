import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ProofDrawer (ProofList) renders the wallet ConnectButton in its locked state; only ProofList is under test.
vi.mock("@/components/wallet/ConnectButton", () => ({ ConnectButton: () => null }));

import type { PlayRule } from "@/lib/plays/rules";
import { SEASON0_PLAYS } from "@/lib/plays/catalogue";
import { evaluatePlay } from "@/lib/plays/engine";
import type { PartnerDetail, PartnerGroup, PartnerPlayView, PlayView } from "@/lib/api-client";
import { eventHint, ruleToHint } from "@/components/plays/rule-hint";
import { flattenProof, formatProofValue, humaniseKey, isEmptyProof, PROOF_TRUNCATED_KEY, shortAssetId } from "@/components/plays/proof";
import { ProofList } from "@/components/plays/ProofDrawer";
import { PartnerBody } from "@/components/partners/PartnerView";
import { COMING_SOON_HEADING, IN_PLATFORM_HEADING, ON_CHAIN_HEADING, PlayGrid } from "@/components/plays/PlayGrid";
import { COMPLIANCE_LINE } from "@/components/common/compliance";
import {
  PLAY_FILTERS,
  boardTotals,
  cardProgress,
  listedPartnerCount,
  matchesFilter,
  partnerListingLabel,
  partnerPageHref,
  partnerRowCaption,
  playHref,
  progressUnitLabel,
  proofProgress,
  questKind,
  visibleStartAction,
  type PlayFilter,
} from "@/components/plays/play-meta";

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("ruleToHint", () => {
  it("phrases every Season 0 rule type in Dulo voice", () => {
    expect(ruleToHint({ type: "hold_any", minUsd: 5 })).toBe("Any xStock worth $5+ in your wallet");
    expect(ruleToHint({ type: "hold_any", minUsd: 0 })).toBe("Any xStock in your wallet");
    expect(ruleToHint({ type: "hold_any", minUsd: 1000 })).toBe("Any xStock worth $1,000+ in your wallet");
    expect(ruleToHint({ type: "hold_any", minUsd: 2.5 })).toBe("Any xStock worth $2.50+ in your wallet");
    expect(ruleToHint({ type: "hold_any", minUsd: 5, assetSymbols: ["NVDAx"] })).toBe("NVDAx worth $5+ in your wallet");
    expect(ruleToHint({ type: "hold_any", minUsd: 1, partnerAssetIds: [] })).toBe("A partner position worth $1+ in your wallet");
    const TSLAX_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
    const NVDAX_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
    expect(ruleToHint({ type: "hold_any", minUsd: 5, assetIds: [NVDAX_ID] })).toBe("A selected xStock worth $5+ in your wallet");
    expect(ruleToHint({ type: "hold_any", minUsd: 5, assetIds: [NVDAX_ID, TSLAX_ID] })).toBe("One of 2 selected xStocks worth $5+ in your wallet");
    expect(ruleToHint({ type: "hold_any", minUsd: 5, assetIds: [NVDAX_ID], assetSymbols: ["NVDAx"] })).toBe("NVDAx worth $5+ in your wallet");
    expect(ruleToHint({ type: "diversified", minAssets: 3, minSectors: 2 })).toBe("3+ xStocks across 2+ sectors in your wallet");
    expect(ruleToHint({ type: "hold_consecutive", days: 7 })).toBe("The same xStock held for 7 daily snapshots in a row");
    expect(ruleToHint({ type: "hold_consecutive", days: 7, assetSymbols: ["NVDAx"] })).toBe("NVDAx held for 7 daily snapshots in a row");
    expect(ruleToHint({ type: "net_increase_days", count: 3, window: 14 })).toBe("xStocks balance up on 3 separate days in any 14-day window");
    expect(ruleToHint({ type: "hold_through_date", calendarKey: "earnings" })).toBe("Held through an earnings date");
    expect(ruleToHint({ type: "hold_through_date", calendarKey: "earnings", assetSymbols: ["NVDAx"] })).toBe("NVDAx held through an earnings date");
    expect(ruleToHint({ type: "mirror_match", tolerance: 0.2 })).toBe("Wallet allocation within 20% of a portfolio you copied");
    expect(ruleToHint({ type: "internal_event", event: "league_trade", count: 3 })).toBe("Make 3 paper trades");
    expect(ruleToHint({ type: "internal_event", event: "call_placed", count: 1 })).toBe("Make a prediction");
    expect(ruleToHint({ type: "internal_event", event: "call_placed", count: 2 })).toBe("Make 2 predictions");
    expect(ruleToHint({ type: "internal_event", event: "mirror_executed", count: 1 })).toBe("Copy a wallet's portfolio");
  });

  it("reads distinctBy: different questions, different xStocks, different UTC days", () => {
    expect(ruleToHint({ type: "internal_event", event: "call_placed", count: 3, distinctBy: "ref" })).toBe("Make predictions on 3 different questions");
    expect(ruleToHint({ type: "internal_event", event: "call_placed", count: 5, distinctBy: "ref" })).toBe("Make predictions on 5 different questions");
    expect(ruleToHint({ type: "internal_event", event: "league_trade", count: 3, distinctBy: "symbol" })).toBe("Make paper trades in 3 different xStocks");
    expect(ruleToHint({ type: "internal_event", event: "game_action", count: 3, distinctBy: "day" })).toBe("Be active on 3 different days (UTC)");
    expect(ruleToHint({ type: "internal_event", event: "game_action", count: 4 })).toBe("Make 4 paper trades or predictions");
    expect(eventHint("game_action", 1)).toBe("Make a paper trade or a prediction");
    // A distinctBy the copy has no sentence for falls back to the plain count; the default branch is unchanged.
    expect(eventHint("league_trade", 2, "day")).toBe("Make 2 paper trades");
    expect(eventHint("some_new_thing", 2, "ref")).toBe("Trigger 2 some new thing events");
    expect(eventHint("some_new_thing", 1)).toBe("Trigger a some new thing event");
  });

  it("gives every catalogue quest a hint, and no on-chain hint says to buy", () => {
    for (const play of SEASON0_PLAYS) {
      const hint = ruleToHint(play.rule);
      expect(hint.length, play.key).toBeGreaterThan(10);
      expect(hint, play.key).not.toMatch(/\b(buy|buys|buying|purchase|swap|deposit|add to|top up)\b/i);
    }
  });

  it("never throws on an unknown rule type", () => {
    expect(ruleToHint({ type: "unknown", raw: {} } as unknown as PlayRule)).toBe("Complete the on-chain action");
  });
});

describe("flattenProof", () => {
  it("returns nothing for null / empty proofs", () => {
    expect(flattenProof(null)).toEqual([]);
    expect(flattenProof(undefined)).toEqual([]);
    expect(isEmptyProof({})).toBe(true);
    expect(isEmptyProof([])).toBe(true);
    expect(isEmptyProof({ a: 1 })).toBe(false);
  });

  it("labels keys, formats leaves and groups an array of objects into one row", () => {
    const rows = flattenProof({
      symbol: "NVDAx",
      usd: 12.5,
      ok: true,
      takenAt: "2026-09-14T10:00:00.000Z",
      sectors: ["Technology", "Energy"],
      holdings: [{ symbol: "NVDAx", qty: 0.1 }],
      nothing: null,
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.symbol).toMatchObject({ label: "Stock", value: "NVDAx" });
    expect(byKey.usd).toMatchObject({ label: "Value", value: "$12.50", raw: "12.5" });
    expect(byKey.ok).toMatchObject({ label: "Ok", value: "yes" });
    expect(byKey.takenAt.label).toBe("Snapshot time");
    expect(byKey.takenAt.raw).toBe("2026-09-14T10:00:00.000Z");
    expect(byKey.takenAt.value).not.toBe("2026-09-14T10:00:00.000Z");
    expect(byKey.sectors).toMatchObject({ label: "Sectors", value: "Technology, Energy" });
    expect(byKey.holdings.label).toBe("Holdings");
    expect(byKey.holdings.items).toEqual([{ value: "NVDAx · quantity 0.1", raw: '{"symbol":"NVDAx","qty":0.1}' }]);
    expect(rows.some((r) => r.key.startsWith("holdings."))).toBe(false);
    expect(byKey.nothing).toMatchObject({ label: "Nothing", value: "—" });
  });

  it("reads a diversified proof as a labelled statement: one line per stock, no dotted paths or camelCase", () => {
    const rows = flattenProof({
      reason: "too_few_sectors",
      takenAt: "2026-09-14T10:00:00.000Z",
      assets: [
        { symbol: "NVDAx", sector: "Technology", usd: 12400 },
        { symbol: "TSLAx", sector: null, usd: 5 },
      ],
      sectors: ["Technology"],
      assetCount: 2,
      sectorCount: 1,
      minAssets: 3,
      minSectors: 2,
      minUsd: 1,
      progress: { current: 2, target: 3, unit: "assets" },
    });
    expect(rows.map((r) => r.label)).toEqual([
      "Status",
      "Snapshot time",
      "Stocks",
      "Sectors",
      "Stocks held",
      "Sectors held",
      "Minimum stocks",
      "Minimum sectors",
      "Minimum value",
      "Progress",
    ]);
    // Every label is distinct: the sector list and the sector count never share a label.
    expect(new Set(rows.map((r) => r.label)).size).toBe(rows.length);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.reason).toMatchObject({ value: "Too few sectors", raw: "too_few_sectors" });
    // A null sector stays visible as "sector —" rather than vanishing from the line.
    expect(byKey.assets.items?.map((i) => i.value)).toEqual(["NVDAx · Technology · $12,400.00", "TSLAx · sector — · $5.00"]);
    expect(byKey.assets.items?.[0].raw).toBe('{"symbol":"NVDAx","sector":"Technology","usd":12400}');
    expect(byKey.minUsd.value).toBe("$1.00");
    expect(byKey.progress).toMatchObject({ value: "2 of 3 stocks", raw: '{"current":2,"target":3,"unit":"assets"}' });
    for (const r of rows) {
      expect(r.key, r.key).not.toMatch(/\.\d+(?:\.|$)/);
      expect(r.label, r.label).not.toMatch(/[a-z][A-Z]|\./);
    }
    expect(flattenProof({ progress: { current: 4, target: 5, unit: "usd" } })[0].value).toBe("$4.00 of $5.00");
  });

  it("shows the ticker for a CAIP-19 assetId with a symbol, else a shortened mint, keeping the full id raw", () => {
    const NVDAX_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
    const held = flattenProof({ assetId: NVDAX_ID, symbol: "NVDAx", qty: 2, usd: 360.5, priceSource: "jupiter", takenAt: "2026-09-14T10:00:00.000Z" });
    expect(held.map((r) => r.label)).toEqual(["Asset", "Quantity", "Value", "Price source", "Snapshot time"]);
    expect(held[0]).toEqual({ key: "assetId", label: "Asset", value: "NVDAx", raw: NVDAX_ID });
    expect(held[3]).toMatchObject({ value: "Jupiter", raw: "jupiter" });

    expect(shortAssetId(NVDAX_ID)).toBe("Xsc9…9qEh");
    expect(shortAssetId("not-an-id")).toBe("not-an-id");
    const bare = flattenProof({ assetId: NVDAX_ID });
    expect(bare).toEqual([{ key: "assetId", label: "Asset", value: "Xsc9…9qEh", raw: NVDAX_ID, mono: true }]);
    // The engine falls back to the id as the symbol; that is not a ticker.
    expect(flattenProof({ assetId: NVDAX_ID, symbol: NVDAX_ID })[0].value).toBe("Xsc9…9qEh");
    // Inside a list item the ticker wins and the id stays in the item's raw JSON.
    const items = flattenProof({ days: [{ day: "2026-09-02", assetId: NVDAX_ID, symbol: "NVDAx", from: 0.1, to: 0.25, deltaUsd: 15 }] })[0].items;
    expect(items?.[0].value).toBe("2026-09-02 · NVDAx · 0.1 → 0.25 · added value $15.00");
    expect(items?.[0].raw).toContain(NVDAX_ID);
    expect(flattenProof({ assetIds: [NVDAX_ID] })[0]).toMatchObject({ label: "Asset IDs", value: "Xsc9…9qEh", mono: true });
  });

  it("groups Mirror legs, earnings checks, day maps and windows into readable lines", () => {
    const SPYX = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
    const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    const mirror = flattenProof({
      targetWallet: WALLET,
      tolerance: 0.2,
      distance: 0.05,
      legs: [
        { assetId: SPYX, symbol: "SPYx", target: 0.5, actual: 0.45, delta: -0.05, ok: true },
        { assetId: "solana:x/token:abc", symbol: "QQQx", target: 0, actual: 0.3, delta: 0.3, ok: false },
      ],
      intent: { targetWallet: WALLET, target: { [SPYX]: 0.5 }, symbols: { [SPYX]: "SPYx" }, budgetUsd: 100 },
    });
    const m = Object.fromEntries(mirror.map((r) => [r.key, r]));
    expect(m.targetWallet).toMatchObject({ label: "Target wallet", value: WALLET, mono: true });
    expect(m.distance).toMatchObject({ label: "Distance from target", value: "5%" });
    expect(m.legs.items?.map((i) => i.value)).toEqual([
      "SPYx · target 50% · actual 45% · within tolerance",
      "QQQx · target 0% · actual 30% · outside tolerance",
    ]);
    expect(m["intent.target"]).toMatchObject({ label: "Portfolio copy · Target weights" });
    expect(m["intent.target"].items).toEqual([{ value: "SPYx · 50%", raw: JSON.stringify({ [SPYX]: 0.5 }) }]);
    expect(m["intent.symbols"]).toBeUndefined();
    expect(m["intent.budgetUsd"]).toMatchObject({ label: "Portfolio copy · Budget", value: "$100.00" });

    const streak = flattenProof({
      usdByDay: { "2026-09-01": 12.5, "2026-09-02": null },
      window: { from: "2026-09-01", to: "2026-09-14" },
      before: { day: "2026-07-29", usd: 12 },
      checked: [{ symbol: "NVDAx", earningsDate: "2026-07-30", before: { day: "2026-07-29", usd: 12 }, after: null }],
    });
    const s = Object.fromEntries(streak.map((r) => [r.key, r]));
    expect(s.usdByDay).toMatchObject({ label: "Value by day" });
    expect(s.usdByDay.items?.map((i) => i.value)).toEqual(["2026-09-01 · $12.50", "2026-09-02 · —"]);
    expect(s.window).toMatchObject({ label: "Window", value: "2026-09-01 → 2026-09-14" });
    expect(s.before).toMatchObject({ label: "Before", value: "2026-07-29 · $12.00" });
    expect(s.checked.label).toBe("Dates checked");
    // after: null is why the date did not qualify, so it must stay visible.
    expect(s.checked.items?.[0].value).toBe("NVDAx · earnings date 2026-07-30 · before 2026-07-29 $12.00 · after —");
    const failed = flattenProof({ checked: [{ symbol: "NVDAx", earningsDate: "2026-07-30", before: { day: "2026-07-29", usd: null }, after: null }] });
    expect(failed[0].items?.[0].value).toBe("NVDAx · earnings date 2026-07-30 · before 2026-07-29 value — · after —");
  });

  it("never hides values: nulls, fallback symbols, uncovered symbols maps, long primitive lists and data keys", () => {
    const ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
    const OTHER = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
    // The engine's symbol fallback (symbol === assetId) is not printed twice.
    expect(flattenProof({ legs: [{ assetId: ID, symbol: ID, target: 0.5, actual: 0.5, delta: 0, ok: true }] })[0].items?.[0].value).toBe(
      "Xsc9…9qEh · target 50% · actual 50% · within tolerance",
    );
    expect(flattenProof({ assetId: ID, symbol: ID }).map((r) => r.label)).toEqual(["Asset"]);
    // A symbols map that labels ids outside the target map is still shown.
    const intent = flattenProof({ intent: { target: { [ID]: 1 }, symbols: { [ID]: "NVDAx", [OTHER]: "SPYx" } } });
    expect(intent.map((r) => r.key)).toEqual(["intent.target", "intent.symbols"]);
    expect(intent[1].items?.map((i) => i.value)).toContain("XsoC…DF2W · SPYx");
    // A long primitive list is capped with "+N more" and keeps the full list raw.
    const days = Array.from({ length: 45 }, (_, i) => `2026-08-${String((i % 28) + 1).padStart(2, "0")}`);
    const row = flattenProof({ bridged: days })[0];
    expect(row.value.endsWith(", +25 more")).toBe(true);
    expect(row.raw).toBe(JSON.stringify(days));
    // Keys that are data keep their spelling (no "Nvd ax", no "2026 09 01").
    expect(humaniseKey("NVDAx")).toBe("NVDAx");
    expect(humaniseKey("2026-09-01")).toBe("2026-09-01");
    expect(humaniseKey(ID)).toBe("Xsc9…9qEh");
    expect(flattenProof({ weights: { NVDAx: 0.6, SPYx: 0.4 } })[0].items?.map((i) => i.value)).toEqual(["NVDAx · 60%", "SPYx · 40%"]);
    expect(flattenProof({ byDay: { "2026-09-01": { usd: 1, qty: 2 } } })[0].label).toBe("By day · 2026-09-01");
    // Object.prototype names are ordinary keys.
    expect(humaniseKey("constructor")).toBe("Constructor");
    expect(formatProofValue("constructor_error", "reason").value).toBe("Constructor error");
    expect(flattenProof({ progress: { current: 1, target: 2, unit: "constructor" } })[0].value).toBe("1 of 2 constructor");
    // A Date is a timestamp, not an empty object.
    const at = flattenProof({ seenAt: new Date("2026-09-14T10:00:00.000Z") })[0];
    expect(at).toMatchObject({ label: "Seen at", raw: "2026-09-14T10:00:00.000Z" });
    expect(at.value).not.toBe("None");
  });

  it("humanises unknown keys by splitting camelCase and snake_case", () => {
    expect(humaniseKey("someCamelKey")).toBe("Some camel key");
    expect(humaniseKey("total_usd_value")).toBe("Total USD value");
    expect(humaniseKey("walletID")).toBe("Wallet ID");
    expect(humaniseKey("nextEarningsHoldBy")).toBe("Hold by");
    expect(humaniseKey("assetId")).toBe("Asset");
    expect(humaniseKey("")).toBe("");
    expect(formatProofValue("needs_daily_snapshots", "reason")).toEqual({ value: "Needs daily snapshots", raw: "needs_daily_snapshots" });
    expect(formatProofValue("x", "reason")).toEqual({ value: "x" });
  });

  it("keeps the row budget, caps long lists with a '+N more' line and never throws", () => {
    const wide = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`field${i}`, i]));
    const wideRows = flattenProof(wide);
    // 60 rows, then one row that says more was left out (never a silent cut).
    expect(wideRows).toHaveLength(61);
    expect(wideRows[60]).toEqual({ key: PROOF_TRUNCATED_KEY, label: "More", value: "Further evidence not shown" });
    expect(flattenProof(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i}`, i])))).toHaveLength(60);

    const many = Array.from({ length: 100 }, (_, i) => ({ symbol: `S${i}`, usd: i }));
    const one = flattenProof({ assets: many })[0];
    expect(one.items).toHaveLength(21);
    expect(one.items?.[20].value).toBe("+80 more");

    const lists = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`list${i}`, many.slice(0, 30)]));
    const capped = flattenProof(lists);
    const shown = capped
      .filter((r) => r.key !== PROOF_TRUNCATED_KEY)
      .reduce((n, r) => n + (r.items ? r.items.filter((x) => !x.value.startsWith("+")).length : 1), 0);
    expect(shown).toBeLessThanOrEqual(60);
    // Three lists of 20 spend the budget; the other two are reported by the trailing "More" row.
    expect(capped.map((r) => r.key)).toEqual(["list0", "list1", "list2", PROOF_TRUNCATED_KEY]);

    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    for (const weird of [
      cyclic,
      { big: BigInt(7) },
      { fn: () => 1 },
      { mixed: [1, { a: 1 }, null, [2, 3], "x"] },
      { deep: [[[[{ a: 1 }]]]] },
      { empty: [], none: {} },
      "text",
      [{ symbol: "NVDAx" }],
    ]) {
      expect(() => flattenProof(weird)).not.toThrow();
    }
    expect(flattenProof({ big: BigInt(7) })[0].value).toBe("7");
    expect(flattenProof({ empty: [], none: {} }).map((r) => r.value)).toEqual(["None", "None"]);
    expect(flattenProof({ mixed: [1, { a: 1 }, null] })[0].items?.map((i) => i.value)).toEqual(["1", "a 1", "—"]);
  });

  it("renders grouped entries as a labelled list with raw values in title tooltips", () => {
    const NVDAX_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
    const html = renderToStaticMarkup(
      createElement(ProofList, {
        entries: flattenProof({
          assetId: NVDAX_ID,
          symbol: "NVDAx",
          takenAt: "2026-09-14T10:00:00.000Z",
          assets: [{ symbol: "NVDAx", sector: "Technology", usd: 12400 }],
        }),
      }),
    );
    expect(html).toContain(">Asset</dt>");
    expect(html).toContain(`title="${NVDAX_ID}">NVDAx</dd>`);
    expect(html).toContain(">Snapshot time</dt>");
    expect(html).toContain(">Stocks</dt>");
    expect(html).toContain("NVDAx · Technology · $12,400.00</li>");
    expect(html).not.toContain("assets.0");
    expect(html).not.toContain(">takenAt<");
    // Labels are prose: no monospace on the label column.
    expect(html).not.toMatch(/<dt[^>]*font-mono/);
  });

  it("formats values by key name and keeps the raw value for the tooltip", () => {
    const rows = flattenProof({
      qty: 0.123456789,
      minQty: 12,
      uiQty: "3.1000000",
      usd: 1234.5,
      minUsd: 5,
      totalUsd: "0.5",
      priceSource: "jupiter",
      source: "helius",
      tolerance: 0.2,
      distance: 0.0512,
      maxWeight: 25,
      weights: [0.5, 0.25],
      legs: [{ symbol: "SPYx", targetWeight: 0.3333, target: 0.3333 }],
      symbol: "qty",
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.qty).toEqual({ key: "qty", label: "Quantity", value: "0.123457", raw: "0.123456789" });
    expect(byKey.minQty).toEqual({ key: "minQty", label: "Min qty", value: "12" });
    expect(byKey.uiQty).toEqual({ key: "uiQty", label: "Ui qty", value: "3.1", raw: "3.1000000" });
    expect(byKey.usd).toEqual({ key: "usd", label: "Value", value: "$1,234.50", raw: "1234.5" });
    expect(byKey.minUsd).toEqual({ key: "minUsd", label: "Minimum value", value: "$5.00", raw: "5" });
    expect(byKey.totalUsd).toEqual({ key: "totalUsd", label: "Total value", value: "$0.5000", raw: "0.5" });
    expect(byKey.priceSource).toEqual({ key: "priceSource", label: "Price source", value: "Jupiter", raw: "jupiter" });
    expect(byKey.source).toEqual({ key: "source", label: "Source", value: "Helius", raw: "helius" });
    expect(byKey.tolerance).toEqual({ key: "tolerance", label: "Tolerance", value: "20%", raw: "0.2" });
    expect(byKey.distance).toEqual({ key: "distance", label: "Distance from target", value: "5.12%", raw: "0.0512" });
    // Outside 0..1 a weight is not a ratio: left as the plain number.
    expect(byKey.maxWeight).toEqual({ key: "maxWeight", label: "Max weight", value: "25" });
    expect(byKey.weights).toEqual({ key: "weights", label: "Weights", value: "50%, 25%", raw: "[0.5,0.25]" });
    // Mirror legs carry weights: target / actual read as percentages on the leg's one line.
    expect(byKey.legs.items?.map((i) => i.value)).toEqual(["SPYx · target weight 33.33% · target 33.33%"]);
    // A "qty" string value is not a key.
    expect(byKey.symbol).toMatchObject({ label: "Stock", value: "qty" });
    // Outside a leg a bare "target" key stays a plain number.
    expect(formatProofValue(0.3333, "target")).toEqual({ value: "0.3333" });
  });

  it("leaves key-less values and non-numeric named values as before", () => {
    expect(formatProofValue(0.2)).toEqual({ value: "0.2" });
    expect(formatProofValue(0.123456789)).toEqual({ value: "0.123456789" });
    expect(formatProofValue("n/a", "usd")).toEqual({ value: "n/a" });
    expect(formatProofValue(null, "usd")).toEqual({ value: "—" });
    expect(formatProofValue(true, "tolerance")).toEqual({ value: "yes" });
    expect(formatProofValue("pyth", "holdings.0.priceSource")).toEqual({ value: "Pyth", raw: "pyth" });
    expect(formatProofValue("cache", "priceSource")).toEqual({ value: "Cached", raw: "cache" });
  });

  it("never shows a non-zero dust value as zero, and still shortens long source strings", () => {
    expect(formatProofValue(0.00000012, "qty")).toEqual({ value: "0.00000012", raw: "1.2e-7" });
    expect(formatProofValue(-0.00000012, "qty").value).toBe("-0.00000012");
    expect(formatProofValue(0, "qty")).toEqual({ value: "0" });
    expect(formatProofValue(0.0000345, "usd")).toEqual({ value: "$0.0000345", raw: "0.0000345" });
    expect(formatProofValue(0, "usd")).toEqual({ value: "$0.00", raw: "0" });
    expect(formatProofValue(0.0000123, "distance")).toEqual({ value: "0.00123%", raw: "0.0000123" });
    expect(formatProofValue(0, "tolerance")).toEqual({ value: "0%", raw: "0" });
    const long = "x".repeat(200);
    const row = formatProofValue(long, "source");
    expect(row.value.length).toBeLessThanOrEqual(120);
    expect(row.raw).toBe(long);
  });

  it("reads an in-platform quest's proof in plain words", () => {
    const events = ["2026-09-14T09:00:00.000Z", "2026-09-14T15:00:00.000Z", "2026-09-15T10:00:00.000Z"].map((ts, i) => ({
      type: "game_action",
      userId: "u1",
      ref: `trade:t${i}`,
      ts: new Date(ts),
    }));
    const res = evaluatePlay(
      { type: "internal_event", event: "game_action", count: 3, distinctBy: "day" },
      { now: new Date("2026-09-15T12:00:00.000Z"), snapshots: [], events, earnings: {}, sectorOf: () => null, underlyingOf: () => null },
    );
    const rows = flattenProof({ ...res.proof, progress: res.progress });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.reason).toMatchObject({ label: "Status", value: "Not enough events" });
    expect(byKey.event).toMatchObject({ label: "Activity", value: "Paper trades or new predictions", raw: "game_action" });
    expect(byKey.distinctBy).toMatchObject({ label: "Counted once per", value: "day" });
    expect(byKey.distinctBy.raw).toBeUndefined();
    expect(byKey.refs).toMatchObject({ label: "Latest counted", value: "2026-09-14, 2026-09-15" });
    expect(byKey.needed).toMatchObject({ label: "Needed", value: "3" });
    expect(byKey.progress).toMatchObject({ value: "2 of 3 days" });
    expect(formatProofValue("ref", "distinctBy")).toEqual({ value: "question", raw: "ref" });
    expect(formatProofValue("symbol", "distinctBy")).toEqual({ value: "xStock", raw: "symbol" });
    expect(formatProofValue("league_trade", "event")).toEqual({ value: "Paper trades", raw: "league_trade" });
    expect(formatProofValue("call_placed", "event")).toEqual({ value: "Predictions", raw: "call_placed" });
    // An unknown name stays as it is rather than vanishing.
    expect(formatProofValue("some_new_thing", "event")).toEqual({ value: "some_new_thing" });
    // No retired product noun reaches a proof label or value.
    for (const r of rows) expect(`${r.label} ${r.value}`, r.key).not.toMatch(/league|call_placed|mirror/i);
  });

  it("handles primitives and caps depth", () => {
    expect(flattenProof(42)).toEqual([{ key: "value", label: "Value", value: "42" }]);
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const rows = flattenProof(deep);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("a.b.c.d");
    expect(rows[0].label).toBe("A · B · C · D");
    expect(rows[0].value).toBe('{"e":1}');
  });
});

describe("play-meta", () => {
  const base = { points: 100, badgeKey: null, comingSoon: false } as const;
  const hold = { ...base, rule: { type: "hold_any", minUsd: 5 } as PlayRule };
  const scout = { ...base, points: 50, rule: { type: "internal_event", event: "league_trade", count: 3 } as PlayRule };
  const mirror = { ...base, points: 500, badgeKey: "mirror", rule: { type: "mirror_match", tolerance: 0.2 } as PlayRule };
  const soon = { ...base, points: 300, comingSoon: true, rule: { type: "hold_any", minUsd: 1, partnerAssetIds: [] } as PlayRule };

  /** The catalogue as the board sees it (PlayLike). */
  const catalogue = SEASON0_PLAYS.map((p) => ({ key: p.key, points: p.points, badgeKey: p.badgeKey ?? null, rule: p.rule, comingSoon: p.comingSoon === true }));
  const byKey = (key: string) => catalogue.find((p) => p.key === key)!;

  it("names the kind of every quest: in-platform, on-chain (Portfolio Match included) or partner coming soon", () => {
    expect(questKind(byKey("scout"))).toBe("in-platform");
    expect(questKind(byKey("oracle"))).toBe("in-platform");
    expect(questKind(byKey("game_days"))).toBe("in-platform");
    expect(questKind(byKey("mirror"))).toBe("on-chain");
    expect(questKind(byKey("first_position"))).toBe("on-chain");
    expect(questKind(byKey("kamino_collateral"))).toBe("partner-coming-soon");
    expect(questKind(byKey("jupiter_dca"))).toBe("partner-coming-soon");
    // comingSoon wins over the rule type.
    expect(questKind({ ...scout, comingSoon: true })).toBe("partner-coming-soon");
    const kinds = catalogue.map(questKind);
    expect(kinds.filter((k) => k === "in-platform")).toHaveLength(8);
    expect(kinds.filter((k) => k === "on-chain")).toHaveLength(10);
    expect(kinds.filter((k) => k === "partner-coming-soon")).toHaveLength(2);
  });

  it("filters All · In-platform · On-chain · Badges", () => {
    expect(PLAY_FILTERS.map((f) => f.label)).toEqual(["All", "In-platform", "On-chain", "Badges"]);
    expect(PLAY_FILTERS.map((f) => f.value)).toEqual(["all", "in_platform", "on_chain", "badges"]);
    expect(matchesFilter(hold, "on_chain")).toBe(true);
    expect(matchesFilter(hold, "in_platform")).toBe(false);
    expect(matchesFilter(scout, "in_platform")).toBe(true);
    expect(matchesFilter(scout, "on_chain")).toBe(false);
    // Portfolio Match moved from the old Games filter to On-chain.
    expect(matchesFilter(mirror, "on_chain")).toBe(true);
    expect(matchesFilter(mirror, "in_platform")).toBe(false);
    expect(matchesFilter(mirror, "badges")).toBe(true);
    expect(matchesFilter(hold, "badges")).toBe(false);
    expect(matchesFilter(hold, "all")).toBe(true);
    // Partner quests coming soon are on-chain quests that are not verified yet.
    expect(matchesFilter(soon, "on_chain")).toBe(true);
    expect(matchesFilter(soon, "in_platform")).toBe(false);
  });

  it("counts the catalogue per filter: 20 = 8 in-platform + 12 on-chain (10 live, 2 coming soon), 4 badges", () => {
    const counts = Object.fromEntries(PLAY_FILTERS.map((f) => [f.value, catalogue.filter((p) => matchesFilter(p, f.value)).length]));
    expect(counts).toEqual({ all: 20, in_platform: 8, on_chain: 12, badges: 4 });
    expect(counts.in_platform + counts.on_chain).toBe(counts.all);
  });

  it("links in-platform quests to where they happen inside Dulo", () => {
    expect(playHref(mirror.rule)).toEqual({ kind: "internal", href: "/copy", label: "Copy a portfolio" });
    expect(playHref(scout.rule)).toEqual({ kind: "internal", href: "/competition", label: "Open the competition" });
    expect(playHref({ type: "internal_event", event: "call_placed", count: 1 })).toEqual({ kind: "internal", href: "/predictions", label: "Make a prediction" });
    expect(playHref({ type: "internal_event", event: "game_action", count: 3, distinctBy: "day" })).toEqual({
      kind: "internal",
      href: "/predictions",
      label: "Make a prediction",
    });
    expect(playHref({ type: "internal_event", event: "mirror_executed", count: 1 })).toMatchObject({ kind: "internal", href: "/copy" });
    expect(playHref({ type: "internal_event", event: "some_new_thing", count: 1 })).toBeNull();
  });

  it("gives no wallet rule an action: an on-chain quest describes a wallet state, never a buy", () => {
    const NVDAX_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
    for (const rule of [
      hold.rule,
      soon.rule,
      { type: "hold_any", minUsd: 5, assetIds: [NVDAX_ID] },
      { type: "hold_any", minUsd: 5, assetSymbols: ["SPYx"] },
      { type: "diversified", minAssets: 3, minSectors: 2 },
      { type: "hold_consecutive", days: 7 },
      { type: "net_increase_days", count: 3, window: 14 },
      { type: "hold_through_date", calendarKey: "earnings" },
    ] as PlayRule[]) {
      expect(playHref(rule), JSON.stringify(rule)).toBeNull();
      expect(visibleStartAction({ ...base, rule, status: "locked" }), JSON.stringify(rule)).toBeNull();
    }
    for (const play of SEASON0_PLAYS) {
      const where = playHref(play.rule);
      if (play.rule.type !== "internal_event" && play.rule.type !== "mirror_match") expect(where, play.key).toBeNull();
      expect(where?.href ?? "", play.key).not.toContain("jup.ag");
      expect(where?.href ?? "", play.key).toMatch(/^(\/[a-z-]*)?$/);
    }
  });

  it("keeps every Jupiter buy link and swap helper out of the quest card and the board", () => {
    for (const rel of ["src/components/plays/PlayCard.tsx", "src/components/plays/PlayGrid.tsx", "src/components/partners/PartnerView.tsx", "src/app/quests/page.tsx"]) {
      const text = readFileSync(path.join(process.cwd(), rel), "utf8");
      for (const needle of ["StartInJupiter", "starterSwapUrl", "jup.ag", "jupiterSwapUrl", "START_IN_JUPITER"]) expect(text, `${rel}: ${needle}`).not.toContain(needle);
    }
    const meta = readFileSync(path.join(process.cwd(), "src/components/plays/play-meta.ts"), "utf8");
    for (const needle of ["jupiterSwapUrl", "USDC_MINT", "STARTER_XSTOCK", "external"]) expect(meta, needle).not.toContain(needle);
    expect(COMPLIANCE_LINE).toContain("Not investment advice");
    expect(COMPLIANCE_LINE).toContain("U.S. persons");
    expect(readFileSync(path.join(process.cwd(), "src/components/layout/AppShell.tsx"), "utf8")).toContain("{COMPLIANCE_LINE}");
    // /profile's empty state points at a prediction, so it carries no Jupiter link either.
    expect(readFileSync(path.join(process.cwd(), "src/app/profile/page.tsx"), "utf8")).not.toContain("StartInJupiterLink");
  });

  describe("the /quests board groups by quest kind", () => {
    const play = (key: string, rule: PlayRule, extra: Partial<PlayView> = {}): PlayView => ({
      key,
      title: key,
      desc: "",
      points: 100,
      badgeKey: null,
      rule,
      status: "locked",
      completedAt: null,
      proof: null,
      completions: 0,
      comingSoon: false,
      ...extra,
    });
    const group = (slug: string, name: string, plays: PlayView[]): PartnerGroup => ({
      partner: { slug, name, logoUrl: null, blurb: "", links: {} },
      campaigns: [{ id: `camp-${slug}`, title: slug, plays }],
    });
    const holdings = [
      play("first-position", { type: "hold_any", minUsd: 5 }),
      play("diversified", { type: "diversified", minAssets: 3, minSectors: 2 }),
      play("steady", { type: "hold_consecutive", days: 7 }),
      play("stacker", { type: "net_increase_days", count: 3, window: 14 }),
      play("earnings", { type: "hold_through_date", calendarKey: "earnings" }),
      play("match", { type: "mirror_match", tolerance: 0.2 }, { badgeKey: "mirror" }),
    ];
    const games = [
      play("oracle", { type: "internal_event", event: "call_placed", count: 1 }),
      play("scout", { type: "internal_event", event: "league_trade", count: 3 }),
      play("game-days", { type: "internal_event", event: "game_action", count: 3, distinctBy: "day" }),
    ];
    const partnerSoon = play("kamino", { type: "hold_any", minUsd: 1, partnerAssetIds: [] }, { comingSoon: true, title: "Kamino Collateral" });
    const board = [group("xstocks", "xStocks", holdings), group("kamino", "Kamino", [partnerSoon]), group("dulo", "Dulo games", games)];
    const render = (groups: PartnerGroup[], filter?: PlayFilter) =>
      renderToStaticMarkup(createElement(PlayGrid, { groups, signedIn: false, filter }));
    /** The markup of one group section. */
    const section = (html: string, id: string) => {
      const start = html.indexOf(`data-quest-group="${id}"`);
      if (start < 0) return "";
      const end = html.indexOf("</section>", start);
      return html.slice(start, end);
    };

    it("puts in-platform quests first, then on-chain quests, then partner quests coming soon", () => {
      const html = render(board);
      const inPlatform = html.indexOf(IN_PLATFORM_HEADING);
      const onChain = html.indexOf(ON_CHAIN_HEADING);
      const soonAt = html.indexOf(COMING_SOON_HEADING);
      expect(inPlatform).toBeGreaterThan(-1);
      expect(onChain).toBeGreaterThan(inPlatform);
      expect(soonAt).toBeGreaterThan(onChain);
      expect(IN_PLATFORM_HEADING).toBe("In-platform quests: points and virtual cash");
      expect(ON_CHAIN_HEADING).toBe("On-chain quests, verified from your wallet");
      // House cards sit in the in-platform group even though the API files them under their own partner.
      const games = section(html, "quests-in-platform");
      for (const key of ["oracle", "scout", "game-days"]) expect(games, key).toContain(`data-play-key="${key}"`);
      expect(games).not.toContain('data-play-key="first-position"');
      const chain = section(html, "quests-on-chain");
      for (const p of holdings) expect(chain, p.key).toContain(`data-play-key="${p.key}"`);
      expect(chain).not.toContain('data-play-key="kamino"');
      // The coming-soon partner quest is a compact row, not a card.
      expect(html).not.toContain('data-play-key="kamino"');
      expect(html).toContain("Kamino Collateral");
    });

    it("prints the compliance line once under the on-chain group and never in the in-platform group", () => {
      const html = render(board);
      expect(count(html, COMPLIANCE_LINE)).toBe(1);
      expect(count(section(html, "quests-on-chain"), COMPLIANCE_LINE)).toBe(1);
      expect(count(section(html, "quests-in-platform"), COMPLIANCE_LINE)).toBe(0);
      // Only in-platform quests on screen: no compliance line at all.
      expect(count(render(board, "in_platform"), COMPLIANCE_LINE)).toBe(0);
      expect(count(render([group("dulo", "Dulo games", games)]), COMPLIANCE_LINE)).toBe(0);
      // Complete on-chain quests still print it once for their group.
      const done = render([group("xstocks", "xStocks", holdings.map((p) => ({ ...p, status: "complete" as const })))]);
      expect(count(done, COMPLIANCE_LINE)).toBe(1);
      // Two listed partners with on-chain quests still share one on-chain group, one line.
      const two = render([group("xstocks", "xStocks", holdings), group("other", "Other", holdings.map((p) => ({ ...p, key: `o-${p.key}` })))]);
      expect(count(two, ON_CHAIN_HEADING)).toBe(1);
      expect(count(two, COMPLIANCE_LINE)).toBe(1);
    });

    it("links no card to a buy and gives on-chain cards no action button", () => {
      const html = render(board);
      expect(html).not.toContain("jup.ag");
      expect(html).not.toContain("opens Jupiter");
      expect(html).not.toMatch(/\b(buy|swap)\b/i);
      const chain = section(html, "quests-on-chain");
      // The only action on an on-chain card is Portfolio Match's link to the copy tool.
      expect(chain.match(/href="\/copy"/g)).toHaveLength(1);
      expect(chain).not.toContain('href="/competition"');
      expect(chain).not.toContain('href="/predictions"');
      const games = section(html, "quests-in-platform");
      expect(games).toContain('href="/predictions"');
      expect(games).toContain('href="/competition"');
    });

    it("keeps the partner page link for a listed partner and none for the house partner", () => {
      const html = render(board);
      expect(section(html, "quests-on-chain")).toContain('href="/partners/xstocks"');
      expect(section(html, "quests-on-chain")).toContain('aria-label="xStocks partner page"');
      expect(section(html, "quests-in-platform")).not.toContain('href="/partners/');
      expect(html).not.toContain('href="/partners/dulo"');
      // The coming-soon row still links to its partner page.
      expect(html).toContain('href="/partners/kamino"');
    });

    it("follows the filter: In-platform hides the on-chain group and the partner list, On-chain hides the in-platform group", () => {
      const games = render(board, "in_platform");
      expect(games).toContain(IN_PLATFORM_HEADING);
      expect(games).not.toContain(ON_CHAIN_HEADING);
      expect(games).not.toContain(COMING_SOON_HEADING);
      const chain = render(board, "on_chain");
      expect(chain).not.toContain(IN_PLATFORM_HEADING);
      expect(chain).toContain(ON_CHAIN_HEADING);
      expect(chain).toContain(COMING_SOON_HEADING);
      const badges = render(board, "badges");
      expect(badges).toContain('data-play-key="match"');
      expect(badges).not.toContain(IN_PLATFORM_HEADING);
      expect(render([group("dulo", "Dulo games", [play("x", { type: "internal_event", event: "league_trade", count: 1 })])], "badges")).toContain(
        "No quests match this filter yet.",
      );
    });
  });

  it("prints one compliance line on a Partner page that lists on-chain quests, and none otherwise", () => {
    const partnerPlay = (key: string, rule: PlayRule, extra: Partial<PartnerPlayView> = {}): PartnerPlayView => ({
      key,
      title: key,
      desc: "",
      points: 100,
      badgeKey: null,
      rule,
      completions: 0,
      comingSoon: false,
      ...extra,
    });
    const detail = (plays: PartnerPlayView[][]): PartnerDetail => ({
      partner: { slug: "xstocks", name: "xStocks", logoUrl: null, blurb: "", links: {}, chainIds: ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"] },
      campaigns: plays.map((list, i) => ({
        id: `camp-${i}`,
        title: `Campaign ${i}`,
        seasonId: "s0",
        startsAt: "2026-09-01T00:00:00.000Z",
        endsAt: "2026-10-01T00:00:00.000Z",
        plays: list,
      })),
      totals: { plays: plays.flat().length, completions: 0 },
    });
    const holdings = [
      partnerPlay("first-position", { type: "hold_any", minUsd: 5 }),
      partnerPlay("diversified", { type: "diversified", minAssets: 3, minSectors: 2 }),
      partnerPlay("steady", { type: "hold_consecutive", days: 7 }),
    ];
    const render = (d: PartnerDetail) => renderToStaticMarkup(createElement(PartnerBody, { detail: d }));

    // Two campaigns of on-chain quests: the line prints once for the section, and no card links a buy.
    const html = render(detail([holdings, [partnerPlay("stacker", { type: "net_increase_days", count: 3, window: 14 })]]));
    expect(count(html, COMPLIANCE_LINE)).toBe(1);
    expect(html).not.toContain("jup.ag");
    expect(html).not.toContain("opens Jupiter");

    // A partner whose only quest is coming soon still lists an on-chain quest.
    expect(count(render(detail([[partnerPlay("soon", { type: "hold_any", minUsd: 1, partnerAssetIds: [] }, { comingSoon: true })]])), COMPLIANCE_LINE)).toBe(1);

    // In-platform quests only: no line.
    const quiet = render(detail([[partnerPlay("scout", { type: "internal_event", event: "league_trade", count: 3 })]]));
    expect(count(quiet, COMPLIANCE_LINE)).toBe(0);
  });

  it("shows the in-platform action only while a quest is live and not complete", () => {
    const league = { ...base, rule: { type: "internal_event", event: "league_trade", count: 3 } as PlayRule };
    expect(visibleStartAction({ ...league, status: "locked" })).toMatchObject({ kind: "internal", href: "/competition" });
    expect(visibleStartAction(league)).toMatchObject({ kind: "internal", href: "/competition" });
    expect(visibleStartAction({ ...league, status: "in_progress" })).toMatchObject({ kind: "internal", href: "/competition" });
    expect(visibleStartAction({ ...league, status: "complete" })).toBeNull();
    expect(visibleStartAction({ ...league, comingSoon: true })).toBeNull();
    expect(visibleStartAction({ ...hold, status: "locked" })).toBeNull();
    expect(visibleStartAction({ ...mirror, status: "in_progress" })).toMatchObject({ href: "/copy" });
  });

  it("counts only listed Partners, so /quests matches /partners", () => {
    const groups = ["xstocks", "jupiter", "kamino", "dulo"].map((slug) => ({ partner: { slug } }));
    expect(listedPartnerCount(groups)).toBe(3);
    expect(listedPartnerCount([{ partner: { slug: "dulo" } }])).toBe(0);
    expect(readFileSync(path.join(process.cwd(), "src/app/quests/page.tsx"), "utf8")).toContain('label: "Listed projects", value: listedPartnerCount(groups)');
  });

  it("the /quests page refreshes the session after a quest refresh and has no buy action in its empty state", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/quests/page.tsx"), "utf8");
    expect(page).toMatch(/await api\.refreshPlays\(\);\s*refetch\(\);\s*void refreshSession\(\)/);
    expect(page).toContain('<Link href="/predictions"');
    expect(page).not.toContain("Hold, diversify and stick through earnings to earn points.");
    for (const label of ['label: "Live quests"', 'label: "Points available"', 'label: "You completed"']) expect(page).toContain(label);
    expect(page).toMatch(/nothing is billed/);
  });

  it("captions a Partner tile with its honest label and quest count, and gives the hidden house Partner no page", () => {
    expect(partnerRowCaption({ playCount: 1, livePlayCount: 0 })).toBe("Coming soon · 1 quest");
    expect(partnerRowCaption({ playCount: 6, livePlayCount: 6 })).toBe("Quests live · 6 quests");
    expect(partnerPageHref("xstocks")).toBe("/partners/xstocks");
    expect(partnerPageHref("dulo")).toBeNull();
  });

  it("reads proof.progress defensively", () => {
    expect(proofProgress({ progress: { current: 2, target: 3, unit: "events" } })).toEqual({ current: 2, target: 3, unit: "events" });
    expect(proofProgress({ progress: { current: 9, target: 3 } })).toEqual({ current: 3, target: 3, unit: "" });
    expect(proofProgress({ progress: { current: 1, target: 0 } })).toBeNull();
    expect(proofProgress({ reason: "x" })).toBeNull();
    expect(proofProgress(null)).toBeNull();
  });

  it("never shows a dollar target on a card, and labels units for people", () => {
    expect(cardProgress({ current: 300, target: 1000, unit: "usd" })).toBeNull();
    expect(cardProgress({ current: 300, target: 1000, unit: "USD" })).toBeNull();
    expect(cardProgress(proofProgress({ progress: { current: 300, target: 1000, unit: "usd" } }))).toBeNull();
    expect(cardProgress({ current: 1, target: 3, unit: "events" })).toEqual({ current: 1, target: 3, unit: "done" });
    expect(cardProgress({ current: 2, target: 4, unit: "legs" })).toEqual({ current: 2, target: 4, unit: "holdings matched" });
    expect(cardProgress({ current: 2, target: 3, unit: "assets" })).toEqual({ current: 2, target: 3, unit: "xStocks" });
    expect(cardProgress({ current: 2, target: 7, unit: "days" })).toEqual({ current: 2, target: 7, unit: "days" });
    expect(cardProgress({ current: 1, target: 3, unit: "questions" })).toEqual({ current: 1, target: 3, unit: "questions" });
    expect(cardProgress(null)).toBeNull();
    expect(progressUnitLabel("constructor")).toBe("constructor");
    const card = readFileSync(path.join(process.cwd(), "src/components/plays/PlayCard.tsx"), "utf8");
    expect(card).toContain("cardProgress(proofProgress(play.proof), assetSource)");
    const preview = readFileSync(path.join(process.cwd(), "src/app/check/_components/PreviewPlayCard.tsx"), "utf8");
    expect(preview).toContain("cardProgress(play.progress, play.assetSource)");
    expect(preview).not.toContain('unit === "usd"');
  });

  it("totals only live quests", () => {
    const t = boardTotals([hold, scout, mirror, soon, { ...hold, status: "complete" }]);
    expect(t).toEqual({ livePlays: 4, livePoints: 750, badges: 1, completed: 1 });
    const season = boardTotals(catalogue);
    expect(season).toMatchObject({ livePlays: 18, livePoints: 3650, badges: 4, completed: 0 });
  });

  it("labels Partners honestly from live quests only (never 'Listed on Dulo')", () => {
    expect(partnerListingLabel(0)).toBe("Coming soon");
    expect(partnerListingLabel(1)).toBe("Quests live");
    expect(partnerListingLabel(8)).toBe("Quests live");
  });
});
