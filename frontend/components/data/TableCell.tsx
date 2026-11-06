"use client";

/**
 * TableCell — a single data cell.
 *
 * - `numeric` → tabular-nums + mono font + right-align by default
 * - `mono`    → mono font without forcing tabular-nums (IDs, hashes)
 * - `align`   → explicit alignment, overrides numeric default
 *
 * Padding and height defer to TableRow + globals.css; cells just handle
 * typography and alignment so the row controls vertical rhythm.
 */

import * as React from "react";
import clsx from "clsx";

import type { ColumnAlign } from "./DataTable";

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  align?: ColumnAlign;
  numeric?: boolean;
  mono?: boolean;
  truncate?: boolean;
  children?: React.ReactNode;
}

export const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  function TableCell({ align, numeric = false, mono = false, truncate = false, className, style, children, ...rest }, ref) {
    const resolvedAlign: ColumnAlign = align ?? (numeric ? "right" : "left");
    const useMono = numeric || mono;

    return (
      <td
        ref={ref}
        className={clsx(
          "align-middle px-3",
          resolvedAlign === "right" && "text-right",
          resolvedAlign === "center" && "text-center",
          resolvedAlign === "left" && "text-left",
          truncate && "max-w-0 truncate",
          className
        )}
        style={{
          color: "var(--text-primary)",
          ...(useMono && {
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            lineHeight: 1.5,
          }),
          ...(numeric && {
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: "\"tnum\" 1, \"zero\" 1",
          }),
          ...style,
        }}
        {...rest}
      >
        {children}
      </td>
    );
  }
);
