"use client";

import { forwardRef, type SelectHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SelectTone = "default" | "error";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  tone?: SelectTone;
  /** Convenience: pass option objects instead of children. */
  options?: SelectOption[];
  /** Optional placeholder rendered as a disabled first option. */
  placeholder?: string;
  children?: ReactNode;
}

const BASE_CLASSES = [
  "appearance-none",
  "flex items-center",
  "h-9 w-full",
  "rounded-[var(--radius)] border",
  "bg-[var(--bg-surface)] text-[var(--text-primary)]",
  "text-[13px] leading-none",
  "pl-3 pr-8 py-0",
  "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
  "focus-visible:outline-[var(--border-focus)]",
  "disabled:opacity-50 disabled:cursor-not-allowed",
].join(" ");

const TONE_CLASSES: Record<SelectTone, string> = {
  default: "border-[var(--border)] hover:border-[var(--border-strong)]",
  error: "border-[var(--error-border)] hover:border-[var(--error)]",
};

/**
 * Inline chevron data-URI. Uses `--text-muted` encoded so the arrow stays legible
 * on every surface without shipping an extra asset request.
 */
const CHEVRON_BG_IMAGE =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238c8c8c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")";

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    tone = "default",
    options,
    placeholder,
    children,
    className,
    "aria-invalid": ariaInvalid,
    ...rest
  },
  ref,
) {
  const resolvedTone: SelectTone = ariaInvalid ? "error" : tone;
  return (
    <select
      ref={ref}
      aria-invalid={ariaInvalid}
      className={cn(BASE_CLASSES, TONE_CLASSES[resolvedTone], className)}
      style={{
        backgroundImage: CHEVRON_BG_IMAGE,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
        backgroundSize: "12px 12px",
      }}
      {...rest}
    >
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options
        ? options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))
        : children}
    </select>
  );
});

export default Select;
