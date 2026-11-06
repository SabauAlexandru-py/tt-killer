/**
 * LED color tokens — Mission Control V2 brief §1.
 *
 * The CSS source of truth lives in `Led.module.css` (keyframes + per-tone
 * variable bindings) and in `app/globals.css` (shared `--led-*` custom
 * properties). This file re-publishes the same OKLCH values as plain data so
 * runtime consumers — RAF renderers, canvas overlays, log colorizers, future
 * analytics — never fork the palette. Do not edit these constants without
 * updating the CSS module in lockstep.
 */

export type LedTone =
  | "idle"
  | "running"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "busy"
  | "pending"
  | "rainbow";

export type LedPattern =
  | "steady"
  | "pulse"
  | "slow-pulse"
  | "fast-blink"
  | "breathing"
  | "strobe"
  | "heartbeat"
  | "rainbow-idle";

export type LedSize = "xs" | "sm" | "md" | "lg";

/**
 * Operator brightness preference — maps to `--led-brightness-mul` via
 * Settings. Halo alphas multiply through this so the fleet can be dimmed on
 * an operator's secondary monitor without touching fill colors.
 */
export type LedBrightness = "soft" | "normal" | "bright";

/** Pixel diameter per size tier. Base `--led-size` reads this via CSS modules. */
export const LED_PIXEL_SIZE: Record<LedSize, number> = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 14,
};

/**
 * Core lens fills — OKLCH, no alpha. Every value matches V2 brief §1 exactly,
 * including the two tones (`busy` / `pending`) that V1 did not carry.
 */
export const LED_FILL: Record<Exclude<LedTone, "rainbow">, string> = {
  idle: "oklch(0.55 0.00 0)",
  running: "oklch(0.72 0.17 160)",
  success: "oklch(0.78 0.18 150)",
  warning: "oklch(0.78 0.17 85)",
  error: "oklch(0.65 0.22 25)",
  info: "oklch(0.72 0.14 220)",
  busy: "oklch(0.74 0.17 300)",
  pending: "oklch(0.62 0.05 240)",
};

/**
 * Halo (box-shadow) stops — OKLCH with the brief's per-tone alpha curve baked
 * in. Idle carries alpha 0 so an idle lens never bleeds a halo; success is the
 * brightest (0.75) because it is a one-shot "just finished" flash, not a loop.
 */
export const LED_HALO: Record<Exclude<LedTone, "rainbow">, string> = {
  idle: "oklch(0.55 0.00 0 / 0.00)",
  running: "oklch(0.72 0.17 160 / 0.55)",
  success: "oklch(0.82 0.20 150 / 0.75)",
  warning: "oklch(0.78 0.17 85  / 0.55)",
  error: "oklch(0.65 0.22 25  / 0.60)",
  info: "oklch(0.72 0.14 220 / 0.45)",
  busy: "oklch(0.74 0.17 300 / 0.55)",
  pending: "oklch(0.62 0.05 240 / 0.25)",
};

/** Base halo alpha per tone — the raw multiplier the CSS applies to brightness. */
export const LED_HALO_ALPHA: Record<Exclude<LedTone, "rainbow">, number> = {
  idle: 0.0,
  running: 0.55,
  success: 0.75,
  warning: 0.55,
  error: 0.6,
  info: 0.45,
  busy: 0.55,
  pending: 0.25,
};

/** The specular dot top-of-lens — gives the LED a physical plastic feel. */
export const LED_HIGHLIGHT = "oklch(1.0 0 0 / 0.65)";

/** Dark bezel ring around every lens — sells "hardware LED set into a panel". */
export const LED_BEZEL = "oklch(0 0 0 / 0.40)";

/** Halo-alpha scalar applied by Settings → LED brightness (brief §9). */
export const BRIGHTNESS_MULTIPLIER: Record<LedBrightness, number> = {
  soft: 0.7,
  normal: 1.0,
  bright: 1.4,
};

/**
 * Semantic routing: default pattern per tone when the caller does not specify
 * one. Keep this dense — the "read it from across the room" guarantee in
 * brief §2 depends on tone+pattern being tightly coupled.
 */
export const DEFAULT_PATTERN: Record<LedTone, LedPattern> = {
  idle: "steady",
  running: "pulse",
  success: "steady",
  warning: "slow-pulse",
  error: "fast-blink",
  info: "steady",
  busy: "pulse",
  pending: "steady",
  rainbow: "rainbow-idle",
};

/**
 * Hue stops the rainbow-idle keyframes cycle through, at the brief's held
 * saturation of 0.17. Exported so a future RAF renderer can share one array.
 */
export const RAINBOW_HUES = [160, 220, 300, 25, 85] as const;

/**
 * Pattern duration (ms) — exposed for JS-level rate caps (the strobe fallback
 * uses this). Mirrors the keyframe durations in Led.module.css.
 */
export const PATTERN_DURATION_MS: Record<LedPattern, number> = {
  steady: 0,
  pulse: 1800,
  "slow-pulse": 3200,
  "fast-blink": 420,
  breathing: 4200,
  strobe: 180,
  heartbeat: 1400,
  "rainbow-idle": 8000,
};

/**
 * Maximum strobe cycles before falling back to fast-blink — brief §2 epilepsy
 * guard. Six × 180ms = 1080ms of hard strobe before the softer blink takes
 * over.
 */
export const STROBE_MAX_CYCLES = 6;

/* ============================================================================
 * Semantic status mapping — orchestrator state → LED state.
 *
 * Every runtime state the asyncio orchestrator (brief §7) emits lands on
 * exactly one {tone, pattern, label} triple. StatusLED reads from this table.
 * Keep it exhaustive — adding a new state without a mapping must break the
 * TypeScript build.
 * ========================================================================== */

export type AccountStatus =
  | "idle"
  | "queued"
  | "profile_create"
  | "browser_start"
  | "signup_in_flight"
  | "warming"
  | "captcha"
  | "done"
  | "cancelled"
  | "failed"
  | "timeout"
  | "stuck"
  | "bridge_busy"
  | "bridge_connected"
  | "bridge_unreachable";

export interface LedState {
  tone: LedTone;
  pattern: LedPattern;
  /** Short, screen-reader-friendly label. Overridable by callers. */
  label: string;
}

export const STATUS_TO_LED: Record<AccountStatus, LedState> = {
  idle: { tone: "idle", pattern: "steady", label: "Idle" },
  queued: { tone: "info", pattern: "steady", label: "Queued" },
  profile_create: {
    tone: "busy",
    pattern: "pulse",
    label: "Creating profile",
  },
  browser_start: { tone: "busy", pattern: "pulse", label: "Starting browser" },
  signup_in_flight: {
    tone: "running",
    pattern: "pulse",
    label: "Signup in progress",
  },
  warming: { tone: "warning", pattern: "slow-pulse", label: "Warming" },
  captcha: { tone: "warning", pattern: "strobe", label: "Captcha challenge" },
  done: { tone: "success", pattern: "steady", label: "Done" },
  cancelled: { tone: "idle", pattern: "steady", label: "Cancelled" },
  failed: { tone: "error", pattern: "fast-blink", label: "Failed" },
  timeout: { tone: "error", pattern: "fast-blink", label: "Timed out" },
  stuck: { tone: "error", pattern: "fast-blink", label: "Stuck" },
  bridge_busy: { tone: "busy", pattern: "pulse", label: "AdsPower bridge busy" },
  bridge_connected: {
    tone: "running",
    pattern: "heartbeat",
    label: "AdsPower bridge connected",
  },
  bridge_unreachable: {
    tone: "error",
    pattern: "fast-blink",
    label: "AdsPower bridge unreachable",
  },
};
