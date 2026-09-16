/**
 * Soulbound Badge mint (docs/HANDOFF.md §3.5): one Token-2022 mint per achievement,
 * decimals 0, NonTransferable + MetadataPointer + TokenMetadata, 1 token minted to the
 * owner's ATA, then the mint authority is burned (set to null) so the supply is fixed at 1.
 *
 * Everything happens in ONE transaction signed by the server wallet (payer + mint
 * authority + metadata update authority) and the fresh mint keypair:
 *   1. SystemProgram.createAccount   space = getMintLen([NonTransferable, MetadataPointer]),
 *                                    lamports = rent for that space + the TLV metadata
 *   2. InitializeNonTransferableMint
 *   3. InitializeMetadataPointer     metadata lives on the mint itself
 *   4. InitializeMint                decimals 0, mint authority = server, no freeze authority
 *   5. TokenMetadata Initialize      name "Dulo · <Badge>", symbol "DULO", uri -> metadata.json
 *   6. CreateAssociatedTokenAccount  (idempotent) for the owner under Token-2022
 *   7. MintTo 1
 *   8. SetAuthority(MintTokens -> null)
 *
 * NOTE ON RPC: this module creates a web3 `Connection`. That is allowed here, and only
 * here, because minting is a WRITE (build, sign and send a transaction), which the
 * read-only ChainAdapter interface does not model. Every chain READ still goes through
 * lib/adapters/solana. Keep the Connection inside this file.
 *
 * SERVER_WALLET_SECRET is the payer's secret key, base58 (Phantom export) or the JSON
 * byte array solana-keygen writes. Empty -> BadgeMintingDisabledError, so a deployment
 * without a funded wallet simply leaves Badge rows pending ("Minting soon" on the profile).
 */
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from "@solana/web3.js";
import {
  AuthorityType,
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createInitializeNonTransferableMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from "@solana/spl-token";
import { createInitializeInstruction, pack, type TokenMetadata } from "@solana/spl-token-metadata";
import bs58 from "bs58";
import { isLocalAppUrl, resolveAppUrl } from "@/lib/config";
import { env, rpcUrl } from "@/lib/server/env";
import { BADGES, BADGE_SEASON, BADGE_SYMBOL, badgeMetadataPath, isBadgeKey, type BadgeKey } from "./keys";

export class BadgeMintingDisabledError extends Error {
  constructor(reason = "SERVER_WALLET_SECRET is empty") {
    super(`badge minting disabled: ${reason}`);
    this.name = "BadgeMintingDisabledError";
  }
}

/** Extensions every Badge mint carries, in initialisation order. */
export const BADGE_MINT_EXTENSIONS: readonly ExtensionType[] = Object.freeze([ExtensionType.NonTransferable, ExtensionType.MetadataPointer]);

/** Parse a secret key: base58 string or JSON byte array. Throws on anything else. */
export function parseSecretKey(secret: string): Keypair {
  const s = secret.trim();
  if (!s) throw new BadgeMintingDisabledError();
  let bytes: Uint8Array;
  if (s.startsWith("[")) {
    const arr = JSON.parse(s) as unknown;
    if (!Array.isArray(arr) || !arr.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) throw new Error("SERVER_WALLET_SECRET: invalid JSON byte array");
    bytes = Uint8Array.from(arr as number[]);
  } else {
    bytes = bs58.decode(s);
  }
  if (bytes.length !== 64) throw new Error(`SERVER_WALLET_SECRET: expected 64 bytes, got ${bytes.length}`);
  return Keypair.fromSecretKey(bytes);
}

/** True when a server wallet secret is configured (without validating it). Never throws. */
export function isBadgeMintingEnabled(): boolean {
  try {
    return env().SERVER_WALLET_SECRET.trim().length > 0;
  } catch {
    return false;
  }
}

/** The server wallet keypair. Throws BadgeMintingDisabledError when unset. */
export function serverWallet(): Keypair {
  const secret = env().SERVER_WALLET_SECRET;
  if (!secret.trim()) throw new BadgeMintingDisabledError();
  return parseSecretKey(secret);
}

/**
 * Public app origin for metadata URIs (no trailing slash): NEXT_PUBLIC_APP_URL, else
 * https://${VERCEL_PROJECT_PRODUCTION_URL}, else localhost (lib/config resolveAppUrl).
 */
function appUrl(): string {
  return resolveAppUrl({ NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL, VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL });
}

/** A production deployment (Vercel production, or any `next start` build). */
export function isProductionRuntime(e: Record<string, string | undefined> = process.env): boolean {
  return e.VERCEL_ENV === "production" || e.NODE_ENV === "production";
}

/**
 * Refuse to mint when the metadata URI would point at localhost in production: the `uri` is
 * written on-chain into a supply-1 mint whose authority is burned, so a wrong origin is permanent.
 * Throws BadgeMintingDisabledError so the cron step skips the batch and reports the reason.
 */
export function assertMintableBaseUrl(baseUrl: string, production = isProductionRuntime()): void {
  if (production && isLocalAppUrl(baseUrl)) {
    throw new BadgeMintingDisabledError(`app URL ${baseUrl} is localhost in production; set NEXT_PUBLIC_APP_URL`);
  }
}

/** TokenMetadata for a badge mint. Pure. */
export function badgeTokenMetadata(badgeKey: BadgeKey, mint: PublicKey, updateAuthority: PublicKey, baseUrl: string): TokenMetadata {
  const info = BADGES[badgeKey];
  return {
    updateAuthority,
    mint,
    name: info.name,
    symbol: BADGE_SYMBOL,
    uri: `${baseUrl.replace(/\/+$/, "")}${badgeMetadataPath(badgeKey)}`,
    additionalMetadata: [
      ["badge", badgeKey],
      ["season", BADGE_SEASON],
    ],
  };
}

/** Account size of the mint (fixed extensions) and the extra TLV bytes the metadata needs. */
export function badgeMintSpace(metadata: TokenMetadata): { mintLen: number; metadataLen: number } {
  const mintLen = getMintLen([...BADGE_MINT_EXTENSIONS]);
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  return { mintLen, metadataLen };
}

export interface BuildBadgeMintInput {
  payer: PublicKey;
  mint: PublicKey;
  owner: PublicKey;
  metadata: TokenMetadata;
  /** Rent for mintLen + metadataLen. */
  lamports: number;
  mintLen: number;
}

/** The eight instructions of a badge mint, in order. Pure (no RPC). */
export function buildBadgeMintInstructions(input: BuildBadgeMintInput): TransactionInstruction[] {
  const { payer, mint, owner, metadata, lamports, mintLen } = input;
  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
  return [
    SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: mint, space: mintLen, lamports, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeNonTransferableMintInstruction(mint, TOKEN_2022_PROGRAM_ID),
    createInitializeMetadataPointerInstruction(mint, payer, mint, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint, 0, payer, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      mint,
      metadata: mint,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      mintAuthority: payer,
      updateAuthority: payer,
    }),
    createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint, TOKEN_2022_PROGRAM_ID),
    createMintToInstruction(mint, ata, payer, 1, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(mint, payer, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID),
  ];
}

export interface MintBadgeInput {
  ownerAddress: string;
  badgeKey: string;
}

export interface MintBadgeResult {
  /** The new Token-2022 mint address (one per badge, supply 1, non-transferable). */
  mint: string;
  txSig: string;
  /** The owner's associated token account that holds the badge. */
  tokenAccount: string;
}

/** Injectable pieces for tests; production uses rpcUrl() + SERVER_WALLET_SECRET. */
export interface MintBadgeDeps {
  connection?: Pick<Connection, "getMinimumBalanceForRentExemption"> & Parameters<typeof sendAndConfirmTransaction>[0];
  payer?: Keypair;
  mintKeypair?: Keypair;
  baseUrl?: string;
  /** Overrides isProductionRuntime() for the localhost guard. */
  production?: boolean;
}

/**
 * Mint a soulbound Badge to `ownerAddress`. Throws BadgeMintingDisabledError when no
 * server wallet is configured or the app URL is localhost in production, an Error for an unknown badge key or bad address, and
 * whatever the RPC throws on failure (the cron isolates per row and retries next tick).
 */
export async function mintBadge(input: MintBadgeInput, deps: MintBadgeDeps = {}): Promise<MintBadgeResult> {
  if (!isBadgeKey(input.badgeKey)) throw new Error(`Unknown badge key: ${input.badgeKey}`);
  let owner: PublicKey;
  try {
    owner = new PublicKey(input.ownerAddress);
  } catch {
    throw new Error(`Invalid owner address: ${input.ownerAddress}`);
  }

  const baseUrl = deps.baseUrl ?? appUrl();
  assertMintableBaseUrl(baseUrl, deps.production ?? isProductionRuntime());

  const payer = deps.payer ?? serverWallet();
  // The one Connection outside lib/adapters/solana: minting is a write, not a read (see header).
  const connection = deps.connection ?? new Connection(rpcUrl(), "confirmed");
  const mintKeypair = deps.mintKeypair ?? Keypair.generate();
  const mint = mintKeypair.publicKey;

  const metadata = badgeTokenMetadata(input.badgeKey, mint, payer.publicKey, baseUrl);
  const { mintLen, metadataLen } = badgeMintSpace(metadata);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

  const tx = new Transaction().add(...buildBadgeMintInstructions({ payer: payer.publicKey, mint, owner, metadata, lamports, mintLen }));
  tx.feePayer = payer.publicKey;
  const txSig = await sendAndConfirmTransaction(connection as Connection, tx, [payer, mintKeypair], { commitment: "confirmed" });

  return {
    mint: mint.toBase58(),
    txSig,
    tokenAccount: getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID).toBase58(),
  };
}
