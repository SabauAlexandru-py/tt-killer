"use client";

/**
 * ViewSwitcher — segmented [Grid | Table] toggle for /profiles.
 *
 * DESIGN_BRIEF_V2 §4: grid is the default view, table is the dense fallback.
 * The control lives in the TopBar's `actions` slot and hands the selected
 * mode back via `onChange`. Stays dumb — parent owns the state so URL/query
 * state can be wired later without touching this file.
 *
 * Visuals match Mission Control's chrome: `--bg-raised` track, `--accent-bg`
 * active pill, 2px focus ring using `--border-focus`. The indicator slides
 * via `transform: translateX()` for GPU-friendly motion (brief §3, no `left`
 * animations outside nav-expand). The active pill wears a small running-tone
 * LED so the segmented control reads as hardware the same way the inspector
 * and profile cards do.
 *
 * Persistence:
 *   Pair the component with `useProfilesView()` — a localStorage-backed hook
 *   keyed on `adspower-profiles-view` (SSR-safe, degrades to in-memory when
 *   storage is blocked). Keep the component controlled so URL-state or a
 *   future query-param sync can slot in without touching this file.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LayoutGrid, Rows3 } from "lucide-react";
import { Led } from "@/components/ui/LED";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Public types + storage key
// ---------------------------------------------------------------------------

export type ProfilesView = "grid" | "table";

/** localStorage key — kept here so page + hook + any future caller agree. */
export const PROFILES_VIEW_STORAGE_KEY = "adspower-profiles-view";

interface SegmentDef {
  key: ProfilesView;
  label: string;
  icon: ReactNode;
}

const SEGMENTS: SegmentDef[] = [
  {
    key: "grid",
    label: "Grid",
    icon: <LayoutGrid size={13} strokeWidth={1.75} aria-hidden />,
  },
  {
    key: "table",
    label: "Table",
    icon: <Rows3 size={13} strokeWidth={1.75} aria-hidden />,
  },
];

// ---------------------------------------------------------------------------
// <ViewSwitcher>
// ---------------------------------------------------------------------------

export interface ViewSwitcherProps {
  value: ProfilesView;
  onChange: (next: ProfilesView) => void;
  /** Visually hide the labels when space is tight (tabs still keyboard-reachable). */
  compact?: boolean;
  className?: string;
}

export function ViewSwitcher({
  value,
  onChange,
  compact = false,
  className,
}: ViewSwitcherProps) {
  const groupId = useId();
  const activeIndex = SEGMENTS.findIndex((s) => s.key === value);

  return (
    <div
      role="tablist"
      aria-label="Profile view"
      className={cn("relative inline-flex items-center", className)}
      style={{
        padding: "3px",
        height: "32px",
        borderRadius: "var(--radius)",
        background: "var(--bg-raised)",
        border: "1px solid var(--border)",
        gap: "2px",
      }}
    >
      {/* Sliding pill — pure transform; background/border fade on top */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: "3px",
          left: "3px",
          width: `calc((100% - 6px) / ${SEGMENTS.length})`,
          height: "calc(100% - 6px)",
          borderRadius: "calc(var(--radius) - 2px)",
          background: "var(--accent-bg)",
          border: "1px solid var(--accent-border)",
          transform: `translateX(${activeIndex * 100}%)`,
          transition:
            "transform var(--dur-normal) var(--ease-smooth), background var(--dur-fast) var(--ease-out)",
          willChange: "transform",
          pointerEvents: "none",
        }}
      />
      {SEGMENTS.map((seg) => {
        const active = seg.key === value;
        return (
          <button
            key={seg.key}
            id={`${groupId}-${seg.key}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`profiles-view-${seg.key}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(seg.key)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const delta = e.key === "ArrowRight" ? 1 : -1;
                const next =
                  (SEGMENTS.length + activeIndex + delta) % SEGMENTS.length;
                const nextSeg = SEGMENTS[next];
                if (nextSeg) onChange(nextSeg.key);
              } else if (e.key === "Home") {
                e.preventDefault();
                const first = SEGMENTS[0];
                if (first) onChange(first.key);
              } else if (e.key === "End") {
                e.preventDefault();
                const last = SEGMENTS[SEGMENTS.length - 1];
                if (last) onChange(last.key);
              }
            }}
            className="relative inline-flex items-center justify-center"
            style={{
              gap: "6px",
              height: "26px",
              padding: compact ? "0 8px" : "0 10px",
              minWidth: compact ? "26px" : undefined,
              borderRadius: "calc(var(--radius) - 2px)",
              fontSize: "12px",
              fontWeight: active ? 600 : 500,
              lineHeight: 1,
              color: active ? "var(--accent)" : "var(--text-secondary)",
              background: "transparent",
              border: "none",
              cursor: active ? "default" : "pointer",
              transition:
                "color var(--dur-fast) var(--ease-out), font-weight var(--dur-fast) var(--ease-out)",
              zIndex: 1,
            }}
          >
            {/* Active pill gets a small running-tone LED on the leading edge
                — hardware cue that the segmented control is "alive". The CSS
                lens inherits the same bezel + halo system the inspector LEDs
                use, so the whole interface reads as one panel. */}
            {active ? (
              <Led
                tone="running"
                pattern="steady"
                size="xs"
                glow
                aria-hidden
                style={{ flexShrink: 0 }}
              />
            ) : (
              <span style={{ display: "inline-flex", color: "var(--text-muted)" }}>
                {seg.icon}
              </span>
            )}
            {!compact && <span>{seg.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// useProfilesView — localStorage-backed hook
// ---------------------------------------------------------------------------

/**
 * React hook that reads + writes the persisted profiles-view preference.
 *
 * - Default: `"grid"` (matches brief §4 "Grid is default up to 200 profiles").
 * - Reads once on mount from `localStorage['adspower-profiles-view']`; a
 *   corrupt value falls back silently.
 * - Writes on every change via `setView`. Never throws — blocked storage
 *   (private window, strict CSP) degrades to in-memory state.
 * - SSR-safe: the first render on the server returns `defaultValue` and we
 *   hydrate on the client inside a `useEffect`, so Next's hydration doesn't
 *   warn and the sliding pill doesn't snap on first paint.
 *
 * Usage inside /profiles/page.tsx:
 *
 *   const [view, setView] = useProfilesView();
 *   <ViewSwitcher value={view} onChange={setView} />
 */
export function useProfilesView(
  defaultValue: ProfilesView = "grid",
): readonly [ProfilesView, (next: ProfilesView) => void] {
  const [view, setViewState] = useState<ProfilesView>(defaultValue);

  // Hydrate from storage after mount — SSR defaults stay stable so React's
  // hydration doesn't complain about client/server markup mismatches.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PROFILES_VIEW_STORAGE_KEY);
      if (raw === "grid" || raw === "table") {
        setViewState(raw);
      }
    } catch {
      // Storage blocked — stick with the default.
    }
  }, []);

  const setView = useCallback((next: ProfilesView) => {
    setViewState(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PROFILES_VIEW_STORAGE_KEY, next);
    } catch {
      // Storage blocked — in-memory only, carry on.
    }
  }, []);

  // Stable tuple so React compares it by reference across renders.
  return useMemo(() => [view, setView] as const, [view, setView]);
}

export default ViewSwitcher;
