"use client";

import * as React from "react";
import { ApiClientError, errorMessage } from "@/lib/api-client";
import { useOptionalSession } from "@/hooks/useSession";
import {
  queryKeyString,
  shouldAwaitSession,
  shouldRefetchOnFocus,
  type QueryKey,
} from "@/hooks/session-state";

/**
 * Tiny data hook for the read pages. Wraps one apiGet-style fetcher with
 * loading / error / retry state, aborts stale requests, and quietly refetches
 * when the tab regains focus.
 *
 * Session aware (inside <SessionProvider>):
 * - refetches whenever the server session changes (`sessionVersion`: sign-in, wallet
 *   linked, account switched, sign-out), so a page never keeps signed-out data after
 *   the user signs in. Pages also put `session?.userId ?? ""` in their key.
 * - holds the first request until the initial /auth/me check settles (capped at
 *   SESSION_WAIT_MS), so a signed-in visitor fetches the page once, not twice.
 * - skips focus refetches while a sign-in is in flight: the wallet popup hands focus
 *   back before /auth/verify sets the cookie.
 *
 * No cache, no dedupe: pages are small and every read is `no-store` anyway.
 */
export interface ApiQueryResult<T> {
  data: T | null;
  /** Readable message; null when the last request succeeded. */
  error: string | null;
  /** HTTP status of the failed request (ApiClientError only); null otherwise. */
  errorStatus: number | null;
  /** True only while the first request (or a retry after an error) is in flight. */
  loading: boolean;
  /** True while a background refetch is in flight and data is already on screen. */
  refreshing: boolean;
  /** Re-run the fetcher. Shows the loading state again only when there is no data. */
  refetch: () => void;
}

export interface ApiQueryOptions {
  /** Refetch when the window regains focus / the tab becomes visible. Default true. */
  refetchOnFocus?: boolean;
  /** Minimum gap between focus-triggered refetches, ms. Default 2000. */
  focusThrottleMs?: number;
  /** Refetch when the server session changes. Default true. */
  refetchOnSessionChange?: boolean;
  /** Hold the first request until the session check settles (max SESSION_WAIT_MS). Default true. */
  awaitSession?: boolean;
}

export type { QueryKey } from "@/hooks/session-state";

/** Longest the first request waits for /auth/me before going ahead anyway. */
export const SESSION_WAIT_MS = 1500;

const noop = () => undefined;

export function useApiQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  /**
   * Changes trigger a refetch. A string, or a list of parts such as
   * `[slug, session?.userId]` (joined into one stable string).
   */
  key: QueryKey = "",
  opts: ApiQueryOptions = {},
): ApiQueryResult<T> {
  const { refetchOnFocus = true, focusThrottleMs = 2000, refetchOnSessionChange = true, awaitSession = true } = opts;
  const session = useOptionalSession();
  const sessionLoading = session?.loading ?? false;
  const sessionVersion = refetchOnSessionChange ? (session?.sessionVersion ?? 0) : 0;
  const signingIn = session?.signingIn ?? false;
  const keyString = queryKeyString(key);

  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [errorStatus, setErrorStatus] = React.useState<number | null>(null);
  const [inFlight, setInFlight] = React.useState(true);
  const [tick, setTick] = React.useState(0);
  const [waitExpired, setWaitExpired] = React.useState(false);

  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;
  const lastRun = React.useRef(0);
  const signingInRef = React.useRef(signingIn);
  signingInRef.current = signingIn;

  const waiting = shouldAwaitSession({ awaitSession, sessionLoading, waitExpired });

  React.useEffect(() => {
    if (!awaitSession || !sessionLoading) return noop;
    const id = window.setTimeout(() => setWaitExpired(true), SESSION_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [awaitSession, sessionLoading]);

  React.useEffect(() => {
    if (waiting) return noop; // stays in the loading state; runs once the session settles
    const ac = new AbortController();
    let active = true;
    lastRun.current = Date.now();
    setInFlight(true);
    fetcherRef
      .current(ac.signal)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
        setErrorStatus(null);
      })
      .catch((e: unknown) => {
        if (!active || ac.signal.aborted) return;
        setError(errorMessage(e));
        setErrorStatus(e instanceof ApiClientError ? e.status : null);
      })
      .finally(() => {
        if (active) setInFlight(false);
      });
    return () => {
      active = false;
      ac.abort();
    };
  }, [keyString, tick, sessionVersion, waiting]);

  const refetch = React.useCallback(() => setTick((t) => t + 1), []);

  React.useEffect(() => {
    if (!refetchOnFocus || typeof window === "undefined") return noop;
    const onFocus = () => {
      const ok = shouldRefetchOnFocus({
        hidden: document.visibilityState === "hidden",
        sinceLastRunMs: Date.now() - lastRun.current,
        throttleMs: focusThrottleMs,
        signingIn: signingInRef.current,
      });
      if (ok) refetch();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refetchOnFocus, focusThrottleMs, refetch]);

  const loading = inFlight && data === null;
  const refreshing = inFlight && data !== null;
  return { data, error: loading ? null : error, errorStatus: loading ? null : errorStatus, loading, refreshing, refetch };
}

export default useApiQuery;
