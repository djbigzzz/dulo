import type { PreviewHoldingView, PreviewPlayStatus, PreviewPlayView, PreviewResponse } from "@/lib/api-client";
import { corporateActionLabel } from "@/components/common/corporate-actions";
import { ageSeconds, formatDateUtc, formatPoints, formatUsd } from "@/components/common/format";
import { formatUsdWhole } from "@/components/league/format";
import { STARTER_POINTS, VIRTUAL_CASH_USD } from "@/lib/games/ledger-policy";
import { isPreIpoSource, issuerLabel } from "@/components/common/issuer";
import { priceSourceLabel } from "@/components/common/PriceChip";

/**
 * Copy and small formatters for /check/[address]. Client-safe, no JSX.
 */

export const PREVIEW_STATUS_LABEL: Record<PreviewPlayStatus, string> = {
  qualifies: "Qualifies now",
  not_yet: "Not yet",
  needs_history: "Needs daily snapshots",
  needs_activity: "Connect to take part",
};

export const CONNECT_CTA_TITLE = "Connect this wallet to start scoring";

const qtyFmt = (digits: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: digits });

/** Multiplier-correct quantity: 2 dp from 1,000, 4 dp from 1, else up to 6 dp. */
export function formatQty(qty: number): string {
  if (!Number.isFinite(qty)) return "0";
  const abs = Math.abs(qty);
  return qtyFmt(abs >= 1000 ? 2 : abs >= 1 ? 4 : 6).format(qty);
}

/** "×1.0213" for a Token-2022 multiplier that changes the balance; null for 1. */
export function formatMultiplier(multiplier: number): string | null {
  if (!Number.isFinite(multiplier) || Math.abs(multiplier - 1) < 1e-9) return null;
  return `×${qtyFmt(6).format(multiplier)}`;
}

/**
 * The board of /check/[address], grouped so the page reads as a verdict and not a catalogue:
 * what the wallet already meets, what needs daily snapshots once connected, what one read
 * decided against, and (collapsed) the in-platform quests no wallet read can decide.
 */
export interface PreviewGroups {
  qualifies: PreviewPlayView[];
  needsHistory: PreviewPlayView[];
  notYet: PreviewPlayView[];
  inPlatform: PreviewPlayView[];
}

export function groupPreviewPlays(plays: readonly PreviewPlayView[]): PreviewGroups {
  const out: PreviewGroups = { qualifies: [], needsHistory: [], notYet: [], inPlatform: [] };
  for (const play of plays) {
    if (play.status === "qualifies") out.qualifies.push(play);
    else if (play.status === "needs_history") out.needsHistory.push(play);
    else if (play.status === "not_yet") out.notYet.push(play);
    else out.inPlatform.push(play);
  }
  return out;
}

/** The one line the collapsed in-platform group shows: what those quests need, and what a new account starts with. */
export function inPlatformSummary(count: number): string {
  const quests = count === 1 ? "in-platform quest needs" : "in-platform quests need";
  return `${count} ${quests} a signed-in account: ${formatPoints(STARTER_POINTS)} starter points and ${formatUsdWhole(VIRTUAL_CASH_USD)} of virtual cash to start`;
}

/** Holdings Plays a single read can decide (the denominator of "2 of 2 verified now"). */
export function decidablePlays(data: Pick<PreviewResponse, "plays">): number {
  return data.plays.filter((p) => p.status === "qualifies" || p.status === "not_yet").length;
}

/** Title + description for a failed check, by HTTP status. */
export function checkErrorCopy(status: number | null, message: string | null): { title: string; description: string } {
  if (status === 400) return { title: "That isn't a Solana address.", description: "Check the address and paste it again: 32 to 44 letters and numbers." };
  if (status === 429) return { title: "Slow down a little", description: message ?? "Too many wallet checks from this connection. Try again in a minute." };
  if (status === 503) return { title: "Couldn't read this wallet right now", description: message ?? "Solana or the price feed didn't answer. Try again shortly." };
  return { title: "Couldn't check this wallet", description: message ?? "Something went wrong. Try again." };
}

/** "40s" | "2m" | "3h" | "2d" for an age in seconds; "age unknown" for null. Compact form for the issuer-mark sentence. */
export function formatShortAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "age unknown";
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** The age of a wire timestamp at `now`, else the age the server measured. */
function liveAge(publishedAt: string | null, serverAge: number | null, now: number): number | null {
  return ageSeconds(publishedAt, now) ?? serverAge;
}

export const ISSUER_MARK_EXPLANATION = "The issuer mark is the issuer's own valuation of the underlying, not a tradeable quote.";

/**
 * The issuer-mark sentence for a pre-IPO holding, or null when there is nothing honest to print:
 * not a PreStocks position, no issuer mark in the payload, or no DEX price to set beside it.
 * Two numbers with their own sources and ages, then the explanation. Never a difference, a
 * percentage or a word that reads as a signal; the caller omits the line on null.
 */
export function issuerMarkLine(h: Pick<PreviewHoldingView, "source" | "quote" | "issuerMark">, now: number = Date.now()): string | null {
  if (!isPreIpoSource(h.source) || !h.issuerMark) return null;
  const dex = h.quote.price;
  if (dex === null || !Number.isFinite(dex) || !Number.isFinite(h.issuerMark.price) || h.issuerMark.price <= 0) return null;
  const dexAge = formatShortAge(liveAge(h.quote.publishedAt, h.quote.ageSeconds, now));
  const markAge = formatShortAge(liveAge(h.issuerMark.publishedAt, h.issuerMark.ageSeconds, now));
  return `DEX price ${formatUsd(dex)} (${priceSourceLabel(h.quote.source)}, ${dexAge}) vs issuer mark ${formatUsd(h.issuerMark.price)} (${issuerLabel(h.source) ?? "issuer"}, ${markAge}). ${ISSUER_MARK_EXPLANATION}`;
}

/**
 * The balance before the Token-2022 multiplier, so a pre-IPO row can print the arithmetic once:
 * "raw × multiplier = qty". Null when the multiplier is 1 (nothing to explain) or not a positive number.
 */
export function rawQtyBeforeMultiplier(qty: number, multiplier: number): number | null {
  if (!Number.isFinite(qty) || !Number.isFinite(multiplier) || multiplier <= 0 || Math.abs(multiplier - 1) < 1e-9) return null;
  return qty / multiplier;
}

/** "3.2 × 5 = 16": the on-chain balance, the multiplier and the quantity, in the row's own number format. */
export function multiplierArithmetic(qty: number, multiplier: number): string | null {
  const raw = rawQtyBeforeMultiplier(qty, multiplier);
  if (raw === null) return null;
  return `${formatQty(raw)} × ${qtyFmt(6).format(multiplier)} = ${formatQty(qty)}`;
}

/**
 * The corporate-action line for a holding whose mint has a PAST action, with the holding's own
 * numbers: "5-for-1 adjustment on 10 Jun 2026: raw 8,742.52 × 5 = 43,712.58". Null for a holding
 * without an action, for one still pending (nothing has changed on chain yet), or when the
 * multiplier is 1 (no arithmetic to show). The raw balance, the multiplier and the quantity, and
 * never a percentage: the action changed the number of tokens shown, not the holder's value.
 */
export function holdingActionLine(h: Pick<PreviewHoldingView, "qty" | "multiplier" | "action">): string | null {
  const action = h.action;
  if (!action || !action.effective) return null;
  const raw = rawQtyBeforeMultiplier(h.qty, h.multiplier);
  if (raw === null) return null;
  // The on-chain (UTC) day, the one the docs name, whatever zone the viewer is in.
  const day = formatDateUtc(action.effectiveAt);
  const when = day ? ` on ${day}` : "";
  return `${corporateActionLabel(action)}${when}: raw ${formatQty(raw)} × ${qtyFmt(6).format(h.multiplier)} = ${formatQty(h.qty)}`;
}

/** True when the read holds at least one PreStocks pre-IPO token. */
export function hasPreIpoHolding(data: Pick<PreviewResponse, "holdings">): boolean {
  return data.holdings.some((h) => isPreIpoSource(h.source));
}

/** True when the preview lists a quest fenced to pre-IPO tokens (its card is on screen). */
export function hasPreIpoQuest(data: Pick<PreviewResponse, "plays">): boolean {
  return data.plays.some((p) => isPreIpoSource(p.assetSource));
}

/** "3 stocks" for an xStocks-only wallet, "3 positions" once a pre-IPO token is among them (never "stocks" for those). */
export function positionsHint(data: Pick<PreviewResponse, "holdings">): string {
  const n = data.holdings.length;
  if (hasPreIpoHolding(data)) return `${n} ${n === 1 ? "position" : "positions"}`;
  return `${n} ${n === 1 ? "stock" : "stocks"}`;
}
