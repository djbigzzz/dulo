"use client";

import * as React from "react";
import { api, ApiClientError, leagueApi, type CallsResponse, type LeagueResponse } from "@/lib/api-client";
import { useApiQuery, type ApiQueryResult, type QueryKey } from "@/components/common/useApiQuery";
import { useOptionalSession } from "@/hooks/useSession";

/**
 * The week's two reads, shared by the whole page: GET /api/v1/league (the competition week:
 * weekStart, weekEnd, closesIn, opensIn) and GET /api/v1/calls (this week's predictions: locksAt,
 * settleAt). The week track under the header needs both on every page, and the landing,
 * /predictions, /competition, /start and /prestocks read them for their own content, so the shell
 * mounts one provider and every reader takes the same request: each endpoint is still read once
 * per page load.
 *
 * Same semantics as each page's own read before: session-keyed (a sign-in, a linked wallet or a
 * sign-out refetches), held until the session check settles, refetched on focus, and retried twice
 * on a 5xx or a network error (600 ms, then 1.2 s), as the landing's reads always were.
 */

export interface WeekData {
  league: ApiQueryResult<LeagueResponse>;
  calls: ApiQueryResult<CallsResponse>;
}

const WeekDataContext = React.createContext<WeekData | null>(null);

/** Retry delays for a failed read, ms. A 4xx is an answer, not a hiccup: it is never retried. */
export const WEEK_READ_RETRY_MS = [600, 1200] as const;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Run `read`, retrying a 5xx or a network failure after each delay in `delays`. Never retries an abort. */
export async function readWithRetry<T>(read: () => Promise<T>, signal?: AbortSignal, delays: readonly number[] = WEEK_READ_RETRY_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (e) {
      const retryable = !(e instanceof ApiClientError) || e.status >= 500;
      if (signal?.aborted || !retryable || attempt >= delays.length) throw e;
      await wait(delays[attempt], signal);
    }
  }
}

const readLeague = (signal: AbortSignal) => readWithRetry(() => leagueApi.overview({ signal }), signal);
const readCalls = (signal: AbortSignal) => readWithRetry(() => api.calls({ signal }), signal);

/** Mounted once, in AppShell, around the header, the week track, the page and the footer. */
export function WeekDataProvider({ children }: { children: React.ReactNode }) {
  const userKey = useOptionalSession()?.session?.userId ?? "";
  const league = useApiQuery(readLeague, ["week:league", userKey]);
  const calls = useApiQuery(readCalls, ["week:calls", userKey]);
  const value = React.useMemo<WeekData>(() => ({ league, calls }), [league, calls]);
  return <WeekDataContext.Provider value={value}>{children}</WeekDataContext.Provider>;
}

/** The shared reads, or null outside the provider (a test rendering one component). */
export function useWeekData(): WeekData | null {
  return React.useContext(WeekDataContext);
}

/**
 * GET /api/v1/league for a page or component. Inside the shell it is the shared read (one request
 * per page); outside it (a standalone render) it reads on its own under `key`.
 */
export function useLeagueQuery(key: QueryKey = ""): ApiQueryResult<LeagueResponse> {
  const shared = React.useContext(WeekDataContext);
  const own = useApiQuery(readLeague, key, { enabled: shared === null });
  return shared ? shared.league : own;
}

/** GET /api/v1/calls, shared the same way as useLeagueQuery. */
export function useCallsQuery(key: QueryKey = ""): ApiQueryResult<CallsResponse> {
  const shared = React.useContext(WeekDataContext);
  const own = useApiQuery(readCalls, key, { enabled: shared === null });
  return shared ? shared.calls : own;
}
