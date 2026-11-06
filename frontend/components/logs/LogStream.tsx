"use client";

/**
 * LogStream — the virtualized monospace log viewer in the center pane.
 *
 * Virtualization strategy:
 *   The spec asks for a "simple slice" window of the last 500 rows. We don't
 *   bring in react-window — rendering 500 memoized `<LogLine>` rows is fine
 *   at 60fps on real machines, and we stay dependency-free so Vercel cold
 *   starts don't inherit another tree.
 *
 * Auto-scroll:
 *   The viewer sticks to the bottom as new lines arrive. If the operator
 *   scrolls up more than `AUTOSCROLL_EPSILON_PX` away from the floor, the
 *   "⏸ paused — click to resume" badge appears at the top. Clicking it, or
 *   scrolling back to the bottom manually, resumes auto-scroll.
 *
 * Intentional omissions:
 *   • No row dividers, no alternating backgrounds — the viewer reads as a
 *     terminal, not a table.
 *   • `aria-live="polite"` on the log container so screen readers announce
 *     new lines when the user is at rest; the "paused" badge is a button
 *     with a clear label for keyboard access.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import LogLine, { type LogRow } from "./LogLine";
import { cn } from "@/lib/cn";

/** Hard cap on rows ever rendered — spec requirement. */
export const LOG_STREAM_MAX_ROWS = 500;

/** How close to the bottom (in px) counts as "stuck to bottom". */
const AUTOSCROLL_EPSILON_PX = 24;

export interface LogStreamProps {
  /**
   * Accumulated log rows (already filtered). The component renders at most
   * the last `LOG_STREAM_MAX_ROWS`; any upstream buffer may be larger.
   */
  lines: LogRow[];
  /** Optional empty-state node rendered when `lines` is empty. */
  emptyState?: ReactNode;
  className?: string;
}

export default function LogStream({
  lines,
  emptyState,
  className,
}: LogStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  // Window the tail: slice the last N rows. Cheap — React re-uses keys and
  // `<LogLine>` is memoized, so only the new row mounts on each push.
  const visible = useMemo<LogRow[]>(() => {
    if (lines.length <= LOG_STREAM_MAX_ROWS) return lines;
    return lines.slice(lines.length - LOG_STREAM_MAX_ROWS);
  }, [lines]);

  /**
   * Flip `paused` based on the viewport's distance from the bottom. Called
   * from `onScroll`; passive by default.
   */
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= AUTOSCROLL_EPSILON_PX;
    setPaused((prev) => (prev === !atBottom ? prev : !atBottom));
  }, []);

  // Pin to the bottom on every new slice — only when not paused.
  // useLayoutEffect so the paint and the scroll land in the same frame.
  useLayoutEffect(() => {
    if (paused) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visible, paused]);

  // When the list is empty, we're at the bottom by definition.
  useEffect(() => {
    if (lines.length === 0 && paused) setPaused(false);
  }, [lines.length, paused]);

  // Programmatic resume from the badge click.
  const resume = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setPaused(false);
  }, []);

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 w-full flex-col",
        "bg-[var(--bg-base)]",
        "border-t border-[var(--border)]",
        className,
      )}
    >
      {paused ? (
        <button
          type="button"
          onClick={resume}
          aria-label="Resume log auto-scroll"
          className={cn(
            "absolute left-1/2 top-2 z-10 -translate-x-1/2",
            "inline-flex items-center gap-2",
            "h-6 px-3",
            "rounded-[var(--radius-sm)] border",
            "bg-[var(--warn-bg)] text-[var(--warn)] border-[var(--warn-border)]",
            "text-[11px] leading-none font-medium tracking-[0.02em]",
            "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
            "hover:bg-[var(--warn)] hover:text-[var(--bg-base)]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
            "focus-visible:outline-[var(--border-focus)]",
          )}
        >
          <span aria-hidden="true">⏸</span>
          <span>paused — click to resume</span>
        </button>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-atomic="false"
        className={cn(
          "flex-1 min-h-0",
          "overflow-y-auto overflow-x-hidden",
          "py-2",
        )}
      >
        {visible.length === 0 ? (
          <div
            className="h-full w-full flex items-center justify-center font-mono-log"
            style={{ color: "var(--text-muted)" }}
          >
            {emptyState ?? "no log lines yet"}
          </div>
        ) : (
          visible.map((row) => <LogLine key={row.key} row={row} />)
        )}
      </div>
    </div>
  );
}
