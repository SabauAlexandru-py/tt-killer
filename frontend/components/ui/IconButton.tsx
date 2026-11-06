"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import Spinner from "./Spinner";
import type { ButtonVariant } from "./Button";

export type IconButtonSize = "sm" | "default" | "lg";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: IconButtonSize;
  loading?: boolean;
  /** Required for a11y — all icon-only controls need a label. */
  "aria-label": string;
  children?: ReactNode;
}

const BASE_CLASSES = [
  "inline-flex items-center justify-center shrink-0",
  "rounded-[var(--radius)] border",
  "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
  "focus-visible:outline-[var(--border-focus)]",
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
].join(" ");

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default: [
    "bg-[var(--bg-surface)] text-[var(--text-secondary)]",
    "border-[var(--border)]",
    "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]",
    "active:bg-[var(--bg-raised)]",
  ].join(" "),
  primary: [
    "bg-[var(--accent)] text-[oklch(0.145_0_0)]",
    "border-[var(--accent)]",
    "hover:brightness-110 active:brightness-95",
  ].join(" "),
  ghost: [
    "bg-transparent text-[var(--text-muted)]",
    "border-transparent",
    "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
  ].join(" "),
  danger: [
    "bg-[var(--error-bg)] text-[var(--error)]",
    "border-[var(--error-border)]",
    "hover:bg-[var(--error)] hover:text-[oklch(0.98_0_0)]",
  ].join(" "),
};

/** Square dimensions matching the Button heights. */
const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: "h-8 w-8",
  default: "h-9 w-9",
  lg: "h-11 w-11",
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    variant = "ghost",
    size = "default",
    loading = false,
    disabled,
    children,
    className,
    type = "button",
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className)}
      {...rest}
    >
      {loading ? <Spinner size="sm" tone="current" /> : children}
    </button>
  );
});

export default IconButton;
