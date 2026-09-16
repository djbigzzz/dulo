/**
 * SERVER-ONLY session helpers. Import from route handlers and server code only;
 * never from client components (it reads env() and next/headers).
 *
 * Cookie: dulo_session, httpOnly, SameSite=Lax, Secure in production, Path=/,
 * 30-day HS256 JWT signed with env().JWT_SECRET.
 */
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { ApiError } from "@/lib/server/api";
import { env } from "@/lib/server/env";
import { SESSION_TTL_SECONDS, signSessionToken, verifySessionToken, type Session } from "./token";

export type { Session };

export const SESSION_COOKIE = "dulo_session";

function cookieAttributes() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

/** Read and verify the session cookie for the current request. Null when absent or invalid. */
export async function getSession(): Promise<Session | null> {
  let token: string | undefined;
  try {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value;
  } catch {
    // Called outside a request scope (e.g. during static rendering): no session.
    return null;
  }
  if (!token) return null;
  return verifySessionToken(token, env().JWT_SECRET);
}

/** Like getSession() but throws ApiError(401) when there is no valid session. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ApiError("Unauthorized", 401);
  return session;
}

/** Sign a session token and set it as the session cookie on `res`. Returns `res`. */
export async function createSessionCookie(session: Session, res: NextResponse): Promise<NextResponse> {
  const token = await signSessionToken(session, env().JWT_SECRET);
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    ...cookieAttributes(),
    maxAge: SESSION_TTL_SECONDS,
    expires: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  });
  return res;
}

/** Expire the session cookie on `res`. Returns `res`. */
export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    ...cookieAttributes(),
    maxAge: 0,
    expires: new Date(0),
  });
  return res;
}
