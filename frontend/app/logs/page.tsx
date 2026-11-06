"use client";


export const dynamic = "force-dynamic";
/**
 * /logs — Mission Control center pane for the global log stream.
 *
 * Wiring:
 *   • `useSSE<LogLinePayload>('/stream/logs')` opens an EventSource at the
 *     configured backend (localStorage-aware via lib/api → lib/sse).
 *   • Each incoming payload is appended to an in-memory ring buffer capped
 *     at `BUFFER_MAX`. The LogStream itself slices the last 500 for render,
 *     so we keep a little extra headroom here for filter hits.
 *   • Filter state lives at the page level — LogFilterBar is a controlled
 *     view, LogStream is a dumb viewer.
 *
 * This page is deliberately simple. The three-pane layout wrapping lives
 * at a higher level (future `app/layout.tsx` nested group); here we fill
 * the center pane with a tiny header + filter bar + stream.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import LogStream from "@/components/logs/LogStream";
import LogFilterBar, {
  EMPTY_LOG_FILTER,
  type LogFilter,
} from "@/components/logs/LogFilterBar";
import type { LogRow } from "@/components/logs/LogLine";
import { useSSE } from "@/lib/sse";
import type { LogLinePayload } from "@/lib/types";
import { cn } from "@/lib/cn";

/** Upstream buffer size — a little larger than the rendered window. */
const BUFFER_MAX = 1000;

/**
 * Pull a profile id out of the payload. The backend emits `profile_id` on
 * per-account lines; system lines only carry `logger`. We fall back to the
 * logger name so system lines still filter sensibly.
 */
function pickProfileId(payload: LogLinePayload): string | null {
  const extras = payload as Record<string, unknown>;
  const pid = extras["profile_id"];
  if (typeof pid === "string" && pid.length > 0) return pid;
  if (typeof payload.logger === "string" && payload.logger.length > 0) {
    return payload.logger;
  }
  return null;
}

export default function LogsPage() {
  const { data, connected, error } = useSSE<LogLinePayload>("/stream/logs");

  const [rows, setRows] = useState<LogRow[]>([]);
  const [filter, setFilter] = useState<LogFilter>(EMPTY_LOG_FILTER);
  const seqRef = useRef(0);

  // Accumulate SSE payloads into the ring buffer.
  useEffect(() => {
    if (!data) return;
    seqRef.current += 1;
    const row: LogRow = {
      ts: typeof data.ts === "number" ? data.ts : Date.now() / 1000,
      level: typeof data.level === "string" ? data.level : "info",
      profileId: pickProfileId(data),
      message: typeof data.message === "string" ? data.message : "",
      key: `${seqRef.current}-${data.ts}`,
    };
    setRows((prev) => {
      const next = prev.length >= BUFFER_MAX ? prev.slice(1) : prev.slice();
      next.push(row);
      return next;
    });
  }, [data]);

  const availableProfileIds = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.profileId) seen.add(r.profileId);
    }
    return Array.from(seen).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = filter.grep.trim().toLowerCase();
    const level = filter.level.toLowerCase();
    const profileSet = new Set(filter.profileIds);
    const hasLevel = level !== "";
    const hasProfiles = profileSet.size > 0;
    const hasNeedle = needle !== "";

    if (!hasLevel && !hasProfiles && !hasNeedle) return rows;

    return rows.filter((r) => {
      if (hasLevel && r.level.toLowerCase() !== level) return false;
      if (hasProfiles) {
        if (!r.profileId || !profileSet.has(r.profileId)) return false;
      }
      if (hasNeedle && !r.message.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [rows, filter]);

  const statusColor = error
    ? "var(--error)"
    : connected
      ? "var(--accent)"
      : "var(--warn)";
  const statusLabel = error
    ? "disconnected"
    : connected
      ? "streaming"
      : "connecting…";

  return (
    <main
      className={cn(
        "flex h-dvh min-h-0 w-full flex-col",
        "bg-[var(--bg-base)]",
      )}
    >
      <header
        className={cn(
          "flex items-center justify-between",
          "h-12 px-4 shrink-0",
          "bg-[var(--bg-surface)] border-b border-[var(--border)]",
        )}
      >
        <div className="flex items-baseline gap-3">
          <h1
            className="text-[14px] font-semibold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            Logs
          </h1>
          <span
            className="font-mono-data"
            style={{ color: "var(--text-muted)" }}
          >
            /stream/logs
          </span>
        </div>
        <div className="flex items-center gap-2" aria-live="polite">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              backgroundColor: statusColor,
              animation: connected
                ? "pulse 2s var(--ease-out) infinite"
                : undefined,
            }}
            aria-hidden="true"
          />
          <span
            className="font-mono-data"
            style={{ color: "var(--text-secondary)" }}
          >
            {statusLabel}
          </span>
        </div>
      </header>

      <LogFilterBar
        value={filter}
        onChange={setFilter}
        availableProfileIds={availableProfileIds}
        totalCount={rows.length}
        visibleCount={filtered.length}
      />

      <LogStream
        lines={filtered}
        className="flex-1 min-h-0"
        emptyState={
          rows.length === 0
            ? connected
              ? "waiting for log lines…"
              : "no log stream — check backend URL in Settings"
            : "no lines match the current filter"
        }
      />
    </main>
  );
}
