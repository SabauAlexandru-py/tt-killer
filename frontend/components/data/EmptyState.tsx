"use client";

/**
 * EmptyState — text-driven, no illustration.
 *
 * Centered title + description, optional primary action.
 * Used inside DataTable (empty prop), dashboard panels, inspector tabs.
 *
 * NO cartoon SVGs. NO giant icons. The design direction is trading-terminal:
 * state is communicated through typography, not whimsy.
 */

import * as React from "react";
import clsx from "clsx";

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
  /** Default: "primary". "secondary" drops the accent background. */
  variant?: "primary" | "secondary";
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  primaryAction?: EmptyStateAction;
  /** Smaller vertical padding — for use inside already-constrained containers. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  title,
  description,
  primaryAction,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "flex w-full flex-col items-center justify-center text-center",
        compact ? "px-4 py-8" : "px-6 py-16",
        className
      )}
    >
      <div
        className="font-semibold"
        style={{
          color: "var(--text-primary)",
          fontSize: "14px",
          lineHeight: 1.4,
          letterSpacing: "0.01em",
        }}
      >
        {title}
      </div>

      {description && (
        <p
          className="mt-2 max-w-sm"
          style={{
            color: "var(--text-muted)",
            fontSize: "12px",
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}

      {primaryAction && (
        <div className="mt-5">
          <EmptyActionButton action={primaryAction} />
        </div>
      )}
    </div>
  );
}

function EmptyActionButton({ action }: { action: EmptyStateAction }) {
  const variant = action.variant ?? "primary";

  const className = clsx(
    "inline-flex items-center justify-center rounded-md border px-4 font-semibold transition-colors",
    "focus-visible:outline-none"
  );

  const baseStyle: React.CSSProperties = {
    height: "var(--row-button)",
    fontSize: "13px",
    lineHeight: 1,
    transitionDuration: "var(--dur-fast)",
    transitionTimingFunction: "var(--ease-out)",
  };

  const variantStyle: React.CSSProperties =
    variant === "primary"
      ? {
          backgroundColor: "var(--accent-bg)",
          borderColor: "var(--accent-border)",
          color: "var(--accent)",
        }
      : {
          backgroundColor: "var(--bg-raised)",
          borderColor: "var(--border)",
          color: "var(--text-primary)",
        };

  const style: React.CSSProperties = { ...baseStyle, ...variantStyle };

  if (action.href) {
    return (
      <a href={action.href} className={className} style={style}>
        {action.label}
      </a>
    );
  }

  return (
    <button type="button" onClick={action.onClick} className={className} style={style}>
      {action.label}
    </button>
  );
}
