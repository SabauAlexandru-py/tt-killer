"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import Spinner from "./Spinner";

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "default" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner on the leading edge and disables interaction. */
  loading?: boolean;
  /** Optional leading icon node (lucide icon, svg, etc.). */
  icon?: ReactNode;
  /** Optional trailing icon node. */
  trailingIcon?: ReactNode;
  children?: ReactNode;
}

const BASE_CLASSES = [
  "inline-flex items-center justify-center gap-2",
  "font-medium whitespace-nowrap select-none",
  "rounded-[var(--radius)] border",
  "text-[13px] leading-none",
  "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
  "focus-visible:outline-[var(--border-focus)]",
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
].join(" ");

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default: [
    "bg-[var(--bg-surface)] text-[var(--text-primary)]",
    "border-[var(--border)]",
    "hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]",
    "active:bg-[var(--bg-raised)]",
  ].join(" "),
  primary: [
    "bg-[var(--accent)] text-[oklch(0.145_0_0)]",
    "border-[var(--accent)]",
    "hover:brightness-110 active:brightness-95",
  ].join(" "),
  ghost: [
    "bg-transparent text-[var(--text-secondary)]",
    "border-transparent",
    "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
    "active:bg-[var(--bg-raised)]",
  ].join(" "),
  danger: [
    "bg-[var(--error-bg)] text-[var(--error)]",
    "border-[var(--error-border)]",
    "hover:bg-[var(--error)] hover:text-[oklch(0.98_0_0)]",
  ].join(" "),
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3",
  default: "h-9 px-4",
  lg: "h-11 px-5 text-[14px] font-semibold",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "default",
    size = "default",
    loading = false,
    icon,
    trailingIcon,
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
      {loading ? <Spinner size="sm" tone="current" /> : icon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
});

export default Button;
