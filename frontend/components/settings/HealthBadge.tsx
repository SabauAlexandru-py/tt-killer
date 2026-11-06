"use client";

/**
 * HealthBadge — live backend reachability indicator for the Settings page.
 *
 * Two layers of signal, derived from a single TanStack Query against
 * `GET /api/health` on a 10s refetchInterval (matches DESIGN_SPEC §
 * "Vercel + localhost strategy"):
 *
 *   Primary row — backend reachability
 *     ● accent + pulse  →  "Backend reachable"
 *     ● error           →  "Unreachable — is the local agent running?"
 *     ● muted           →  "Checking…" (first in-flight fetch)
 *
 *   Sub-badge row — AdsPower reachability, read from the same payload
 *     ● accent          →  "AdsPower reachable"
 *     ● warn            →  "AdsPower unreachable"
 *     ● muted           →  "AdsPower status unknown" (no payload yet)
 *
 * Why one query and not two:
 *   - `/api/health` already carries `adspower_reachable` — a second poll
 *     against `/api/adspower/status` would double the traffic and risk
 *     the two badges disagreeing by a second.
 *   - Settings is a read-heavy page the operator leaves open; keeping
 *     this cheap matters.
 *
 * The component accepts `backendUrl` as an optional prop so the parent
 * form can re-key the query right after a Save — when the key changes
 * TanStack Query drops the previous fetch and refetches immediately,
 * giving the operator a live confirmation that the new URL works
 * without waiting for the next 10s tick.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ApiError, getBackendUrl, health } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import StatusDot, { type StatusTone } from "@/components/ui/StatusDot";
import type { HealthResponse } from "@/lib/types";

export interface HealthBadgeProps {
  /**
   * Current backend URL as the Settings form sees it. Used purely to
   * rekey the query so a Save triggers an instant re-probe. When
   * omitted, the hook reads `getBackendUrl()` itself — handy when the
   * badge lives outside a form.
   */
  backendUrl?: string;
}

interface BadgeState {
  tone: StatusTone;
  pulse: boolean;
  label: string;
}

export function HealthBadge({ backendUrl }: HealthBadgeProps) {
  // Fall back to the live localStorage read when no prop is passed; this
  // lets the badge stand alone (e.g. in the TopBar) without a wiring step.
  const resolvedUrl = backendUrl ?? getBackendUrl();

  const query = useQuery<HealthResponse, ApiError>({
    // Re-key on URL so saving a new backend URL triggers a fresh probe
    // instead of showing the previous server's cached health for 10s.
    queryKey: [...queryKeys.meta.health(), resolvedUrl],
    queryFn: ({ signal }) => health(signal),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    retry: 0,
    // No stale time — we want the 10s interval to always do real work.
    staleTime: 0,
  });

  const primary = useMemo<BadgeState>(() => {
    if (query.isPending && !query.data) {
      return { tone: "muted", pulse: false, label: "Checking…" };
    }
    if (query.isError || !query.data?.ok) {
      return {
        tone: "error",
        pulse: false,
        label: "Unreachable — is the local agent running?",
      };
    }
    return { tone: "accent", pulse: true, label: "Backend reachable" };
  }, [query.data, query.isError, query.isPending]);

  const sub = useMemo<BadgeState>(() => {
    if (!query.data) {
      return { tone: "muted", pulse: false, label: "AdsPower status unknown" };
    }
    if (query.data.adspower_reachable) {
      return { tone: "accent", pulse: false, label: "AdsPower reachable" };
    }
    return { tone: "warn", pulse: false, label: "AdsPower unreachable" };
  }, [query.data]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col"
      style={{ gap: "6px" }}
    >
      <BadgeRow state={primary} prominent />
      <BadgeRow state={sub} />
    </div>
  );
}

interface BadgeRowProps {
  state: BadgeState;
  prominent?: boolean;
}

function BadgeRow({ state, prominent = false }: BadgeRowProps) {
  return (
    <span
      className="inline-flex items-center"
      style={{
        gap: "8px",
        fontSize: prominent ? "13px" : "12px",
        lineHeight: 1.4,
        color: prominent ? "var(--text-primary)" : "var(--text-muted)",
        fontWeight: prominent ? 500 : 400,
      }}
    >
      <StatusDot tone={state.tone} pulse={state.pulse} label={state.label} />
      <span>{state.label}</span>
    </span>
  );
}

export default HealthBadge;
