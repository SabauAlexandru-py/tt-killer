"use client";

/**
 * SortableHeader — a header-cell button that cycles sort state.
 *
 * Click cycle: unsorted → asc → desc → unsorted.
 * Visual: label + a 10px chevron that tilts for direction, muted when inactive.
 *
 * Controlled: pass `currentSort` and `onSortChange`. If `onSortChange` is
 * omitted the header renders a non-interactive label (useful during loading
 * or read-only snapshots).
 */

import * as React from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

import type { SortState, SortDirection, ColumnAlign } from "./DataTable";

export interface SortableHeaderProps {
  label: string;
  sortKey: string;
  currentSort: SortState | null;
  onSortChange?: (next: SortState | null) => void;
  align?: ColumnAlign;
}

export function SortableHeader({
  label,
  sortKey,
  currentSort,
  onSortChange,
  align = "left",
}: SortableHeaderProps) {
  const isActive = currentSort?.key === sortKey;
  const direction: SortDirection | undefined = isActive ? currentSort?.direction : undefined;

  const handleClick = React.useCallback(() => {
    if (!onSortChange) return;
    if (!isActive) {
      onSortChange({ key: sortKey, direction: "asc" });
      return;
    }
    if (direction === "asc") {
      onSortChange({ key: sortKey, direction: "desc" });
      return;
    }
    onSortChange(null);
  }, [direction, isActive, onSortChange, sortKey]);

  const Icon = direction === "asc" ? ChevronUp : direction === "desc" ? ChevronDown : ChevronsUpDown;
  const interactive = Boolean(onSortChange);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!interactive}
      className={clsx(
        "inline-flex items-center gap-1 select-none transition-colors",
        align === "right" && "flex-row-reverse",
        align === "center" && "justify-center",
        interactive ? "cursor-pointer" : "cursor-default",
        "focus-visible:outline-none"
      )}
      style={{
        color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
        fontSize: "11px",
        letterSpacing: "0.06em",
        fontWeight: 600,
        textTransform: "uppercase",
        transitionDuration: "var(--dur-fast)",
        transitionTimingFunction: "var(--ease-out)",
      }}
      aria-label={interactive ? `Sort by ${label}` : label}
    >
      <span>{label}</span>
      <Icon
        aria-hidden="true"
        size={12}
        strokeWidth={2}
        style={{
          color: isActive ? "var(--accent)" : "var(--text-muted)",
          opacity: isActive ? 1 : 0.6,
          flexShrink: 0,
        }}
      />
    </button>
  );
}
