import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type KbdSize = "sm" | "default";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  size?: KbdSize;
  children: ReactNode;
}

const BASE_CLASSES = [
  "inline-flex items-center justify-center",
  "font-mono tabular-nums",
  "rounded-[var(--radius-sm)] border",
  "bg-[var(--bg-raised)] text-[var(--text-secondary)]",
  "border-[var(--border)]",
  "border-b-[var(--border-strong)]",
  "whitespace-nowrap select-none",
  "px-1.5",
].join(" ");

const SIZE_CLASSES: Record<KbdSize, string> = {
  sm: "h-4 text-[10px] min-w-[16px]",
  default: "h-5 text-[11px] min-w-[20px]", // 20px tall — matches spec
};

/**
 * Keyboard key pill. Use for shortcut hints like ⌘K, Esc, /.
 * Designed to sit inside Pills, tooltips, or inline with body copy.
 */
const Kbd = forwardRef<HTMLElement, KbdProps>(function Kbd(
  { size = "default", children, className, ...rest },
  ref,
) {
  return (
    <kbd
      ref={ref}
      className={cn(BASE_CLASSES, SIZE_CLASSES[size], className)}
      {...rest}
    >
      {children}
    </kbd>
  );
});

export default Kbd;
