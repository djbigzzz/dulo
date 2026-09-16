/**
 * Session JWT (jose, HS256). No Next.js or env imports so it can be unit tested;
 * src/lib/auth/session.ts wires it to env().JWT_SECRET and the cookie store.
 *
 * Claims: { sub: userId, wid: walletId, adr: address, cid: chainId, iss, iat, exp }
 */
import { SignJWT, jwtVerify } from "jose";

export type Session = {
  userId: string;
  walletId: string;
  address: string;
  chainId: string;
};

/** 30 days. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_ISSUER = "dulo";

/** Minimum HS256 secret length in characters (`openssl rand -base64 48` yields 64). Mirrored by env.ts. */
export const JWT_SECRET_MIN_LENGTH = 32;

function key(secret: string): Uint8Array {
  if (typeof secret !== "string" || secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(`JWT secret must be at least ${JWT_SECRET_MIN_LENGTH} characters`);
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(session: Session, secret: string, now: Date = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ wid: session.walletId, adr: session.address, cid: session.chainId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(session.userId)
    .setIssuer(SESSION_ISSUER)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_TTL_SECONDS)
    .sign(key(secret));
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Returns the session or null on any failure (bad signature, expired, malformed claims). */
export async function verifySessionToken(token: string, secret: string, now?: Date): Promise<Session | null> {
  if (!nonEmptyString(token)) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      currentDate: now,
    });
    const { sub, wid, adr, cid } = payload;
    if (!nonEmptyString(sub) || !nonEmptyString(wid) || !nonEmptyString(adr) || !nonEmptyString(cid)) {
      return null;
    }
    return { userId: sub, walletId: wid, address: adr, chainId: cid };
  } catch {
    return null;
  }
}
