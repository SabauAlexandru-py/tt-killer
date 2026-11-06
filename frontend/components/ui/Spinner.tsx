import type { SVGProps } from "react";
import { cn } from "@/lib/cn";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps extends Omit<SVGProps<SVGSVGElement>, "size"> {
  size?: SpinnerSize;
  /** Override the stroke color. Defaults to currentColor so it inherits from the parent. */
  tone?: "current" | "muted" | "accent";
}

const SIZE_MAP: Record<SpinnerSize, number> = {
  sm: 12,
  md: 16,
  lg: 20,
};

const TONE_MAP: Record<NonNullable<SpinnerProps["tone"]>, string> = {
  current: "text-current",
  muted: "text-[var(--text-muted)]",
  accent: "text-[var(--accent)]",
};

/**
 * Compact SVG spinner. Spins via CSS `animation: spin` (Tailwind's built-in),
 * no keyframe injection needed. Uses a 90° arc so the motion reads clearly
 * even at 12px.
 */
export default function Spinner({
  size = "md",
  tone = "current",
  className,
  ...rest
}: SpinnerProps) {
  const px = SIZE_MAP[size];
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
      className={cn("animate-spin shrink-0", TONE_MAP[tone], className)}
      {...rest}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2.5"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
