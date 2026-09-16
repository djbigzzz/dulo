import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Shared helpers for /api/v1 route handlers.
 *
 * Every response is an envelope:
 *   { ok: true, data }            on success
 *   { ok: false, error, issues? } on failure
 */

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string; issues?: unknown };

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiOk<T>>({ ok: true, data }, init);
}

export function fail(error: string, status = 400, issues?: unknown) {
  return NextResponse.json<ApiErr>({ ok: false, error, issues }, { status });
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
    public issues?: unknown,
  ) {
    super(message);
  }
}

/** Parse URL search params against a zod schema. Throws ApiError(400). */
export function parseQuery<S extends z.ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const url = new URL(req.url);
  const obj: Record<string, string | string[]> = {};
  for (const [k, v] of url.searchParams.entries()) {
    const existing = obj[k];
    if (existing === undefined) obj[k] = v;
    else obj[k] = Array.isArray(existing) ? [...existing, v] : [existing, v];
  }
  const r = schema.safeParse(obj);
  if (!r.success) throw new ApiError("Invalid query", 400, r.error.issues);
  return r.data;
}

const JSON_CONTENT_TYPE_RE = /^application\/json\b/i;

/**
 * Parse a JSON body against a zod schema. Throws ApiError(415) unless the request
 * declares `Content-Type: application/json` (a cross-site HTML form can only send
 * text/plain or form encodings, so this also closes login CSRF), ApiError(400) otherwise.
 */
export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  const contentType = (req.headers.get("content-type") ?? "").trim();
  if (!JSON_CONTENT_TYPE_RE.test(contentType)) {
    throw new ApiError("Content-Type must be application/json", 415);
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError("Body must be JSON", 400);
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new ApiError("Invalid body", 400, r.error.issues);
  return r.data;
}

/**
 * Wrap a handler so thrown ApiErrors become envelopes and anything else a 500.
 *
 *   export const GET = handler(async (req) => ok(await something()));
 */
export function handler<Ctx = unknown>(fn: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return fail(e.message, e.status, e.issues);
      console.error(e);
      return fail("Internal error", 500);
    }
  };
}

const BEARER_RE = /^Bearer\s+(.+)$/i;

/** Constant-time string comparison; a length mismatch is a plain false (length is not a secret). */
function secretsMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface CronSecretOptions {
  /**
   * Also accept `?secret=<CRON_SECRET>` (a manual poke from a browser). Default: only outside
   * production, because a secret in a query string lands in request logs; Vercel Cron and the
   * GitHub Actions pinger both send the `Authorization: Bearer` header.
   */
  allowQuery?: boolean;
}

/**
 * Guard for /api/cron/* routes. Accepts `Authorization: Bearer <CRON_SECRET>`; `?secret=` only
 * outside production (see CronSecretOptions). Compares in constant time. Throws ApiError(401).
 */
export function assertCronSecret(req: Request, secret: string, opts: CronSecretOptions = {}) {
  const allowQuery = opts.allowQuery ?? process.env.NODE_ENV !== "production";
  const bearer = BEARER_RE.exec(req.headers.get("authorization") ?? "");
  let given: string | null = null;
  if (bearer) given = bearer[1].trim();
  else if (allowQuery) given = new URL(req.url).searchParams.get("secret");
  if (!secret || given === null || !secretsMatch(given, secret)) throw new ApiError("Unauthorized", 401);
}

/** First entry of a possibly comma-separated proxy header ("a, b" -> "a"); null when empty. */
function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0].trim();
  return first.length > 0 ? first : null;
}

/** The host (incl. port) this request was addressed to: `x-forwarded-host` behind a proxy, else `host`. */
export function requestHost(req: Request): string | null {
  return firstHeaderValue(req.headers.get("x-forwarded-host")) ?? firstHeaderValue(req.headers.get("host"));
}

/**
 * The origin the browser used for this request, e.g. "https://dulo.fun" or "http://localhost:3000".
 * Scheme from `x-forwarded-proto` (default https in production, http elsewhere), host from
 * requestHost(). Falls back to `fallbackUrl` (env().NEXT_PUBLIC_APP_URL) only when no host header exists.
 */
export function requestOrigin(req: Request, fallbackUrl: string): { origin: string; host: string } {
  const host = requestHost(req);
  if (!host) {
    const u = new URL(fallbackUrl);
    return { origin: u.origin, host: u.host };
  }
  const forwarded = firstHeaderValue(req.headers.get("x-forwarded-proto"))?.toLowerCase();
  const proto =
    forwarded === "http" || forwarded === "https" ? forwarded : process.env.NODE_ENV === "production" ? "https" : "http";
  return { origin: `${proto}://${host}`, host };
}

/**
 * Login-CSRF guard for state-changing auth routes (verify, logout). When the browser
 * sends an `Origin` header its host must be the host this request was addressed to;
 * anything else (another site, a "null" origin) is refused with ApiError(403).
 * Requests without an Origin header (same-origin GET-initiated fetches, curl) pass.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (origin === null) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError("Cross-site request refused", 403);
  }
  const own = requestHost(req);
  if (!own || originHost.toLowerCase() !== own.toLowerCase()) {
    throw new ApiError("Cross-site request refused", 403);
  }
}
