import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type SkeletonShape = "line" | "rect" | "circle" | "pill";

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  shape?: SkeletonShape;
  /** Pixel width — passes to CSS `width`. Omit to let the parent size it. */
  width?: number | string;
  /** Pixel height — passes to CSS `height`. Omit to use shape default. */
  height?: number | string;
  /** Disable the shimmer animation (useful inside non-visible panes). */
  static?: boolean;
}

const SHAPE_CLASSES: Record<SkeletonShape, string> = {
  line: "rounded-[var(--radius-sm)] h-3",
  rect: "rounded-[var(--radius)]",
  circle: "rounded-full",
  pill: "rounded-full h-5",
};

/**
 * Shimmer uses `shimmer` keyframe defined in globals.css:
 *   @keyframes shimmer { from { background-position: 200% 0 } to { background-position: -200% 0 } }
 * The gradient uses `--bg-raised` and `--bg-hover` so the animation tracks
 * the active theme. Fallbacks to a static --bg-raised tint if animation is
 * disabled (prefers-reduced-motion).
 */
const SHIMMER_STYLE = {
  background:
    "linear-gradient(90deg, var(--bg-raised) 0%, var(--bg-hover) 50%, var(--bg-raised) 100%)",
  backgroundSize: "200% 100%",
  animation: "shimmer 1.6s linear infinite",
} as const;

const STATIC_STYLE = {
  background: "var(--bg-raised)",
} as const;

const Skeleton = forwardRef<HTMLSpanElement, SkeletonProps>(function Skeleton(
  {
    shape = "line",
    width,
    height,
    static: isStatic = false,
    className,
    style,
    ...rest
  },
  ref,
) {
  const base = isStatic ? STATIC_STYLE : SHIMMER_STYLE;
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn(
        "block",
        SHAPE_CLASSES[shape],
        "motion-reduce:animate-none",
        className,
      )}
      style={{
        ...base,
        width,
        height,
        ...style,
      }}
      {...rest}
    />
  );
});

export default Skeleton;
