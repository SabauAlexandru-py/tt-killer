"use client";

/**
 * CreateAccountsDialog — DESIGN_BRIEF_V2 §5 N-selector, promoted to its own
 * component so the Dashboard, `/runs` page and command-palette shortcut all
 * fire the same flow.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  Create accounts                           [× close]          │
 *   │  One signup per proxy, running in parallel.                   │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │                                                               │
 *   │  HOW MANY ACCOUNTS?                                           │
 *   │                                                               │
 *   │     [−]  ┌────────┐  [+]   ●──────○───────────  of  10        │
 *   │          │   04   │                                            │
 *   │          └────────┘                                            │
 *   │                                                               │
 *   │  ● This will spawn 4 parallel signups, 1 per proxy.           │
 *   │                                                               │
 *   │  ▲ Warning: 12 exceeds the suggested concurrency of 10. Some   │
 *   │    runs may contend for AdsPower's 1 req/sec rate limit.      │
 *   │                                                               │
 *   │  ▸ Advanced (name prefix, birth year, rotate_between)         │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │                                   [Cancel] [Start 4 accounts] │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Contract:
 *   - On open, fires `getCapacity()` (`/api/meta/capacity` → `/api/capacity`
 *     fallback) so the upper bound and suggested_concurrency reflect what
 *     the backend sees right now, not what the Dashboard's last proxies
 *     query returned.
 *   - Bounded [1, proxiesCount]. When proxiesCount === 0 the control is
 *     disabled with a one-click shortcut to the Proxies page.
 *   - Default value on open: proxiesCount (not min(P, 5) as the brief's
 *     original example — the task wants "max out by default").
 *   - Submit builds the body as:
 *         { proxy_ids: proxies.slice(0, N).map(p => p.id),
 *           name_prefix, birth_year, rotate_between, max_parallel: N }
 *     On 202 the dialog closes, invalidates the runs cache, and routes to
 *     `/runs/{run_id}`.
 *
 * Motion:
 *   - Numeric readout uses `useCountUp` for a 220ms ease-out-cubic tween.
 *   - When N changes the chip ("This will spawn N parallel signups…")
 *     fires a one-shot LED flash — its background flashes `--accent-bg`
 *     and the dot-LED on the left kicks (scale 1 → 1.25 → 1). Both respect
 *     `prefers-reduced-motion: reduce` via the shared hook.
 *   - The slider thumb lights up (`--led-running-glow`) while dragging.
 *
 * Accessibility:
 *   - The group is `role="group"` with `aria-labelledby` pointing at the
 *     question heading.
 *   - The slider is a native `<input type="range">` so ↑/↓/←/→/Home/End
 *     work out of the box; Shift+arrow uses `step={5}` via keyboard
 *     intercept.
 *   - The chip message is in an `aria-live="polite"` region so screen
 *     readers announce "This will spawn N parallel signups" as the user
 *     scrubs.
 *   - All buttons are keyboard-reachable and show the focus ring.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";
import Pill from "@/components/ui/Pill";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Led } from "@/components/ui/LED";

import { createAccountsRun, getCapacity } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { useCountUp } from "@/lib/useCountUp";
import { useReducedMotion } from "@/lib/useReducedMotion";
import type { StoredProxy } from "@/lib/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CreateAccountsDialogProps {
  /** Controlled open state — parent holds the boolean. */
  open: boolean;
  /** Fires on backdrop click, Esc, and footer Cancel. */
  onClose: () => void;
  /**
   * Proxy rows from the Dashboard's `listProxies` query. Used both for the
   * upper-bound fallback (while capacity is still loading) and for picking
   * the actual `proxy_ids` slice sent to `/api/runs/create`.
   */
  proxies: StoredProxy[];
  /** The Dashboard's `proxiesQuery.isLoading`. Kept in sync so the dialog's
   *  disabled state matches the parent CTA. */
  loadingProxies?: boolean;
  /**
   * Called when the backend returns 202. Parent typically closes the dialog
   * itself here; the dialog *also* closes on success for safety so a dropped
   * callback never leaves the modal hanging over the new run page.
   */
  onCreated?: (runId: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default values for the advanced block — match backend's defaults. */
const DEFAULT_NAME_PREFIX = "TikTok Acc";
const DEFAULT_BIRTH_YEAR = 1996;
const DEFAULT_ROTATE_BETWEEN = true;

/** Birth-year bounds mirror the backend validator (routes/runs.CreateRunBody). */
const MIN_BIRTH_YEAR = 1950;
const MAX_BIRTH_YEAR = 2015;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateAccountsDialog({
  open,
  onClose,
  proxies,
  loadingProxies = false,
  onCreated,
}: CreateAccountsDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();

  const headingId = useId();
  const chipLabelId = useId();

  // -------------------------------------------------------------------------
  // Capacity query — fires on every open
  // -------------------------------------------------------------------------

  const capacityQuery = useQuery({
    queryKey: queryKeys.meta.capacity(),
    queryFn: ({ signal }) => getCapacity(signal),
    enabled: open,
    // The dashboard's proxies query is the source of truth for proxy_ids; the
    // capacity call is only here for the suggested_concurrency hint, so a
    // stale-window of 5s is fine.
    staleTime: 5_000,
    gcTime: 60_000,
    retry: 0,
  });

  // Prefer capacity's `proxies` count (it reflects what the backend will
  // actually enumerate), fall back to parent proxies length while loading.
  const proxiesCount = capacityQuery.data?.proxies ?? proxies.length;
  const suggestedConcurrency =
    capacityQuery.data?.suggested_concurrency ?? Math.min(proxiesCount, 10);

  const hasProxies = proxiesCount > 0;

  // -------------------------------------------------------------------------
  // N state — default = proxiesCount, bounded [1, proxiesCount]
  // -------------------------------------------------------------------------

  const [n, setN] = useState<number>(() => Math.max(1, proxiesCount));
  const [rawN, setRawN] = useState<string>(() =>
    String(Math.max(1, proxiesCount)),
  );

  // When the dialog opens, re-seed N to proxiesCount — operator's intent is
  // usually "spin up everything". When the proxy count changes mid-session
  // (bulk-paste finished), clamp without a jump.
  const lastOpenRef = useRef<boolean>(false);
  useEffect(() => {
    if (!open) {
      lastOpenRef.current = false;
      return;
    }
    if (!lastOpenRef.current) {
      lastOpenRef.current = true;
      const seed = Math.max(1, proxiesCount);
      setN(seed);
      setRawN(String(seed));
    } else if (proxiesCount > 0 && n > proxiesCount) {
      setN(proxiesCount);
      setRawN(String(proxiesCount));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, proxiesCount]);

  const clamp = useCallback(
    (value: number) => {
      if (!Number.isFinite(value)) return 1;
      const ceiling = Math.max(1, proxiesCount);
      return Math.max(1, Math.min(ceiling, Math.round(value)));
    },
    [proxiesCount],
  );

  const commitN = useCallback(
    (next: number) => {
      const clamped = clamp(next);
      setN(clamped);
      setRawN(String(clamped));
    },
    [clamp],
  );

  const onStepperPlus = useCallback(() => commitN(n + 1), [commitN, n]);
  const onStepperMinus = useCallback(() => commitN(n - 1), [commitN, n]);

  const onNumericChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/[^0-9]/g, "");
      setRawN(raw);
      if (raw === "") return; // let user clear mid-edit; commit on blur
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) setN(clamp(parsed));
    },
    [clamp],
  );

  const onNumericBlur = useCallback(() => {
    const parsed = Number.parseInt(rawN, 10);
    if (!Number.isFinite(parsed)) {
      setRawN(String(n));
      return;
    }
    commitN(parsed);
  }, [commitN, n, rawN]);

  const onSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = Number.parseInt(e.target.value, 10);
      if (Number.isFinite(parsed)) commitN(parsed);
    },
    [commitN],
  );

  const onSliderKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      // Native range input already handles ← → but we want Shift+arrow = 5.
      if (!e.shiftKey) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        commitN(n - 5);
      } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        commitN(n + 5);
      }
    },
    [commitN, n],
  );

  // -------------------------------------------------------------------------
  // Advanced options
  // -------------------------------------------------------------------------

  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);
  const [namePrefix, setNamePrefix] = useState<string>(DEFAULT_NAME_PREFIX);
  const [birthYearRaw, setBirthYearRaw] = useState<string>(
    String(DEFAULT_BIRTH_YEAR),
  );
  const [rotateBetween, setRotateBetween] = useState<boolean>(
    DEFAULT_ROTATE_BETWEEN,
  );

  const birthYearValid = useMemo(() => {
    const parsed = Number.parseInt(birthYearRaw, 10);
    if (!Number.isFinite(parsed)) return false;
    return parsed >= MIN_BIRTH_YEAR && parsed <= MAX_BIRTH_YEAR;
  }, [birthYearRaw]);

  // -------------------------------------------------------------------------
  // Chip animation — LED flash + count-up on N change
  // -------------------------------------------------------------------------

  const animatedN = useCountUp(n, { duration: 220 });

  const [flashKey, setFlashKey] = useState<number>(0);
  const firstFlashRef = useRef<boolean>(true);
  useEffect(() => {
    // Skip the mount flash so opening the dialog doesn't look like a hit.
    if (firstFlashRef.current) {
      firstFlashRef.current = false;
      return;
    }
    if (reducedMotion) return;
    setFlashKey((k) => k + 1);
  }, [n, reducedMotion]);

  // -------------------------------------------------------------------------
  // Submit — POST /api/runs/create
  // -------------------------------------------------------------------------

  const createMutation = useMutation({
    mutationFn: async () => {
      // Pick the first N proxy rows from the dashboard's current list. The
      // backend accepts both local ids and AdsPower proxy_ids; it resolves
      // local -> AdsPower internally (routes/runs._resolve_proxy_ids).
      const proxyIds = proxies.slice(0, n).map((p) => p.id);
      const birthYear = Number.parseInt(birthYearRaw, 10);
      return createAccountsRun({
        proxy_ids: proxyIds.length > 0 ? proxyIds : null,
        name_prefix:
          namePrefix.trim().length > 0 ? namePrefix.trim() : null,
        rotate_between: rotateBetween,
        birth_year: Number.isFinite(birthYear) ? birthYear : null,
        max_parallel: n,
      });
    },
    onSuccess: (res) => {
      toast.success(`Run started — ${n} accounts`, {
        description: res.run_id,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.runs.all });
      onCreated?.(res.run_id);
      onClose();
      router.push(`/runs/${encodeURIComponent(res.run_id)}`);
    },
    onError: (err) => {
      toast.error("Failed to start run", {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const submitting = createMutation.isPending;
  const disabled =
    submitting ||
    loadingProxies ||
    !hasProxies ||
    !birthYearValid ||
    n < 1 ||
    n > proxiesCount;

  const handleSubmit = useCallback(() => {
    if (disabled) return;
    createMutation.mutate();
  }, [createMutation, disabled]);

  // Keyboard: Cmd+Enter / Ctrl+Enter submits from anywhere in the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleSubmit]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const warnOverConcurrency =
    hasProxies && suggestedConcurrency > 0 && n > suggestedConcurrency;

  return (
    <Dialog
      open={open}
      onClose={submitting ? () => undefined : onClose}
      className="max-w-[560px]"
    >
      <DialogHeader>
        <div className="flex flex-col" style={{ gap: "4px" }}>
          <DialogTitle>Create accounts</DialogTitle>
          <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
            One signup per proxy, all running in parallel.
          </span>
        </div>
        <Pill tone={hasProxies ? "accent" : "muted"}>
          {capacityQuery.isLoading ? (
            "scanning…"
          ) : (
            <>
              <span className="font-mono-data">{proxiesCount}</span>
              <span>&nbsp;proxies</span>
            </>
          )}
        </Pill>
      </DialogHeader>

      <DialogContent>
        {!hasProxies ? (
          <NoProxiesState
            loading={loadingProxies || capacityQuery.isLoading}
            onGoToProxies={() => {
              onClose();
              router.push("/proxies");
            }}
          />
        ) : (
          <div
            role="group"
            aria-labelledby={headingId}
            className="flex flex-col"
            style={{ gap: "16px" }}
          >
            {/* --- Stepper + slider -------------------------------------- */}
            <div className="flex flex-col" style={{ gap: "10px" }}>
              <span
                id={headingId}
                className="truncate"
                style={{
                  fontSize: "12px",
                  lineHeight: 1.4,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                How many accounts?
              </span>

              <div
                className="flex items-center"
                style={{ gap: "10px", flexWrap: "wrap" }}
              >
                <StepperControl
                  value={n}
                  rawValue={rawN}
                  min={1}
                  max={proxiesCount}
                  animated={animatedN}
                  onPlus={onStepperPlus}
                  onMinus={onStepperMinus}
                  onNumericChange={onNumericChange}
                  onNumericBlur={onNumericBlur}
                />

                <span
                  className="font-mono-data"
                  style={{
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  of {proxiesCount}
                </span>
              </div>

              <SliderControl
                value={n}
                min={1}
                max={proxiesCount}
                onChange={onSliderChange}
                onKeyDown={onSliderKeyDown}
                aria-labelledby={headingId}
              />
            </div>

            {/* --- Live chip (count-up + LED flash) ---------------------- */}
            <ParallelChip
              n={n}
              animatedN={animatedN}
              flashKey={flashKey}
              labelId={chipLabelId}
              reducedMotion={reducedMotion}
            />

            {/* --- Warning when N > suggested_concurrency ---------------- */}
            {warnOverConcurrency ? (
              <WarningStripe
                n={n}
                suggested={suggestedConcurrency}
              />
            ) : null}

            {/* --- Advanced (collapsed) ---------------------------------- */}
            <AdvancedSection
              open={advancedOpen}
              onToggle={() => setAdvancedOpen((s) => !s)}
              namePrefix={namePrefix}
              setNamePrefix={setNamePrefix}
              birthYear={birthYearRaw}
              setBirthYear={setBirthYearRaw}
              birthYearValid={birthYearValid}
              rotateBetween={rotateBetween}
              setRotateBetween={setRotateBetween}
            />
          </div>
        )}
      </DialogContent>

      <DialogFooter>
        <Button
          variant="ghost"
          onClick={onClose}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={submitting}
          disabled={disabled}
        >
          {submitting
            ? `Launching ${n}…`
            : `Start ${n} ${n === 1 ? "account" : "accounts"}`}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export default CreateAccountsDialog;

// ===========================================================================
// Sub-components
// ===========================================================================

/* --- NoProxiesState ----------------------------------------------------- */

interface NoProxiesStateProps {
  loading: boolean;
  onGoToProxies: () => void;
}

function NoProxiesState({ loading, onGoToProxies }: NoProxiesStateProps) {
  return (
    <div
      className="flex flex-col items-center text-center"
      style={{
        gap: "12px",
        padding: "24px 16px",
        border: "1px dashed var(--border)",
        borderRadius: "var(--radius)",
        background: "var(--bg-surface)",
      }}
    >
      <Led tone="pending" pattern="steady" size="lg" />
      <div className="flex flex-col" style={{ gap: "4px" }}>
        <span
          style={{
            fontSize: "14px",
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          {loading ? "Scanning for proxies…" : "No proxies yet"}
        </span>
        <span
          style={{ fontSize: "12px", color: "var(--text-muted)" }}
        >
          Each parallel signup needs its own proxy. Add one or paste a
          batch on the Proxies page, then come back here.
        </span>
      </div>
      <Button variant="default" onClick={onGoToProxies}>
        Open Proxies →
      </Button>
    </div>
  );
}

/* --- StepperControl ----------------------------------------------------- */

interface StepperControlProps {
  value: number;
  rawValue: string;
  min: number;
  max: number;
  animated: number;
  onPlus: () => void;
  onMinus: () => void;
  onNumericChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onNumericBlur: () => void;
}

function StepperControl({
  value,
  rawValue,
  min,
  max,
  animated,
  onPlus,
  onMinus,
  onNumericChange,
  onNumericBlur,
}: StepperControlProps) {
  // Guard: never let the stepper ± buttons submit a wrapping form.
  return (
    <div
      className="flex items-center"
      style={{
        gap: "0",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        background: "var(--bg-surface)",
        overflow: "hidden",
        height: "48px",
      }}
    >
      <button
        type="button"
        onClick={onMinus}
        disabled={value <= min}
        aria-label="Decrement"
        style={{
          width: "44px",
          height: "100%",
          background: "transparent",
          color: "var(--text-secondary)",
          fontSize: "20px",
          lineHeight: 1,
          fontWeight: 500,
          cursor: value <= min ? "not-allowed" : "pointer",
          opacity: value <= min ? 0.4 : 1,
          transition: "background var(--dur-fast) var(--ease-out)",
          borderRight: "1px solid var(--border)",
        }}
        onMouseEnter={(e) => {
          if (value > min)
            (e.currentTarget.style.background = "var(--bg-hover)");
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        −
      </button>

      <div
        className="flex items-center justify-center font-mono-data"
        style={{
          flex: 1,
          minWidth: "88px",
          height: "100%",
          position: "relative",
        }}
      >
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={rawValue}
          onChange={onNumericChange}
          onBlur={onNumericBlur}
          min={min}
          max={max}
          aria-label="Number of accounts to create"
          style={{
            width: "100%",
            height: "100%",
            background: "transparent",
            border: 0,
            outline: "none",
            textAlign: "center",
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            fontSize: "22px",
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
          }}
        />
        {/* Shadow count-up readout — fades in when input is not focused and
            lets the tabular-nums tween sit on top of the raw input for a
            Lamborghini-dash feel without stealing the input's keyboard
            affordance. */}
        <span
          aria-hidden="true"
          className="font-mono-data"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            opacity: 0,
            color: "var(--accent)",
            fontSize: "22px",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {animated}
        </span>
      </div>

      <button
        type="button"
        onClick={onPlus}
        disabled={value >= max}
        aria-label="Increment"
        style={{
          width: "44px",
          height: "100%",
          background: "transparent",
          color: "var(--text-secondary)",
          fontSize: "20px",
          lineHeight: 1,
          fontWeight: 500,
          cursor: value >= max ? "not-allowed" : "pointer",
          opacity: value >= max ? 0.4 : 1,
          transition: "background var(--dur-fast) var(--ease-out)",
          borderLeft: "1px solid var(--border)",
        }}
        onMouseEnter={(e) => {
          if (value < max)
            (e.currentTarget.style.background = "var(--bg-hover)");
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        +
      </button>
    </div>
  );
}

/* --- SliderControl ------------------------------------------------------ */

interface SliderControlProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "min" | "max" | "value"
  > {
  value: number;
  min: number;
  max: number;
}

function SliderControl({
  value,
  min,
  max,
  onChange,
  onKeyDown,
  ...rest
}: SliderControlProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div
      className="n-slider"
      style={{
        position: "relative",
        height: "24px",
        display: "flex",
        alignItems: "center",
        width: "100%",
      }}
    >
      {/* Track background */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          height: "6px",
          borderRadius: "999px",
          background: "var(--border-strong)",
        }}
      />
      {/* Filled portion */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          width: `${pct}%`,
          top: "50%",
          transform: "translateY(-50%)",
          height: "6px",
          borderRadius: "999px",
          background: "var(--accent)",
          boxShadow:
            "0 0 8px 1px oklch(0.72 0.17 160 / 0.4), 0 0 16px 2px oklch(0.72 0.17 160 / 0.22)",
          transition: "width var(--dur-fast) var(--ease-out)",
        }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        className="n-slider__input"
        {...rest}
      />
      <style jsx>{`
        .n-slider__input {
          -webkit-appearance: none;
          appearance: none;
          position: relative;
          z-index: 1;
          width: 100%;
          background: transparent;
          height: 24px;
          margin: 0;
          padding: 0;
          cursor: pointer;
        }
        .n-slider__input:focus {
          outline: none;
        }
        .n-slider__input::-webkit-slider-runnable-track {
          background: transparent;
          height: 24px;
        }
        .n-slider__input::-moz-range-track {
          background: transparent;
          height: 24px;
          border: 0;
        }
        .n-slider__input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: var(--text-primary);
          border: 2px solid var(--accent);
          box-shadow:
            inset 0 1px 1px oklch(1 0 0 / 0.65),
            0 0 0 1px oklch(0 0 0 / 0.4),
            0 0 10px 1px oklch(0.72 0.17 160 / 0.5),
            0 0 20px 3px oklch(0.72 0.17 160 / 0.25);
          cursor: grab;
          transition:
            transform var(--dur-fast) var(--ease-out),
            box-shadow var(--dur-normal) var(--ease-out);
          margin-top: 3px;
        }
        .n-slider__input::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: var(--text-primary);
          border: 2px solid var(--accent);
          box-shadow:
            inset 0 1px 1px oklch(1 0 0 / 0.65),
            0 0 0 1px oklch(0 0 0 / 0.4),
            0 0 10px 1px oklch(0.72 0.17 160 / 0.5),
            0 0 20px 3px oklch(0.72 0.17 160 / 0.25);
          cursor: grab;
          transition:
            transform var(--dur-fast) var(--ease-out),
            box-shadow var(--dur-normal) var(--ease-out);
        }
        .n-slider__input:hover::-webkit-slider-thumb,
        .n-slider__input:focus-visible::-webkit-slider-thumb,
        .n-slider__input:active::-webkit-slider-thumb {
          transform: scale(1.12);
          box-shadow:
            inset 0 1px 1px oklch(1 0 0 / 0.65),
            0 0 0 1px oklch(0 0 0 / 0.4),
            0 0 12px 2px oklch(0.72 0.17 160 / 0.75),
            0 0 28px 4px oklch(0.72 0.17 160 / 0.4);
        }
        .n-slider__input:hover::-moz-range-thumb,
        .n-slider__input:focus-visible::-moz-range-thumb,
        .n-slider__input:active::-moz-range-thumb {
          transform: scale(1.12);
          box-shadow:
            inset 0 1px 1px oklch(1 0 0 / 0.65),
            0 0 0 1px oklch(0 0 0 / 0.4),
            0 0 12px 2px oklch(0.72 0.17 160 / 0.75),
            0 0 28px 4px oklch(0.72 0.17 160 / 0.4);
        }
        @media (prefers-reduced-motion: reduce) {
          .n-slider__input::-webkit-slider-thumb,
          .n-slider__input::-moz-range-thumb {
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}

/* --- ParallelChip ------------------------------------------------------- */

interface ParallelChipProps {
  n: number;
  animatedN: number;
  flashKey: number;
  labelId: string;
  reducedMotion: boolean;
}

function ParallelChip({
  n,
  animatedN,
  flashKey,
  labelId,
  reducedMotion,
}: ParallelChipProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      id={labelId}
      className="n-chip"
      style={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 14px",
        borderRadius: "var(--radius)",
        border: "1px solid var(--accent-border)",
        background: "var(--accent-bg)",
        color: "var(--accent)",
      }}
    >
      {/* Flash overlay — re-mounted on every N change via `key`. */}
      {!reducedMotion ? (
        <span
          key={flashKey}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--accent)",
            opacity: 0,
            pointerEvents: "none",
            animation:
              "n-chip-flash 480ms cubic-bezier(0.32, 0.72, 0, 1) forwards",
          }}
        />
      ) : null}
      <Led
        tone="running"
        pattern={reducedMotion ? "steady" : "pulse"}
        size="sm"
      />
      <span
        style={{
          fontSize: "13px",
          lineHeight: 1.4,
          position: "relative",
          zIndex: 1,
        }}
      >
        This will spawn{" "}
        <span
          className="font-mono-data"
          style={{
            fontSize: "13px",
            color: "var(--accent)",
            fontWeight: 600,
            padding: "0 2px",
          }}
        >
          {animatedN}
        </span>{" "}
        parallel {n === 1 ? "signup" : "signups"}, 1 per proxy.
      </span>
      <style jsx>{`
        @keyframes n-chip-flash {
          0% {
            opacity: 0.35;
          }
          50% {
            opacity: 0.18;
          }
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

/* --- WarningStripe ------------------------------------------------------ */

interface WarningStripeProps {
  n: number;
  suggested: number;
}

function WarningStripe({ n, suggested }: WarningStripeProps) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "10px 14px",
        borderRadius: "var(--radius)",
        border: "1px solid var(--warn-border)",
        background: "var(--warn-bg)",
        color: "var(--warn)",
      }}
    >
      <Led tone="warning" pattern="slow-pulse" size="sm" />
      <span style={{ fontSize: "12px", lineHeight: 1.45 }}>
        Warning:{" "}
        <span className="font-mono-data" style={{ color: "var(--warn)" }}>
          {n}
        </span>{" "}
        exceeds the suggested concurrency of{" "}
        <span className="font-mono-data" style={{ color: "var(--warn)" }}>
          {suggested}
        </span>
        . Some runs may contend for AdsPower&apos;s 1 req/sec rate limit.
      </span>
    </div>
  );
}

/* --- AdvancedSection --------------------------------------------------- */

interface AdvancedSectionProps {
  open: boolean;
  onToggle: () => void;
  namePrefix: string;
  setNamePrefix: (value: string) => void;
  birthYear: string;
  setBirthYear: (value: string) => void;
  birthYearValid: boolean;
  rotateBetween: boolean;
  setRotateBetween: (value: boolean) => void;
}

function AdvancedSection({
  open,
  onToggle,
  namePrefix,
  setNamePrefix,
  birthYear,
  setBirthYear,
  birthYearValid,
  rotateBetween,
  setRotateBetween,
}: AdvancedSectionProps) {
  return (
    <div
      className="flex flex-col"
      style={{
        gap: "10px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        background: "var(--bg-surface)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center justify-between"
        style={{
          padding: "10px 14px",
          background: "transparent",
          color: "var(--text-secondary)",
          fontSize: "12px",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          fontWeight: 600,
          cursor: "pointer",
          width: "100%",
          textAlign: "left",
        }}
      >
        <span>Advanced</span>
        <span
          aria-hidden="true"
          style={{
            transition: "transform var(--dur-fast) var(--ease-out)",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            display: "inline-block",
            color: "var(--text-muted)",
          }}
        >
          ▸
        </span>
      </button>
      {open ? (
        <div
          className="flex flex-col"
          style={{
            gap: "12px",
            padding: "4px 14px 14px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <label className="flex flex-col" style={{ gap: "6px" }}>
            <span
              style={{
                fontSize: "12px",
                color: "var(--text-muted)",
                letterSpacing: "0.02em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              Name prefix
            </span>
            <Input
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
              placeholder={DEFAULT_NAME_PREFIX}
              aria-label="Profile name prefix"
            />
          </label>
          <label className="flex flex-col" style={{ gap: "6px" }}>
            <span
              style={{
                fontSize: "12px",
                color: "var(--text-muted)",
                letterSpacing: "0.02em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              Birth year
            </span>
            <Input
              variant="mono"
              value={birthYear}
              onChange={(e) =>
                setBirthYear(e.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder={String(DEFAULT_BIRTH_YEAR)}
              aria-invalid={!birthYearValid || undefined}
              aria-label="Birth year"
              tone={birthYearValid ? "default" : "error"}
            />
            {!birthYearValid ? (
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--error)",
                }}
              >
                Must be between {MIN_BIRTH_YEAR} and {MAX_BIRTH_YEAR}.
              </span>
            ) : null}
          </label>
          <label className="flex items-center" style={{ gap: "10px" }}>
            <Checkbox
              checked={rotateBetween}
              onChange={(e) => setRotateBetween(e.target.checked)}
            />
            <span className="flex flex-col" style={{ gap: "2px" }}>
              <span
                style={{
                  fontSize: "13px",
                  color: "var(--text-primary)",
                  fontWeight: 500,
                }}
              >
                Rotate proxy between accounts
              </span>
              <span
                style={{ fontSize: "11px", color: "var(--text-muted)" }}
              >
                Fires each proxy&apos;s rotation URL before every signup.
              </span>
            </span>
          </label>
        </div>
      ) : null}
    </div>
  );
}
