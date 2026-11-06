/**
 * profile-format — formatting helpers shared between ProfileTable and
 * ProfileInspector.
 *
 * Keeping them in one place guarantees the inspector and the row display
 * the same thing for the same profile — if "proxy" is "res.proxyrack.net:9000"
 * in the row, it's "res.proxyrack.net:9000" in the inspector too.
 *
 * AdsPower's Local API is a moving target: timestamps arrive as ISO strings,
 * unix seconds, unix millis, or the odd "2026-10-31 14:12:00" blob. These
 * helpers try every form and fall back to the original string instead of
 * throwing — a dense data table should never explode because one row has
 * a weird date.
 */

import type { AdsPowerProfile, AdsPowerUserProxyConfig } from "@/lib/types";
import type { TokenName } from "@/lib/tokens";

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

export interface ProfileStatus {
  label: string;
  tone: TokenName;
}

/**
 * Collapse AdsPower profile into a tiny status pill.
 *
 * - `active` / `is_active` / `status` extras (if present) win.
 * - Otherwise: "ready" when a proxy host is wired, "no proxy" when not.
 *
 * Returning a plain object (rather than JSX) lets the table render a
 * StatusDot + Pill side-by-side while the inspector can render just the pill.
 */
export function deriveProfileStatus(profile: AdsPowerProfile): ProfileStatus {
  // Honor any upstream "active" signal AdsPower may surface as an extra.
  const upstreamActive = coerceBool(profile["active"] ?? profile["is_active"]);
  if (upstreamActive === true) return { label: "Running", tone: "accent" };
  if (upstreamActive === false && profile.user_proxy_config?.proxy_host) {
    return { label: "Idle", tone: "muted" };
  }

  const upstreamStatus = profile["status"];
  if (typeof upstreamStatus === "string" && upstreamStatus.length > 0) {
    const lower = upstreamStatus.toLowerCase();
    if (lower === "active" || lower === "running") {
      return { label: "Running", tone: "accent" };
    }
    if (lower === "closed" || lower === "idle" || lower === "stopped") {
      return { label: "Idle", tone: "muted" };
    }
  }

  if (profile.user_proxy_config?.proxy_host) {
    return { label: "Ready", tone: "accent" };
  }
  return { label: "No proxy", tone: "warn" };
}

function coerceBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes")
      return true;
    if (normalized === "false" || normalized === "0" || normalized === "no")
      return false;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Proxy formatting
// ---------------------------------------------------------------------------

/**
 * "host:port" for a profile's proxy config, or null when nothing is wired.
 *
 * AdsPower returns `proxy_port` as either a string or number; this coerces
 * both and trims whitespace before formatting.
 */
export function formatProxyEndpoint(
  cfg: AdsPowerUserProxyConfig | null | undefined,
): string | null {
  if (!cfg) return null;
  const host = typeof cfg.proxy_host === "string" ? cfg.proxy_host.trim() : "";
  if (!host) return null;
  const portRaw = cfg.proxy_port;
  const port =
    typeof portRaw === "number"
      ? String(portRaw)
      : typeof portRaw === "string"
        ? portRaw.trim()
        : "";
  return port ? `${host}:${port}` : host;
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/**
 * Parse an AdsPower timestamp (ISO string, unix seconds, unix millis, or a
 * "YYYY-MM-DD HH:MM:SS" blob) into a Date, or null when it can't.
 */
export function parseAdsPowerTime(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    const asSeconds = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(asSeconds);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // Pure digits — unix seconds or millis.
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      const asSeconds = n < 1e12 ? n * 1000 : n;
      const d = new Date(asSeconds);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    // "YYYY-MM-DD HH:MM:SS" — turn the space into a 'T' so Safari parses it.
    const spaced = trimmed.includes(" ") && !trimmed.includes("T")
      ? trimmed.replace(" ", "T")
      : trimmed;
    const d = new Date(spaced);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

const RELATIVE_FORMATTER =
  typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl
    ? new Intl.RelativeTimeFormat("en", { numeric: "auto" })
    : null;

/**
 * "2m ago", "4h ago", "3d ago". Falls back to the original string when
 * parsing fails so the operator still sees whatever AdsPower sent.
 */
export function formatRelative(raw: unknown): string {
  const date = parseAdsPowerTime(raw);
  if (!date) return raw == null ? "—" : String(raw);
  if (!RELATIVE_FORMATTER) return date.toISOString();

  const diffSeconds = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return RELATIVE_FORMATTER.format(Math.round(diffSeconds), "second");
  if (abs < 3600)
    return RELATIVE_FORMATTER.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400)
    return RELATIVE_FORMATTER.format(Math.round(diffSeconds / 3600), "hour");
  if (abs < 2592000)
    return RELATIVE_FORMATTER.format(Math.round(diffSeconds / 86400), "day");
  if (abs < 31536000)
    return RELATIVE_FORMATTER.format(Math.round(diffSeconds / 2592000), "month");
  return RELATIVE_FORMATTER.format(Math.round(diffSeconds / 31536000), "year");
}

const ABSOLUTE_FORMATTER =
  typeof Intl !== "undefined"
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

/** Full absolute timestamp (used in `title` attributes for hover disclosure). */
export function formatAbsolute(raw: unknown): string {
  const date = parseAdsPowerTime(raw);
  if (!date) return raw == null ? "" : String(raw);
  return ABSOLUTE_FORMATTER ? ABSOLUTE_FORMATTER.format(date) : date.toISOString();
}
