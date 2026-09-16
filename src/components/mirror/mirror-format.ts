/** Mirror-specific formatters. Client-safe, no React. */
import { COMPLIANCE_LINE } from "@/components/common/compliance";

/** "42.3%" for a 0..1 weight. */
export function formatWeight(weight: number | null | undefined, digits = 1): string {
  if (weight === null || weight === undefined || !Number.isFinite(weight)) return "—";
  return `${(weight * 100).toFixed(digits)}%`;
}

const usdc = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "25.50 USDC". */
export function formatUsdc(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${usdc.format(n)} USDC`;
}

/** Parse the budget input: a positive finite number, else null. */
export function parseBudget(raw: string): number | null {
  const n = Number(String(raw).replace(/[,$\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const BASE58_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * The "Mirror any wallet" box: a trimmed base58 string of Solana address length, else null.
 * Shape only (the server decodes it); same pattern the /api/v1/mirror routes accept.
 */
export function parseWalletInput(raw: string): string | null {
  const s = String(raw ?? "").trim();
  return BASE58_ADDRESS_RE.test(s) ? s : null;
}

/** Plain-language compliance line shown next to buy links (15 Sep review, compliance copy). Shared: components/common/compliance. */
export const MIRROR_COMPLIANCE_LINE = COMPLIANCE_LINE;

/**
 * The mirror_match rule in one sentence (engine: every leg within tolerance AND total distance
 * Σ|Δ|/2 within tolerance, other xStocks included), e.g. "Land within 20% of each weight, with
 * no more than 20% of your xStocks off the mix".
 */
export function toleranceCopy(tolerance: number): string {
  const pct = Number.isFinite(tolerance) ? Math.round(Math.min(1, Math.max(0, tolerance)) * 100) : 20;
  return `Land within ${pct}% of each weight, with no more than ${pct}% of your xStocks off the mix`;
}

/** "7d" / "30d" label from the comparison snapshot's timestamp, e.g. "vs 6d ago". */
export function sinceLabel(sinceIso: string, now: number = Date.now()): string {
  const t = Date.parse(sinceIso);
  if (!Number.isFinite(t)) return "";
  const hours = Math.max(0, Math.floor((now - t) / 3_600_000));
  if (hours < 1) return "vs minutes ago";
  if (hours < 48) return `vs ${hours}h ago`;
  return `vs ${Math.floor(hours / 24)}d ago`;
}
