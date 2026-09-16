import type { PreviewPlayStatus, PreviewResponse } from "@/lib/api-client";

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
