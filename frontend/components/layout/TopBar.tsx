"use client";

/**
 * TopBar — 48px bar pinned at the top of the Center column.
 *
 *   Left:  breadcrumb or page title + live-connection LED.
 *   Right: slot for actions (buttons, filters, search).
 *
 * V2 chrome: a tiny LED in the breadcrumb area tracks backend connectivity
 * via a global SSE subscription to `/stream/logs`:
 *   - Connected   → green breathing ("breathing" pattern).
 *   - Reconnecting → amber slow-pulse ("warning" pattern).
 *   - Disconnected → red fast-blink ("error" pattern — needs attention).
 *
 * The LED is purely informational — it does not surface the log payloads, it
 * just rides on the EventSource lifecycle to reflect whether the frontend is
 * reaching the backend right now. Reduced-motion fallbacks are handled
 * globally in `app/globals-v2.css` under
 * `@media (prefers-reduced-motion: reduce)`.
 *
 * DESIGN_SPEC § Layout: "TopBar inside Center: 48px".
 */

import { useMemo, type ReactNode } from "react";
import { useSSE } from "../../lib/sse";

export interface TopBarProps {
  /** Left side — usually a breadcrumb or short title string. */
  left?: ReactNode;
  /**
   * Convenience: if passed as a string, rendered as heading-sm; otherwise
   * uses `left`. Prefer `left` for custom nodes.
   */
  title?: string;
  /** Right slot — action buttons, filter chips, search field. */
  actions?: ReactNode;
  /** Children render as the LEFT content if `left` is not provided. */
  children?: ReactNode;
}

interface ConnectionLedView {
  className: string;
  label: string;
  describedBy: string;
}

/**
 * Maps the raw SSE state (connected flag + error) to one of three LED views.
 *
 * `error === null` + `connected === false` is treated as "connecting" — the
 * EventSource is between its first attempt and open. After the first error,
 * EventSource's native retry loop kicks in; we keep the LED on amber so the
 * operator sees "we're reaching for the backend" rather than a steady red
 * that would suggest a hard failure.
 */
function selectConnectionView(
  connected: boolean,
  error: string | null,
): ConnectionLedView {
  if (connected) {
    return {
      className: "led led--breathing",
      label: "Backend connected",
      describedBy: "SSE stream to /stream/logs is open.",
    };
  }
  if (error && error.includes("closed")) {
    return {
      className: "led led--error",
      label: "Backend disconnected",
      describedBy: "SSE stream to /stream/logs is closed.",
    };
  }
  return {
    className: "led led--warning",
    label: "Backend reconnecting",
    describedBy: "SSE stream to /stream/logs is reconnecting.",
  };
}

/**
 * Small, inline LED + tooltip that rides on the global `/stream/logs` SSE
 * subscription. Renders in the breadcrumb row so the operator always sees
 * backend liveness no matter which page they're on.
 */
function ConnectionLed() {
  const { connected, error } = useSSE<unknown>("/api/stream/logs");
  const view = useMemo(
    () => selectConnectionView(connected, error),
    [connected, error],
  );

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={view.label}
      title={`${view.label} — ${view.describedBy}`}
      className="inline-flex items-center"
      style={{ gap: "6px" }}
    >
      <span aria-hidden className={view.className} />
      <span className="sr-only">{view.describedBy}</span>
    </span>
  );
}

export function TopBar({ left, title, actions, children }: TopBarProps) {
  const leftContent =
    left ??
    (title ? (
      <span
        style={{
          fontSize: "14px",
          fontWeight: 600,
          color: "var(--text-primary)",
          letterSpacing: "-0.005em",
        }}
      >
        {title}
      </span>
    ) : (
      children ?? null
    ));

  return (
    <header
      role="toolbar"
      aria-label="Page toolbar"
      className="flex items-center justify-between sticky top-0 z-10"
      style={{
        height: "48px",
        paddingLeft: "20px",
        paddingRight: "16px",
        background: "var(--bg-base)",
        borderBottom: "1px solid var(--border)",
        gap: "16px",
      }}
    >
      <div
        className="flex items-center min-w-0"
        style={{ gap: "12px", flex: 1, minWidth: 0 }}
      >
        <ConnectionLed />
        {leftContent}
      </div>
      {actions && (
        <div
          className="flex items-center"
          style={{ gap: "8px", flexShrink: 0 }}
        >
          {actions}
        </div>
      )}
    </header>
  );
}
