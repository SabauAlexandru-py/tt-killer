"use client";

/**
 * ElapsedTimer — tabular-nums mono readout of wall-clock elapsed time.
 *
 *   mm:ss    under 1 hour
 *   h:mm:ss  1 hour or more
 *
 * Color drifts as the row overstays its welcome:
 *   - default         text-muted
 *   - elapsed ≥ 1.5× p50Seconds   --warn (amber)
 *   - elapsed ≥ 3×   p50Seconds   --error (rose)
 *
 * When a frozen `endedAt` is passed, the timer stops ticking and shows the
 * final duration. When `live` is false, the timer also stops — useful when
 * the parent page already froze state via a snapshot's updated_at.
 *
 * Timestamps are unix epoch seconds (float) to match RunSnapshot.created_at.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";

export interface ElapsedTimerProps {
  /** Unix epoch seconds when the row started. */
  startedAt: number;
  /** Unix epoch seconds when the row ended. If present, timer is frozen. */
  endedAt?: number | null;
  /** Expected p50 duration in seconds for threshold coloring. */
  p50Seconds?: number | null;
  /** Keep the timer ticking. Default: true. */
  live?: boolean;
  /** Optional aria-label override. */
  ariaLabel?: string;
  /** Extra class names on the outer span. */
  className?: string;
  /** Inline style overrides. */
  style?: CSSProperties;
}

export function ElapsedTimer({
  startedAt,
  endedAt = null,
  p50Seconds = null,
  live = true,
  ariaLabel,
  className,
  style,
}: ElapsedTimerProps) {
  // Initial "now" lands on epoch seconds the same unit startedAt uses.
  const [now, setNow] = useState<number>(() => Date.now() / 1000);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!live || endedAt != null) return;
    // Interval is fine: we only need per-second updates and setInterval drift
    // is invisible at 1Hz. Keep the handle in a ref so React 18 strict-mode
    // double-invoke clears properly.
    const id = window.setInterval(() => {
      setNow(Date.now() / 1000);
    }, 1000);
    rafRef.current = id;
    return () => window.clearInterval(id);
  }, [live, endedAt]);

  const elapsed = Math.max(0, (endedAt ?? now) - startedAt);
  const color = thresholdColor(elapsed, p50Seconds);
  const text = formatElapsed(elapsed);

  return (
    <span
      role="timer"
      aria-live={live && endedAt == null ? "off" : undefined}
      aria-label={ariaLabel ?? `Elapsed ${text}`}
      className={className}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        lineHeight: 1.5,
        fontVariantNumeric: "tabular-nums",
        fontFeatureSettings: '"tnum" 1, "zero" 1',
        color,
        transition: "color var(--dur-normal) var(--ease-out)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {text}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

function thresholdColor(
  elapsedSeconds: number,
  p50Seconds: number | null,
): string {
  if (p50Seconds == null || p50Seconds <= 0) return "var(--text-muted)";
  if (elapsedSeconds >= 3 * p50Seconds) return "var(--error)";
  if (elapsedSeconds >= 1.5 * p50Seconds) return "var(--warn)";
  return "var(--text-muted)";
}

function formatElapsed(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  if (h > 0) {
    return `${h}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export default ElapsedTimer;
