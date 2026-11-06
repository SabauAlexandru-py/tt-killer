"use client";


export const dynamic = "force-dynamic";
/**
 * /runs/[id] — Run detail.
 *
 * The hero page for an operator babysitting N parallel signups. It holds
 * two stacked panes inside the Center column:
 *
 *   Top     per-account list (one AccountRow per AccountResult)
 *   Bottom  live LogStream, 300px tall, pinned to the center floor
 *
 * The page hydrates with a TanStack Query fetch of `GET /api/runs/{id}` so
 * route-direct loads work, then subscribes to
 * `GET /api/stream/runs/{id}` (SSE) for sub-second liveness. SSE snapshots
 * supersede the query cache whenever they land; the query is kept around as
 * the hydration seed and the error channel.
 *
 * Nothing is wired to the Inspector pane yet — AccountRow.onSelect is the
 * hook. A later milestone will open the Inspector on click with the full
 * AccountResult and action buttons.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ThreePane } from "@/components/layout/ThreePane";
import { TopBar } from "@/components/layout/TopBar";
import { PageHeader } from "@/components/layout/PageHeader";
import Pill from "@/components/ui/Pill";
import StatusDot from "@/components/ui/StatusDot";
import Skeleton from "@/components/ui/Skeleton";
import { getRun } from "@/lib/api";
import { useSSE } from "@/lib/sse";
import { queryKeys } from "@/lib/queryKeys";
import { RUN_STATUS_COLORS } from "@/lib/tokens";
import type {
  AccountResult,
  LogLinePayload,
  RunSnapshot,
  RunStatus,
} from "@/lib/types";

import AccountRow from "@/components/runs/AccountRow";
import ElapsedTimer from "@/components/runs/ElapsedTimer";

/** Expected median duration of a signup, used to color the ElapsedTimer. */
const P50_SIGNUP_SECONDS = 180;

/** Max log lines kept in memory before the oldest are dropped. */
const LOG_BUFFER_MAX = 400;

/* -------------------------------------------------------------------------- */
/* page                                                                        */
/* -------------------------------------------------------------------------- */

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params?.id ?? "";

  // Hydration seed + error channel.
  const query = useQuery<RunSnapshot>({
    queryKey: queryKeys.runs.detail(runId),
    queryFn: ({ signal }) => getRun(runId, signal),
    enabled: runId.length > 0,
    staleTime: 2_000,
    refetchOnWindowFocus: false,
  });

  // Live stream — supersedes query cache when connected and emitting.
  const stream = useSSE<RunSnapshot>(`/api/stream/runs/${runId}`, {
    enabled: runId.length > 0,
  });

  const snapshot = stream.data ?? query.data ?? null;
  const loading = !snapshot && (query.isPending || query.isFetching);

  return (
    <ThreePane>
      <TopBar
        left={
          <Breadcrumb
            runId={runId}
            status={snapshot?.status ?? null}
            connected={stream.connected}
          />
        }
        actions={<StreamStatusTag connected={stream.connected} error={stream.error} />}
      />

      <PageHeader
        eyebrow={snapshot?.kind?.toUpperCase() ?? "RUN"}
        title={runId || "Loading…"}
        description={
          snapshot ? (
            <>
              {snapshot.results.length} account
              {snapshot.results.length === 1 ? "" : "s"} · last update{" "}
              <TimeAgo ts={snapshot.updated_at} />
            </>
          ) : null
        }
        actions={
          snapshot ? (
            <ElapsedTimer
              startedAt={snapshot.created_at}
              endedAt={
                snapshot.status === "running" ? null : snapshot.updated_at
              }
              live={snapshot.status === "running"}
              p50Seconds={P50_SIGNUP_SECONDS * Math.max(1, snapshot.results.length / 4)}
              style={{ fontSize: "16px" }}
            />
          ) : null
        }
      />

      <section
        aria-label="Run accounts and logs"
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateRows: "minmax(0, 1fr) 300px",
          padding: "16px 20px 20px",
          gap: "16px",
        }}
      >
        <AccountsPane
          snapshot={snapshot}
          loading={loading}
          error={query.error instanceof Error ? query.error.message : null}
        />
        <LogPane runId={runId} />
      </section>
    </ThreePane>
  );
}

/* -------------------------------------------------------------------------- */
/* breadcrumb + top-right stream tag                                           */
/* -------------------------------------------------------------------------- */

function Breadcrumb({
  runId,
  status,
  connected,
}: {
  runId: string;
  status: RunStatus | null;
  connected: boolean;
}) {
  const token = status ? RUN_STATUS_COLORS[status] : "muted";
  const pulse = connected && status === "running";
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "13px",
        color: "var(--text-secondary)",
      }}
    >
      <a
        href="/runs"
        style={{
          color: "var(--text-secondary)",
          transition: "color var(--dur-fast) var(--ease-out)",
        }}
      >
        Runs
      </a>
      <span aria-hidden="true" style={{ color: "var(--text-muted)" }}>
        /
      </span>
      <StatusDot tone={token} pulse={pulse} label={status ?? "unknown"} />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {runId}
      </span>
    </nav>
  );
}

function StreamStatusTag({
  connected,
  error,
}: {
  connected: boolean;
  error: string | null;
}) {
  if (error && !connected) {
    return (
      <Pill tone="error" icon={<StatusDot tone="error" />}>
        stream: {error}
      </Pill>
    );
  }
  if (connected) {
    return (
      <Pill tone="accent" icon={<StatusDot tone="accent" pulse />}>
        live
      </Pill>
    );
  }
  return (
    <Pill tone="warn" icon={<StatusDot tone="warn" />}>
      connecting…
    </Pill>
  );
}

function TimeAgo({ ts }: { ts: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 5_000);
    return () => window.clearInterval(id);
  }, []);
  const delta = Math.max(0, Math.round(now - ts));
  if (delta < 5) return <span>just now</span>;
  if (delta < 60) return <span>{delta}s ago</span>;
  const mins = Math.floor(delta / 60);
  if (mins < 60) return <span>{mins}m ago</span>;
  const h = Math.floor(mins / 60);
  return <span>{h}h ago</span>;
}

/* -------------------------------------------------------------------------- */
/* accounts pane                                                               */
/* -------------------------------------------------------------------------- */

function AccountsPane({
  snapshot,
  loading,
  error,
}: {
  snapshot: RunSnapshot | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section
      aria-label="Accounts"
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-surface)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          height: "36px",
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          gap: "16px",
          borderBottom: "1px solid var(--border)",
          background: "color-mix(in oklch, var(--bg-surface) 85%, transparent)",
          backdropFilter: "blur(8px)",
          fontSize: "11px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-secondary)",
          fontWeight: 600,
        }}
      >
        <span>Accounts</span>
        {snapshot && (
          <span style={{ color: "var(--text-muted)" }}>
            {snapshot.results.length} total · {countByStatus(snapshot.results)}
          </span>
        )}
      </header>

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {loading && <AccountSkeletonList />}
        {!loading && error && (
          <EmptyState tone="error" title="Could not load run" body={error} />
        )}
        {!loading && !error && snapshot && snapshot.results.length === 0 && (
          <EmptyState
            tone="muted"
            title="No accounts queued"
            body="This run was created but no proxies were attached."
          />
        )}
        {!loading && snapshot?.results?.map((r) => (
          <AccountRow
            key={accountKey(r)}
            result={r}
            startedAt={snapshot.created_at}
            endedAt={
              snapshot.status === "running" ? null : snapshot.updated_at
            }
            live={snapshot.status === "running"}
            p50Seconds={P50_SIGNUP_SECONDS}
          />
        ))}
      </div>
    </section>
  );
}

function accountKey(r: AccountResult): string {
  return r.profile_id ?? `${r.proxy_id}:${r.profile_name}`;
}

function countByStatus(rows: AccountResult[]): string {
  const counts: Record<AccountResult["status"], number> = {
    pending: 0,
    running: 0,
    complete: 0,
    failed: 0,
  };
  for (const r of rows) counts[r.status] += 1;
  const parts: string[] = [];
  if (counts.running) parts.push(`${counts.running} running`);
  if (counts.complete) parts.push(`${counts.complete} done`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.pending) parts.push(`${counts.pending} pending`);
  return parts.join(" · ") || "idle";
}

function AccountSkeletonList() {
  return (
    <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "16px 1fr 120px 110px 1fr 72px 48px",
            gap: "16px",
            alignItems: "center",
            height: "48px",
            padding: "0 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-2 w-28" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-20 w-12" style={{ borderRadius: 4 }} />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({
  tone,
  title,
  body,
}: {
  tone: "muted" | "error";
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        padding: "48px 24px",
        textAlign: "center",
        color: tone === "error" ? "var(--error)" : "var(--text-secondary)",
      }}
    >
      <div
        style={{
          fontSize: "14px",
          fontWeight: 600,
          marginBottom: "6px",
          color:
            tone === "error" ? "var(--error)" : "var(--text-primary)",
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
        {body}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* log pane — inline LogStream placeholder                                     */
/* -------------------------------------------------------------------------- */

function LogPane({ runId }: { runId: string }) {
  // The global logs stream carries ALL log lines; we filter to lines that
  // mention the current run_id either as a structured field OR embedded in
  // the `message` body. This is the cheap version — a per-run SSE endpoint
  // will replace this once the backend adds it.
  const sse = useSSE<LogLinePayload>("/api/stream/logs");
  const buffer = useLogBuffer(sse.data, runId);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Autoscroll to bottom when a new line lands AND the user is already near
  // the bottom (don't fight the operator who scrolled up to read history).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [buffer]);

  return (
    <section
      aria-label="Live logs"
      style={{
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-base)",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      <header
        style={{
          height: "36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-surface)",
          fontSize: "11px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-secondary)",
          fontWeight: 600,
        }}
      >
        <span>Logs</span>
        <span style={{ color: "var(--text-muted)", textTransform: "none" }}>
          {buffer.length} / {LOG_BUFFER_MAX}
          {sse.connected ? " · live" : " · connecting"}
        </span>
      </header>

      <div
        ref={scrollerRef}
        className="font-mono-log"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "8px 16px",
          color: "var(--text-secondary)",
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          lineHeight: 1.45,
        }}
      >
        {buffer.length === 0 ? (
          <div style={{ color: "var(--text-muted)", padding: "8px 0" }}>
            Waiting for log lines matching <code>{runId}</code>…
          </div>
        ) : (
          buffer.map((line, i) => <LogRow key={i} line={line} />)
        )}
      </div>
    </section>
  );
}

function LogRow({ line }: { line: LogLinePayload }) {
  const ts = new Date((line.ts ?? 0) * 1000);
  const hh = ts.getHours().toString().padStart(2, "0");
  const mm = ts.getMinutes().toString().padStart(2, "0");
  const ss = ts.getSeconds().toString().padStart(2, "0");
  const color = logColor(line.level);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "72px 48px minmax(0, 1fr)",
        gap: "8px",
        alignItems: "baseline",
        padding: "1px 0",
      }}
    >
      <span style={{ color: "var(--text-muted)" }}>
        {hh}:{mm}:{ss}
      </span>
      <span style={{ color, textTransform: "uppercase", fontWeight: 600 }}>
        {(line.level ?? "info").slice(0, 4)}
      </span>
      <span
        style={{
          color: "var(--text-primary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {line.message}
      </span>
    </div>
  );
}

function logColor(level: string | undefined): string {
  switch ((level ?? "").toLowerCase()) {
    case "error":
    case "critical":
    case "fatal":
      return "var(--error)";
    case "warn":
    case "warning":
      return "var(--warn)";
    case "info":
      return "var(--info)";
    case "debug":
    case "trace":
      return "var(--text-muted)";
    default:
      return "var(--text-secondary)";
  }
}

/**
 * Append each incoming log line to a bounded ring buffer, filtering to lines
 * that mention the run id. The filter uses either a structured `run_id`
 * field (preferred, when the backend emits one) or a substring match on the
 * message body (fallback).
 */
function useLogBuffer(
  latest: LogLinePayload | null,
  runId: string,
): LogLinePayload[] {
  const [buffer, setBuffer] = useState<LogLinePayload[]>([]);
  const lastRef = useRef<LogLinePayload | null>(null);

  useEffect(() => {
    if (!latest || latest === lastRef.current) return;
    lastRef.current = latest;
    if (!runId) return;
    const structuredId = typeof latest.run_id === "string" ? latest.run_id : null;
    const matches =
      structuredId === runId ||
      (typeof latest.message === "string" && latest.message.includes(runId));
    if (!matches) return;
    setBuffer((prev) => {
      const next = prev.length >= LOG_BUFFER_MAX ? prev.slice(1) : prev.slice();
      next.push(latest);
      return next;
    });
  }, [latest, runId]);

  return useMemo(() => buffer, [buffer]);
}
