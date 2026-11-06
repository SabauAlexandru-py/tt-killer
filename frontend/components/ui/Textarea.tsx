"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type TextareaHTMLAttributes,
  type ChangeEvent,
} from "react";
import { cn } from "@/lib/cn";

export type TextareaVariant = "default" | "mono";
export type TextareaTone = "default" | "error";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: TextareaVariant;
  tone?: TextareaTone;
  /** Auto-grow height to fit content between `minRows` and `maxRows`. */
  autoGrow?: boolean;
  minRows?: number;
  maxRows?: number;
}

const BASE_CLASSES = [
  "block w-full",
  "rounded-[var(--radius)] border",
  "bg-[var(--bg-surface)] text-[var(--text-primary)]",
  "placeholder:text-[var(--text-muted)]",
  "text-[13px] leading-[1.5]",
  "px-3 py-2",
  "resize-none",
  "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
  "focus-visible:outline-[var(--border-focus)]",
  "disabled:opacity-50 disabled:cursor-not-allowed",
].join(" ");

const TONE_CLASSES: Record<TextareaTone, string> = {
  default: "border-[var(--border)] hover:border-[var(--border-strong)]",
  error: "border-[var(--error-border)] hover:border-[var(--error)]",
};

const VARIANT_CLASSES: Record<TextareaVariant, string> = {
  default: "font-sans",
  mono: "font-mono tabular-nums",
};

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    variant = "default",
    tone = "default",
    autoGrow = false,
    minRows = 3,
    maxRows = 10,
    className,
    rows,
    value,
    defaultValue,
    onChange,
    "aria-invalid": ariaInvalid,
    ...rest
  },
  ref,
) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  // Expose the underlying textarea while keeping our ref available.
  useImperativeHandle(ref, () => localRef.current as HTMLTextAreaElement, []);

  const resize = useCallback(() => {
    const el = localRef.current;
    if (!el || !autoGrow) return;
    el.style.height = "auto";
    const lineHeight = 13 * 1.5; // matches text-[13px] leading-[1.5]
    const minPx = minRows * lineHeight + 16; // + vertical padding
    const maxPx = maxRows * lineHeight + 16;
    const next = Math.max(minPx, Math.min(maxPx, el.scrollHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
  }, [autoGrow, minRows, maxRows]);

  useEffect(() => {
    if (autoGrow) resize();
  }, [autoGrow, resize, value, defaultValue]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (autoGrow) resize();
    onChange?.(e);
  };

  const resolvedTone: TextareaTone = ariaInvalid ? "error" : tone;

  return (
    <textarea
      ref={localRef}
      rows={rows ?? minRows}
      value={value}
      defaultValue={defaultValue}
      onChange={handleChange}
      aria-invalid={ariaInvalid}
      className={cn(
        BASE_CLASSES,
        TONE_CLASSES[resolvedTone],
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    />
  );
});

export default Textarea;
