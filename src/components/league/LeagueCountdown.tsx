"use client";

import * as React from "react";
import { cn } from "cn";
import type { LeagueView } from "@/lib/api-client";
import { countdownTarget } from "@/components/league/format";

// The pure helpers live in format.ts (testable without React); re-exported for callers.
export { countdownTarget, nextOpenIso } from "@/components/league/format";

/**
 * Milliseconds until `targetIso`, ticking once a second. The server clock (`serverNowIso`,
 * captured when the response arrived) corrects a skewed device clock.
 */
export function useCountdown(targetIso: string | null, serverNowIso: string | null): number | null {
  const offset = React.useMemo(() => {
    if (!serverNowIso) return 0;
    const t = Date.parse(serverNowIso);
    return Number.isFinite(t) ? t - Date.now() : 0;
    // The offset is only meaningful for the response it came with.
  }, [serverNowIso]);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!targetIso) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  if (!targetIso) return null;
  const target = Date.parse(targetIso);
  if (!Number.isFinite(target)) return null;
  return Math.max(0, target - (now + offset));
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "3d 13:10:52" set like a chronograph dial: tabular digits, muted unit and separators. The
 * separators carry their own colour so they stay muted inside gradient-text parents.
 */
export function Chronograph({ ms, className }: { ms: number; className?: string }) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sep = <span className="px-[0.06em] font-normal text-[#6b635a]">:</span>;
  const label = `${days > 0 ? `${days} days ` : ""}${h} hours ${m} minutes ${s} seconds`;
  return (
    <span className={cn("inline-flex items-baseline tabular-nums", className)} aria-label={label}>
      {days > 0 ? (
        <>
          <span>{days}</span>
          <span className="mr-[0.3em] ml-[0.06em] text-[0.62em] font-medium text-[#8f877d]">d</span>
        </>
      ) : null}
      <span>{pad(h)}</span>
      {sep}
      <span>{pad(m)}</span>
      {sep}
      <span>{pad(s)}</span>
    </span>
  );
}

/** Live chronograph for a stat tile; "—" when there is nothing to count down to. */
export function LeagueCountdownValue({ league, serverNow }: { league: LeagueView; serverNow: string }) {
  const remaining = useCountdown(countdownTarget(league), serverNow);
  return <span aria-live="off">{remaining === null ? "—" : <Chronograph ms={remaining} />}</span>;
}

export default LeagueCountdownValue;
