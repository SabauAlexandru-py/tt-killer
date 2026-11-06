/**
 * Mission Control — motion utility layer (V2).
 *
 * Single source of truth for every named animation preset the UI uses. The
 * V2 design brief (DESIGN_BRIEF_V2.md §3) names a small vocabulary of
 * motions — `cardEnter`, `cardHover`, `rowRipple`, `successFlash`,
 * `errorShake`, `metricCountUp`, `inspectorSlide`, `navCollapse` — and this
 * file ships each one as a plain object so a component can:
 *
 *   • hand the keyframes + easing to framer-motion (`animate={cardEnter.to}`)
 *   • reach for the matching CSS class (`var(--motion-card-enter-duration)`)
 *   • stub the whole thing out when `prefers-reduced-motion: reduce` is set
 *
 * Every preset exposes:
 *   • `duration` — ms, number (not a string) so framer-motion / rAF math works
 *   • `easing`   — cubic-bezier array matching the CSS token
 *   • `cssDuration` / `cssEasing` — string aliases for inline `style={}` work
 *   • `from` / `to` — property snapshots for framer-motion
 *   • `cssVar`      — the CSS custom property name the V2 keyframes attach to
 *
 * The hooks (`useCountUp`, `useReducedMotion`) stay deliberately small —
 * no state machines, no AbortController theatrics. requestAnimationFrame, a
 * ref for cancel, and a matchMedia listener. That's it.
 *
 * Reduced motion — a non-negotiable: the §8 budget mandates it, and every
 * preset exports a `reduced` shape (either a 120ms cross-fade, a no-op, or
 * the terminal keyframe already baked). `useReducedMotion()` is the switch.
 */

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Easing tokens — mirror app/globals-v2.css one-to-one.
// ---------------------------------------------------------------------------

/**
 * Cubic-bezier control points as a 4-tuple. Matches framer-motion's `ease`
 * prop shape and CSS `cubic-bezier(a, b, c, d)` signature. Keep these in sync
 * with the CSS custom properties — the test harness in @/frontend/__tests__
 * will fail if they drift.
 */
export type Cubic = readonly [number, number, number, number];

export const EASE_OUT:        Cubic = [0.16, 1, 0.3, 1];
export const EASE_SMOOTH:     Cubic = [0.32, 0.72, 0, 1];
export const EASE_OVERSHOOT:  Cubic = [0.34, 1.56, 0.64, 1];
export const EASE_ANTICIP:    Cubic = [0.68, -0.4, 0.32, 1.4];
export const EASE_LINEAR:     Cubic = [0, 0, 1, 1];

// Durations. All ms, all integers, all reachable from CSS vars.
export const DUR_QUICK  = 80;
export const DUR_FAST   = 120;
export const DUR_NORMAL = 220;
export const DUR_SLOW   = 380;

// ---------------------------------------------------------------------------
// Easing helpers — the countUp hook needs scalar interpolation.
// ---------------------------------------------------------------------------

/**
 * Evaluate a cubic-bezier easing at `t ∈ [0, 1]`. Uses Newton–Raphson with a
 * bisection fallback, which is the same approach Chromium's compositor takes
 * — accurate to ~1e-6 inside 8 iterations, cheap enough to run every rAF
 * tick.
 *
 * `easing` matches the CSS `cubic-bezier(p1x, p1y, p2x, p2y)` tuple exactly,
 * so passing EASE_OUT here gives the identical curve the browser renders.
 */
export function evaluateCubic(easing: Cubic, t: number): number {
  const [p1x, p1y, p2x, p2y] = easing;

  // Handle the linear case explicitly — saves a few iterations and avoids
  // the Newton–Raphson divide-by-zero when all control points are on the
  // diagonal.
  if (p1x === p1y && p2x === p2y) return t;

  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const x = solveCubicX(clamped, p1x, p2x);
  return sampleCurve(x, p1y, p2y);
}

function sampleCurve(t: number, a1: number, a2: number): number {
  const c1 = 3 * a1;
  const c2 = 3 * (a2 - a1) - c1;
  const c3 = 1 - c1 - c2;
  return ((c3 * t + c2) * t + c1) * t;
}

function sampleCurveDerivative(t: number, a1: number, a2: number): number {
  const c1 = 3 * a1;
  const c2 = 3 * (a2 - a1) - c1;
  const c3 = 1 - c1 - c2;
  return (3 * c3 * t + 2 * c2) * t + c1;
}

function solveCubicX(x: number, p1x: number, p2x: number): number {
  let t = x;
  for (let i = 0; i < 8; i++) {
    const current = sampleCurve(t, p1x, p2x) - x;
    if (Math.abs(current) < 1e-6) return t;
    const slope = sampleCurveDerivative(t, p1x, p2x);
    if (Math.abs(slope) < 1e-6) break;
    t -= current / slope;
  }

  // Bisection fallback for edge cases where Newton–Raphson diverges.
  let lo = 0;
  let hi = 1;
  t = x;
  while (lo < hi) {
    const value = sampleCurve(t, p1x, p2x);
    if (Math.abs(value - x) < 1e-6) return t;
    if (value < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
    if (hi - lo < 1e-6) return t;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Preset shape
// ---------------------------------------------------------------------------

/**
 * Transform/opacity/filter snapshot — the exact subset framer-motion treats
 * as GPU-friendly. Keeping it narrow is deliberate: §8 bans animating
 * width/height/top/left (nav-expand is the single exception).
 */
export interface MotionFrame {
  readonly opacity?: number;
  readonly scale?: number;
  readonly translateX?: number | string;
  readonly translateY?: number | string;
  readonly rotate?: number | string;
  readonly filter?: string;
  readonly background?: string;
  readonly borderColor?: string;
  readonly boxShadow?: string;
}

export interface MotionPreset {
  /** Stable machine name — also the CSS variable suffix. */
  readonly name: string;
  readonly duration: number;
  readonly easing: Cubic;
  /** `${duration}ms` — drop-in for inline style. */
  readonly cssDuration: string;
  readonly cssEasing: string;
  /** CSS custom property name the V2 stylesheet exposes. */
  readonly cssVar: string;
  /** Starting frame — what `initial={from}` gets. */
  readonly from: MotionFrame;
  /** Terminal frame — what `animate={to}` gets. */
  readonly to: MotionFrame;
  /**
   * Multi-key sequence for shakes / ripples / stutters. Each entry is a
   * keyframe; use `.map((f) => f.translateX)` to feed framer-motion arrays.
   */
  readonly keyframes?: readonly MotionFrame[];
  /**
   * Reduced-motion fallback. `null` means the preset becomes a no-op; a
   * MotionFrame means "jump straight here" with a 120ms cross-fade.
   */
  readonly reduced: MotionFrame | null;
}

function cubicToCss(easing: Cubic): string {
  return `cubic-bezier(${easing[0]}, ${easing[1]}, ${easing[2]}, ${easing[3]})`;
}

function preset(
  spec: Omit<MotionPreset, "cssDuration" | "cssEasing" | "cssVar"> & {
    readonly cssVar?: string;
  },
): MotionPreset {
  return {
    ...spec,
    cssDuration: `${spec.duration}ms`,
    cssEasing: cubicToCss(spec.easing),
    cssVar: spec.cssVar ?? `--motion-${spec.name}`,
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Grid / list card entrance — fades + rises 12px. Stagger upstream
 * (40ms per item, cap at 12 items — see §3 of the brief).
 */
export const cardEnter: MotionPreset = preset({
  name: "card-enter",
  duration: 320,
  easing: EASE_OUT,
  from: { opacity: 0, translateY: 12 },
  to: { opacity: 1, translateY: 0 },
  reduced: { opacity: 1, translateY: 0 },
});

/**
 * Hover lift — single preset covers the profile card, run card, and settings
 * surface. Translate + border shade + soft drop-shadow, all via transform /
 * color / box-shadow (never size).
 */
export const cardHover: MotionPreset = preset({
  name: "card-hover",
  duration: 180,
  easing: EASE_OUT,
  from: {
    translateY: 0,
    borderColor: "var(--border)",
    boxShadow: "0 0 0 0 oklch(0 0 0 / 0)",
  },
  to: {
    translateY: -2,
    borderColor: "var(--border-strong)",
    boxShadow: "0 6px 20px oklch(0 0 0 / 0.35)",
  },
  reduced: null,
});

/**
 * Press feedback — 985-scale on :active, snaps back on release.
 * Cancelled under reduced motion (§8 rate-caps list).
 */
export const cardPress: MotionPreset = preset({
  name: "card-press",
  duration: DUR_QUICK,
  easing: EASE_OUT,
  from: { scale: 1 },
  to: { scale: 0.985 },
  reduced: null,
});

/**
 * Row ripple on data update — flashes the row's background with
 * `--accent-bg` and dissolves. Rate-capped by caller to 1 per row per 500ms.
 */
export const rowRipple: MotionPreset = preset({
  name: "row-ripple",
  duration: 400,
  easing: EASE_SMOOTH,
  from: { background: "var(--accent-bg)" },
  to: { background: "transparent" },
  keyframes: [
    { background: "transparent" },
    { background: "var(--accent-bg)" },
    { background: "transparent" },
  ],
  reduced: { background: "transparent" },
});

/**
 * Success flash — one-shot row celebration when a signup finishes.
 * Background + border blink to accent, then fade back. Max once per 2s per
 * row (§8).
 */
export const successFlash: MotionPreset = preset({
  name: "success-flash",
  duration: 480,
  easing: EASE_SMOOTH,
  from: {
    background: "transparent",
    borderColor: "var(--border)",
  },
  to: {
    background: "transparent",
    borderColor: "var(--border)",
  },
  keyframes: [
    { background: "transparent", borderColor: "var(--border)" },
    { background: "var(--accent-bg)", borderColor: "var(--accent-border)" },
    { background: "var(--accent-bg)", borderColor: "var(--accent-border)" },
    { background: "transparent", borderColor: "var(--border)" },
  ],
  reduced: { background: "transparent", borderColor: "var(--border)" },
});

/**
 * Form shake — 5-sample keyframe at linear easing. Scoped to inputs, never
 * fires on data-level errors (§8). Collapsed to a no-op under reduced
 * motion.
 */
export const errorShake: MotionPreset = preset({
  name: "error-shake",
  duration: 320,
  easing: EASE_LINEAR,
  from: { translateX: 0 },
  to: { translateX: 0 },
  keyframes: [
    { translateX: 0 },
    { translateX: -4 },
    { translateX: 4 },
    { translateX: -2 },
    { translateX: 0 },
  ],
  reduced: null,
});

/**
 * Metric count-up — the preset itself is metadata (duration + easing); the
 * actual interpolation lives in `useCountUp`. Fires on monotonic counters
 * only: profiles total, done 24h. Never on anything that can go backwards.
 */
export const metricCountUp: MotionPreset = preset({
  name: "metric-count-up",
  duration: 600,
  easing: EASE_OUT,
  from: { opacity: 1 },
  to: { opacity: 1 },
  reduced: { opacity: 1 },
});

/**
 * Right-inspector slide — 100% → 0 with opacity fade. Mirrors the
 * sticky bulk-action bar as well (§4).
 */
export const inspectorSlide: MotionPreset = preset({
  name: "inspector-slide",
  duration: 260,
  easing: EASE_SMOOTH,
  from: { translateX: "100%", opacity: 0 },
  to: { translateX: "0%", opacity: 1 },
  reduced: { translateX: "0%", opacity: 1 },
});

/**
 * Nav rail collapse/expand — width 56px ↔ 240px. The ONE spot where
 * animating `width` is tolerated (§8 explicit exception). 220ms,
 * `--ease-smooth`, costs once per toggle.
 */
export const navCollapse: MotionPreset = preset({
  name: "nav-collapse",
  duration: DUR_NORMAL,
  easing: EASE_SMOOTH,
  from: { opacity: 1 },
  to: { opacity: 1 },
  reduced: { opacity: 1 },
});

/**
 * Registry — lookup by name so a CSS data-attribute can drive a React preset.
 * Keep the map readonly so callers don't mutate the source of truth.
 */
export const MOTION_PRESETS = {
  cardEnter,
  cardHover,
  cardPress,
  rowRipple,
  successFlash,
  errorShake,
  metricCountUp,
  inspectorSlide,
  navCollapse,
} as const satisfies Readonly<Record<string, MotionPreset>>;

export type MotionPresetName = keyof typeof MOTION_PRESETS;

/**
 * Build an inline style object that applies a preset's duration + easing to
 * CSS vars. The V2 stylesheet (`globals-v2.css`) defines every keyframe
 * against these vars, so a component only has to attach the class + style:
 *
 *   <div
 *     className="motion motion--card-enter"
 *     style={presetStyle(cardEnter)}
 *   />
 */
export function presetStyle(p: MotionPreset): Record<string, string> {
  return {
    [`${p.cssVar}-duration`]: p.cssDuration,
    [`${p.cssVar}-easing`]: p.cssEasing,
  };
}

// ---------------------------------------------------------------------------
// useReducedMotion — matchMedia switch for everything above.
// ---------------------------------------------------------------------------

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * React hook that returns `true` when the user has set `prefers-reduced-
 * motion: reduce`. SSR-safe — returns `false` on the server, then syncs on
 * mount. Updates live if the user flips the preference mid-session.
 *
 * Attach the result to every animation controller:
 *
 *   const reduce = useReducedMotion();
 *   const preset = reduce ? cardEnter.reduced : cardEnter.to;
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) return;
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(mql.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);

    // Safari < 14 only supports the deprecated addListener/removeListener.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return reduced;
}

// ---------------------------------------------------------------------------
// useCountUp — tween a number from 0 → target via rAF.
// ---------------------------------------------------------------------------

export interface UseCountUpOptions {
  /** Total tween time in ms. Default pulls from `metricCountUp.duration`. */
  readonly duration?: number;
  /** Easing curve. Default pulls from `metricCountUp.easing`. */
  readonly easing?: Cubic;
  /**
   * Starting value. Default 0 — on mount the counter sweeps from zero to
   * `target`. Set to the prior value when you want "delta" animations
   * (e.g. metric went from 42 → 51, start at 42).
   */
  readonly from?: number;
  /**
   * Decimal places to round to. Default 0 — metrics are integers. Set to
   * 2 for percentages, etc.
   */
  readonly decimals?: number;
  /**
   * When true (default), honors `prefers-reduced-motion: reduce` by
   * snapping to the target value with no tween. Set false only in demos.
   */
  readonly respectReducedMotion?: boolean;
}

/**
 * Animate a numeric readout toward `target` using requestAnimationFrame.
 *
 *   const value = useCountUp(metrics.profilesTotal);
 *   return <span className="font-mono-data">{value}</span>;
 *
 * Contract:
 * • Starts at `from` (default 0), tweens to `target` over `duration`.
 * • Re-triggers whenever `target` changes — the new tween starts from the
 *   value currently displayed (not from `from`), so values animate
 *   continuously even when the target updates mid-tween.
 * • Cancels cleanly on unmount — the rAF callback checks a ref flag so
 *   React never warns about setState after unmount.
 * • SSR-safe: returns `target` on the server (no flash of zero).
 * • Reduced motion: snaps to `target` with no tween when the user prefers.
 */
export function useCountUp(
  target: number,
  options: UseCountUpOptions = {},
): number {
  const {
    duration = metricCountUp.duration,
    easing = metricCountUp.easing,
    from = 0,
    decimals = 0,
    respectReducedMotion = true,
  } = options;

  const reduced = useReducedMotion();
  const shouldSnap = respectReducedMotion && reduced;

  // On the server, render the terminal value — no flash-of-zero.
  const [value, setValue] = useState<number>(() => {
    if (typeof window === "undefined") return target;
    return from;
  });

  const frameRef = useRef<number | null>(null);
  const liveRef = useRef<boolean>(false);
  const valueRef = useRef<number>(value);

  // Keep the ref synced so the rAF callback can read the latest rendered value.
  valueRef.current = value;

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      if (frameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      setValue(target);
      return;
    }

    if (shouldSnap) {
      setValue(target);
      return;
    }

    // Cancel any tween already in flight so the new one takes over cleanly.
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    const start = valueRef.current;
    const delta = target - start;

    // No-op tween: target matches the currently rendered value.
    if (delta === 0) {
      setValue(target);
      return;
    }

    // Guard against pathological durations — anything <= 0 snaps.
    if (duration <= 0) {
      setValue(target);
      return;
    }

    const startedAt = performance.now();
    const multiplier = Math.pow(10, decimals);

    const tick = (now: number) => {
      if (!liveRef.current) return;

      const elapsed = now - startedAt;
      const rawProgress = elapsed / duration;
      const progress = rawProgress <= 0 ? 0 : rawProgress >= 1 ? 1 : rawProgress;
      const eased = evaluateCubic(easing, progress);
      const next = start + delta * eased;
      const rounded = Math.round(next * multiplier) / multiplier;

      setValue(rounded);

      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(tick);
      } else {
        // Snap to the exact target — avoids 1e-15 drift from the eased math.
        setValue(target);
        frameRef.current = null;
      }
    };

    frameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // `from` is only read once per mount — a change to it should NOT
    // retrigger the tween (the rendered value becomes the new start).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration, decimals, shouldSnap]);

  return value;
}
