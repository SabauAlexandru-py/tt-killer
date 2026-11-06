/**
 * Data-component barrel.
 *
 * Import sites should pull from `@/components/data` so the internal file
 * layout can evolve without touching every call site.
 *
 *   import { DataTable, EmptyState, FilterChips } from "@/components/data";
 */

export { DataTable } from "./DataTable";
export type {
  DataTableProps,
  Column,
  ColumnAlign,
  SortDirection,
  SortState,
} from "./DataTable";

export { TableRow } from "./TableRow";
export type { TableRowProps } from "./TableRow";

export { TableCell } from "./TableCell";
export type { TableCellProps } from "./TableCell";

export { SortableHeader } from "./SortableHeader";
export type { SortableHeaderProps } from "./SortableHeader";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps, EmptyStateAction } from "./EmptyState";

export { FilterChips } from "./FilterChips";
export type { FilterChipsProps, FilterOption } from "./FilterChips";
