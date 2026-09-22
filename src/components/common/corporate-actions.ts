import type { CorporateActionView } from "@/lib/api-client";
import { formatDateUtc } from "@/components/common/format";

/**
 * Copy and formatters for a corporate action (a Token-2022 ScaledUiAmount change on a mint) as
 * the Partner page and the wallet check print it. Client-safe, no React, no server imports.
 *
 * An action changes the NUMBER OF TOKENS a wallet shows, never the holder's value, and the copy
 * says exactly that. Nothing here is a percentage, a discount, a premium or any other price signal:
 * the arithmetic is the raw balance, the multiplier and the quantity, and no more.
 */

/** The one explanation sentence printed beside every action. */
export const CORPORATE_ACTION_EXPLANATION = "The number of tokens a wallet shows changed; its value did not. Read from the mint on Solana.";

const ratioFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const multFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

function finitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** "5-for-1 adjustment" for a split (an integer ratio of 2 or more), "×1.4861 adjustment" for anything else. */
export function corporateActionLabel(action: Pick<CorporateActionView, "kind" | "ratio">): string {
  if (!finitePositive(action.ratio)) return "Adjustment";
  const whole = Math.round(action.ratio);
  if (action.kind === "split" && whole >= 2 && Math.abs(action.ratio - whole) < 1e-9) return `${ratioFmt.format(whole)}-for-1 adjustment`;
  return `×${ratioFmt.format(action.ratio)} adjustment`;
}

/** "multiplier 1 → 5": the multiplier on the mint before and after the action. */
export function multiplierChangeLabel(action: Pick<CorporateActionView, "multiplierBefore" | "multiplierAfter">): string {
  const before = finitePositive(action.multiplierBefore) ? multFmt.format(action.multiplierBefore) : "—";
  const after = finitePositive(action.multiplierAfter) ? multFmt.format(action.multiplierAfter) : "—";
  return `multiplier ${before} → ${after}`;
}

/**
 * When the action takes effect, as the row prints it: "Effective 10 Jun 2026" once the new
 * multiplier is in force, "Takes effect 17 Jul 2026" while it is pending, and "Date not set on the
 * mint" when the mint carries no timestamp. The day is the on-chain (UTC) day, the one the docs
 * name, whatever zone the viewer is in.
 */
export function corporateActionWhen(action: Pick<CorporateActionView, "effectiveAt" | "effective">): string {
  const day = formatDateUtc(action.effectiveAt);
  if (!day) return "Date not set on the mint";
  return action.effective ? `Effective ${day}` : `Takes effect ${day}`;
}
