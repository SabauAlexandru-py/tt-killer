"use client";

/**
 * ProxyList — table of stored proxies with inline Rotate / Verify / Edit /
 * Delete actions.
 *
 * Data flow:
 *   - `useQuery(queryKeys.proxies.list(), listProxies)` reads the local
 *     JSON store via FastAPI.
 *   - Each action is its own `useMutation`, scoped to a single proxy id
 *     so pending state is per-row (nothing freezes the whole table while
 *     one rotation is in flight).
 *   - Every mutation invalidates `queryKeys.proxies.all` on success so the
 *     list refetches `last_known_ip` + `last_rotated_at` from the source
 *     of truth instead of trusting client-side merges.
 *
 * Columns follow DESIGN_SPEC § `/proxies`:
 *   Status · Name · Host:Port (mono) · Type (pill) · User (mono muted) ·
 *   Last IP (mono + relative time) · Rotation (badge) · Actions
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  deleteProxy,
  listProxies,
  rotateProxy,
  verifyProxyIp,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { StoredProxy } from "@/lib/types";

import { DataTable, type Column } from "@/components/data/DataTable";
import { EmptyState } from "@/components/data/EmptyState";
import Pill from "@/components/ui/Pill";

import { ProxyActions, ProxyStatusDot } from "./ProxyRow";
import { RotationBadge } from "./RotationBadge";

// ---------------------------------------------------------------------------
// Relative-time helper for the "Last IP" column.
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "unknown";
  const ageMs = Math.max(0, now - ts);
  const sec = Math.round(ageMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function formatIp(proxy: StoredProxy): { ip: string; age: string } {
  return {
    ip: proxy.last_known_ip ?? "—",
    age: formatRelativeTime(proxy.last_rotated_at),
  };
}

// ---------------------------------------------------------------------------
// ProxyList
// ---------------------------------------------------------------------------

export interface ProxyListProps {
  /** Opens the ProxyForm in edit mode for this proxy. */
  onEdit: (proxy: StoredProxy) => void;
}

export function ProxyList({ onEdit }: ProxyListProps) {
  const queryClient = useQueryClient();

  const proxiesQuery = useQuery({
    queryKey: queryKeys.proxies.list(),
    queryFn: ({ signal }) => listProxies(signal),
  });

  // Rotate ------------------------------------------------------------------
  const rotateMutation = useMutation({
    mutationFn: (proxy: StoredProxy) => rotateProxy(proxy.id),
    onSuccess: (data, proxy) => {
      if (data.changed) {
        toast.success(`Rotated ${proxy.name}`, {
          description: `${data.old_ip ?? "—"} → ${data.new_ip ?? "—"}`,
        });
      } else {
        toast.warning(`Rotation did not change IP for ${proxy.name}`, {
          description: `IP still ${data.new_ip ?? data.old_ip ?? "unknown"}`,
        });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies.all });
    },
    onError: (err, proxy) => {
      toast.error(`Rotation failed for ${proxy.name}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  // Verify IP ---------------------------------------------------------------
  const verifyMutation = useMutation({
    mutationFn: (proxy: StoredProxy) => verifyProxyIp(proxy.id),
    onSuccess: (data, proxy) => {
      toast.success(`${proxy.name}: ${data.ip}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies.all });
    },
    onError: (err, proxy) => {
      toast.error(`IP check failed for ${proxy.name}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  // Delete ------------------------------------------------------------------
  const deleteMutation = useMutation({
    mutationFn: (proxy: StoredProxy) => deleteProxy(proxy.id),
    onSuccess: (_data, proxy) => {
      toast.success(`Deleted ${proxy.name}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies.all });
    },
    onError: (err, proxy) => {
      toast.error(`Delete failed for ${proxy.name}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  // Handlers ----------------------------------------------------------------
  const handleRotate = (proxy: StoredProxy) => rotateMutation.mutate(proxy);
  const handleVerify = (proxy: StoredProxy) => verifyMutation.mutate(proxy);
  const handleDelete = (proxy: StoredProxy) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete proxy "${proxy.name}"? Profiles that still reference it will stay but lose their rotation URL.`,
      );
      if (!confirmed) return;
    }
    deleteMutation.mutate(proxy);
  };

  // Columns -----------------------------------------------------------------
  const columns: Column<StoredProxy>[] = [
    {
      key: "status",
      header: "",
      width: "28px",
      cell: (proxy) => <ProxyStatusDot proxy={proxy} />,
    },
    {
      key: "name",
      header: "Name",
      sortable: true,
      cell: (proxy) => (
        <span
          style={{
            color: "var(--text-primary)",
            fontWeight: 500,
          }}
        >
          {proxy.name}
        </span>
      ),
    },
    {
      key: "endpoint",
      header: "Host : Port",
      mono: true,
      cell: (proxy) => (
        <span className="font-mono-data" title={`${proxy.host}:${proxy.port}`}>
          <span style={{ color: "var(--text-primary)" }}>{proxy.host}</span>
          <span style={{ color: "var(--text-muted)" }}>:</span>
          <span style={{ color: "var(--text-secondary)" }}>{proxy.port}</span>
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      width: "96px",
      cell: (proxy) => (
        <Pill tone={proxy.type === "socks5" ? "info" : "default"}>
          {proxy.type.toUpperCase()}
        </Pill>
      ),
    },
    {
      key: "user",
      header: "User",
      mono: true,
      cell: (proxy) => (
        <span
          className="font-mono-data"
          style={{ color: "var(--text-muted)" }}
          title={proxy.user ?? undefined}
        >
          {proxy.user ?? "—"}
        </span>
      ),
    },
    {
      key: "lastIp",
      header: "Last IP",
      mono: true,
      cell: (proxy) => {
        const { ip, age } = formatIp(proxy);
        return (
          <div className="flex flex-col font-mono-data" style={{ lineHeight: 1.3 }}>
            <span style={{ color: "var(--text-primary)" }}>{ip}</span>
            <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
              {age}
            </span>
          </div>
        );
      },
    },
    {
      key: "rotation",
      header: "Rotation",
      width: "180px",
      cell: (proxy) => (
        <RotationBadge
          lastRotatedAt={proxy.last_rotated_at}
          rotationUrl={proxy.rotation_url}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      width: "180px",
      align: "right",
      headerClassName: "sr-only",
      cell: (proxy) => (
        <ProxyActions
          proxy={proxy}
          onRotate={handleRotate}
          onVerify={handleVerify}
          onEdit={onEdit}
          onDelete={handleDelete}
          rotatingId={rotateMutation.isPending ? rotateMutation.variables?.id ?? null : null}
          verifyingId={verifyMutation.isPending ? verifyMutation.variables?.id ?? null : null}
          deletingId={deleteMutation.isPending ? deleteMutation.variables?.id ?? null : null}
        />
      ),
    },
  ];

  // Error surface — still renders the table empty, but with a visible banner
  // so the operator doesn't stare at a confusing "No rows" when the backend
  // is down.
  if (proxiesQuery.isError) {
    return (
      <div
        role="alert"
        className="rounded-md border p-4"
        style={{
          borderColor: "var(--error-border)",
          background: "var(--error-bg)",
          color: "var(--error)",
          fontSize: "13px",
        }}
      >
        <strong style={{ fontWeight: 600 }}>Couldn’t load proxies.</strong>{" "}
        {proxiesQuery.error instanceof Error
          ? proxiesQuery.error.message
          : String(proxiesQuery.error)}
      </div>
    );
  }

  return (
    <DataTable<StoredProxy>
      ariaLabel="Stored proxies"
      columns={columns}
      rows={proxiesQuery.data ?? []}
      getRowKey={(proxy) => proxy.id}
      loading={proxiesQuery.isLoading}
      skeletonRows={4}
      empty={
        <EmptyState
          title="No proxies yet"
          description="Add your first proxy using the form above. Rotation is optional, but recommended for every TikTok signup."
          compact
        />
      }
    />
  );
}

export default ProxyList;
