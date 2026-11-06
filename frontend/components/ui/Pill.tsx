import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type PillTone = "default" | "muted" | "accent" | "warn" | "error" | "info";

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  /** Optional leading icon node. */
  icon?: ReactNode;
  children?: ReactNode;
}

const BASE_CLASSES = [
  "inline-flex items-center gap-1",
  "h-5", // 20px tall — matches spec
  "px-2",
  "rounded-[var(--radius-sm)] border",
  "text-[11px] leading-none font-medium",
  "whitespace-nowrap",
  "tracking-[0.02em]",
].join(" ");

const TONE_CLASSES: Record<PillTone, string> = {
  default: [
    "bg-[var(--bg-raised)] text-[var(--text-secondary)]",
    "border-[var(--border)]",
  ].join(" "),
  muted: [
    "bg-[var(--bg-surface)] text-[var(--text-muted)]",
    "border-[var(--border)]",
  ].join(" "),
  accent: [
    "bg-[var(--accent-bg)] text-[var(--accent)]",
    "border-[var(--accent-border)]",
  ].join(" "),
  warn: [
    "bg-[var(--warn-bg)] text-[var(--warn)]",
    "border-[var(--warn-border)]",
  ].join(" "),
  error: [
    "bg-[var(--error-bg)] text-[var(--error)]",
    "border-[var(--error-border)]",
  ].join(" "),
  info: [
    "bg-[var(--info-bg)] text-[var(--info)]",
    "border-[var(--info-border)]",
  ].join(" "),
};

const Pill = forwardRef<HTMLSpanElement, PillProps>(function Pill(
  { tone = "default", icon, children, className, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(BASE_CLASSES, TONE_CLASSES[tone], className)}
      {...rest}
    >
      {icon ? <span className="flex items-center shrink-0">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
});

export default Pill;
