"use client";

/**
 * useCountUp
 * ----------
 * Tweens a numeric readout from its previous value to a new target using
 * `requestAnimationFrame` and an ease-out-cubic curve.
 *
 *   const displayed = useCountUp(proxies.length);
 *   <span>{displayed}</span>
 *
 * Contract:
 *   - On the very first call the hook sets the display to `target` directly
 *     (no entrance tween, so the dashboard doesn't flash numbers in from 0
 *     on refresh).
 *   - When `prefers-reduced-motion: reduce` is on, or `disabled` is true,
 *     the hook sets the display to `target` directly and skips rAF.
 *   - Integer-to-integer transitions round each frame so the digits stay
 *     tabular; a non-finite target short-circuits to the target itself.
 *   - A new target mid-animation re-bases from the current displayed value,
 *     so sequential bumps (10 → 11 → 12) look continuous instead of
 *     snapping back.
 *
 * Duration defaults to 600ms — slow enough to read, fast enough that a
 * stream of SSE ticks doesn't pile up.
 */

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

export interface UseCountUpOptions {
  /** Animation length in ms. Default 600. */
  duration?: number;
  /** Skip animation; set the display value directly. */
  disabled?: boolean;
  /**
   * Tween from 0 → target on first mount instead of snapping. Default false
   * (the dashboard was flashing numbers in from 0 on every refresh). When the
   * Hero + metric row wants the "spin up" moment on initial load, set true —
   * the hook honours `prefers-reduced-motion` either way.
   */
  animateInitial?: boolean;
}

export function useCountUp(target: number, opts: UseCountUpOptions = {}): number {
  const { duration = 600, disabled = false, animateInitial = false } = opts;
  const reducedMotion = useReducedMotion();

  const settledTarget = Number.isFinite(target) ? target : 0;
  const initialDisplay =
    animateInitial && !disabled && !reducedMotion ? 0 : settledTarget;

  const [display, setDisplay] = useState<number>(initialDisplay);
  const displayRef = useRef<number>(initialDisplay);
  const firstRun = useRef<boolean>(true);
  const rafRef = useRef<number | null>(null);

  // Keep displayRef in sync so re-targets mid-tween read the live value.
  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    // Cancel any in-flight tween before deciding what to do with this update.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (firstRun.current) {
      firstRun.current = false;
      const settled = Number.isFinite(target) ? target : 0;
      // If the caller asked for an initial tween and the OS allows motion,
      // fall through to the tween block from the hook's seeded 0. Otherwise
      // land on target immediately.
      if (!(animateInitial && !disabled && !reducedMotion)) {
        displayRef.current = settled;
        setDisplay(settled);
        return;
      }
    }

    if (!Number.isFinite(target) || disabled || reducedMotion) {
      const settled = Number.isFinite(target) ? target : 0;
      displayRef.current = settled;
      setDisplay(settled);
      return;
    }

    const from = displayRef.current;
    const to = target;
    const delta = to - from;
    if (delta === 0) return;

    const integerMode = Number.isInteger(from) && Number.isInteger(to);
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — strong early motion, gentle landing.
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + delta * eased;
      const next = integerMode ? Math.round(current) : current;
      displayRef.current = next;
      setDisplay(next);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target, duration, disabled, reducedMotion, animateInitial]);

  return display;
}

export default useCountUp;
