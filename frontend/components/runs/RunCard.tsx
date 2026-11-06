"use client";

/**
 * RunCard — dashboard summary tile for a single run (create or warmup).
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ ● run_a1b2c3d4            [create]  04:12pm │  ← mono id · kind pill · mono time
 *   │                                             │
 *   │  running · 3 of 8 profiles                  │  ← status line
 *   │  ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░       │  ← per-profile sparkbar
 *   │                                             │
 *   │  2 ok  ·  1 running  ·  0 failed  ·  5 ••   │  ← mono-data tally
 *   └─────────────────────────────────────────────┘
 *
 * The sparkbar is a strip of fixed-width cells, one per account in the run,
 * each coloured by its AccountStatus. It replaces a progress bar for runs
 * that fan out across many parallel profiles — individual stuck accounts
 * are visible at a glance without opening the run.
 *
 * Status vocabulary (matches StatusDot tones used across the app):
 *   complete → accent (emerald)
 *   running  → warn   (amber, pulsed)
 *   failed   → error  (rose)
 *   pending  → muted  (grey)
 *
 * Clicking the card navigates to /runs/[id]. Keyboard: Enter / Space on the
 * article behaves the same so the dashboard is fully traversable with Tab.
 */

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/cn";
import Pill from "@/components/ui/Pill";
import StatusDot from "@/components/ui/StatusDot";
import { useReducedMotion } from "@/lib/useReducedMotion";
import type { AccountStatus, RunSnapshot } from "@/lib/types";

const RIPPLE_MS = 600;

export interface RunCardProps {
  run: RunSnapshot;
  /**
   * Monotonic trigger key for the row-ripple. Any time this value changes
   * (other than the initial mount), the card plays one 600ms horizontal
   * sweep in `--accent` across itself, then fades. Owners pass the moment
   * they detect a running → complete transition for this run id. Rate-cap
   * lives in the owner (one ripple per run per 500ms, per brief §8).
   */
  rippleKey?: number;
  className?: string;
}

const STATUS_TONE = {
  complete: "accent",
  running: "warn",
  failed: "error",
  pending: "muted",
} as const;

const STATUS_BG = {
  complete: "var(--accent)",
  running: "var(--warn)",
  failed: "var(--error)",
  pending: "var(--bg-hover)",
} as const;

function formatRunTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${mo}-${day} ${hh}:${mm}`;
}

function shortRunId(id: string): string {
  // Keep enough for operator pattern-matching but don't dominate the card.
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-3)}`;
}

export function RunCard({ run, rippleKey, className }: RunCardProps) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  // --- Row ripple -----------------------------------------------------------
  // Triggered whenever `rippleKey` changes to a NEW (non-undefined) value.
  // We re-mount a keyed overlay so the sweep restarts cleanly even if the
  // parent fires two transitions in a row. prefers-reduced-motion collapses
  // the sweep to a 120ms opacity fade.
  const [rippleToken, setRippleToken] = useState<number | null>(null);
  const seenRipple = useRef<number | undefined>(rippleKey);
  useEffect(() => {
    if (rippleKey === undefined) return;
    if (seenRipple.current === rippleKey) return;
    // Skip the "first sighting" — the dashboard mounts cards with a baseline
    // key equal to the run's complete count, and we don't want a sweep on
    // the historical rows every page load.
    if (seenRipple.current === undefined) {
      seenRipple.current = rippleKey;
      return;
    }
    seenRipple.current = rippleKey;
    setRippleToken(rippleKey);
    const t = window.setTimeout(() => setRippleToken(null), RIPPLE_MS);
    return () => window.clearTimeout(t);
  }, [rippleKey]);

  const go = useCallback(() => {
    router.push(`/runs/${encodeURIComponent(run.run_id)}`);
  }, [router, run.run_id]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    },
    [go],
  );

  const tally = useMemo(() => {
    const counts: Record<AccountStatus, number> = {
      pending: 0,
      running: 0,
      complete: 0,
      failed: 0,
    };
    for (const r of run.results) counts[r.status] += 1;
    return counts;
  }, [run.results]);

  const total = run.results.length;
  const runningStatus = run.status === "running";

  const runTone =
    run.status === "complete"
      ? "accent"
      : run.status === "failed"
        ? "error"
        : "warn";

  const kindTone = run.kind === "create" ? "info" : "accent";
  const timeLabel = formatRunTime(run.created_at);

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`Open run ${run.run_id}`}
      onClick={go}
      onKeyDown={onKeyDown}
      className={cn(
        "relative flex flex-col min-w-0 cursor-pointer overflow-hidden",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "hover:border-[var(--border-strong)]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]",
        className,
      )}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "16px 18px",
        gap: "14px",
      }}
    >
      {/* Row ripple — 600ms --accent bar sweeps L→R on running→complete.
          Keyed overlay so a second transition restarts the sweep cleanly. */}
      {rippleToken !== null ? (
        <span
          key={rippleToken}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "inherit",
            pointerEvents: "none",
            overflow: "hidden",
            zIndex: 0,
            // In reduced-motion land this becomes a soft fade with no sweep.
            animation: reducedMotion
              ? `run-card-ripple-fade 180ms var(--ease-out) forwards`
              : undefined,
            background: reducedMotion
              ? "var(--accent-bg)"
              : undefined,
          }}
        >
          {!reducedMotion ? (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: "-45%",
                width: "45%",
                background:
                  "linear-gradient(90deg, oklch(0.72 0.17 160 / 0) 0%, oklch(0.72 0.17 160 / 0.55) 55%, oklch(0.72 0.17 160 / 0) 100%)",
                filter: "blur(0.5px)",
                animation: `run-card-ripple ${RIPPLE_MS}ms var(--ease-smooth) forwards`,
                willChange: "transform, opacity",
              }}
            />
          ) : null}
        </span>
      ) : null}

      {/* Keyframes for the ripple — scoped to this component via styled-jsx
          `global` so the animation name is reachable from inline `animation`
          declarations on the overlay children. */}
      <style jsx global>{`
        @keyframes run-card-ripple {
          0% {
            transform: translateX(0);
            opacity: 0;
          }
          12% {
            opacity: 1;
          }
          88% {
            opacity: 1;
          }
          100% {
            transform: translateX(320%);
            opacity: 0;
          }
        }
        @keyframes run-card-ripple-fade {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }
      `}</style>

      {/* Header row: status dot + mono id + kind pill + mono time */}
      <div
        className="flex items-center min-w-0"
        style={{ gap: "10px", position: "relative", zIndex: 1 }}
      >
        <StatusDot tone={runTone} pulse={runningStatus} />
        <span
          className="truncate font-mono-data"
          style={{ color: "var(--text-primary)", fontWeight: 500 }}
          title={run.run_id}
        >
          {shortRunId(run.run_id)}
        </span>
        <Pill tone={kindTone} className="shrink-0">
          {run.kind}
        </Pill>
        <span style={{ flex: 1 }} aria-hidden="true" />
        <span
          className="shrink-0 font-mono-data"
          style={{ color: "var(--text-muted)" }}
          title={new Date(run.created_at * 1000).toISOString()}
        >
          {timeLabel}
        </span>
      </div>

      {/* Status summary line */}
      <div
        className="flex items-baseline min-w-0"
        style={{ gap: "8px", position: "relative", zIndex: 1 }}
      >
        <span
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color:
              run.status === "complete"
                ? "var(--accent)"
                : run.status === "failed"
                  ? "var(--error)"
                  : "var(--warn)",
            textTransform: "capitalize",
          }}
        >
          {run.status}
        </span>
        <span
          style={{
            fontSize: "12px",
            color: "var(--text-muted)",
          }}
        >
          {tally.complete + tally.failed} of {total || "—"}{" "}
          {run.kind === "warmup" ? "profiles" : "accounts"}
        </span>
      </div>

      {/* Per-profile sparkbar */}
      {total > 0 ? (
        <div
          role="img"
          aria-label={`${tally.complete} complete, ${tally.running} running, ${tally.failed} failed, ${tally.pending} pending`}
          className="flex w-full"
          style={{
            gap: "2px",
            height: "6px",
            borderRadius: "999px",
            overflow: "hidden",
            background: "var(--bg-base)",
            border: "1px solid var(--border)",
            padding: "1px",
            position: "relative",
            zIndex: 1,
          }}
        >
          {run.results.map((r, i) => (
            <span
              key={`${run.run_id}-${r.profile_id ?? r.proxy_id}-${i}`}
              title={`${r.profile_name} — ${r.status}`}
              style={{
                flex: 1,
                height: "100%",
                borderRadius: "1px",
                background: STATUS_BG[r.status],
                animation:
                  r.status === "running"
                    ? "pulse 2s cubic-bezier(0.16, 1, 0.3, 1) infinite"
                    : undefined,
                transformOrigin: "center",
              }}
            />
          ))}
        </div>
      ) : (
        <div
          aria-hidden="true"
          style={{
            height: "6px",
            borderRadius: "999px",
            background: "var(--bg-base)",
            border: "1px solid var(--border)",
            position: "relative",
            zIndex: 1,
          }}
        />
      )}

      {/* Mono tally row */}
      <div
        className="flex items-center flex-wrap font-mono-data"
        style={{
          gap: "12px",
          color: "var(--text-secondary)",
          position: "relative",
          zIndex: 1,
        }}
      >
        <span className="flex items-center" style={{ gap: "6px" }}>
          <StatusDot tone={STATUS_TONE.complete} />
          <span>
            {tally.complete.toString().padStart(2, "0")} ok
          </span>
        </span>
        <span className="flex items-center" style={{ gap: "6px" }}>
          <StatusDot
            tone={STATUS_TONE.running}
            pulse={tally.running > 0}
          />
          <span>
            {tally.running.toString().padStart(2, "0")} run
          </span>
        </span>
        <span className="flex items-center" style={{ gap: "6px" }}>
          <StatusDot tone={STATUS_TONE.failed} />
          <span>
            {tally.failed.toString().padStart(2, "0")} fail
          </span>
        </span>
        <span className="flex items-center" style={{ gap: "6px" }}>
          <StatusDot tone={STATUS_TONE.pending} />
          <span>
            {tally.pending.toString().padStart(2, "0")} wait
          </span>
        </span>
      </div>
    </article>
  );
}

export default RunCard;
