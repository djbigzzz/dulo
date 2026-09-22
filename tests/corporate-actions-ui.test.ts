/**
 * Corporate actions made visible (22 Sep 2026): the Partner page section, the wallet check's
 * action line and the "Held Through a Split" quest card.
 *
 * An action changes the number of tokens a wallet shows, never the holder's value, and every line
 * here says so: the raw balance, the multiplier and the quantity, and never a percentage, a
 * discount, a premium, a share or a stock. The quest card reads as in progress with its hint and
 * never as failed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// PlayCard imports the wallet ConnectButton chain through PlayGrid siblings; the card itself is under test.
vi.mock("@/components/wallet/ConnectButton", () => ({ ConnectButton: () => null }));

import type { AssetId, ChainId } from "@/lib/core";
import type { CorporateActionView, PartnerDetail, PlayView, PreviewHoldingView } from "@/lib/api-client";
import { buildPreview, holdingActionView } from "@/app/api/v1/preview/preview";
import { catalogueIndexFrom } from "@/lib/cron/evaluate";
import type { WalletHoldingsRead } from "@/lib/cron/snapshot";
import { CORPORATE_ACTION_EXPLANATION, corporateActionLabel, corporateActionWhen, multiplierChangeLabel } from "@/components/common/corporate-actions";
import { formatDateUtc } from "@/components/common/format";
import { CorporateActionsSection, PartnerBody } from "@/components/partners/PartnerView";
import { HoldingRow } from "@/app/check/_components/HoldingsList";
import { holdingActionLine } from "@/app/check/_components/check-format";
import { PlayCard } from "@/components/plays/PlayCard";
import { MISSED_ADJUSTMENT_NOTE, NEXT_ADJUSTMENT_NOTE, questStatusNote, showsProgressBar } from "@/components/plays/play-meta";
import { flattenProof } from "@/components/plays/proof";

const ROOT = path.resolve(__dirname, "..");
const repoFile = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const SOL: ChainId = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SPACEX_MINT = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const OPENAI_MINT = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const TSLA_MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const SPACEX = `${SOL}/token:${SPACEX_MINT}` as AssetId;
const OPENAI = `${SOL}/token:${OPENAI_MINT}` as AssetId;
const TSLA = `${SOL}/token:${TSLA_MINT}` as AssetId;
const NOW = new Date("2026-09-22T12:00:00.000Z");

/** Words that would turn a token into a security, or an explanation into a signal. */
const SECURITY_WORDS = /\b(shares?|stocks?|equity|equities)\b/i;
const SIGNAL_WORDS = /discount|premium|cheap|upside|%|\b(buy|buys|buying|purchase|swap)\b/i;

/** The two live facts (verified on-chain 22 Sep 2026), as GET /api/v1/partners/prestocks carries them. */
const SPACEX_SPLIT: CorporateActionView = {
  assetId: SPACEX,
  symbol: "SPACEX",
  source: "prestocks",
  kind: "split",
  multiplierBefore: 1,
  multiplierAfter: 5,
  ratio: 5,
  effectiveAt: "2026-06-10T04:30:00.000Z",
  effective: true,
};
const OPENAI_ADJUSTMENT: CorporateActionView = {
  assetId: OPENAI,
  symbol: "OPENAI",
  source: "prestocks",
  kind: "adjustment",
  multiplierBefore: 1,
  multiplierAfter: 1.4861347,
  ratio: 1.4861347,
  effectiveAt: "2026-07-17T16:30:00.000Z",
  effective: true,
};

function holding(over: Partial<PreviewHoldingView> = {}): PreviewHoldingView {
  return {
    assetId: SPACEX,
    symbol: "SPACEX",
    source: "prestocks",
    qty: 43712.58,
    multiplier: 5,
    usd: 8742516,
    quote: { assetId: SPACEX, symbol: "SPACEX", price: 200, source: "jupiter", publishedAt: NOW.toISOString(), ageSeconds: 40, stale: false, marketOpen: true },
    issuerMark: null,
    action: { kind: "split", ratio: 5, effectiveAt: "2026-06-10T04:30:00.000Z", effective: true },
    ...over,
  };
}

function playView(over: Partial<PlayView> = {}): PlayView {
  return {
    key: "held_through_split",
    title: "Held Through a Split",
    desc: "A pre-IPO token held across an on-chain adjustment.",
    points: 150,
    badgeKey: null,
    rule: { type: "multiplier_change" },
    assetSource: "prestocks",
    status: "in_progress",
    completedAt: null,
    proof: { reason: "no_adjustment_yet", takenAt: NOW.toISOString(), days: 3, progress: { current: 0, target: 1, unit: "adjustments" } },
    completions: 0,
    comingSoon: false,
    ...over,
  };
}

function detail(actions: CorporateActionView[], slug = "prestocks"): PartnerDetail {
  return {
    partner: { slug, name: slug === "prestocks" ? "PreStocks" : "xStocks", logoUrl: null, blurb: "Tokenized pre-IPO exposure on Solana.", links: {}, chainIds: [SOL] },
    campaigns: [
      {
        id: `camp-${slug}-season-0`,
        title: "Stocks Season",
        seasonId: "season-0",
        startsAt: NOW.toISOString(),
        endsAt: NOW.toISOString(),
        plays: [{ key: "pre_ipo_position", title: "Pre-IPO Position", desc: "A pre-IPO token worth $5 or more in your wallet.", points: 50, badgeKey: null, rule: { type: "hold_any", minUsd: 5 }, completions: 0, comingSoon: false, assetSource: "prestocks" }],
      },
    ],
    totals: { plays: 1, completions: 0 },
    corporateActions: actions,
  };
}

describe("corporate action copy", () => {
  it("labels a split as N-for-1 and anything else by its ratio, never as a percentage", () => {
    expect(corporateActionLabel(SPACEX_SPLIT)).toBe("5-for-1 adjustment");
    expect(corporateActionLabel(OPENAI_ADJUSTMENT)).toBe("×1.4861 adjustment");
    expect(corporateActionLabel({ kind: "adjustment", ratio: 0.5 })).toBe("×0.5 adjustment");
    expect(corporateActionLabel({ kind: "split", ratio: 10 })).toBe("10-for-1 adjustment");
    // A "split" whose ratio is not a whole number cannot be printed as N-for-1: the ratio form is the honest one.
    expect(corporateActionLabel({ kind: "split", ratio: 2.5 })).toBe("×2.5 adjustment");
    expect(corporateActionLabel({ kind: "split", ratio: Number.NaN })).toBe("Adjustment");
    expect(multiplierChangeLabel(SPACEX_SPLIT)).toBe("multiplier 1 → 5");
    expect(multiplierChangeLabel(OPENAI_ADJUSTMENT)).toBe("multiplier 1 → 1.486135");
    expect(corporateActionWhen(SPACEX_SPLIT)).toBe("Effective 10 Jun 2026");
    expect(corporateActionWhen({ effectiveAt: "2026-12-01T00:00:00.000Z", effective: false })).toBe("Takes effect 1 Dec 2026");
    expect(corporateActionWhen({ effectiveAt: null, effective: false })).toBe("Date not set on the mint");
    expect(CORPORATE_ACTION_EXPLANATION).toBe("The number of tokens a wallet shows changed; its value did not. Read from the mint on Solana.");
    for (const text of [corporateActionLabel(SPACEX_SPLIT), corporateActionLabel(OPENAI_ADJUSTMENT), multiplierChangeLabel(SPACEX_SPLIT), CORPORATE_ACTION_EXPLANATION]) {
      expect(text).not.toMatch(SIGNAL_WORDS);
      expect(text).not.toMatch(SECURITY_WORDS);
    }
  });
});

describe("Partner page — Corporate actions section", () => {
  it("renders one glass row per action above the quests, with the label, the date, the multipliers and the explanation", () => {
    const out = html(createElement(PartnerBody, { detail: detail([SPACEX_SPLIT, OPENAI_ADJUSTMENT]) }));
    expect(out).toContain('data-slot="corporate-actions"');
    expect(out).toContain('aria-labelledby="partner-corporate-actions"');
    expect(out).toContain('id="partner-corporate-actions"');
    expect(out).toContain(">Corporate actions<");
    expect(out.split('data-slot="corporate-action"').length - 1).toBe(2);
    expect(out).toContain(">SPACEX<");
    expect(out).toContain("5-for-1 adjustment");
    expect(out).toContain("Effective 10 Jun 2026");
    expect(out).toContain("multiplier 1 → 5");
    expect(out).toContain(">OPENAI<");
    expect(out).toContain("×1.4861 adjustment");
    expect(out).toContain("Effective 17 Jul 2026");
    expect(out).toContain("multiplier 1 → 1.486135");
    expect(out.split(CORPORATE_ACTION_EXPLANATION).length - 1).toBe(2);
    // The feed sits above the quests and the row carries the issuer pill.
    expect(out.indexOf('id="partner-corporate-actions"')).toBeLessThan(out.indexOf('id="partner-plays"'));
    expect(out).toContain('data-source="prestocks"');
    // Nothing in the section reads as a price signal or turns a token into a security.
    const section = out.slice(out.indexOf('data-slot="corporate-actions"'), out.indexOf('id="partner-plays"'));
    expect(section).not.toMatch(SIGNAL_WORDS);
    expect(section).not.toMatch(SECURITY_WORDS);
  });

  it("renders nothing at all for an empty list, a missing list or junk entries", () => {
    const empty = html(createElement(PartnerBody, { detail: detail([]) }));
    expect(empty).not.toContain("Corporate actions");
    expect(empty).not.toContain('data-slot="corporate-actions"');
    expect(html(createElement(CorporateActionsSection, { actions: [] }))).toBe("");
    expect(html(createElement(CorporateActionsSection, { actions: null }))).toBe("");
    expect(html(createElement(CorporateActionsSection, { actions: undefined }))).toBe("");
    expect(html(createElement(CorporateActionsSection, { actions: [null as unknown as CorporateActionView] }))).toBe("");
  });

  it("shows a pending action as 'Takes effect' and keeps the same explanation", () => {
    const pending: CorporateActionView = { ...OPENAI_ADJUSTMENT, effectiveAt: "2026-12-01T00:00:00.000Z", effective: false };
    const out = html(createElement(CorporateActionsSection, { actions: [pending] }));
    expect(out).toContain("Takes effect 1 Dec 2026");
    expect(out).toContain(CORPORATE_ACTION_EXPLANATION);
  });
});

describe("/check/[address] — the action line under the multiplier arithmetic", () => {
  it("prints the real numbers of the holding: kind, date, raw × multiplier = quantity", () => {
    expect(holdingActionLine(holding())).toBe("5-for-1 adjustment on 10 Jun 2026: raw 8,742.52 × 5 = 43,712.58");
    expect(holdingActionLine(holding({ qty: 16, multiplier: 5 }))).toBe("5-for-1 adjustment on 10 Jun 2026: raw 3.2 × 5 = 16");
    const openai = holdingActionLine(holding({ qty: 1.4861347, multiplier: 1.4861347, action: { kind: "adjustment", ratio: 1.4861347, effectiveAt: "2026-07-17T16:30:00.000Z", effective: true } }));
    expect(openai).toBe("×1.4861 adjustment on 17 Jul 2026: raw 1 × 1.486135 = 1.4861");
    // No timestamp on the mint: the line still adds up, with no date.
    expect(holdingActionLine(holding({ action: { kind: "split", ratio: 5, effectiveAt: null, effective: true } }))).toBe("5-for-1 adjustment: raw 8,742.52 × 5 = 43,712.58");
    for (const line of [holdingActionLine(holding()), openai]) {
      expect(line).not.toMatch(SIGNAL_WORDS);
      expect(line).not.toMatch(SECURITY_WORDS);
    }
  });

  it("prints the on-chain (UTC) day whatever zone the viewer or the test machine is in", () => {
    // SPACEX's split took effect at 04:30Z on 10 Jun 2026: in Los Angeles that instant is still 9 Jun.
    const before = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      // Node applies a TZ change at once (its process.env.TZ setter); the contrast is only meaningful when it did.
      const honoured = new Date("2026-06-10T04:30:00.000Z").getHours() === 21;
      if (honoured) {
        expect(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date("2026-06-10T04:30:00.000Z"))).toBe("9 Jun 2026");
      }
      expect(formatDateUtc("2026-06-10T04:30:00.000Z")).toBe("10 Jun 2026");
      expect(formatDateUtc("2026-12-01T00:00:00.000Z")).toBe("1 Dec 2026");
      expect(formatDateUtc(null)).toBe("");
      expect(formatDateUtc("nope")).toBe("");
      expect(corporateActionWhen(SPACEX_SPLIT)).toBe("Effective 10 Jun 2026");
      expect(corporateActionWhen({ effectiveAt: "2026-12-01T00:00:00.000Z", effective: false })).toBe("Takes effect 1 Dec 2026");
      expect(holdingActionLine(holding())).toBe("5-for-1 adjustment on 10 Jun 2026: raw 8,742.52 × 5 = 43,712.58");
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it("prints nothing for a pending action, no action, or a multiplier of 1", () => {
    expect(holdingActionLine(holding({ action: { kind: "split", ratio: 5, effectiveAt: "2026-12-01T00:00:00.000Z", effective: false } }))).toBeNull();
    expect(holdingActionLine(holding({ action: null }))).toBeNull();
    expect(holdingActionLine(holding({ action: undefined }))).toBeNull();
    expect(holdingActionLine(holding({ multiplier: 1, qty: 10 }))).toBeNull();
  });

  it("renders the line in the holding row, under the arithmetic, and omits it without a past action", () => {
    const out = html(createElement(HoldingRow, { holding: holding(), now: NOW.getTime() }));
    expect(out).toContain('data-slot="corporate-action"');
    expect(out).toContain("5-for-1 adjustment on 10 Jun 2026: raw 8,742.52 × 5 = 43,712.58");
    expect(out.indexOf('data-slot="corporate-action"')).toBeGreaterThan(out.indexOf('data-slot="multiplier-arithmetic"'));
    // The explanation is VISIBLE text under the line (a phone has no hover, a <p> no focus), never a title tooltip.
    expect(out).toContain(`>${CORPORATE_ACTION_EXPLANATION}<`);
    expect(out).toContain('data-slot="corporate-action-explanation"');
    expect(out).not.toContain(`title="${CORPORATE_ACTION_EXPLANATION}"`);
    expect(out.indexOf('data-slot="corporate-action-explanation"')).toBeGreaterThan(out.indexOf("5-for-1 adjustment on 10 Jun 2026"));
    expect(out).not.toContain("shares");
    const without = html(createElement(HoldingRow, { holding: holding({ action: null }), now: NOW.getTime() }));
    expect(without).not.toContain('data-slot="corporate-action"');
    const pending = html(createElement(HoldingRow, { holding: holding({ action: { kind: "split", ratio: 5, effectiveAt: null, effective: false } }), now: NOW.getTime() }));
    expect(pending).not.toContain('data-slot="corporate-action"');
    // An xStock with a past action prints the line too: the arithmetic is the same on every issuer.
    const x = html(createElement(HoldingRow, { holding: holding({ assetId: TSLA, symbol: "TSLAx", source: "xstocks", qty: 6, multiplier: 2, action: { kind: "split", ratio: 2, effectiveAt: "2026-08-01T00:00:00.000Z", effective: true } }), now: NOW.getTime() }));
    expect(x).toContain("2-for-1 adjustment on 1 Aug 2026: raw 3 × 2 = 6");
  });

  it("maps the action onto the preview holding by asset id, and leaves the others null", () => {
    const read: WalletHoldingsRead = {
      address: "preview",
      chainId: SOL,
      readAt: NOW,
      holdings: [
        { assetId: SPACEX, symbol: "SPACEX", source: "prestocks", raw: "8742516000000", multiplier: 5, qty: 43712.58, price: 200, priceSource: "jupiter", usd: 8742516 },
        { assetId: TSLA, symbol: "TSLAx", source: "xstocks", raw: "3000000000", multiplier: 1, qty: 3, price: 200, priceSource: "jupiter", usd: 600 },
      ],
      quotes: new Map(),
    };
    const out = buildPreview({ read, plays: [], catalogue: catalogueIndexFrom([]), earnings: {}, now: NOW, actions: [SPACEX_SPLIT, OPENAI_ADJUSTMENT] });
    const bySymbol = Object.fromEntries(out.holdings.map((h) => [h.symbol, h]));
    expect(bySymbol.SPACEX.action).toEqual({ kind: "split", ratio: 5, effectiveAt: "2026-06-10T04:30:00.000Z", effective: true });
    expect(bySymbol.TSLAx.action).toBeNull();
    const none = buildPreview({ read, plays: [], catalogue: catalogueIndexFrom([]), earnings: {}, now: NOW });
    expect(none.holdings.every((h) => h.action === null)).toBe(true);
    expect(holdingActionView({ assetId: SPACEX }, undefined)).toBeNull();
    expect(holdingActionView({ assetId: SPACEX }, [])).toBeNull();
    expect(holdingActionView({ assetId: SPACEX }, [{ ...SPACEX_SPLIT, ratio: Number.NaN }])).toBeNull();
    expect(holdingActionView({ assetId: OPENAI }, [SPACEX_SPLIT, OPENAI_ADJUSTMENT])).toMatchObject({ kind: "adjustment", ratio: 1.4861347 });
  });

  it("reads the list only for a wallet with a position, through the shared never-throwing list", () => {
    const src = repoFile("src/app/api/v1/preview/preview.ts");
    expect(src).toMatch(/import \{ listCorporateActions \} from "@\/lib\/corporate-actions"/);
    expect(src).toContain("if (!read.holdings.some((h) => h.qty > 0)) return [];");
    expect(src).toContain("await listCorporateActions()");
  });
});

describe("quest card — Held Through a Split", () => {
  it("reads as in progress with its hint and 'Completes on the next adjustment.', never as failed", () => {
    const out = html(createElement(PlayCard, { play: playView(), signedIn: true }));
    expect(out).toContain('data-status="in_progress"');
    expect(out).toContain(">In progress<");
    expect(out).toContain("Pre-IPO token held across an on-chain adjustment (same raw balance, new multiplier)");
    expect(out).toContain('data-slot="status-note"');
    expect(out).toContain(NEXT_ADJUSTMENT_NOTE);
    expect(NEXT_ADJUSTMENT_NOTE).toBe("Completes on the next adjustment.");
    expect(out).not.toMatch(/fail|failed|missed|expired/i);
    // One event, no bar: an empty "0 of 1 adjustments" bar would read as failure.
    expect(out).not.toContain('role="progressbar"');
    expect(out).not.toContain("0 of 1");
    expect(out).not.toMatch(SIGNAL_WORDS);
    expect(out).not.toMatch(SECURITY_WORDS);
  });

  it("says the last adjustment was not held across, still in progress, and stays quiet once complete or coming soon", () => {
    const missed = html(createElement(PlayCard, { play: playView({ proof: { reason: "not_held_through", missed: [] } }), signedIn: true }));
    expect(missed).toContain(MISSED_ADJUSTMENT_NOTE);
    expect(missed).toContain(">In progress<");
    expect(missed).not.toMatch(/\bfail(ed|ure)?\b/i);
    expect(questStatusNote(playView())).toBe(NEXT_ADJUSTMENT_NOTE);
    expect(questStatusNote(playView({ proof: { reason: "no_snapshots" } }))).toBe(NEXT_ADJUSTMENT_NOTE);
    expect(questStatusNote(playView({ proof: { reason: "not_held_through" } }))).toBe(MISSED_ADJUSTMENT_NOTE);
    expect(questStatusNote(playView({ proof: null }))).toBeNull();
    expect(questStatusNote(playView({ proof: { reason: "partner_pending" } }))).toBeNull();
    expect(questStatusNote(playView({ status: "complete", completedAt: NOW.toISOString() }))).toBeNull();
    expect(questStatusNote(playView({ comingSoon: true }))).toBeNull();
    expect(questStatusNote(playView({ rule: { type: "hold_any", minUsd: 5 } }))).toBeNull();
    expect(showsProgressBar({ type: "multiplier_change" })).toBe(false);
    expect(showsProgressBar({ type: "hold_consecutive", days: 7 })).toBe(true);
    // Signed out: the note is still true (it describes the quest, not the player), the pill says Connect to track.
    const out = html(createElement(PlayCard, { play: playView() }));
    expect(out).toContain("Connect to track");
    expect(out).toContain(NEXT_ADJUSTMENT_NOTE);
    // Partner pages carry no per-user state and print no note.
    const partner = html(createElement(PlayCard, { play: playView(), showStatus: false }));
    expect(partner).not.toContain('data-slot="status-note"');
    // A complete card prints the completion, not the note.
    const done = html(createElement(PlayCard, { play: playView({ status: "complete", completedAt: NOW.toISOString(), proof: { assetId: SPACEX, symbol: "SPACEX", before: { day: "2026-06-09", multiplier: 1, qty: 8742.52, raw: "8742516000000" }, after: { day: "2026-06-10", multiplier: 5, qty: 43712.58, raw: "8742516000000" }, ratio: 5 } }), signedIn: true }));
    expect(done).toContain("Complete · ");
    expect(done).not.toContain('data-slot="status-note"');
  });

  it("labels the proof rows as a raw balance and a multiplier ratio, never a percentage", () => {
    const rows = flattenProof(
      { assetId: SPACEX, symbol: "SPACEX", before: { day: "2026-06-09", multiplier: 1, qty: 8742.52, raw: "8742516000000" }, after: { day: "2026-06-10", multiplier: 5, qty: 43712.58, raw: "8742516000000" }, ratio: 5 },
      { assetSource: "prestocks" },
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    // The ticker stands in for the asset id (the full id stays in raw); no separate symbol row.
    expect(byKey.assetId).toMatchObject({ label: "Asset", value: "SPACEX", raw: SPACEX });
    expect(byKey.symbol).toBeUndefined();
    expect(byKey.ratio).toMatchObject({ label: "Multiplier ratio", value: "5" });
    expect(byKey.before).toMatchObject({ label: "Before", value: "2026-06-09 · multiplier 1 · quantity 8,742.52 · raw balance 8742516000000" });
    expect(byKey.after).toMatchObject({ label: "After", value: "2026-06-10 · multiplier 5 · quantity 43,712.58 · raw balance 8742516000000" });
    for (const r of rows) {
      expect(r.value, r.key).not.toMatch(/%/);
      expect(r.label, r.key).not.toMatch(SECURITY_WORDS);
    }
    const missed = flattenProof({ reason: "not_held_through", missed: [{ assetId: SPACEX, symbol: "SPACEX", before: { day: "2026-06-09", multiplier: 1, qty: 1, raw: "1" }, after: { day: "2026-06-10", multiplier: 5, qty: 0, raw: "0" } }] });
    expect(missed.find((r) => r.key === "reason")).toMatchObject({ value: "Not held through" });
    expect(missed.find((r) => r.key === "missed")?.label).toBe("Adjustments not held across");
  });
});
