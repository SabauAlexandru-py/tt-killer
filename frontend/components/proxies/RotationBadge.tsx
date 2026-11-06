"use client";

/**
 * RotationBadge — compact Pill that summarises a stored proxy's rotation state.
 *
 * Reads `last_rotated_at` + `rotation_url` from a StoredProxy and renders one of:
 *
 *   ┌───────────────────────┬──────────┬──────────────────────────────┐
 *   │ Condition             │ Tone     │ Label                        │
 *   ├───────────────────────┼──────────┼──────────────────────────────┤
 *   │ no rotation_url       │ default  │ "no rotation"                │
 *   │ never rotated         │ info     │ "never rotated"              │
 *   │ rotated < 5 min ago   │ accent   │ "rotated Xs ago"             │
 *   │ rotated < 1 h ago     │ accent   │ "rotated Xm ago"             │
 *   │ rotated < 24 h ago    │ info     │ "rotated Xh ago"             │
 *   │ rotated > 24 h ago    │ warn     │ "rotated Xd ago"             │
 *   └───────────────────────┴──────────┴──────────────────────────────┘
 *
 * The age label updates only on re-render — the parent page's TanStack Query
 * poll is enough cadence; we don't need a setInterval ticking inside every row.
 *
 * Keep this self-contained: it's rendered inside tight 36px rows alongside
 * four other cells, so no wrapper div, no tooltip library, no icons.
 */

import { RefreshCw } from "lucide-react";
import Pill, { type PillTone } from "@/components/ui/Pill";

export interface RotationBadgeProps {
  /** ISO-8601 timestamp from `StoredProxy.last_rotated_at`. */
  lastRotatedAt: string | null;
  /** URL from `StoredProxy.rotation_url` — null means rotation is unconfigured. */
  rotationUrl: string | null;
  /** Reference time for age calculations (lets tests pin "now"). Defaults to Date.now(). */
  now?: number;
  className?: string;
}

interface Resolved {
  tone: PillTone;
  label: string;
  title: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Pure classifier — exported so other row renderers (Inspector, logs) can
 * reuse the same "fresh / stale" bucket without duplicating the thresholds.
 */
export function classifyRotation(
  lastRotatedAt: string | null,
  rotationUrl: string | null,
  now: number = Date.now(),
): Resolved {
  if (!rotationUrl) {
    return {
      tone: "default",
      label: "no rotation",
      title: "This proxy has no rotation URL configured.",
    };
  }

  if (!lastRotatedAt) {
    return {
      tone: "info",
      label: "never rotated",
      title: "Rotation URL configured, but never triggered yet.",
    };
  }

  const ts = Date.parse(lastRotatedAt);
  if (Number.isNaN(ts)) {
    return {
      tone: "default",
      label: "unknown",
      title: `Unparseable timestamp: ${lastRotatedAt}`,
    };
  }

  const ageMs = Math.max(0, now - ts);
  const title = `Last rotated ${new Date(ts).toLocaleString()}`;

  if (ageMs < 5 * MINUTE_MS) {
    const seconds = Math.max(1, Math.round(ageMs / 1000));
    return { tone: "accent", label: `rotated ${seconds}s ago`, title };
  }
  if (ageMs < HOUR_MS) {
    const minutes = Math.round(ageMs / MINUTE_MS);
    return { tone: "accent", label: `rotated ${minutes}m ago`, title };
  }
  if (ageMs < DAY_MS) {
    const hours = Math.round(ageMs / HOUR_MS);
    return { tone: "info", label: `rotated ${hours}h ago`, title };
  }
  const days = Math.round(ageMs / DAY_MS);
  return { tone: "warn", label: `rotated ${days}d ago`, title };
}

export function RotationBadge({
  lastRotatedAt,
  rotationUrl,
  now,
  className,
}: RotationBadgeProps) {
  const resolved = classifyRotation(lastRotatedAt, rotationUrl, now);
  const hasRotation = Boolean(rotationUrl);

  return (
    <Pill
      tone={resolved.tone}
      title={resolved.title}
      icon={
        hasRotation ? (
          <RefreshCw aria-hidden="true" size={10} strokeWidth={2} />
        ) : undefined
      }
      className={className}
    >
      {resolved.label}
    </Pill>
  );
}

export default RotationBadge;
