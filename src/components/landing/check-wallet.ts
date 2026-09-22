import { PRE_IPO_PUBLIC_WALLETS, PUBLIC_WALLETS, type PublicWallet } from "@/lib/mirror/public-wallets";

/**
 * "Check any wallet" helpers shared by the landing paste box and /check (15 Sep review M-C).
 * Client-safe, no JSX.
 */

/**
 * One-tap examples under the paste box ("Try a real holder"): the first three curated public
 * wallets, with their neutral labels ("Public holder A"), then the pre-IPO holder with its
 * "pre-IPO" tag. Not Dulo players, never scored. The pre-IPO holder is on these chips only, never
 * on /copy.
 */
export const SAMPLE_WALLETS: readonly PublicWallet[] = [...PUBLIC_WALLETS.slice(0, 3), ...PRE_IPO_PUBLIC_WALLETS];

export const CHECK_INVALID_MESSAGE = "Paste a Solana wallet address (32 to 44 letters and numbers).";

/** The check page for an address. */
export function checkHref(address: string): string {
  return `/check/${encodeURIComponent(address)}`;
}
