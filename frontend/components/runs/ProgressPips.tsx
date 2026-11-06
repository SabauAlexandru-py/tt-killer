"use client";

/**
 * ProgressPips — LED family for the 7-stage signup pipeline.
 *
 *   proxy → launch → signup → captcha → otp → password → done
 *
 * Each stage renders a 10px LED with a glowing halo (see .led in
 * globals-v2.css, DESIGN_BRIEF_V2 §1). Between every adjacent pair a 1px
 * connector line sits on top of --border; the moment the preceding stage
 * flips to "done" the connector's accent fill animates from `width: 0%` to
 * `width: 100%` over 300ms, so the chain feels like current flowing between
 * two hardware pins rather than seven disconnected lamps (brief §1).
 *
 * LED state mapping (brief §2):
 *
 *   pending  — `.led--idle`             idle gray,   steady.
 *   active   — amber (--led-warning)    1800ms `keyframe-led-pulse`.
 *   done     — `.led--success`          emerald steady + success glow halo.
 *   failed   — rose (--led-error)       420ms `keyframe-led-fast-blink`.
 *
 * The amber-pulse and fast-blink animations are attached inline so a single
 * element uses the `.led` base + the animation name; `prefers-reduced-motion:
 * reduce` in globals-v2.css applies `animation: none !important` to the base
 * `.led` selector, so every looped LED collapses to steady with no extra
 * code here.
 *
 * Accessibility: the wrapper is `role="progressbar"` with aria-valuemin 1,
 * aria-valuemax 7, aria-valuenow set to the 1-indexed current stage (or 7
 * when `complete`) and an aria-label of the form
 *   "Signup progress, step 3 of 7: Signup form"
 *   "Signup progress, step 4 of 7: Captcha failed"
 *   "Signup progress, step 7 of 7: complete"
 */

import { Fragment, useMemo, type CSSProperties } from "react";

export type PipState =
  | "proxy"
  | "launch"
  | "signup"
  | "captcha"
  | "otp"
  | "password"
  | "done";

type PipStatus = "pending" | "active" | "done" | "failed";

export const PIP_ORDER: ReadonlyArray<PipState> = [
  "proxy",
  "launch",
  "signup",
  "captcha",
  "otp",
  "password",
  "done",
];

export const PIP_LABELS: Readonly<Record<PipState, string>> = {
  proxy: "Proxy check",
  launch: "Browser launch",
  signup: "Signup form",
  captcha: "Captcha",
  otp: "OTP",
  password: "Password",
  done: "Finalize",
};

export interface ProgressPipsProps {
  /** The stage the account is currently in (or finished at). */
  currentState: PipState;
  /** Marks the current stage as a failure (rose fast-blink, no pulse). */
  failed?: boolean;
  /**
   * Pipeline fully finished — every LED lights emerald regardless of
   * `currentState` index. Fired when AccountResult.status === "complete".
   */
  complete?: boolean;
  /** Extra class names on the wrapper. */
  className?: string;
  /** Connector gap on each side, in px. Default: 4px (compact). */
  gap?: number;
  /** Connector length in px. Default: 14px. */
  connectorWidth?: number;
}

export function ProgressPips({
  currentState,
  failed = false,
  complete = false,
  className,
  gap = 4,
  connectorWidth = 14,
}: ProgressPipsProps) {
  const currentIndex = useMemo(
    () => Math.max(0, PIP_ORDER.indexOf(currentState)),
    [currentState],
  );
  const total = PIP_ORDER.length;
  const stepLabel = PIP_LABELS[currentState];
  const announce = complete
    ? `Signup progress, step ${total} of ${total}: complete`
    : `Signup progress, step ${currentIndex + 1} of ${total}: ${
        failed ? `${stepLabel} failed` : stepLabel
      }`;

  return (
    <div
      className={className}
      role="progressbar"
      aria-valuenow={complete ? total : currentIndex + 1}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={announce}
      aria-live="polite"
      title={announce}
      style={{
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      {PIP_ORDER.map((stage, i) => {
        const status = resolveStatus(i, currentIndex, failed, complete);
        const isLast = i === total - 1;
        // Connector between stage i and stage i+1 fills when stage i is done.
        const connectorFilled = complete || i < currentIndex;
        const connectorFailed =
          failed && !complete && i === currentIndex - 1 && !connectorFilled;
        return (
          <Fragment key={stage}>
            <Led status={status} label={PIP_LABELS[stage]} />
            {!isLast && (
              <Connector
                filled={connectorFilled}
                failed={connectorFailed}
                gap={gap}
                width={connectorWidth}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* internals                                                                   */
/* -------------------------------------------------------------------------- */

function resolveStatus(
  stageIndex: number,
  currentIndex: number,
  failed: boolean,
  complete: boolean,
): PipStatus {
  if (complete) return "done";
  if (stageIndex < currentIndex) return "done";
  if (stageIndex === currentIndex) return failed ? "failed" : "active";
  return "pending";
}

interface LedProps {
  status: PipStatus;
  label: string;
}

function Led({ status, label }: LedProps) {
  const title = `${label}${
    status === "failed"
      ? " — failed"
      : status === "active"
        ? " — in progress"
        : status === "done"
          ? " — complete"
          : " — pending"
  }`;
  return (
    <span
      role="presentation"
      aria-label={title}
      title={title}
      className={`led ${LED_CLASS[status]}`.trim()}
      style={LED_STYLE[status]}
    />
  );
}

/**
 * Status → class names on the shared `.led` primitive.
 *   - pending/done map cleanly to existing class modifiers.
 *   - active (amber pulse) and failed (rose fast-blink) inline their fill +
 *     halo + animation because the pre-canned `.led--warning` and
 *     `.led--error` classes reach for `slow-pulse` and `fast-blink` by
 *     default; here we want the 1800ms `keyframe-led-pulse` cadence for the
 *     current stage, same as the top-level status LED does elsewhere.
 */
const LED_CLASS: Record<PipStatus, string> = {
  pending: "led--idle",
  active: "",
  done: "led--success",
  failed: "",
};

const LED_STYLE: Record<PipStatus, CSSProperties> = {
  pending: {},
  active: {
    // CSS custom properties aren't in the standard CSSProperties type; cast.
    ...({
      "--led-fill": "var(--led-warning)",
      "--led-halo": "var(--led-warning-glow)",
    } as unknown as CSSProperties),
    animation: "keyframe-led-pulse 1800ms var(--ease-smooth) infinite",
  },
  done: {},
  failed: {
    ...({
      "--led-fill": "var(--led-error)",
      "--led-halo": "var(--led-error-glow)",
    } as unknown as CSSProperties),
    animation: "keyframe-led-fast-blink 420ms steps(2, end) infinite",
  },
};

interface ConnectorProps {
  filled: boolean;
  failed: boolean;
  gap: number;
  width: number;
}

function Connector({ filled, failed, gap, width }: ConnectorProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        display: "inline-block",
        width: `${width}px`,
        height: "1px",
        margin: `0 ${gap}px`,
        background: "var(--border)",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: "100%",
          width: filled ? "100%" : "0%",
          background: failed ? "var(--error)" : "var(--accent)",
          boxShadow: filled
            ? `0 0 6px 0 ${failed ? "var(--led-error-glow)" : "var(--led-success-glow)"}`
            : "none",
          transition:
            "width 300ms var(--ease-out), background 220ms var(--ease-out), box-shadow 220ms var(--ease-out)",
        }}
      />
    </span>
  );
}

export default ProgressPips;
