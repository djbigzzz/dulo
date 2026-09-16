/**
 * House bot identities: handles and the wallet address each one is derived from. Server-only
 * (node:crypto, @solana/web3.js), but free of Prisma and price imports so the sign-in guard can
 * use it without loading the competition module. lib/games/league re-exports both names.
 *
 * The addresses are public by construction (Keypair.fromSeed(sha256(handle)), handles shown on
 * the competition board), so sign-in refuses them whether or not the bot's Wallet row exists yet.
 */
import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";

/**
 * Fifteen sober paper-portfolio handles (Mirror shows them as model portfolios, so no meme or
 * options-slang names). None belongs to a real person. The order is load-bearing: index n is
 * bot-league-(n+1), so rename in place and never reorder, insert or remove.
 */
export const BOT_HANDLES: readonly string[] = Object.freeze([
  "balanced_index",
  "value_tilt",
  "dividend_core",
  "quiet_compounder",
  "broad_market",
  "nasdaq_nomad",
  "tech_growth",
  "equal_weight",
  "sector_rotation",
  "mean_reverter",
  "quality_screen",
  "megacap_core",
  "steady_allocator",
  "slow_money",
  "long_horizon",
]);

/** A valid Solana address derived from the handle: Keypair.fromSeed(sha256(handle)). */
export function botWalletAddress(handle: string): string {
  const seed = createHash("sha256").update(handle, "utf8").digest();
  return Keypair.fromSeed(new Uint8Array(seed)).publicKey.toBase58();
}

let houseBotAddresses: ReadonlySet<string> | null = null;

/** True for the planned wallet address of any house bot (current BOT_HANDLES). */
export function isHouseBotAddress(address: string): boolean {
  houseBotAddresses ??= new Set(BOT_HANDLES.map(botWalletAddress));
  return houseBotAddresses.has(address.trim());
}
