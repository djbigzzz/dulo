"use client";

import * as React from "react";

/**
 * True while `ref`'s element intersects the viewport. Off (always false) when `enabled` is false,
 * before mount, and where IntersectionObserver does not exist (server render, old browsers), so a
 * caller that hides something "while X is in view" fails open and shows it.
 */
export function useInView<T extends Element>(ref: React.RefObject<T | null>, enabled = true): boolean {
  const [inView, setInView] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === "undefined") {
      setInView(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false), { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return inView;
}

export default useInView;
