"use client";

/**
 * MetricCard — top-of-dashboard readout.
 *
 *   ┌────────────────────────────┐
 *   │ · LABEL              • LED │  ← dot + 12px uppercase · corner LED
 *   │                            │
 *   │  128                       │  ← display 32px / 700 / tabular, tweened
 *   │                            │
 *   │ +12 last 24h               │  ← mono-data sublabel
 *   └────────────────────────────┘
 *
 * One card per metric on the dashboard metrics row. Numbers are rendered in
 * the display scale with tabular-nums so a changing count doesn't reflow.
 *
 * Tone is advisory: the border stays neutral so the row reads as a single
 * strip of numbers rather than a confetti of coloured chips. The small
 * StatusDot next to the label keeps the long-form semantic (matches the
 * vocabulary RunCard uses), while the new corner LED is a glanceable "is
 * this metric live right now?" signal at the top-right — mirrors the same
 * tone/pulse the parent passes.
 *
 * Motion added in this refresh:
 *   - Numeric values tween via `useCountUp` (ease-out-cubic, 600ms).
 *   - Each delta also flashes `--accent-bg` over the card background for
 *     400ms via an absolutely-positioned overlay that fades to 0 on an
 *     ease-out curve. The overlay is keyed by a flash counter so a
 *     rapid-fire series of SSE ticks restarts the animation instead of
 *     stacking.
 *   - `useReducedMotion` short-circuits the tween and the flash so the OS
 *     accessibility preference actually gets honoured — the card still
 *     redraws, just instantly.
 *
 * Non-goals (Mission Control stays dense):
 *   - No gradients. No decorative drop-shadows. The LED uses a tone-tinted
 *     ring — same pattern StatusDot already relies on — so the dashboard
 *     keeps its trading-terminal character.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import StatusDot, { type StatusTone } from "@/components/ui/StatusDot";
import { cn } from "@/lib/cn";
import { useCountUp } from "@/lib/useCountUp";
import { useReducedMotion } from "@/lib/useReducedMotion";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricCardProps {
  /** Short all-caps label — e.g. "Proxies", "Signups 24h". */
  label: string;
  /**
   * Primary readout. Numbers get the `useCountUp` tween; anything else
   * (ReactNode, formatted strings, "N/A") is rendered directly so callers
   * can still pass "128,042" with a thousand-separator when they want one.
   */
  value: ReactNode;
  /**
   * Optional sublabel below the big number. Rendered in mono-data so deltas
   * like "+12 last 24h" line up across cards.
   */
  sublabel?: ReactNode;
  /** Optional tone — picks the status-dot colour next to the label AND the
   *  corner LED colour. */
  tone?: StatusTone;
  /** Pulse both the status dot and the corner LED (used for live/in-flight
   *  counts). Gets suppressed when prefers-reduced-motion is on. */
  pulse?: boolean;
  /** Loading state renders a shimmer placeholder for the value. */
  loading?: boolean;
  /**
   * When true, the first time the card renders with a resolved numeric value
   * it tweens from 0 → target over 600ms. Opt-in because dashboards that
   * refetch mid-hover should land on the exact number — only the
   * initial-mount moment wants the "spin up" effect.
   */
  animateInitial?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// LED tone mapping
// ---------------------------------------------------------------------------

/** Explicit tone → LED colour tokens. Keeps the switch exhaustive and lets us
 *  render an "idle" LED when the parent didn't pass a tone. */
const LED_COLORS: Record<Exclude<StatusTone, "muted" | "default">, {
  core: string;
  halo: string;
}> = {
  accent: { core: "var(--accent)", halo: "var(--accent-bg)" },
  warn: { core: "var(--warn)", halo: "var(--warn-bg)" },
  error: { core: "var(--error)", halo: "var(--error-bg)" },
  info: { core: "var(--info)", halo: "var(--info-bg)" },
};

const LED_IDLE = {
  core: "var(--text-muted)",
  halo: "oklch(0.72 0 0 / 0.12)",
};

function resolveLed(tone: StatusTone | undefined) {
  if (!tone || tone === "default" || tone === "muted") return LED_IDLE;
  return LED_COLORS[tone];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const FLASH_MS = 400;

export function MetricCard({
  label,
  value,
  sublabel,
  tone,
  pulse = false,
  loading = false,
  animateInitial = false,
  className,
}: MetricCardProps) {
  const reducedMotion = useReducedMotion();

  const isNumeric = typeof value === "number";
  const numericTarget = isNumeric ? (value as number) : 0;

  // Tween integers; hold ReactNode values as-is.
  const animatedNumber = useCountUp(numericTarget, {
    disabled: !isNumeric || loading,
    animateInitial,
  });
  const displayValue: ReactNode = isNumeric ? animatedNumber : value;

  // Flash --accent-bg on delta change. A keyed overlay re-mounts on each
  // flash so rapid SSE ticks don't get swallowed by an already-running
  // animation.
  const [flashing, setFlashing] = useState<boolean>(false);
  const [flashKey, setFlashKey] = useState<number>(0);
  const prevNumeric = useRef<number | null>(null);

  useEffect(() => {
    if (!isNumeric) {
      prevNumeric.current = null;
      return;
    }
    const prev = prevNumeric.current;
    prevNumeric.current = numericTarget;

    if (prev === null || prev === numericTarget) return;
    if (reducedMotion) return;

    setFlashKey((k) => k + 1);
    setFlashing(true);
    const timer = window.setTimeout(() => setFlashing(false), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [numericTarget, isNumeric, reducedMotion]);

  const led = resolveLed(tone);
  const ledIsPulsing = pulse && !reducedMotion;

  return (
    <section
      aria-label={label}
      className={cn(
        "relative flex flex-col justify-between min-w-0 overflow-hidden",
        className,
      )}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "16px 18px",
        gap: "12px",
        minHeight: "116px",
      }}
    >
      {/* Delta flash — absolute overlay keyed by flashKey so each tick
          starts its own animation. */}
      {flashing && !reducedMotion ? (
        <span
          key={flashKey}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--accent-bg)",
            borderRadius: "var(--radius)",
            animation: `metric-flash ${FLASH_MS}ms var(--ease-out) forwards`,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
      ) : null}

      {/* Corner LED — mirrors tone/pulse semantics from the parent. */}
      <span
        aria-hidden="true"
        className="metric-led"
        style={{
          position: "absolute",
          top: "12px",
          right: "14px",
          width: "12px",
          height: "12px",
          borderRadius: "999px",
          background: led.halo,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1,
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "999px",
            background: led.core,
            animation: ledIsPulsing
              ? "metric-led-pulse 2s var(--ease-smooth) infinite"
              : "none",
            boxShadow: tone
              ? `0 0 0 1px ${led.halo}`
              : "none",
          }}
        />
      </span>

      {/* Label row — small StatusDot keeps its label-side role; corner LED
          handles the far-right glance. */}
      <div
        className="flex items-center min-w-0"
        style={{
          gap: "8px",
          paddingRight: "20px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {tone ? <StatusDot tone={tone} pulse={pulse} /> : null}
        <span
          className="truncate"
          style={{
            fontSize: "12px",
            lineHeight: 1.4,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            fontWeight: 500,
          }}
        >
          {label}
        </span>
      </div>

      {/* Big number — tabular-nums, tweened. */}
      <div
        className="truncate"
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "32px",
          lineHeight: 1.1,
          fontWeight: 700,
          color: "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"tnum" 1, "zero" 1',
          letterSpacing: "-0.02em",
          position: "relative",
          zIndex: 1,
        }}
      >
        {loading ? (
          <span
            aria-hidden="true"
            className="inline-block motion-reduce:animate-none"
            style={{
              width: "3ch",
              height: "28px",
              borderRadius: "var(--radius-sm)",
              background:
                "linear-gradient(90deg, var(--bg-raised) 0%, var(--bg-hover) 50%, var(--bg-raised) 100%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.6s linear infinite",
              verticalAlign: "middle",
            }}
          />
        ) : (
          displayValue
        )}
      </div>

      {sublabel ? (
        <div
          className="truncate font-mono-data"
          style={{
            color: "var(--text-muted)",
            position: "relative",
            zIndex: 1,
          }}
        >
          {sublabel}
        </div>
      ) : (
        <div style={{ height: "18px" }} aria-hidden="true" />
      )}

      <style jsx global>{`
        @keyframes shimmer {
          from {
            background-position: 200% 0;
          }
          to {
            background-position: -200% 0;
          }
        }
        @keyframes metric-flash {
          0% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
        @keyframes metric-led-pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.45;
            transform: scale(1.35);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .metric-led > span {
            animation: none !important;
          }
        }
      `}</style>
    </section>
  );
}

export default MetricCard;
