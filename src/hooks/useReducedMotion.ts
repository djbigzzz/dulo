"use client";

import * as React from "react";

/**
 * True when the viewer asks for reduced motion (prefers-reduced-motion: reduce). Every Broadcast
 * clock (the week track, the landing's lock clock, the competition and predictions page clocks)
 * then drops its seconds and ticks once a minute, and markers stop sliding. SSR-safe: false until
 * mounted, so the server and the first client render agree; it follows the setting if it changes.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}
