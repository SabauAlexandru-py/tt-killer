"use client";


export const dynamic = "force-dynamic";
/**
 * /runs — Runs history list.
 *
 * DESIGN_SPEC § Frontend routes:
 *   "Runs history: table with filter chips, URL-state"
 *
 * Shell
 *   ThreePane → TopBar (filter chips) → PageHeader "Runs" → DataTable.
 *
 * Filter chips
 *   Two <FilterChips> groups, both single-select with a leading "All" pill:
 *     - kind     : create | warmup     (URL param `kind`)
 *     - status   : running | complete | failed   (URL param `status`)
 *   FilterChips writes to the URL via next/navigation's useRouter.replace,
 *   so back/forward restores state and the view is deep-linkable.
 *
 * Table columns (left → right):
 *     1. 8px StatusDot  — emerald (complete), amber+pulse (running), rose (failed)
 *     2. run_id         — mono, tabular-nums
 *     3. kind           — Pill (info=create, warn=warmup)
 *     4. started        — relative ("4m ago"), refreshed via tick state
 *     5. duration       — mono mm:ss / h:mm:ss, live for running rows
 *     6. accounts       — total result count (mono)
 *     7. ✓ : ✗          — complete / failed counts, mono
 *
 * Row click pushes /runs/{run_id}.
 *
 * Data flow
 *   TanStack Query → listRuns(). refetchInterval = 2s so running rows tick
 *   without SSE; the runs stream lives on the detail page.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ThreePane } from "@/components/layout/ThreePane";
import { TopBar } from "@/components/layout/TopBar";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  DataTable,
  EmptyState,
  FilterChips,
  type Column,
} from "@/components/data";
import Pill from "@/components/ui/Pill";
import StatusDot from "@/components/ui/StatusDot";

import { listRuns } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { RunKind, RunSnapshot, RunStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Filter option definitions — single source of truth so the chip set and the
// filter predicate can't drift.
// ---------------------------------------------------------------------------

const KIND_OPTIONS: { value: RunKind; label: string }[] = [
  { value: "create", label: "Create" },
  { value: "warmup", label: "Warmup" },
];

const STATUS_OPTIONS: {
  value: RunStatus;
  label: string;
  tone: "accent" | "warn" | "error";
}[] = [
  { value: "running", label: "Running", tone: "warn" },
  { value: "complete", label: "Complete", tone: "accent" },
  { value: "failed", label: "Failed", tone: "error" },
];

const VALID_KINDS = new Set<RunKind>(KIND_OPTIONS.map((o) => o.value));
const VALID_STATUSES = new Set<RunStatus>(STATUS_OPTIONS.map((o) => o.value));

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RunsPage() {
  return (
    <React.Suspense fallback={null}>
      <RunsPageInner />
    </React.Suspense>
  );
}

function RunsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // --- URL-state --------------------------------------------------------------
  const kindFilter = React.useMemo<RunKind[]>(() => {
    const raw = searchParams?.get("kind") ?? "";
    if (!raw) return [];
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter((v): v is RunKind => VALID_KINDS.has(v as RunKind));
  }, [searchParams]);

  const statusFilter = React.useMemo<RunStatus[]>(() => {
    const raw = searchParams?.get("status") ?? "";
    if (!raw) return [];
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter((v): v is RunStatus => VALID_STATUSES.has(v as RunStatus));
  }, [searchParams]);

  // --- Data -------------------------------------------------------------------
  const runsQuery = useQuery({
    queryKey: queryKeys.runs.list(),
    queryFn: ({ signal }) => listRuns(signal),
    // Running rows need near-live updates; 2s is dense enough for a terminal
    // view without hammering the backend.
    refetchInterval: 2_000,
  });

  const allRuns = runsQuery.data ?? [];

  // --- Filter + sort ----------------------------------------------------------
  const rows = React.useMemo(() => {
    const kindSet = new Set(kindFilter);
    const statusSet = new Set(statusFilter);

    return allRuns
      .filter((r) => (kindSet.size === 0 ? true : kindSet.has(r.kind)))
      .filter((r) => (statusSet.size === 0 ? true : statusSet.has(r.status)))
      .slice()
      .sort((a, b) => b.created_at - a.created_at);
  }, [allRuns, kindFilter, statusFilter]);

  // --- Live clock for relative time + running-duration cells ------------------
  const now = useNow(1_000);

  // --- Row click → detail -----------------------------------------------------
  const onRowClick = React.useCallback(
    (row: RunSnapshot) => {
      router.push(`/runs/${encodeURIComponent(row.run_id)}`);
    },
    [router],
  );

  // --- Columns ----------------------------------------------------------------
  const columns = React.useMemo<Column<RunSnapshot>[]>(
    () => [
      {
        key: "dot",
        header: "",
        width: "28px",
        cell: (row) => <StatusDotForStatus status={row.status} />,
        cellClassName: "pl-3 pr-0",
        headerClassName: "pl-3 pr-0",
      },
      {
        key: "run_id",
        header: "Run",
        mono: true,
        width: "22ch",
        cell: (row) => <RunIdCell runId={row.run_id} />,
      },
      {
        key: "kind",
        header: "Kind",
        width: "110px",
        cell: (row) => <KindPill kind={row.kind} />,
      },
      {
        key: "started_at",
        header: "Started",
        width: "14ch",
        cell: (row) => (
          <span style={{ color: "var(--text-secondary)" }}>
            {formatRelative(row.created_at, now)}
          </span>
        ),
      },
      {
        key: "duration",
        header: "Duration",
        mono: true,
        align: "right",
        width: "10ch",
        cell: (row) => (
          <span style={{ color: "var(--text-primary)" }}>
            {formatDuration(row, now)}
          </span>
        ),
      },
      {
        key: "accounts",
        header: "Accounts",
        numeric: true,
        width: "9ch",
        cell: (row) => (
          <span style={{ color: "var(--text-primary)" }}>
            {row.results.length}
          </span>
        ),
      },
      {
        key: "outcome",
        header: "✓ : ✗",
        mono: true,
        align: "right",
        width: "11ch",
        cell: (row) => <OutcomeCounts results={row.results} />,
        cellClassName: "pr-4",
        headerClassName: "pr-4",
      },
    ],
    [now],
  );

  // --- Filter bar for the TopBar actions slot --------------------------------
  const filterBar = (
    <div
      className="flex items-center"
      style={{ gap: "16px" }}
      aria-label="Run filters"
    >
      <FilterGroup label="Kind">
        <FilterChips
          options={KIND_OPTIONS}
          active={kindFilter}
          paramName="kind"
          single
          allLabel="All"
          ariaLabel="Filter runs by kind"
        />
      </FilterGroup>
      <FilterGroup label="Status">
        <FilterChips
          options={STATUS_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            tone: o.tone,
          }))}
          active={statusFilter}
          paramName="status"
          single
          allLabel="All"
          ariaLabel="Filter runs by status"
        />
      </FilterGroup>
    </div>
  );

  // --- Empty-state copy -------------------------------------------------------
  const anyFilter = kindFilter.length + statusFilter.length > 0;
  const emptyBody = anyFilter ? (
    <EmptyState
      title="No matching runs."
      description="Clear the filter chips above to see every run on record."
      compact
    />
  ) : (
    <EmptyState
      title="No runs yet."
      description="Kick off a create or warmup run from the dashboard — it'll stream in here as soon as the orchestrator picks it up."
      compact
    />
  );

  return (
    <ThreePane>
      <TopBar left={<span style={topBarCrumbStyle}>Runs</span>} actions={filterBar} />

      <div className="flex-1 min-w-0 flex flex-col">
        <PageHeader
          title="Runs"
          description={
            runsQuery.isError
              ? "Couldn't reach the orchestrator — check the backend URL in Settings."
              : `Every create and warmup run on this operator, newest first.${
                  allRuns.length > 0 ? ` ${allRuns.length} total.` : ""
                }`
          }
        />

        <section
          className="flex-1 min-w-0"
          style={{ padding: "20px", background: "var(--bg-base)" }}
        >
          <DataTable<RunSnapshot>
            ariaLabel="Runs list"
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.run_id}
            onRowClick={onRowClick}
            loading={runsQuery.isPending}
            skeletonRows={8}
            empty={emptyBody}
          />
        </section>
      </div>
    </ThreePane>
  );
}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

const topBarCrumbStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "var(--text-primary)",
  letterSpacing: "-0.005em",
};

function StatusDotForStatus({ status }: { status: RunStatus }) {
  if (status === "running") {
    return <StatusDot tone="warn" pulse label="Running" />;
  }
  if (status === "failed") {
    return <StatusDot tone="error" label="Failed" />;
  }
  return <StatusDot tone="accent" label="Complete" />;
}

function KindPill({ kind }: { kind: RunKind }) {
  const tone = kind === "create" ? "info" : "warn";
  const label = kind === "create" ? "Create" : "Warmup";
  return <Pill tone={tone}>{label}</Pill>;
}

function RunIdCell({ runId }: { runId: string }) {
  // AdsPower run ids are long — surface the full id on hover, show a tidy
  // 12-char head + tail in the cell so the column keeps its budget.
  const short = runId.length > 14 ? `${runId.slice(0, 8)}…${runId.slice(-4)}` : runId;
  return (
    <span
      title={runId}
      style={{
        color: "var(--text-primary)",
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {short}
    </span>
  );
}

function OutcomeCounts({
  results,
}: {
  results: RunSnapshot["results"];
}) {
  let complete = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "complete") complete += 1;
    else if (r.status === "failed") failed += 1;
  }
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span style={{ color: "var(--accent)" }}>{complete}</span>
      <span style={{ color: "var(--text-muted)" }}> : </span>
      <span style={{ color: failed > 0 ? "var(--error)" : "var(--text-muted)" }}>
        {failed}
      </span>
    </span>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center" style={{ gap: "8px" }}>
      <span
        style={{
          fontSize: "11px",
          lineHeight: 1,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time helpers — pure, no deps.
// ---------------------------------------------------------------------------

/** Return wall-clock `Date.now() / 1000` (seconds), tick every `intervalMs`. */
function useNow(intervalMs: number): number {
  const [now, setNow] = React.useState<number>(() => Date.now() / 1000);
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Humanise a unix-seconds timestamp as "just now" / "4m ago" / "2h ago" / "3d ago". */
function formatRelative(tsSeconds: number, nowSeconds: number): string {
  const delta = Math.max(0, nowSeconds - tsSeconds);
  if (delta < 10) return "just now";
  if (delta < 60) return `${Math.floor(delta)}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86_400)}d ago`;
}

/** Format a run's duration. Running rows tick off `nowSeconds`; terminal rows freeze. */
function formatDuration(row: RunSnapshot, nowSeconds: number): string {
  const end = row.status === "running" ? nowSeconds : row.updated_at;
  const total = Math.max(0, end - row.created_at);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}
