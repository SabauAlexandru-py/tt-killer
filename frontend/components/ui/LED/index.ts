/**
 * LED component family — barrel export.
 *
 * Minimum public surface the task spec asks for: `Led`, `StatusLED`,
 * `ProgressLED`, plus the `LedTone` and `LedPattern` types. Extra token
 * exports below are opt-in for runtime consumers (RAF renderers, canvas
 * overlays, future analytics) and never fork the OKLCH palette.
 */

export { Led, StatusLED, ProgressLED, default } from "./Led";
export type {
  LedProps,
  StatusLEDProps,
  ProgressLEDProps,
  LedTone,
  LedPattern,
  LedSize,
  AccountStatus,
  LedState,
} from "./Led";
export {
  DEFAULT_PATTERN,
  STATUS_TO_LED,
  LED_FILL,
  LED_HALO,
  LED_HALO_ALPHA,
  LED_HIGHLIGHT,
  LED_BEZEL,
  LED_PIXEL_SIZE,
  BRIGHTNESS_MULTIPLIER,
  PATTERN_DURATION_MS,
  RAINBOW_HUES,
  STROBE_MAX_CYCLES,
} from "./led-colors";
export type { LedBrightness } from "./led-colors";
