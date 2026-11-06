/**
 * Semantic status → design token maps.
 *
 * Components consume these instead of hardcoding `--accent` / `--warn` /
 * `--error` directly. When we want to swap "pending" from neutral to info
 * blue later, we change it in ONE place and every StatusDot, Pill, and
 * progress pip in the UI follows.
 *
 * Token families mirror `app/globals.css`:
 *
 *   accent  → emerald   (healthy, running, complete)
 *   warn    → amber     (in-flight, warming, degraded)
 *   error   → rose      (stuck, failed, unreachable)
 *   info    → sky       (info chips, neutral highlights)
 *   muted   → neutral   (idle, pending, disabled)
 *
 * The `TokenName` string is also the CSS-variable family: a consumer renders
 * it as `var(--${token})` for the base color, `var(--${token}-bg)` for the
 * 12%-alpha wash, and `var(--${token}-border)` for the 30%-alpha outline —
 * mirroring the three slots the design spec defines for every semantic color.
 *
 * `muted` has no background/border slot in globals.css (it's a text shade);
 * see `tokenBgVar` / `tokenBorderVar` below, which fall back to the surface
 * border tokens so the API stays uniform.
 */

import type { CSSProperties } from "react";
import type { AccountStatus, RunStatus } from "./types";

// ---------------------------------------------------------------------------
// Token family
// ---------------------------------------------------------------------------

export type TokenName = "accent" | "warn" | "error" | "info" | "muted";

/** Every token family that carries bg + border slots. */
export const SEMANTIC_TOKENS = ["accent", "warn", "error", "info"] as const;

// ---------------------------------------------------------------------------
// Status maps
// ---------------------------------------------------------------------------

/**
 * Account-level status → token family.
 *
 *   pending  — queued, nothing happened yet (neutral)
 *   running  — orchestrator is working this row (amber, in-flight)
 *   complete — finished without an error (emerald)
 *   failed   — orchestrator aborted this row (rose)
 */
export const ACCOUNT_STATUS_COLORS: Readonly<Record<AccountStatus, TokenName>> =
  {
    pending: "muted",
    running: "warn",
    complete: "accent",
    failed: "error",
  };

/**
 * Run-level status → token family.
 *
 * Note: a run in `running` state is intentionally emerald, not amber — the
 * emerald dot pulses to signal "the overall orchestrator is healthy and
 * actively working", while per-account amber signals the in-flight row.
 * Two levels, two meanings, one color system.
 */
export const RUN_STATUS_COLORS: Readonly<Record<RunStatus, TokenName>> = {
  running: "accent",
  complete: "accent",
  failed: "error",
};

/**
 * Health badge states for the top-bar HealthBadge and Settings page.
 *
 *   ok        — backend reachable and AdsPower reachable
 *   degraded  — backend reachable but AdsPower unreachable
 *   down      — backend itself is not responding
 *   unknown   — before the first probe resolves
 */
export type HealthState = "ok" | "degraded" | "down" | "unknown";

export const HEALTH_COLORS: Readonly<Record<HealthState, TokenName>> = {
  ok: "accent",
  degraded: "warn",
  down: "error",
  unknown: "muted",
};

// ---------------------------------------------------------------------------
// CSS-variable helpers
// ---------------------------------------------------------------------------

/** `var(--accent)`, `var(--warn)`, etc. For text / dot fill. */
export function tokenVar(token: TokenName): string {
  if (token === "muted") return "var(--text-muted)";
  return `var(--${token})`;
}

/** `var(--accent-bg)` etc. For 12%-alpha backgrounds (chips, pills). */
export function tokenBgVar(token: TokenName): string {
  if (token === "muted") return "var(--bg-raised)";
  return `var(--${token}-bg)`;
}

/** `var(--accent-border)` etc. For 30%-alpha outlines. */
export function tokenBorderVar(token: TokenName): string {
  if (token === "muted") return "var(--border)";
  return `var(--${token}-border)`;
}

/**
 * All three CSS variables in one object, suitable for spreading into a React
 * `style` prop:
 *
 *   <span style={{ ...tokenStyle("warn"), color: "var(--text-primary)" }} />
 *
 * Exposes:
 *   --token-fg      → base color (dot, text)
 *   --token-bg      → 12%-alpha wash
 *   --token-border  → 30%-alpha outline
 */
export function tokenStyle(token: TokenName): CSSProperties {
  return {
    ["--token-fg" as never]: tokenVar(token),
    ["--token-bg" as never]: tokenBgVar(token),
    ["--token-border" as never]: tokenBorderVar(token),
  } as CSSProperties;
}

/** Return true when the token represents an in-flight state worth pulsing. */
export function isInFlight(token: TokenName): boolean {
  return token === "warn" || token === "accent";
}
