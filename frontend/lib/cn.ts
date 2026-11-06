import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind-aware className joiner.
 * Dedupe conflicting utilities, drop falsy values, and preserve CSS variable
 * references like `bg-[var(--bg-surface)]`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
