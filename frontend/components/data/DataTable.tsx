"use client";

/**
 * DataTable — generic typed table for Mission Control.
 *
 * Design contract (DESIGN_SPEC.md):
 *   - 36px rows (32px dense via `dense` prop)
 *   - Sticky header with backdrop-blur so it survives long scrolls
 *   - Hover highlight at 4% white
 *   - Selected row at 8% white + 2px left --accent border
 *   - NO zebra striping
 *   - Numeric columns opt into tabular-nums via `column.numeric`
 *   - Monospaced data cells opt in via `column.mono` (IPs, IDs, timestamps…)
 *
 * No shadcn, no radix. Hand-rolled semantic <table>.
 */

import * as React from "react";
import clsx from "clsx";

import { TableRow } from "./TableRow";
import { TableCell } from "./TableCell";
import { SortableHeader } from "./SortableHeader";

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string;
  direction: SortDirection;
}

export type ColumnAlign = "left" | "right" | "center";

export interface Column<T> {
  /** Stable identifier — also the default sort key. */
  key: string;
  /** Header cell content. String renders inside a SortableHeader when `sortable`. */
  header: React.ReactNode;
  /** Cell renderer per row. */
  cell: (row: T, index: number) => React.ReactNode;
  /** Fixed column width — e.g. `120px`, `12ch`, `1fr`, `40%`. */
  width?: string | number;
  /** Text alignment. Numeric columns default to `right`. */
  align?: ColumnAlign;
  /** Apply `tabular-nums` + mono font so numbers line up. */
  numeric?: boolean;
  /** Force mono font (for IDs/hashes/timestamps that aren't numeric). */
  mono?: boolean;
  /** Mark column as sortable — header becomes a SortableHeader button. */
  sortable?: boolean;
  /** Explicit sort key when it differs from `key`. */
  sortKey?: string;
  /** Extra classes applied to every <td> in this column. */
  cellClassName?: string;
  /** Extra classes applied to the header <th>. */
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Stable key per row — required so React reconciles row identity across sorts. */
  getRowKey: (row: T, index: number) => string | number;
  onRowClick?: (row: T, index: number) => void;
  /** Row key for the currently selected row (opens the Inspector pane). */
  selectedKey?: string | number | null;
  /** 32px rows instead of 36px. */
  dense?: boolean;
  /** Controlled sort state. Omit to render an unsorted table. */
  sort?: SortState | null;
  onSortChange?: (next: SortState | null) => void;
  /** Rendered when `rows.length === 0 && !loading`. */
  empty?: React.ReactNode;
  /** Rendered in place of rows while data is loading. */
  loading?: boolean;
  /** Skeleton row count while loading. */
  skeletonRows?: number;
  /** Sticky header (default true). Turn off inside nested or short tables. */
  stickyHeader?: boolean;
  /** aria-label for the table — required for screen readers. */
  ariaLabel?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  selectedKey,
  dense = false,
  sort,
  onSortChange,
  empty,
  loading = false,
  skeletonRows = 6,
  stickyHeader = true,
  ariaLabel,
  className,
}: DataTableProps<T>) {
  const showEmpty = !loading && rows.length === 0;

  return (
    <div
      className={clsx(
        "relative w-full overflow-auto rounded-md",
        "border",
        className
      )}
      style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-surface)" }}
    >
      <table
        className="w-full border-collapse text-left"
        style={{ fontSize: "13px", lineHeight: 1.5 }}
        aria-label={ariaLabel}
      >
        <colgroup>
          {columns.map((col) => (
            <col
              key={col.key}
              style={col.width != null ? { width: typeof col.width === "number" ? `${col.width}px` : col.width } : undefined}
            />
          ))}
        </colgroup>

        <thead
          className={clsx(stickyHeader && "sticky top-0 z-10")}
          style={{
            backgroundColor: "color-mix(in oklch, var(--bg-surface) 85%, transparent)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <tr>
            {columns.map((col) => {
              const headerAlign = col.align ?? (col.numeric ? "right" : "left");
              const isSortable = Boolean(col.sortable);
              const sortKey = col.sortKey ?? col.key;
              const isSorted = sort?.key === sortKey;
              const direction = isSorted ? sort?.direction : undefined;

              return (
                <th
                  key={col.key}
                  scope="col"
                  className={clsx(
                    "h-9 border-b px-3 align-middle font-semibold uppercase",
                    headerAlign === "right" && "text-right",
                    headerAlign === "center" && "text-center",
                    col.headerClassName
                  )}
                  style={{
                    fontSize: "11px",
                    letterSpacing: "0.06em",
                    color: "var(--text-secondary)",
                    borderColor: "var(--border)",
                    fontWeight: 600,
                  }}
                  aria-sort={
                    isSorted ? (direction === "asc" ? "ascending" : "descending") : isSortable ? "none" : undefined
                  }
                >
                  {isSortable && typeof col.header === "string" ? (
                    <SortableHeader
                      label={col.header}
                      sortKey={sortKey}
                      currentSort={sort ?? null}
                      onSortChange={onSortChange}
                      align={headerAlign}
                    />
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }).map((_, index) => (
                <SkeletonRow key={`skeleton-${index}`} columns={columns} dense={dense} />
              ))
            : rows.map((row, rowIndex) => {
                const key = getRowKey(row, rowIndex);
                const isSelected = selectedKey != null && key === selectedKey;
                const clickable = Boolean(onRowClick);

                return (
                  <TableRow
                    key={key}
                    dense={dense}
                    selected={isSelected}
                    clickable={clickable}
                    onClick={onRowClick ? () => onRowClick(row, rowIndex) : undefined}
                  >
                    {columns.map((col) => (
                      <TableCell
                        key={col.key}
                        align={col.align ?? (col.numeric ? "right" : "left")}
                        numeric={col.numeric}
                        mono={col.mono}
                        className={col.cellClassName}
                      >
                        {col.cell(row, rowIndex)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
        </tbody>
      </table>

      {showEmpty && (
        <div className="w-full">
          {empty ?? (
            <div
              className="flex items-center justify-center px-4 py-10 text-center"
              style={{ color: "var(--text-muted)", fontSize: "12px" }}
            >
              No rows.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Skeleton row — thin shimmer band per cell while data loads.
 * ------------------------------------------------------------------------- */

function SkeletonRow<T>({
  columns,
  dense,
}: {
  columns: Column<T>[];
  dense: boolean;
}) {
  const height = dense ? "var(--row-table-dense)" : "var(--row-table)";
  return (
    <tr style={{ height }} aria-hidden="true">
      {columns.map((col) => (
        <td
          key={col.key}
          className="px-3 align-middle"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span
            className="block rounded-sm"
            style={{
              height: "10px",
              width: col.numeric ? "60%" : "80%",
              marginLeft: col.align === "right" || col.numeric ? "auto" : 0,
              backgroundColor: "var(--bg-raised)",
              opacity: 0.7,
            }}
          />
        </td>
      ))}
    </tr>
  );
}
