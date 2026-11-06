"use client";

/**
 * ProfileTable — AdsPower profiles rendered through the shared DataTable.
 *
 * Columns (DESIGN_SPEC § Profiles route):
 *   1. Status       → StatusDot + Pill, color from deriveProfileStatus()
 *   2. Name         → sans, truncate (AdsPower names like "TikTok Acc #4")
 *   3. User ID      → mono, 12ch
 *   4. Group        → sans, muted when empty
 *   5. Proxy        → mono host:port, muted "—" when no proxy wired
 *   6. Created      → relative ("2m ago"), absolute shown on hover
 *
 * Clicking a row opens the right Inspector (ui-store) with
 * <ProfileInspector profile={...} />. The table owns the current selection
 * (keyed on user_id) so the row gets the 2px left accent border.
 */

import { useState } from "react";

import { DataTable, type Column, type SortState } from "@/components/data";
import type { AdsPowerProfile } from "@/lib/types";
import { useInspectorState } from "@/lib/ui-store";
import Pill from "@/components/ui/Pill";
import StatusDot from "@/components/ui/StatusDot";
import { isInFlight } from "@/lib/tokens";

import { ProfileInspector } from "./ProfileInspector";
import {
  deriveProfileStatus,
  formatAbsolute,
  formatProxyEndpoint,
  formatRelative,
  parseAdsPowerTime,
} from "./profile-format";

export interface ProfileTableProps {
  profiles: AdsPowerProfile[];
  loading?: boolean;
  /** Empty-state shown when `profiles.length === 0 && !loading`. */
  empty?: React.ReactNode;
}

const DEFAULT_SORT: SortState = { key: "created_time", direction: "desc" };

export function ProfileTable({ profiles, loading, empty }: ProfileTableProps) {
  const { openInspector, inspector, closeInspector } = useInspectorState();
  const [sort, setSort] = useState<SortState | null>(DEFAULT_SORT);

  // The Inspector id we stamp lets us detect "same row re-opened" and avoid
  // a flicker on the slide-in animation — ui-store reads it off `id`.
  const currentInspectorId = inspector?.id ?? null;
  const selectedUserId =
    currentInspectorId && currentInspectorId.startsWith("profile:")
      ? currentInspectorId.slice("profile:".length)
      : null;

  const sortedRows = applySort(profiles, sort);

  const columns: Column<AdsPowerProfile>[] = [
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortKey: "status",
      width: "120px",
      cell: (row) => {
        const status = deriveProfileStatus(row);
        return (
          <div className="flex items-center" style={{ gap: "8px" }}>
            <StatusDot
              tone={status.tone}
              pulse={isInFlight(status.tone) && status.label === "Running"}
              label={status.label}
            />
            <Pill tone={status.tone}>{status.label}</Pill>
          </div>
        );
      },
    },
    {
      key: "name",
      header: "Name",
      sortable: true,
      cell: (row) => (
        <span
          className="truncate block"
          style={{ color: "var(--text-primary)", fontWeight: 500 }}
        >
          {row.name ?? "—"}
        </span>
      ),
    },
    {
      key: "user_id",
      header: "User ID",
      sortable: true,
      mono: true,
      width: "14ch",
      cell: (row) => <span>{row.user_id}</span>,
    },
    {
      key: "group_name",
      header: "Group",
      sortable: true,
      cell: (row) =>
        row.group_name ? (
          <Pill tone="default">{row.group_name}</Pill>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        ),
    },
    {
      key: "proxy",
      header: "Proxy",
      sortable: true,
      sortKey: "proxy",
      mono: true,
      cell: (row) => {
        const endpoint = formatProxyEndpoint(row.user_proxy_config);
        if (!endpoint) {
          return <span style={{ color: "var(--text-muted)" }}>—</span>;
        }
        return (
          <span className="truncate block" title={endpoint}>
            {endpoint}
          </span>
        );
      },
    },
    {
      key: "created_time",
      header: "Created",
      sortable: true,
      align: "right",
      width: "120px",
      cell: (row) => {
        const absolute = formatAbsolute(row.created_time);
        return (
          <span
            title={absolute || undefined}
            style={{ color: "var(--text-secondary)" }}
          >
            {formatRelative(row.created_time)}
          </span>
        );
      },
    },
  ];

  return (
    <DataTable<AdsPowerProfile>
      ariaLabel="AdsPower profiles"
      columns={columns}
      rows={sortedRows}
      loading={loading}
      skeletonRows={8}
      empty={empty}
      sort={sort}
      onSortChange={setSort}
      getRowKey={(row) => row.user_id}
      selectedKey={selectedUserId}
      onRowClick={(row) => {
        const id = `profile:${row.user_id}`;
        if (id === currentInspectorId) {
          // Clicking the already-open row toggles the Inspector shut.
          closeInspector();
          return;
        }
        openInspector({
          id,
          title: row.name ?? row.user_id,
          body: <ProfileInspector profile={row} />,
        });
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Sorting — handled locally, no server-side pagination on this route.
// ---------------------------------------------------------------------------

function applySort(
  rows: AdsPowerProfile[],
  sort: SortState | null,
): AdsPowerProfile[] {
  if (!sort) return rows;
  const direction = sort.direction === "asc" ? 1 : -1;
  const copy = rows.slice();
  copy.sort((a, b) => direction * compare(a, b, sort.key));
  return copy;
}

function compare(a: AdsPowerProfile, b: AdsPowerProfile, key: string): number {
  switch (key) {
    case "status": {
      return (
        deriveProfileStatus(a).label.localeCompare(
          deriveProfileStatus(b).label,
          undefined,
          { sensitivity: "base" },
        )
      );
    }
    case "name":
      return compareNullable(a.name, b.name);
    case "user_id":
      return a.user_id.localeCompare(b.user_id, undefined, {
        sensitivity: "base",
      });
    case "group_name":
      return compareNullable(a.group_name, b.group_name);
    case "proxy":
      return compareNullable(
        formatProxyEndpoint(a.user_proxy_config),
        formatProxyEndpoint(b.user_proxy_config),
      );
    case "created_time": {
      const da = parseAdsPowerTime(a.created_time)?.getTime() ?? 0;
      const db = parseAdsPowerTime(b.created_time)?.getTime() ?? 0;
      return da === db ? 0 : da < db ? -1 : 1;
    }
    default:
      return 0;
  }
}

function compareNullable(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null || a === "") return 1; // nulls last
  if (b == null || b === "") return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export default ProfileTable;
