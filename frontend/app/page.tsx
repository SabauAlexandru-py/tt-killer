"use client";


export const dynamic = "force-dynamic";
/**
 * Dashboard — the `/` route.
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ Nav │ TopBar                                          │
 *   │     │ PageHeader  "Dashboard"            [Create …]   │
 *   │     │                                                 │
 *   │     │ 10  PROXIES LOADED · Ready to spawn 10 signups  │
 *   │     │     [ Create 10 accounts ]                      │
 *   │     │                                                 │
 *   │     │ [Proxies] [Profiles] [Running] [Signups 24h]    │
 *   │     │                                                 │
 *   │     │ RECENT RUNS                                     │
 *   │     │ ┌────────────┐ ┌────────────┐                   │
 *   │     │ │  RunCard   │ │  RunCard   │  …                │
 *   │     │ └────────────┘ └────────────┘                   │
 *   └──────────────────────────────────────────────────────┘
 *
 * Two queries drive the content — `listRuns` (with a 3s refetchInterval so
 * the page stays alive while the operator watches it for hours) and
 * `listProxies` / `listProfiles` for the metric row. The N-selector dialog
 * (components/runs/CreateAccountsDialog) owns the actual POST — this file
 * just hands it the current proxy list, listens for its `onCreated` to
 * invalidate the runs cache, and re-labels the hero CTA live as
 * `Create ${proxyCount} accounts` so operators know what will fire the
 * instant they click.
 *
 * Implementation notes:
 *   - Queries use the centralised keys from lib/queryKeys so a mutation
 *     elsewhere (e.g. deleting a proxy) still refreshes this page.
 *   - Colours reference --bg-X, --text-X, --accent via CSS variables, never
 *     raw Tailwind palette classes — the DESIGN_SPEC tokens are the only
 *     source of truth.
 *   - The metric row collapses to 2 columns under `sm` and 4 above.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ThreePane } from "@/components/layout/ThreePane";
import { TopBar } from "@/components/layout/TopBar";
import { PageHeader } from "@/components/layout/PageHeader";
import Button from "@/components/ui/Button";
import StatusDot from "@/components/ui/StatusDot";
import { Led } from "@/components/ui/LED";
import Skeleton from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/data/EmptyState";

import { MetricCard } from "@/components/runs/MetricCard";
import { RunCard } from "@/components/runs/RunCard";
import { CreateAccountsDialog } from "@/components/runs/CreateAccountsDialog";

import { listProfiles, listProxies, listRuns } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { useCountUp } from "@/lib/useCountUp";
import type {
  AdsPowerProfile,
  RunSnapshot,
  StoredProxy,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const runsQuery = useQuery({
    queryKey: queryKeys.runs.list(),
    queryFn: ({ signal }) => listRuns(signal),
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
  });

  const proxiesQuery = useQuery({
    queryKey: queryKeys.proxies.list(),
    queryFn: ({ signal }) => listProxies(signal),
  });

  const profilesQuery = useQuery({
    queryKey: queryKeys.profiles.list(),
    queryFn: ({ signal }) => listProfiles(signal),
    // Profiles call out to AdsPower Local API — be gentle.
    refetchInterval: 15_000,
    retry: 0,
  });

  // ---- Derived metrics ----------------------------------------------------

  const runs: RunSnapshot[] = runsQuery.data ?? [];
  const proxies: StoredProxy[] = proxiesQuery.data ?? [];
  const profiles: AdsPowerProfile[] = profilesQuery.data ?? [];

  const runningRuns = useMemo(
    () => runs.filter((r) => r.status === "running").length,
    [runs],
  );

  const signups24h = useMemo(() => {
    const cutoff = Date.now() / 1000 - 24 * 60 * 60;
    let total = 0;
    for (const r of runs) {
      if (r.kind !== "create") continue;
      if (r.created_at < cutoff) continue;
      for (const acc of r.results) {
        if (acc.status === "complete") total += 1;
      }
    }
    return total;
  }, [runs]);

  const recentRuns = useMemo(
    () => [...runs].sort((a, b) => b.created_at - a.created_at).slice(0, 8),
    [runs],
  );

  // ---- Running → complete ripple detection -------------------------------
  // Keep the last-seen status per run_id. When a run transitions from
  // "running" to "complete", bump its ripple key. The RunCard uses the
  // monotonic key to replay its 600ms sweep. We rate-cap at one ripple per
  // run per 500ms so bursts of SSE ticks don't stack.
  const prevStatusRef = useRef<Record<string, RunSnapshot["status"]>>({});
  const lastRippleAtRef = useRef<Record<string, number>>({});
  const [rippleKeys, setRippleKeys] = useState<Record<string, number>>({});

  useEffect(() => {
    const prev = prevStatusRef.current;
    const lastAt = lastRippleAtRef.current;
    const nextStatus: Record<string, RunSnapshot["status"]> = {};
    let dirty: Record<string, number> | null = null;
    const now = Date.now();
    for (const run of runs) {
      nextStatus[run.run_id] = run.status;
      const before = prev[run.run_id];
      const lastRippleAt = lastAt[run.run_id];
      if (
        before === "running" &&
        run.status === "complete" &&
        (lastRippleAt === undefined || now - lastRippleAt >= 500)
      ) {
        lastAt[run.run_id] = now;
        dirty = dirty ?? { ...rippleKeys };
        dirty[run.run_id] = (dirty[run.run_id] ?? 0) + 1;
      }
    }
    prevStatusRef.current = nextStatus;
    if (dirty) setRippleKeys(dirty);
    // rippleKeys intentionally omitted — we only want transitions on `runs`
    // to drive updates, and we already snapshot it inside the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs]);

  // ---- Hero copy ----------------------------------------------------------
  const proxyCount = proxies.length;
  const heroCount = useCountUp(proxyCount, {
    disabled: proxiesQuery.isLoading,
  });
  const heroButtonLabel =
    proxyCount === 0
      ? "Add a proxy first"
      : proxyCount === 1
        ? "Create 1 account"
        : `Create ${proxyCount} accounts`;
  const heroPillLabel =
    proxyCount === 0
      ? "No proxies loaded"
      : proxyCount === 1
        ? "Ready to spawn 1 parallel signup"
        : `Ready to spawn ${proxyCount} parallel signups`;

  // ---- Render ------------------------------------------------------------

  const openDialog = () => setCreateOpen(true);
  const closeDialog = () => setCreateOpen(false);

  return (
    <ThreePane>
      <TopBar
        title="Dashboard"
        actions={
          <Button
            variant="primary"
            size="lg"
            onClick={openDialog}
            disabled={proxiesQuery.isLoading}
          >
            {heroButtonLabel}
          </Button>
        }
      />
      <PageHeader
        title="Dashboard"
        description="Live view of your account factory."
        actions={
          <Button
            variant="primary"
            onClick={openDialog}
            disabled={proxiesQuery.isLoading}
          >
            {heroButtonLabel}
          </Button>
        }
      />

      {/* --- Hero: big proxies count + ready-to-spawn pill + CTA ---------- */}
      <section
        aria-label="Ready to spawn"
        style={{
          padding: "20px 20px 0",
          marginBottom: "20px",
        }}
      >
        <div
          style={{
            maxWidth: "640px",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "14px",
          }}
        >
          {/* Top row: huge number + ready pill */}
          <div
            className="flex items-center"
            style={{ gap: "20px", width: "100%", minWidth: 0 }}
          >
            <span
              aria-label={`${proxyCount} proxies loaded`}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "72px",
                lineHeight: 1,
                fontWeight: 600,
                color: "var(--text-primary)",
                fontVariantNumeric: "tabular-nums",
                fontFeatureSettings: '"tnum" 1, "zero" 1',
                letterSpacing: "-0.03em",
              }}
            >
              {proxiesQuery.isLoading ? "--" : heroCount}
            </span>
            <div
              className="flex flex-col"
              style={{ gap: "4px", minWidth: 0, flex: 1 }}
            >
              <span
                style={{
                  fontSize: "12px",
                  lineHeight: 1.4,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  fontWeight: 500,
                }}
              >
                Proxies loaded
              </span>
              <span
                className="inline-flex items-center"
                role="status"
                aria-live="polite"
                style={{
                  gap: "10px",
                  padding: "6px 12px 6px 10px",
                  height: "32px",
                  borderRadius: "var(--radius-sm)",
                  background:
                    proxyCount > 0
                      ? "var(--accent-bg)"
                      : "var(--bg-raised)",
                  border: `1px solid ${
                    proxyCount > 0 ? "var(--accent-border)" : "var(--border)"
                  }`,
                  color:
                    proxyCount > 0
                      ? "var(--accent)"
                      : "var(--text-muted)",
                  fontSize: "12px",
                  fontWeight: 500,
                  letterSpacing: "0.01em",
                  alignSelf: "flex-start",
                  maxWidth: "100%",
                }}
              >
                <Led
                  tone={proxyCount > 0 ? "running" : "idle"}
                  pattern="steady"
                  size="sm"
                  glow
                />
                <span className="truncate">{heroPillLabel}</span>
              </span>
            </div>
          </div>

          {/* Primary CTA — label tracks the live proxy count. */}
          <Button
            variant="primary"
            size="lg"
            onClick={openDialog}
            disabled={proxiesQuery.isLoading || proxyCount === 0}
          >
            {heroButtonLabel}
          </Button>
        </div>
      </section>

      {/* --- Metric row ---------------------------------------------------- */}
      <section
        aria-label="Key metrics"
        style={{
          padding: "0 20px 12px",
          display: "grid",
          gap: "12px",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        <MetricCard
          label="Proxies"
          loading={proxiesQuery.isLoading}
          value={proxies.length}
          animateInitial
          tone={proxies.length > 0 ? "accent" : undefined}
          sublabel={
            <span>
              {proxies.filter((p) => p.rotation_url).length} rotatable
            </span>
          }
        />
        <MetricCard
          label="Profiles"
          loading={profilesQuery.isLoading}
          value={profiles.length}
          animateInitial
          sublabel={
            profilesQuery.isError ? (
              <span style={{ color: "var(--error)" }}>
                AdsPower unreachable
              </span>
            ) : (
              <span>
                {Math.max(proxies.length - profiles.length, 0)} unlinked
              </span>
            )
          }
        />
        <MetricCard
          label="Running runs"
          loading={runsQuery.isLoading}
          value={runningRuns}
          animateInitial
          tone={runningRuns > 0 ? "warn" : "accent"}
          pulse={runningRuns > 0}
          sublabel={
            <span>
              {runs.length} total · {runs.filter((r) => r.status === "failed").length} failed
            </span>
          }
        />
        <MetricCard
          label="Signups 24h"
          loading={runsQuery.isLoading}
          value={signups24h}
          animateInitial
          tone={signups24h > 0 ? "accent" : undefined}
          sublabel={<span>complete accounts</span>}
        />
      </section>

      {/* --- Recent runs --------------------------------------------------- */}
      <section
        aria-label="Recent runs"
        style={{
          padding: "8px 20px 32px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          flex: 1,
          minHeight: 0,
        }}
      >
        <header
          className="flex items-center"
          style={{ gap: "12px", paddingTop: "12px" }}
        >
          <h2
            style={{
              fontSize: "12px",
              lineHeight: 1.4,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              fontWeight: 500,
              margin: 0,
            }}
          >
            Recent runs
          </h2>
          <span style={{ color: "var(--border-strong)" }}>·</span>
          <span
            className="font-mono-data"
            style={{ color: "var(--text-muted)" }}
          >
            {runs.length} total
          </span>
          {runsQuery.isFetching && !runsQuery.isLoading ? (
            <span
              className="flex items-center"
              style={{ gap: "6px", color: "var(--text-muted)" }}
            >
              <StatusDot tone="info" pulse />
              <span className="font-mono-data">refreshing</span>
            </span>
          ) : null}
        </header>

        {runsQuery.isLoading ? (
          <div
            style={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            }}
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton
                key={i}
                shape="rect"
                height={160}
                className="w-full"
              />
            ))}
          </div>
        ) : runsQuery.isError ? (
          <EmptyState
            title="Couldn't load runs"
            description={
              runsQuery.error instanceof Error
                ? runsQuery.error.message
                : "The backend didn't answer."
            }
            primaryAction={{
              label: "Retry",
              onClick: () => runsQuery.refetch(),
              variant: "secondary",
            }}
          />
        ) : recentRuns.length === 0 ? (
          <EmptyState
            title="No runs yet"
            description="Kick off your first account-creation run from the Create accounts button."
            primaryAction={{
              label: "Create accounts",
              onClick: openDialog,
            }}
          />
        ) : (
          <div
            role="list"
            style={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            }}
          >
            {recentRuns.map((run) => (
              <div role="listitem" key={run.run_id}>
                <RunCard
                  run={run}
                  rippleKey={rippleKeys[run.run_id] ?? 0}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <CreateAccountsDialog
        open={createOpen}
        onClose={closeDialog}
        proxies={proxies}
        loadingProxies={proxiesQuery.isLoading}
        onCreated={() => {
          // Dialog already invalidates on success, but a defensive refresh
          // keeps the dashboard honest if a future caller bypasses the
          // dialog's own onSuccess.
          queryClient.invalidateQueries({ queryKey: queryKeys.runs.all });
        }}
      />
    </ThreePane>
  );
}
