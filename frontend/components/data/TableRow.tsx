"use client";

/**
 * TableRow — a single data row.
 *
 * Height: 36px default, 32px when `dense`.
 * Hover:  4% white overlay (hover:bg-[rgb(255_255_255/0.04)])
 * Selected: 8% white overlay + 2px left --accent border inset
 * NO zebra striping.
 *
 * Usable inside DataTable or standalone (grouped rows, custom bodies).
 * Keyboard: when `clickable`, row is a button role with Enter/Space handlers.
 */

import * as React from "react";
import clsx from "clsx";

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  dense?: boolean;
  selected?: boolean;
  clickable?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

export const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  function TableRow(
    { dense = false, selected = false, clickable = false, disabled = false, onClick, onKeyDown, className, children, style, ...rest },
    ref
  ) {
    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLTableRowElement>) => {
        onKeyDown?.(event);
        if (!clickable || disabled || event.defaultPrevented) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick?.(event as unknown as React.MouseEvent<HTMLTableRowElement>);
        }
      },
      [clickable, disabled, onClick, onKeyDown]
    );

    const interactive = clickable && !disabled;

    return (
      <tr
        ref={ref}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-selected={selected || undefined}
        aria-disabled={disabled || undefined}
        data-selected={selected ? "true" : undefined}
        data-dense={dense ? "true" : undefined}
        onClick={interactive ? onClick : undefined}
        onKeyDown={interactive ? handleKeyDown : undefined}
        className={clsx(
          "group border-b transition-colors",
          interactive && "cursor-pointer",
          // Hover overlay — 4% white. Only when interactive and not already selected.
          interactive && !selected && "hover:bg-[rgb(255_255_255/0.04)]",
          // Focus ring handled globally by :focus-visible in globals.css.
          className
        )}
        style={{
          height: dense ? "var(--row-table-dense)" : "var(--row-table)",
          borderColor: "var(--border)",
          transitionDuration: "var(--dur-fast)",
          transitionTimingFunction: "var(--ease-out)",
          ...(selected && {
            backgroundColor: "rgb(255 255 255 / 0.08)",
            boxShadow: "inset 2px 0 0 0 var(--accent)",
          }),
          ...(disabled && { opacity: 0.5, pointerEvents: "none" }),
          ...style,
        }}
        {...rest}
      >
        {children}
      </tr>
    );
  }
);
