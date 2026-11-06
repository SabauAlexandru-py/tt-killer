"use client";

/**
 * AccountRow — one line of the per-account list on the Run detail page.
 *
 * Layout (left → right), 36px row, 20px gutter outside, 16px between slots:
 *
 *   [dot] [profile_name           ] [proxy_id] [pips] [action      …] [timer] [shot]
 *   8px    220px (ellipsis)          120px     110px  1fr              64px    48px
 *
 * The row is a semantic <article>, NOT a <tr>, so it can live inside a
 * DataTable's single-column layout AND stand alone. The parent passes an
 * optional `onSelect` to open the Inspector pane.
 *
 * Progress stage is derived from the AccountResult shape — the backend does
 * not (yet) emit a `current_action`. The heuristic reads the row's forward
 * progress through ip_before → profile_id → screenshots → account, and maps
 * to one of the seven PipState values. See `deriveAccountStage` below.
 */

import { useMemo, type CSSProperties } from "react";

import type { AccountResult } from "@/lib/types";
import { buildApiUrl } from "@/lib/api";
import { ACCOUNT_STATUS_COLORS, tokenVar } from "@/lib/tokens";
import StatusDot from "@/components/ui/StatusDot";

import ElapsedTimer from "./ElapsedTimer";
import ProgressPips, { PIP_LABELS, type PipState } from "./ProgressPips";
import ScreenshotThumb from "./ScreenshotThumb";

export interface AccountRowProps {
  result: AccountResult;
  /** Unix epoch seconds — used by the ElapsedTimer. */
  startedAt: number;
  /** Unix epoch seconds — if present, freezes the timer. */
  endedAt?: number | null;
  /** Expected p50 duration for the whole row, in seconds. */
  p50Seconds?: number | null;
  /** Whether the overall run is still live (parent-controlled). */
  live?: boolean;
  /** Selected highlight — wires up to the Inspector pane later. */
  selected?: boolean;
  onSelect?: (result: AccountResult) => void;
}

/* -------------------------------------------------------------------------- */
/* row                                                                         */
/* -------------------------------------------------------------------------- */

export function AccountRow({
  result,
  startedAt,
  endedAt = null,
  p50Seconds = null,
  live = true,
  selected = false,
  onSelect,
}: AccountRowProps) {
  const stage = useMemo(() => deriveAccountStage(result), [result]);
  const statusToken = ACCOUNT_STATUS_COLORS[result.status];
  const isRunning = result.status === "running";
  const isComplete = result.status === "complete";
  const latestShot = result.screenshots.at(-1) ?? null;

  const clickable = Boolean(onSelect);
  // Left edge is always a 3px border so the row never reflows when the
  // running pulse kicks in. The class `.account-row` sets it transparent,
  // and `.account-row.is-running` animates border-left-color between
  // `--warn` and `--warn-border` on an 1800ms loop (see globals-v2.css).
  // Padding-left drops from 20 → 17 to keep the content gutter constant.
  const rowStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns:
      "16px minmax(140px, 220px) 120px auto minmax(0, 1fr) 72px 48px",
    alignItems: "center",
    gap: "16px",
    height: "48px",
    paddingLeft: "17px",
    paddingRight: "16px",
    borderBottom: "1px solid var(--border)",
    background: selected ? "var(--bg-hover)" : "transparent",
    boxShadow: selected ? "inset 2px 0 0 var(--accent)" : "none",
    cursor: clickable ? "pointer" : "default",
    transition:
      "background-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
  };

  const rowClassName = ["account-row", isRunning ? "is-running" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={rowClassName}
      role={clickable ? "button" : "group"}
      tabIndex={clickable ? 0 : -1}
      aria-label={`Account ${result.profile_name} — ${stage.label}`}
      aria-current={selected ? "true" : undefined}
      onClick={clickable ? () => onSelect?.(result) : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect?.(result);
              }
            }
          : undefined
      }
      onMouseEnter={(event) => {
        if (!selected) event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        if (!selected) event.currentTarget.style.background = "transparent";
      }}
      style={rowStyle}
    >
      <StatusDot tone={statusToken} pulse={isRunning} label={result.status} />

      <span
        className="truncate"
        style={{
          color: "var(--text-primary)",
          fontSize: "13px",
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={result.profile_name}
      >
        {result.profile_name}
      </span>

      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--text-secondary)",
          fontVariantNumeric: "tabular-nums",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={result.proxy_id}
      >
        {result.proxy_id}
      </span>

      <ProgressPips
        currentState={stage.state}
        failed={stage.failed}
        complete={isComplete}
      />

      <span
        aria-live="polite"
        style={{
          fontSize: "12px",
          color: stage.failed
            ? "var(--error)"
            : isRunning
              ? tokenVar(statusToken)
              : "var(--text-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
        title={stage.label}
      >
        {stage.label}
      </span>

      <ElapsedTimer
        startedAt={startedAt}
        endedAt={endedAt}
        p50Seconds={p50Seconds}
        live={live && (isRunning || result.status === "pending")}
      />

      {latestShot ? (
        <ScreenshotThumb
          src={resolveScreenshotUrl(latestShot)}
          alt={`${result.profile_name} latest screenshot`}
          caption={shortName(latestShot)}
          timestamp={endedAt ?? undefined}
        />
      ) : (
        <ScreenshotPlaceholder />
      )}
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* stage derivation                                                            */
/* -------------------------------------------------------------------------- */

export interface AccountStage {
  state: PipState;
  failed: boolean;
  label: string;
}

/**
 * Map an AccountResult's shape onto the seven pipeline stages.
 *
 * Heuristic (no explicit `current_action` on the wire today):
 *   - ip_before unset        → proxy phase
 *   - ip_before set, no id   → launch phase
 *   - profile_id, no account → signup → captcha → otp → password, keyed off
 *                              how many screenshots we've captured so far
 *   - account set            → done (unless status === failed → died late)
 *
 * Returns `failed: true` when AccountResult.status === "failed"; `state` then
 * reports WHICH stage the row died on, so the UI can pin the rose pip in the
 * right position.
 */
export function deriveAccountStage(r: AccountResult): AccountStage {
  const dead = r.status === "failed";
  const errorLine = r.error ? r.error.split("\n")[0]?.slice(0, 140) : null;

  if (r.status === "complete") {
    return { state: "done", failed: false, label: "Complete" };
  }

  if (r.status === "pending") {
    return {
      state: "proxy",
      failed: false,
      label: "Queued",
    };
  }

  if (!r.ip_before) {
    return {
      state: "proxy",
      failed: dead,
      label: dead
        ? errorLine ?? "Proxy check failed"
        : "Checking proxy…",
    };
  }

  if (!r.profile_id) {
    return {
      state: "launch",
      failed: dead,
      label: dead
        ? errorLine ?? "Browser launch failed"
        : "Launching browser…",
    };
  }

  if (!r.account) {
    // Progress through signup → captcha → otp → password based on how many
    // artifacts the run has captured (proxy check + launch together emit ≤ 1
    // shot; from there each phase adds one).
    const stages: ReadonlyArray<PipState> = [
      "signup",
      "captcha",
      "otp",
      "password",
    ];
    const idx = Math.min(
      stages.length - 1,
      Math.max(0, r.screenshots.length - 1),
    );
    const stage = stages[idx] ?? "signup";
    const running = PIP_LABELS[stage];
    return {
      state: stage,
      failed: dead,
      label: dead ? errorLine ?? `${running} failed` : `${running}…`,
    };
  }

  // Account is minted — we're in the tail.
  return {
    state: "done",
    failed: dead,
    label: dead ? errorLine ?? "Post-signup failure" : "Finalizing…",
  };
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a screenshot path to a backend-served URL.
 *
 * - Absolute http(s) URLs pass through untouched.
 * - Everything else is served from the backend's configured static mount at
 *   `/api/screenshots/{path}`. The exact backend convention lands in a later
 *   milestone; this helper is the single edit point when it does.
 */
function resolveScreenshotUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  // Normalize Windows separators + strip any leading `./` or `/`.
  const clean = path
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  return buildApiUrl(`/api/screenshots/${encodeURI(clean)}`);
}

function shortName(path: string): string {
  const clean = path.replace(/\\/g, "/");
  const segments = clean.split("/").filter(Boolean);
  return segments.slice(-2).join("/") || clean;
}

function ScreenshotPlaceholder() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: "48px",
        height: "80px",
        flexShrink: 0,
        border: "1px dashed var(--border)",
        borderRadius: "var(--radius-sm)",
        background: "transparent",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: "10px",
      }}
    >
      —
    </span>
  );
}

export default AccountRow;
