import { useMemo, useState } from "react";

export interface SortState {
  key: string;
  direction: "asc" | "desc";
}

type Accessor<T> = (row: T) => string | number | null | undefined;

/**
 * Client-side sort for a page's already-fetched rows -- DataTable itself
 * deliberately owns no sorting/filtering state (see its own module
 * docstring); this is the one small reusable piece of that page-owned
 * logic every list screen was duplicating, so it lives here once instead.
 *
 * Click cycle per column: unsorted -> ascending -> descending -> unsorted.
 * `accessors` maps a DataTableColumn's `key` to the raw (not formatted)
 * value to compare -- numbers sort numerically, everything else as a
 * locale-aware string compare; `null`/`undefined` always sort last,
 * regardless of direction, so a table isn't reordered every time you
 * flip a sort with blank values in it.
 */
export function useTableSort<T>(rows: T[], accessors: Record<string, Accessor<T>>) {
  const [sort, setSort] = useState<SortState | null>(null);

  function toggleSort(key: string) {
    setSort((s) => {
      if (!s || s.key !== key) return { key, direction: "asc" };
      if (s.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const accessor = accessors[sort.key];
    if (!accessor) return rows;
    const withValues = rows.map((row) => ({ row, value: accessor(row) }));
    withValues.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      const cmp =
        typeof a.value === "number" && typeof b.value === "number"
          ? a.value - b.value
          : String(a.value).localeCompare(String(b.value));
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return withValues.map((w) => w.row);
  }, [rows, sort, accessors]);

  return { sortedRows, sort, toggleSort };
}
