/**
 * Small HTTP helpers shared by the price sources. Server-only.
 */
import { env } from "@/lib/server/env";

export const DEFAULT_TIMEOUT_MS = 10_000;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body?: string,
  ) {
    super(`HTTP ${status} from ${url}${body ? `: ${body.slice(0, 200)}` : ""}`);
    this.name = "HttpError";
  }
  /** 4xx that is not auth/rate-limit related — the request itself is wrong. */
  get isBadRequest(): boolean {
    return this.status >= 400 && this.status < 500 && ![401, 403, 429].includes(this.status);
  }
}

export interface FetchJsonOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
}

/** GET (by default) a JSON document with an AbortController timeout. Throws HttpError on non-2xx. */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { accept: "application/json", ...(opts.headers ?? {}) },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      let body: string | undefined;
      try {
        body = await res.text();
      } catch {
        body = undefined;
      }
      throw new HttpError(res.status, url, body);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Split an array into fixed-size chunks. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new RangeError("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Run `fn` over `items` with at most `limit` in flight. Results keep input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * env() throws when required server vars are missing (e.g. a local script without a
 * DATABASE_URL). Price sources only need optional keys, so degrade to defaults.
 */
export function serverEnvOrNull(): ReturnType<typeof env> | null {
  try {
    return env();
  } catch {
    return null;
  }
}

export function warn(scope: string, message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err !== undefined ? String(err) : "";
  console.warn(`[prices/${scope}] ${message}${detail ? ` — ${detail}` : ""}`);
}
