"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Optional label rendered to the right of the box. */
  label?: ReactNode;
  /** Optional description under the label. */
  description?: ReactNode;
}

const BOX_BASE = [
  "relative inline-flex items-center justify-center shrink-0",
  "h-4 w-4", // 16px — matches spec
  "rounded-[var(--radius-sm)] border",
  "bg-[var(--bg-surface)] border-[var(--border-strong)]",
  "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
  "peer-hover:border-[var(--text-secondary)]",
  "peer-checked:bg-[var(--accent)] peer-checked:border-[var(--accent)]",
  "peer-indeterminate:bg-[var(--accent)] peer-indeterminate:border-[var(--accent)]",
  "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2",
  "peer-focus-visible:outline-[var(--border-focus)]",
  "peer-disabled:opacity-50 peer-disabled:cursor-not-allowed",
].join(" ");

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, className, id, disabled, ...rest },
  ref,
) {
  const inputId = id ?? (label ? `cbx-${Math.random().toString(36).slice(2, 8)}` : undefined);

  const box = (
    <span className={cn("inline-flex relative", className)}>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        disabled={disabled}
        className="peer sr-only"
        {...rest}
      />
      <span className={BOX_BASE} aria-hidden="true">
        {/* Checkmark — rendered only when :checked via sibling selector trick: */}
        <svg
          viewBox="0 0 16 16"
          className="h-3 w-3 text-[oklch(0.145_0_0)] opacity-0 peer-checked:opacity-100 pointer-events-none absolute"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ display: "none" }}
        >
          <polyline points="3.5 8.5 7 12 13 4" />
        </svg>
      </span>
      {/* Overlay the check mark via peer state — placed OUTSIDE the box so peer-checked resolves. */}
      <svg
        viewBox="0 0 16 16"
        className={cn(
          "pointer-events-none absolute left-0 top-0 h-4 w-4 p-[2px]",
          "text-[oklch(0.145_0_0)]",
          "opacity-0 peer-checked:opacity-100",
          "transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        )}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="3 8.5 6.5 12 13 4" />
      </svg>
    </span>
  );

  if (!label && !description) return box;

  return (
    <label
      htmlFor={inputId}
      className={cn(
        "flex items-start gap-2 cursor-pointer select-none",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      {box}
      <span className="flex flex-col gap-0.5 leading-tight">
        {label ? (
          <span className="text-[13px] text-[var(--text-primary)]">{label}</span>
        ) : null}
        {description ? (
          <span className="text-[12px] text-[var(--text-muted)]">{description}</span>
        ) : null}
      </span>
    </label>
  );
});

export default Checkbox;
