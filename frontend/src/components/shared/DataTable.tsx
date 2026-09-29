import type { ReactNode } from "react";
import { ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/ErrorState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortState } from "@/components/shared/useTableSort";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
  /** Opt-in per column -- paired with the table-level `sort`/`onSortToggle`
   * props below (see useTableSort). A column without this stays a plain,
   * unclickable header, exactly as before this existed. */
  sortable?: boolean;
}

export interface DataTableSelection<T> {
  isSelected: (row: T) => boolean;
  onToggle: (row: T, checked: boolean) => void;
  isAllSelected: boolean;
  onToggleAll: (checked: boolean) => void;
  rowAriaLabel: (row: T) => string;
}

export interface DataTablePagination {
  /** Pre-formatted "Showing X–Y of Z <items>" text -- the noun/plural is the
   * page's business copy, not DataTable's to invent. */
  summary: ReactNode;
  pageLabel: ReactNode;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled: boolean;
  nextDisabled: boolean;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => React.Key;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  /** Required so every caller has to decide what an empty result looks like. */
  emptyState: ReactNode;
  onRowClick?: (row: T) => void;
  selection?: DataTableSelection<T>;
  pagination?: DataTablePagination;
  skeletonRowCount?: number;
  /** Current sort (from useTableSort) and the toggle callback -- both
   * required together for any column to render as sortable; omit both to
   * keep every header plain, as before. */
  sort?: SortState | null;
  onSortToggle?: (key: string) => void;
}

/** CKAM's shared operational-table shell (REVIEW_FINDINGS.md #1). Presents
 * results consistently; does NOT own fetching, query params, sorting, or
 * filtering -- the page keeps that, exactly as AssetRegister already does
 * (AM-03 §7.2). A column whose `cell` renders an interactive control (a
 * checkbox, a button) is responsible for calling `event.stopPropagation()`
 * on it when `onRowClick` is also set -- exactly as the built-in selection
 * checkbox below does -- so an action click never fires row navigation. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  emptyState,
  onRowClick,
  selection,
  pagination,
  skeletonRowCount = 5,
  sort,
  onSortToggle,
}: DataTableProps<T>) {
  const colCount = columns.length + (selection ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Table (components/ui/table.tsx) already wraps itself in its own
          horizontally-scrolling div -- this outer div only clips that to a
          rounded, bordered card; it must not add a second scroll container,
          or the inner one silently becomes the only one that actually
          scrolls while this one measures as non-overflowing. */}
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {selection && (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={selection.isAllSelected}
                    onCheckedChange={(checked) => selection.onToggleAll(checked === true)}
                  />
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead key={col.key} className={col.headerClassName}>
                  {col.sortable && onSortToggle ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => onSortToggle(col.key)}
                      aria-label={`Sort by ${typeof col.header === "string" ? col.header : col.key}`}
                    >
                      {col.header}
                      {sort?.key === col.key ? (
                        sort.direction === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <TableRow>
                <TableCell colSpan={colCount} className="p-0">
                  <ErrorState message={errorMessage} onRetry={onRetry} />
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              Array.from({ length: skeletonRowCount }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {selection && (
                    <TableCell>
                      <Skeleton className="h-4 w-4" />
                    </TableCell>
                  )}
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="p-0">
                  {emptyState}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  className={cn(onRowClick && "cursor-pointer")}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selection && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={selection.rowAriaLabel(row)}
                        checked={selection.isSelected(row)}
                        onCheckedChange={(checked) => selection.onToggle(row, checked === true)}
                      />
                    </TableCell>
                  )}
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.cellClassName}>
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground" aria-live="polite">
            {pagination.summary}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={pagination.onPrevious} disabled={pagination.previousDisabled}>
              Previous
            </Button>
            <span>{pagination.pageLabel}</span>
            <Button variant="outline" size="sm" onClick={pagination.onNext} disabled={pagination.nextDisabled}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
