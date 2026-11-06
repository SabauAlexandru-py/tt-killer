"use client";

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import stylesRaw from "./Led.module.css";

// Narrow the CSS-module type so TypeScript's noUncheckedIndexedAccess stops
// flagging every styles.X lookup as string|undefined.
const styles = stylesRaw as Record<string, string>;
import {
  DEFAULT_PATTERN,
  PATTERN_DURATION_MS,
  STATUS_TO_LED,
  STROBE_MAX_CYCLES,
  type AccountStatus,
  type LedPattern,
  type LedSize,
  type LedState,
  type LedTone,
} from "./led-colors";

export type { LedTone, LedPattern, LedSize, AccountStatus, LedState };

/* -----------------------------------------------------------------------------
 * Class lookup tables.
 *
 * Keeping them out of the component body means React never allocates the
 * mapping object per render, and each class name resolves in O(1).
 * -------------------------------------------------------------------------- */

const TONE_CLASS: Record<LedTone, string> = {
  idle: styles.toneIdle,
  running: styles.toneRunning,
  success: styles.toneSuccess,
  warning: styles.toneWarning,
  error: styles.toneError,
  info: styles.toneInfo,
  busy: styles.toneBusy,
  pending: styles.tonePending,
  /* rainbow deliberately empty — its pattern drives background-color directly,
     so a tone class would just be overridden mid-animation. */
  rainbow: "",
};

const PATTERN_CLASS: Record<LedPattern, string> = {
  steady: styles.patternSteady,
  pulse: styles.patternPulse,
  "slow-pulse": styles.patternSlowPulse,
  "fast-blink": styles.patternFastBlink,
  breathing: styles.patternBreathing,
  strobe: styles.patternStrobe,
  heartbeat: styles.patternHeartbeat,
  "rainbow-idle": styles.patternRainbowIdle,
};

const SIZE_CLASS: Record<LedSize, string> = {
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
};

/* =============================================================================
 * <Led>
 *
 * The base primitive — one semantic dot, every pattern from V2 brief §2.
 *
 * Responsibilities this component holds (and the CSS module does NOT):
 *
 *   1. Resolve `pattern` from `tone` when the caller omits it, honoring the
 *      DEFAULT_PATTERN table from `led-colors.ts`.
 *   2. Epilepsy guard: after `STROBE_MAX_CYCLES` the strobe animation drops to
 *      `fast-blink` for anyone still watching. Brief §2.
 *   3. Fire the one-shot `led-kick` whenever tone or pattern changes. Brief §3
 *      (`led-kick` preset).
 *   4. Pause looped animations while the tab is hidden. Brief §8 rate caps.
 *
 * The CSS module owns everything else: keyframes, timing, reduced-motion
 * collapse, GPU hinting.
 * =========================================================================== */

export interface LedProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Semantic tone — the fleet-wide "what color" decision. Default `idle`. */
  tone?: LedTone;
  /** Animation pattern. When omitted, derived from tone via DEFAULT_PATTERN. */
  pattern?: LedPattern;
  /** Diameter: xs(6px) · sm(8px) · md(10px) · lg(14px). Default `md`. */
  size?: LedSize;
  /** Adds the bloom halo via box-shadow. Default `true`. */
  glow?: boolean;
  /** Screen-reader label. Promotes the span to role="status". */
  label?: string;
  /** Collapse strobe to fast-blink after the 6-cycle cap. Default `true`. */
  strobeFallback?: boolean;
}

export const Led = forwardRef<HTMLSpanElement, LedProps>(function Led(
  {
    tone = "idle",
    pattern,
    size = "md",
    glow = true,
    label,
    strobeFallback = true,
    className,
    ...rest
  },
  ref,
) {
  const resolvedPattern = pattern ?? DEFAULT_PATTERN[tone];

  /* Strobe → fast-blink fallback after N cycles. The CSS caps the animation
   * to 6 iterations; this timer swaps the class so the lens keeps signaling
   * rather than freezing on the last keyframe. */
  const [strobeExhausted, setStrobeExhausted] = useState(false);
  useEffect(() => {
    if (resolvedPattern !== "strobe" || !strobeFallback) {
      if (strobeExhausted) setStrobeExhausted(false);
      return;
    }
    const total = PATTERN_DURATION_MS.strobe * STROBE_MAX_CYCLES;
    const t = window.setTimeout(() => setStrobeExhausted(true), total);
    return () => window.clearTimeout(t);
    // strobeExhausted is intentionally excluded — it is a derived-reset only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedPattern, strobeFallback]);

  const effectivePattern: LedPattern =
    resolvedPattern === "strobe" && strobeExhausted
      ? "fast-blink"
      : resolvedPattern;

  /* One-shot led-kick on state change. We hold our own ref so the kick fires
   * even when the caller passed their own ref via forwardRef. */
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const prev = useRef<{ tone: LedTone; pattern: LedPattern } | null>(null);
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const first = prev.current == null;
    const changed =
      !first &&
      (prev.current!.tone !== tone ||
        prev.current!.pattern !== effectivePattern);
    prev.current = { tone, pattern: effectivePattern };
    if (!changed) return;
    el.classList.remove(styles.kick);
    // Force a reflow so re-adding the class replays the animation from 0%.
    void el.offsetWidth;
    el.classList.add(styles.kick);
  }, [tone, effectivePattern]);

  /* Pause looped animations while tab is backgrounded (brief §8). */
  const [hidden, setHidden] = useState<boolean>(() =>
    typeof document !== "undefined" ? document.hidden : false,
  );
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  /* Combine refs — the forwarded ref is honored while we keep our own. */
  const setRef = (node: HTMLSpanElement | null) => {
    innerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref)
      (ref as React.MutableRefObject<HTMLSpanElement | null>).current = node;
  };

  return (
    <span
      ref={setRef}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        styles.led,
        SIZE_CLASS[size],
        TONE_CLASS[tone],
        PATTERN_CLASS[effectivePattern],
        glow && styles.ledGlow,
        hidden && styles.paused,
        className,
      )}
      {...rest}
    />
  );
});

/* =============================================================================
 * <StatusLED>
 *
 * Thin shim over <Led> that reads a semantic status (the orchestrator's
 * emitted state — brief §7) and resolves it to the right {tone, pattern, label}
 * via STATUS_TO_LED. Keeps callers from hand-wiring the mapping in every
 * profile card.
 * =========================================================================== */

export interface StatusLEDProps
  extends Omit<LedProps, "tone" | "pattern" | "label"> {
  /** Runtime account/bridge status emitted by the orchestrator. */
  status: AccountStatus;
  /** Override the auto-derived aria-label (e.g. include the account index). */
  label?: string;
}

export function StatusLED({ status, label, ...rest }: StatusLEDProps) {
  const mapped: LedState = STATUS_TO_LED[status];
  return (
    <Led
      tone={mapped.tone}
      pattern={mapped.pattern}
      label={label ?? mapped.label}
      {...rest}
    />
  );
}

/* =============================================================================
 * <ProgressLED>
 *
 * Replaces V1's `ProgressPips`. Renders `total` pips in a row where:
 *
 *   - index < completed            → success + steady (glowing)
 *   - index === current            → running + pulse
 *   - index === errorAt            → error + fast-blink
 *   - otherwise                    → idle + steady (no halo)
 *
 * The pip that *just* transitioned to completed replays the pop
 * (`pipFill`, brief §3 `progress-pip-fill`).
 *
 * Example:
 *   <ProgressLED total={10} completed={3} showCount />   →   ●●●○○○○○○○ 3/10
 * =========================================================================== */

export interface ProgressLEDProps {
  /** How many pips in the row. */
  total: number;
  /** How many have been marked complete. Clamped to [0, total]. */
  completed: number;
  /**
   * Index currently in flight (will render as running + pulse). Defaults to
   * `completed` when `completed < total`, otherwise -1 (no current pip).
   */
  current?: number;
  /** Error index — renders a hard-blinking rose pip. */
  errorAt?: number;
  /** Pip size. `sm` (8px) is the dense default — fleet rows pack tightly. */
  size?: LedSize;
  /** Show " N/M" after the pips in mono-data style. */
  showCount?: boolean;
  /** Group-level aria-label. */
  label?: string;
  className?: string;
}

export function ProgressLED({
  total,
  completed,
  current,
  errorAt,
  size = "sm",
  showCount = false,
  label,
  className,
}: ProgressLEDProps) {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeCompleted = Math.max(
    0,
    Math.min(safeTotal, Math.floor(completed)),
  );
  const currentIdx =
    current ?? (safeCompleted < safeTotal ? safeCompleted : -1);
  const errIdx = typeof errorAt === "number" ? Math.floor(errorAt) : -1;

  /* Detect which pip just transitioned to completed — the only one that
   * replays `pipFill`. We stash it in a ref rather than state so the
   * animation fires in the same commit as the data update. */
  const prevCompleted = useRef(safeCompleted);
  const justFilledIdx = useRef<number>(-1);
  if (safeCompleted > prevCompleted.current) {
    justFilledIdx.current = safeCompleted - 1;
  } else if (safeCompleted < prevCompleted.current) {
    justFilledIdx.current = -1;
  }
  useEffect(() => {
    prevCompleted.current = safeCompleted;
    // Clear the pop marker after one animation duration so a re-render
    // triggered by sibling state updates doesn't double-play it.
    const t = window.setTimeout(() => {
      justFilledIdx.current = -1;
    }, 320);
    return () => window.clearTimeout(t);
  }, [safeCompleted]);

  const pips: ReactNode[] = [];
  for (let i = 0; i < safeTotal; i++) {
    let tone: LedTone = "idle";
    let pattern: LedPattern = "steady";
    if (errIdx >= 0 && i === errIdx) {
      tone = "error";
      pattern = "fast-blink";
    } else if (i < safeCompleted) {
      tone = "success";
      pattern = "steady";
    } else if (i === currentIdx) {
      tone = "running";
      pattern = "pulse";
    }
    pips.push(
      <Led
        key={i}
        tone={tone}
        pattern={pattern}
        size={size}
        glow={tone !== "idle"}
        className={cn(
          justFilledIdx.current === i ? styles.pipJustFilled : undefined,
        )}
      />,
    );
  }

  return (
    <span
      role="group"
      aria-label={label ?? `Progress ${safeCompleted} of ${safeTotal}`}
      className={cn(styles.progress, className)}
    >
      {pips}
      {showCount && (
        <span className={styles.progressCount} aria-hidden="true">
          {safeCompleted}/{safeTotal}
        </span>
      )}
    </span>
  );
}

export default Led;
