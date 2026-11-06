"use client";

/**
 * LogLine — a single terminal row in the log stream.
 *
 * Shape (spec): `[HH:MM:SS.mmm] [profile-id] [level] message`
 *
 * Level → color (ANSI-style, dark mode primary):
 *   error / critical / fatal → `--error`
 *   warn  / warning          → `--warn`
 *   info                     → `--accent`
 *   debug / trace / else     → `--text-muted`
 *
 * Memoized because the stream flips rows often and we don't want the whole
 * list re-rendering on every incoming message.
 */

import { memo } from "react";
import { cn } from "@/lib/cn";

export interface LogRow {
  /** Unix epoch seconds (float) — same shape as backend `LogLinePayload.ts`. */
  ts: number;
  /** Raw level string from the backend (case-insensitive). */
  level: string;
  /**
   * The profile id for this line. Falls back to the `logger` name when no
   * explicit `profile_id` was emitted, and to `null` for system lines.
   */
  profileId: string | null;
  message: string;
  /** Stable key for list rendering — monotonic seq + ts. */
  key: string;
}

export interface LogLineProps {
  row: LogRow;
}

/** Local-time `HH:MM:SS.mmm`. 24h, zero-padded. */
function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** Map backend level → CSS variable string. */
function levelColorVar(level: string): string {
  const l = level.toLowerCase();
  if (l === "error" || l === "critical" || l === "fatal") {
    return "var(--error)";
  }
  if (l === "warn" || l === "warning") return "var(--warn)";
  if (l === "info") return "var(--accent)";
  // debug, trace, notset, anything unknown → muted
  return "var(--text-muted)";
}

function LogLineImpl({ row }: LogLineProps) {
  const color = levelColorVar(row.level);
  const profile = row.profileId ?? "—";
  const levelLabel = row.level.toLowerCase().slice(0, 5);

  return (
    <div
      role="row"
      // whitespace-pre + break-all keeps the fixed-width header columns
      // intact while letting long messages wrap inside the flex child.
      className={cn(
        "font-mono-log",
        "flex items-baseline gap-2",
        "px-3 py-[1px] whitespace-pre",
      )}
      style={{ color: "var(--text-secondary)" }}
    >
      <span
        className="shrink-0 select-none"
        style={{ color: "var(--text-muted)" }}
      >
        [{formatTs(row.ts)}]
      </span>
      <span
        className="shrink-0 select-text max-w-[180px] truncate"
        style={{ color: "var(--text-muted)" }}
        title={profile}
      >
        [{profile}]
      </span>
      <span
        className="shrink-0 uppercase tracking-[0.04em]"
        style={{ color }}
        aria-label={`level ${row.level.toLowerCase()}`}
      >
        [{levelLabel}]
      </span>
      <span
        className="min-w-0 flex-1 break-words whitespace-pre-wrap"
        style={{ color: "var(--text-primary)" }}
      >
        {row.message}
      </span>
    </div>
  );
}

const LogLine = memo(LogLineImpl);
export default LogLine;
