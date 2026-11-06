"use client";

/**
 * useReducedMotion
 * ----------------
 * Subscribes to `(prefers-reduced-motion: reduce)` and returns `true` when
 * the OS has asked the UI to cut non-essential animation.
 *
 * Mission Control stays dense and legible — this hook is how the rest of the
 * dashboard (MetricCard flashes, count-up tweens, LED pulses) decides to
 * short-circuit motion without having to re-check the media query itself.
 *
 * Returns `false` during SSR and the very first client render, flips to the
 * real value inside `useEffect`. That matches Next.js hydration — no mismatch
 * warnings because we never read `window` during render.
 */

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mq = window.matchMedia(QUERY);
    setReduced(mq.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);

    // Safari < 14 only supports addListener/removeListener.
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  return reduced;
}

export default useReducedMotion;
