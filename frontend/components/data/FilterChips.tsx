"use client";

/**
 * FilterChips — chip-based filter row with URL-state.
 *
 * Clicking a chip:
 *   1. toggles its value in `active`
 *   2. writes the new set to the `paramName` query param (comma-separated),
 *      preserving every other param
 *   3. calls `onChange(next)` if the parent wants to react
 *
 * Shape:
 *   options:  [{ value, label, count?, icon? }]
 *   active:   string[]         (controlled)
 *   single:   bool              (single-select — selecting one clears the rest)
 *
 * A leading "All" pseudo-chip clears every selection — it's active whenever
 * `active` is empty. Set `allLabel={null}` to hide it.
 */

import * as React from "react";
import clsx from "clsx";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
  /** Semantic tone for the active state. Default "accent" (emerald). */
  tone?: "accent" | "warn" | "error" | "info" | "neutral";
}

export interface FilterChipsProps {
  options: FilterOption[];
  active: string[];
  /** Query-param key the chips write to. Omit to run fully controlled (no URL sync). */
  paramName?: string;
  onChange?: (next: string[]) => void;
  /** Single-select mode: selecting one chip clears the others. Default: false (multi). */
  single?: boolean;
  /** Label for the leading "All" chip. Pass `null` to hide it. Default: "All". */
  allLabel?: string | null;
  /** Count shown on the "All" chip. */
  allCount?: number;
  /** aria-label for the chip group — required for assistive tech. */
  ariaLabel?: string;
  className?: string;
}

export function FilterChips({
  options,
  active,
  paramName,
  onChange,
  single = false,
  allLabel = "All",
  allCount,
  ariaLabel = "Filters",
  className,
}: FilterChipsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const commit = React.useCallback(
    (next: string[]) => {
      onChange?.(next);
      if (!paramName) return;

      const nextParams = new URLSearchParams(searchParams?.toString() ?? "");
      if (next.length === 0) {
        nextParams.delete(paramName);
      } else {
        nextParams.set(paramName, next.join(","));
      }
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [onChange, paramName, pathname, router, searchParams]
  );

  const toggle = React.useCallback(
    (value: string) => {
      if (single) {
        commit(active.includes(value) ? [] : [value]);
        return;
      }
      const isActive = active.includes(value);
      const next = isActive ? active.filter((v) => v !== value) : [...active, value];
      commit(next);
    },
    [active, commit, single]
  );

  const clear = React.useCallback(() => commit([]), [commit]);

  const showAll = allLabel !== null;
  const allIsActive = active.length === 0;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={clsx("flex flex-wrap items-center gap-1.5", className)}
    >
      {showAll && (
        <Chip
          label={allLabel}
          count={allCount}
          active={allIsActive}
          onClick={clear}
          tone="neutral"
        />
      )}

      {options.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          count={option.count}
          icon={option.icon}
          tone={option.tone ?? "accent"}
          active={active.includes(option.value)}
          onClick={() => toggle(option.value)}
        />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Chip — presentational. A thin pill button.
 * ------------------------------------------------------------------------- */

interface ChipProps {
  label: string;
  count?: number;
  icon?: React.ReactNode;
  tone: NonNullable<FilterOption["tone"]>;
  active: boolean;
  onClick: () => void;
}

const TONE_VARS: Record<NonNullable<FilterOption["tone"]>, { bg: string; border: string; text: string }> = {
  accent:  { bg: "var(--accent-bg)", border: "var(--accent-border)", text: "var(--accent)" },
  warn:    { bg: "var(--warn-bg)",   border: "var(--warn-border)",   text: "var(--warn)"   },
  error:   { bg: "var(--error-bg)",  border: "var(--error-border)",  text: "var(--error)"  },
  info:    { bg: "var(--info-bg)",   border: "var(--info-border)",   text: "var(--info)"   },
  neutral: { bg: "var(--bg-raised)", border: "var(--border-strong)", text: "var(--text-primary)" },
};

function Chip({ label, count, icon, tone, active, onClick }: ChipProps) {
  const toneVars = TONE_VARS[tone];

  const style: React.CSSProperties = active
    ? {
        backgroundColor: toneVars.bg,
        borderColor: toneVars.border,
        color: toneVars.text,
        transitionDuration: "var(--dur-fast)",
        transitionTimingFunction: "var(--ease-out)",
      }
    : {
        backgroundColor: "transparent",
        borderColor: "var(--border)",
        color: "var(--text-secondary)",
        transitionDuration: "var(--dur-fast)",
        transitionTimingFunction: "var(--ease-out)",
      };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap border px-2.5 transition-colors",
        "rounded-sm select-none",
        !active && "hover:bg-[rgb(255_255_255/0.04)] hover:text-[var(--text-primary)]"
      )}
      style={{
        height: "26px",
        fontSize: "12px",
        lineHeight: 1,
        fontWeight: 500,
        ...style,
      }}
    >
      {icon && <span className="inline-flex items-center" aria-hidden="true">{icon}</span>}
      <span>{label}</span>
      {typeof count === "number" && (
        <span
          className="tabular-nums"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            fontVariantNumeric: "tabular-nums",
            opacity: active ? 0.9 : 0.7,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
