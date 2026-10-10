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

/**
 * True while `ref`'s element sits wholly above the viewport (scrolled past). Read on scroll and
 * resize (once a frame), not by an IntersectionObserver: a jump from above the element to below it
 * (End, an anchor) never changes whether it intersects, so an observer would not report it. Off
 * (false) when `enabled` is false and before mount, so a caller that hides something once X is
 * passed fails open and shows it.
 */
export function useScrolledPast<T extends Element>(ref: React.RefObject<T | null>, enabled = true): boolean {
  const [past, setPast] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) {
      setPast(false);
      return;
    }
    let frame = 0;
    const read = () => {
      frame = 0;
      setPast(el.getBoundingClientRect().bottom < 0);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref, enabled]);
  return past;
}

export default useInView;
