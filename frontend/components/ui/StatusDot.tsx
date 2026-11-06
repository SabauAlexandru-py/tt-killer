import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type StatusTone = "default" | "accent" | "warn" | "error" | "info" | "muted";

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  /** When true, dot pulses via the `pulse` keyframe defined in globals.css. */
  pulse?: boolean;
  /** Accessible label — screen-reader only. */
  label?: string;
}

const TONE_CLASSES: Record<StatusTone, string> = {
  default: "bg-[var(--text-secondary)]",
  accent: "bg-[var(--accent)]",
  warn: "bg-[var(--warn)]",
  error: "bg-[var(--error)]",
  info: "bg-[var(--info)]",
  muted: "bg-[var(--text-muted)]",
};

const TONE_SHADOW: Record<StatusTone, string> = {
  default: "shadow-[0_0_0_2px_oklch(0.72_0_0/0.15)]",
  accent: "shadow-[0_0_0_2px_var(--accent-bg)]",
  warn: "shadow-[0_0_0_2px_var(--warn-bg)]",
  error: "shadow-[0_0_0_2px_var(--error-bg)]",
  info: "shadow-[0_0_0_2px_var(--info-bg)]",
  muted: "shadow-none",
};

/**
 * 8px circular status indicator. Pulse animation is defined in globals.css as
 * `@keyframes pulse { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.3); opacity: 0 } }`
 * per spec — a 2s loop, applied only when `pulse` is true.
 */
const StatusDot = forwardRef<HTMLSpanElement, StatusDotProps>(function StatusDot(
  { tone = "default", pulse = false, label, className, style, ...rest },
  ref,
) {
  const inlinePulseStyle = pulse
    ? { animation: "pulse 2s cubic-bezier(0.16, 1, 0.3, 1) infinite", ...style }
    : style;
  return (
    <span
      ref={ref}
      role={label ? "status" : undefined}
      aria-label={label}
      className={cn(
        "inline-block h-2 w-2 rounded-full shrink-0",
        TONE_CLASSES[tone],
        pulse && TONE_SHADOW[tone],
        className,
      )}
      style={inlinePulseStyle}
      {...rest}
    />
  );
});

export default StatusDot;
