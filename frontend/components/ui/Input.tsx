"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type InputVariant = "default" | "mono";
export type InputTone = "default" | "error";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  variant?: InputVariant;
  tone?: InputTone;
  /** Prefix node rendered inside the input (search icon, $ sign, etc). */
  leading?: ReactNode;
  /** Suffix node rendered inside the input (unit, clear button, etc). */
  trailing?: ReactNode;
}

const WRAPPER_BASE = [
  "flex items-center gap-2",
  "h-9 w-full",
  "rounded-[var(--radius)] border",
  "bg-[var(--bg-surface)]",
  "px-3",
  "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
  "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2",
  "focus-within:outline-[var(--border-focus)]",
].join(" ");

const WRAPPER_TONE: Record<InputTone, string> = {
  default: "border-[var(--border)] hover:border-[var(--border-strong)]",
  error: "border-[var(--error-border)] hover:border-[var(--error)]",
};

const INPUT_BASE = [
  "flex-1 min-w-0 h-full",
  "bg-transparent border-0 outline-none",
  "text-[13px] leading-none",
  "text-[var(--text-primary)]",
  "placeholder:text-[var(--text-muted)]",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

const VARIANT_CLASSES: Record<InputVariant, string> = {
  default: "font-sans",
  mono: "font-mono tabular-nums tracking-tight",
};

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    variant = "default",
    tone = "default",
    leading,
    trailing,
    className,
    disabled,
    "aria-invalid": ariaInvalid,
    ...rest
  },
  ref,
) {
  const resolvedTone: InputTone = ariaInvalid ? "error" : tone;
  return (
    <div
      className={cn(
        WRAPPER_BASE,
        WRAPPER_TONE[resolvedTone],
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      {leading ? (
        <span className="shrink-0 text-[var(--text-muted)] flex items-center">
          {leading}
        </span>
      ) : null}
      <input
        ref={ref}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        className={cn(INPUT_BASE, VARIANT_CLASSES[variant])}
        {...rest}
      />
      {trailing ? (
        <span className="shrink-0 text-[var(--text-muted)] flex items-center">
          {trailing}
        </span>
      ) : null}
    </div>
  );
});

export default Input;
