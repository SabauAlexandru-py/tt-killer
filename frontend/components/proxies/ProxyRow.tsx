"use client";

/**
 * ProxyRow — per-row action controls + the status-dot helper used in the
 * ProxyList DataTable.
 *
 * The DataTable's `columns.cell` API already renders a row, so we don't
 * reinvent `<tr>` here. Instead this module ships:
 *
 *   - <ProxyActions />  — Rotate / Verify IP / Edit / Delete buttons, with
 *                         pending state on each so a mid-flight rotation
 *                         can't be double-fired.
 *   - <ProxyStatusDot /> — the leading status indicator whose tone is derived
 *                          from last_known_ip age (fresh → accent pulse;
 *                          stale → info; never seen → muted; rotation URL
 *                          missing → warn).
 *
 * Both are hand-rolled against our own Button / IconButton / StatusDot
 * primitives — no shadcn, no radix.
 */

import { RefreshCw, Search, Pencil, Trash2 } from "lucide-react";
import IconButton from "@/components/ui/IconButton";
import StatusDot, { type StatusTone } from "@/components/ui/StatusDot";
import type { StoredProxy } from "@/lib/types";

// ---------------------------------------------------------------------------
// ProxyActions — four-button cluster for the trailing cell of a ProxyList row.
// ---------------------------------------------------------------------------

export interface ProxyActionsProps {
  proxy: StoredProxy;
  onRotate: (proxy: StoredProxy) => void;
  onVerify: (proxy: StoredProxy) => void;
  onEdit: (proxy: StoredProxy) => void;
  onDelete: (proxy: StoredProxy) => void;
  /** Id of the proxy whose rotate is in-flight. */
  rotatingId?: string | null;
  /** Id of the proxy whose verify is in-flight. */
  verifyingId?: string | null;
  /** Id of the proxy currently being deleted. */
  deletingId?: string | null;
}

export function ProxyActions({
  proxy,
  onRotate,
  onVerify,
  onEdit,
  onDelete,
  rotatingId,
  verifyingId,
  deletingId,
}: ProxyActionsProps) {
  const isRotating = rotatingId === proxy.id;
  const isVerifying = verifyingId === proxy.id;
  const isDeleting = deletingId === proxy.id;
  const rotationDisabled = !proxy.rotation_url || isRotating;

  // Stop click propagation so pressing a button doesn't also fire the row's
  // onRowClick handler (which would open the Inspector mid-action).
  const guard =
    (handler: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      handler();
    };

  return (
    <div
      className="flex items-center justify-end"
      style={{ gap: "6px" }}
      onClick={(event) => event.stopPropagation()}
    >
      <IconButton
        size="sm"
        aria-label={
          proxy.rotation_url
            ? `Rotate proxy ${proxy.name}`
            : `Rotate disabled — no rotation URL for ${proxy.name}`
        }
        title={
          proxy.rotation_url
            ? "Trigger rotation URL"
            : "No rotation URL configured"
        }
        loading={isRotating}
        disabled={rotationDisabled}
        onClick={guard(() => onRotate(proxy))}
      >
        {!isRotating && <RefreshCw size={14} strokeWidth={2} />}
      </IconButton>

      <IconButton
        size="sm"
        aria-label={`Verify current IP for ${proxy.name}`}
        title="Check current IP without rotating"
        loading={isVerifying}
        disabled={isVerifying}
        onClick={guard(() => onVerify(proxy))}
      >
        {!isVerifying && <Search size={14} strokeWidth={2} />}
      </IconButton>

      <IconButton
        size="sm"
        aria-label={`Edit proxy ${proxy.name}`}
        title="Edit proxy"
        onClick={guard(() => onEdit(proxy))}
      >
        <Pencil size={14} strokeWidth={2} />
      </IconButton>

      <IconButton
        size="sm"
        variant="danger"
        aria-label={`Delete proxy ${proxy.name}`}
        title="Delete proxy"
        loading={isDeleting}
        disabled={isDeleting}
        onClick={guard(() => onDelete(proxy))}
      >
        {!isDeleting && <Trash2 size={14} strokeWidth={2} />}
      </IconButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProxyStatusDot — leading indicator based on last_known_ip + rotation health.
// ---------------------------------------------------------------------------

const ROTATION_FRESH_MS = 60 * 60 * 1000; // 1h
const ROTATION_STALE_MS = 24 * 60 * 60 * 1000; // 24h

export interface ProxyStatusDotProps {
  proxy: StoredProxy;
  /** Lets tests pin "now". */
  now?: number;
}

/**
 * Pure classifier for the StatusDot tone.
 *
 * Rules (ordered — first match wins):
 *   1. No IP seen ever              → muted  ("Never contacted")
 *   2. Rotation URL missing         → info   (IP known, no rotation plan)
 *   3. Rotated < 1h ago             → accent pulse (healthy, live)
 *   4. Rotated < 24h ago            → accent (healthy, recent)
 *   5. Rotated > 24h ago            → warn   (stale)
 *   6. Rotation URL set, never ran  → info   (ready but untested)
 */
export function classifyProxyStatus(
  proxy: StoredProxy,
  now: number = Date.now(),
): { tone: StatusTone; pulse: boolean; label: string } {
  if (!proxy.last_known_ip) {
    return { tone: "muted", pulse: false, label: "Never contacted" };
  }
  if (!proxy.rotation_url) {
    return { tone: "info", pulse: false, label: "No rotation configured" };
  }
  if (proxy.last_rotated_at) {
    const ageMs = now - Date.parse(proxy.last_rotated_at);
    if (Number.isFinite(ageMs) && ageMs >= 0) {
      if (ageMs < ROTATION_FRESH_MS) {
        return { tone: "accent", pulse: true, label: "Fresh rotation" };
      }
      if (ageMs < ROTATION_STALE_MS) {
        return { tone: "accent", pulse: false, label: "Recently rotated" };
      }
      return { tone: "warn", pulse: false, label: "Stale — rotate soon" };
    }
  }
  return { tone: "info", pulse: false, label: "Rotation ready, never triggered" };
}

export function ProxyStatusDot({ proxy, now }: ProxyStatusDotProps) {
  const { tone, pulse, label } = classifyProxyStatus(proxy, now);
  return (
    <span className="inline-flex items-center" title={label}>
      <StatusDot tone={tone} pulse={pulse} label={label} />
    </span>
  );
}

export default ProxyActions;
