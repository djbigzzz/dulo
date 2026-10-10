"use client";

import * as React from "react";

/**
 * One ticking clock anchored to the server's `now`, so a countdown agrees with the week track and
 * every other page whatever the device clock says. `tickMs` is how often it moves: 1 s for a
 * countdown with seconds, 60 s under reduced motion (the clocks then drop their seconds).
 */
export function useServerClock(serverNowIso: string | null | undefined, tickMs: number = 1_000): number {
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const skew = React.useRef(0);
  React.useEffect(() => {
    const server = serverNowIso ? Date.parse(serverNowIso) : Number.NaN;
    if (!Number.isFinite(server)) return;
    skew.current = server - Date.now();
    setNowMs(Date.now() + skew.current);
  }, [serverNowIso]);
  React.useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now() + skew.current), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);
  return nowMs;
}
