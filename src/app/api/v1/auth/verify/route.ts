import { after } from "next/server";
import { z } from "zod";
import { verifyEd25519 } from "@/lib/adapters/solana";
import { createSessionCookie, getSession, type Session } from "@/lib/auth/session";
import { parseSiwsMessage } from "@/lib/auth/siws";
import { checkSiwsMessage, decodeBase58, isSolanaAddress, siwsSignedBytes } from "@/lib/auth/siws-verify";
import { SOLANA_MAINNET } from "@/lib/core";
import { runForUser } from "@/lib/cron/tick";
import { ensureStarterPoints } from "@/lib/games/starter";
import { ApiError, assertSameOrigin, handler, ok, parseBody, requestOrigin } from "@/lib/server/api";
import { db } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { clientIp } from "@/lib/server/rate-limit";
import { assertNewAccountAllowed, isBotOwnedUser, isHouseBotAddress, welcomePayload } from "./guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  /** base58 public key */
  address: z.string().min(32).max(44),
  /** the exact SIWS text that was signed */
  message: z.string().min(1).max(8192),
  /** base58 ed25519 signature (64 bytes) */
  signature: z.string().min(1).max(128),
  /** base58 bytes the wallet reports having signed (wallet-standard signIn output) */
  signedMessage: z.string().min(1).max(16384).optional(),
  /** already signed in and `address` belongs to another account: sign in to that account instead of 409 */
  switch: z.boolean().optional(),
});

function unauthorized(reason: string): never {
  throw new ApiError(reason, 401);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

function walletWhere(address: string) {
  return { chainId_address: { chainId: SOLANA_MAINNET, address } };
}

type WalletRow = { id: string; userId: string; chainId: string; address: string };

/** With a session, a Wallet owned by someone else is a 409 unless the caller asked to switch accounts. */
function assertOwnership<W extends WalletRow>(wallet: W, current: Session | null, switchAccount: boolean): W {
  if (current && wallet.userId !== current.userId && !switchAccount) {
    throw new ApiError("Wallet belongs to another account", 409);
  }
  return wallet;
}

/** Create User + Wallet(isPrimary) for a first sign-in. */
async function createUserWithWallet(address: string) {
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: {} });
      return tx.wallet.create({
        data: { userId: user.id, chainId: SOLANA_MAINNET, address, isPrimary: true },
      });
    });
  } catch (err) {
    // Two first sign-ins for the same address raced; the loser reads the winner's row.
    if (isUniqueViolation(err)) {
      const raced = await db.wallet.findUnique({ where: walletWhere(address) });
      if (raced) return raced;
    }
    throw err;
  }
}

/**
 * Attach `address` to an existing user as a secondary wallet. Returns null when the
 * user row no longer exists (stale session). A concurrent creation of the same Wallet
 * is resolved by re-reading it; the caller applies the ownership rule to that row.
 */
async function linkWalletToUser(userId: string, address: string) {
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) return null;
      return tx.wallet.create({
        data: { userId, chainId: SOLANA_MAINNET, address, isPrimary: false },
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await db.wallet.findUnique({ where: walletWhere(address) });
      if (raced) return raced;
    }
    throw err;
  }
}

/**
 * The Wallet row a verified signature maps to.
 *   no session                           -> existing Wallet, else new User with this Wallet as primary
 *   session, address not yet a Wallet    -> linked to the session's user (isPrimary=false)
 *   session, address owned by other user -> 409, or that account when `switchAccount`
 *   session, address owned by same user  -> that Wallet (re-sign-in from a linked wallet)
 * Only a brand-new account counts against the per-network new-account limit (`limitKey`,
 * clientIp(req)); signing back in or linking a wallet never does.
 */
async function resolveWallet(address: string, current: Session | null, switchAccount: boolean, limitKey: string) {
  const existing = await db.wallet.findUnique({ where: walletWhere(address) });
  if (existing) return assertOwnership(existing, current, switchAccount);

  if (current) {
    const linked = await linkWalletToUser(current.userId, address);
    if (linked) return assertOwnership(linked, current, switchAccount);
    // The session's user is gone; fall through and start a fresh account.
  }
  assertNewAccountAllowed(limitKey);
  return createUserWithWallet(address);
}

/**
 * POST /api/v1/auth/verify
 * body { address, message, signature, signedMessage?, switch? }
 * -> sets the httpOnly session cookie, ok({ session, welcome })
 *
 * Signed out: signs in (creating the account on first sign-in).
 * Signed in:  links the signed wallet to the current account; a wallet that already
 *             belongs to another account is a 409 unless `switch` is true, in which
 *             case the session moves to that account.
 * Any verification failure is a 401 with a short reason; nothing else leaks.
 *   429  "Too many new accounts from this network. Try again later." (new accounts only,
 *        20 per network per hour, ./guards)
 *   403  "House bot wallets cannot sign in" (a planned house bot address from BOT_HANDLES,
 *        refused before any Wallet row is read or written, or a bot-league-* user or an
 *        isBot competition account), checked before any cookie is set, `switch` included.
 *
 * Starter points (lib/games/starter): the account's one-off 1,000 starter points for the
 * active Season are written here, synchronously, before the response. `welcome` is
 * { starterPoints, virtualCashUsd } only for the request that wrote the grant, else null. A
 * failed grant is logged and never fails the sign-in (the next prediction or cron tick
 * grants it). Points only, no cash value.
 */
export const POST = handler(async (req) => {
  assertSameOrigin(req);
  const body = await parseBody(req, BodySchema);
  const e = env();
  const now = new Date();

  // An existing session decides whether this sign-in links a wallet or starts a session.
  const current = await getSession().catch(() => null);

  if (!isSolanaAddress(body.address)) unauthorized("Invalid address");

  const parsed = parseSiwsMessage(body.message);
  if (!parsed) unauthorized("Malformed sign-in message");

  // Same derivation as the nonce route: what the browser used, not what env says.
  const { origin: appUrl, host: domain } = requestOrigin(req, e.NEXT_PUBLIC_APP_URL);
  const check = checkSiwsMessage(parsed, { address: body.address, domain, appUrl, now });
  if (!check.ok) unauthorized(check.reason);

  // Nonce must have been issued by us and still be live.
  const nonceRow = await db.authNonce.findUnique({ where: { nonce: parsed.nonce } });
  if (!nonceRow) unauthorized("Unknown or already used nonce");
  if (nonceRow.expiresAt.getTime() <= now.getTime()) {
    await db.authNonce.deleteMany({ where: { nonce: parsed.nonce } });
    unauthorized("Nonce expired; request a new one");
  }

  // Signature over the bytes the wallet signed.
  let signature: Uint8Array;
  try {
    signature = decodeBase58(body.signature, "signature");
  } catch {
    unauthorized("Invalid signature encoding");
  }
  if (signature.length !== 64) unauthorized("Invalid signature length");

  let signedBytes: Uint8Array | null;
  try {
    signedBytes = siwsSignedBytes(body.message, body.signedMessage);
  } catch {
    unauthorized("Invalid signedMessage encoding");
  }
  if (!signedBytes) unauthorized("signedMessage does not match message");

  let valid = false;
  try {
    valid = verifyEd25519(body.address, signedBytes, signature);
  } catch {
    valid = false;
  }
  if (!valid) unauthorized("Invalid signature");

  // Single use: the delete is atomic, so two valid submissions of one nonce yield one session.
  const consumed = await db.authNonce.deleteMany({
    where: { nonce: parsed.nonce, expiresAt: { gt: now } },
  });
  if (consumed.count !== 1) unauthorized("Nonce already used");

  // A house bot's key is derivable from its public handle: refuse its address before resolveWallet
  // can create or link a Wallet at it (the row-based check below only works once the bot is seeded).
  if (isHouseBotAddress(body.address)) throw new ApiError("House bot wallets cannot sign in", 403);
  const wallet = await resolveWallet(body.address, current, body.switch === true, clientIp(req));
  if (await isBotOwnedUser(wallet.userId)) throw new ApiError("House bot wallets cannot sign in", 403);

  const starter = await ensureStarterPoints(wallet.userId, now).catch((err: unknown) => {
    console.warn("[auth/verify] starter points grant failed (the next prediction or tick retries)", err);
    return { granted: false };
  });

  const session: Session = {
    userId: wallet.userId,
    walletId: wallet.id,
    address: wallet.address,
    chainId: wallet.chainId,
  };

  const res = ok({ session, welcome: welcomePayload(starter.granted) }, { headers: { "cache-control": "no-store" } });
  await createSessionCookie(session, res);

  // Snapshot this account's wallets and evaluate its quests right away, so "First Position"
  // is already complete when the quests board loads instead of after the next 5-minute tick.
  // after() runs once the response is sent and keeps the serverless function alive for it;
  // runForUser never throws and caps itself at ~8s, the .catch is belt and braces.
  after(() =>
    runForUser(wallet.userId).catch((err: unknown) => {
      console.warn("[auth/verify] post-sign-in refresh failed", err);
    }),
  );
  return res;
});
