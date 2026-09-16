/**
 * Pure SIWS verification checks shared by the verify route and the tests.
 *
 * CLIENT-SAFE (no server imports). Signature verification itself lives in the
 * ChainAdapter (verifyEd25519 from "@/lib/adapters/solana"); this file only
 * decides whether a parsed message is the one we expect and which bytes were
 * signed.
 */
import bs58 from "bs58";
import { SIWS_CHAIN_ID, type ParsedSiwsMessage } from "./siws";

/** A signed message is accepted when its Issued At is within this window of server time. */
export const SIWS_MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

export type SiwsCheck = { ok: true } | { ok: false; reason: string };

export interface SiwsExpectation {
  /** Address the client claims to be signing in with. */
  address: string;
  /** Host (incl. port) of the app, e.g. "dulo.fun" or "localhost:3000". */
  domain: string;
  /** Full app URL; only its origin is compared against the message URI. */
  appUrl: string;
  now?: Date;
  maxSkewMs?: number;
}

/**
 * Check a parsed SIWS message against what this server expects. Signature and
 * nonce state are checked separately by the caller.
 */
export function checkSiwsMessage(parsed: ParsedSiwsMessage, expect: SiwsExpectation): SiwsCheck {
  const now = expect.now ?? new Date();
  const maxSkew = expect.maxSkewMs ?? SIWS_MAX_CLOCK_SKEW_MS;

  if (parsed.address !== expect.address) {
    return { ok: false, reason: "Message address does not match" };
  }
  if (parsed.domain.toLowerCase() !== expect.domain.toLowerCase()) {
    return { ok: false, reason: "Message domain does not match this app" };
  }

  let uriOrigin: string;
  let appOrigin: string;
  try {
    uriOrigin = new URL(parsed.uri).origin;
    appOrigin = new URL(expect.appUrl).origin;
  } catch {
    return { ok: false, reason: "Message URI is not a valid URL" };
  }
  if (uriOrigin !== appOrigin) {
    return { ok: false, reason: "Message URI does not match this app" };
  }

  if (parsed.chainId !== undefined && parsed.chainId !== SIWS_CHAIN_ID && parsed.chainId !== `solana:${SIWS_CHAIN_ID}`) {
    return { ok: false, reason: "Unsupported chain in sign-in message" };
  }

  const issuedAt = Date.parse(parsed.issuedAt);
  if (Number.isNaN(issuedAt)) {
    return { ok: false, reason: "Message Issued At is not a valid timestamp" };
  }
  if (Math.abs(now.getTime() - issuedAt) > maxSkew) {
    return { ok: false, reason: "Sign-in message expired; request a new nonce" };
  }

  if (parsed.expirationTime !== undefined) {
    const exp = Date.parse(parsed.expirationTime);
    if (Number.isNaN(exp) || exp <= now.getTime()) {
      return { ok: false, reason: "Sign-in message expired" };
    }
  }
  if (parsed.notBefore !== undefined) {
    const nbf = Date.parse(parsed.notBefore);
    if (Number.isNaN(nbf) || nbf > now.getTime()) {
      return { ok: false, reason: "Sign-in message is not yet valid" };
    }
  }

  return { ok: true };
}

/** Decode a base58 string; throws Error(`Invalid <label>`) on bad input. */
export function decodeBase58(input: string, label = "base58"): Uint8Array {
  if (typeof input !== "string" || input.length === 0) throw new Error(`Invalid ${label}`);
  try {
    return bs58.decode(input);
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

/** True when `address` is a base58 string decoding to 32 bytes (an ed25519 public key). */
export function isSolanaAddress(address: string): boolean {
  if (typeof address !== "string" || address.length < 32 || address.length > 44) return false;
  try {
    return bs58.decode(address).length === 32;
  } catch {
    return false;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * The bytes the wallet actually signed.
 *
 * - Without `signedMessage` (plain signMessage flow): the UTF-8 bytes of `message`.
 * - With `signedMessage` (wallet-standard signIn flow): the base58-decoded bytes,
 *   which MUST equal the UTF-8 bytes of `message`; otherwise returns null.
 *
 * Throws on undecodable base58.
 */
export function siwsSignedBytes(message: string, signedMessage?: string): Uint8Array | null {
  const utf8 = new TextEncoder().encode(message);
  if (signedMessage === undefined) return utf8;
  const signed = decodeBase58(signedMessage, "signedMessage");
  return bytesEqual(signed, utf8) ? signed : null;
}
