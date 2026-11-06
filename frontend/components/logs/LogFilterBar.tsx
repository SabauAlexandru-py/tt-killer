"use client";

/**
 * LogFilterBar — controls that compose into a predicate applied to the
 * incoming log stream. The parent owns the `LogFilter` state; this bar
 * only renders controls and calls `onChange` with the next value.
 *
 * Controls:
 *   • Level <Select> — "" means "all levels".
 *   • Profile chip row — multi-select. `[]` means "all profiles". Chips are
 *     populated from `availableProfileIds` (the dedup set observed on the
 *     stream so far). An "all profiles" chip clears the set.
 *   • Grep <Input> — case-insensitive substring over `message`.
 *   • Live counters `visible / total` in tabular mono.
 *   • "clear all" button appears only when any filter is active.
 */

import { useId, useMemo } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { cn } from "@/lib/cn";

export interface LogFilter {
  /** "" = all levels; otherwise matches `row.level.toLowerCase()`. */
  level: string;
  /** Empty = all profiles; otherwise only rows whose profileId is in here. */
  profileIds: string[];
  /** Raw substring, case-insensitive, matched on `message`. */
  grep: string;
}

export const EMPTY_LOG_FILTER: LogFilter = {
  level: "",
  profileIds: [],
  grep: "",
};

export interface LogFilterBarProps {
  value: LogFilter;
  onChange: (next: LogFilter) => void;
  /** Profile ids discovered in the current (unfiltered) buffer. */
  availableProfileIds: readonly string[];
  /** Total rows in the buffer (unfiltered). */
  totalCount: number;
  /** Rows currently visible after the filter is applied. */
  visibleCount: number;
}

const LEVEL_OPTIONS = [
  { value: "", label: "all levels" },
  { value: "debug", label: "debug" },
  { value: "info", label: "info" },
  { value: "warn", label: "warn" },
  { value: "error", label: "error" },
];

export default function LogFilterBar({
  value,
  onChange,
  availableProfileIds,
  totalCount,
  visibleCount,
}: LogFilterBarProps) {
  const grepId = useId();
  const selectedSet = useMemo(
    () => new Set(value.profileIds),
    [value.profileIds],
  );

  const toggleProfile = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...value, profileIds: Array.from(next) });
  };

  const clearProfiles = () => {
    if (value.profileIds.length === 0) return;
    onChange({ ...value, profileIds: [] });
  };

  const clearAll = () => {
    onChange({ ...EMPTY_LOG_FILTER });
  };

  const filterActive =
    value.level !== "" ||
    value.profileIds.length > 0 ||
    value.grep.trim() !== "";

  return (
    <section
      aria-label="Log filters"
      className={cn(
        "flex flex-col gap-2",
        "px-4 py-3",
        "bg-[var(--bg-surface)] border-b border-[var(--border)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[140px]">
          <Select
            value={value.level}
            options={LEVEL_OPTIONS}
            onChange={(e) =>
              onChange({ ...value, level: e.currentTarget.value })
            }
            aria-label="Filter by level"
          />
        </div>

        <div className="flex-1 min-w-[220px]">
          <Input
            id={grepId}
            placeholder="grep log messages…"
            value={value.grep}
            onChange={(e) =>
              onChange({ ...value, grep: e.currentTarget.value })
            }
            aria-label="Grep log messages"
            leading={<MagnifyingGlass />}
          />
        </div>

        <div
          className="font-mono-data shrink-0"
          aria-live="polite"
          style={{ color: "var(--text-muted)" }}
        >
          <span style={{ color: "var(--text-secondary)" }}>
            {visibleCount}
          </span>
          <span className="px-1">/</span>
          <span>{totalCount}</span>
        </div>

        {filterActive ? (
          <button
            type="button"
            onClick={clearAll}
            className={cn(
              "h-9 px-3 shrink-0",
              "rounded-[var(--radius)] border border-[var(--border)]",
              "text-[12px] text-[var(--text-secondary)]",
              "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
              "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
              "focus-visible:outline-[var(--border-focus)]",
            )}
          >
            clear all
          </button>
        ) : null}
      </div>

      <ProfileChips
        available={availableProfileIds}
        selected={selectedSet}
        onToggle={toggleProfile}
        onClear={clearProfiles}
      />
    </section>
  );
}

function ProfileChips({
  available,
  selected,
  onToggle,
  onClear,
}: {
  available: readonly string[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  if (available.length === 0) {
    return (
      <div
        className="font-mono-data text-[11px]"
        style={{ color: "var(--text-muted)" }}
      >
        no profiles seen yet — once log lines arrive they&apos;ll appear
        here as chips.
      </div>
    );
  }

  const allActive = selected.size === 0;

  return (
    <div
      role="group"
      aria-label="Filter by profile id"
      className="flex flex-wrap items-center gap-1"
    >
      <button
        type="button"
        onClick={onClear}
        aria-pressed={allActive}
        className={cn(
          "inline-flex items-center h-5 px-2 shrink-0",
          "rounded-[var(--radius-sm)] border",
          "text-[11px] leading-none font-medium tracking-[0.02em]",
          "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
          "focus-visible:outline-[var(--border-focus)]",
          allActive
            ? "bg-[var(--accent-bg)] text-[var(--accent)] border-[var(--accent-border)]"
            : "bg-[var(--bg-raised)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]",
        )}
      >
        all profiles
      </button>
      {available.map((id) => {
        const active = selected.has(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onToggle(id)}
            aria-pressed={active}
            title={id}
            className={cn(
              "inline-flex items-center h-5 px-2 max-w-[180px]",
              "rounded-[var(--radius-sm)] border",
              "font-mono-data text-[11px] leading-none",
              "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
              "focus-visible:outline-[var(--border-focus)]",
              active
                ? "bg-[var(--accent-bg)] text-[var(--accent)] border-[var(--accent-border)]"
                : "bg-[var(--bg-raised)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]",
            )}
          >
            <span className="truncate">{id}</span>
          </button>
        );
      })}
    </div>
  );
}

function MagnifyingGlass() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
