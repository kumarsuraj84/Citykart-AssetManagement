import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";

/**
 * The purchase-order list as the server returns it since S2: each PO carries
 * its company and vendor names, unit counts and a status, all over the units
 * the signed-in person may see. Shared by the Purchase Orders list, the
 * Receive queue and Home.
 */
export interface PoListRow {
  id: number;
  company_id: number;
  po_number: string;
  po_date: string;
  vendor_id: number | null;
  cost_center_id?: number | null;
  pi_status?: "NOT_DELIVERED" | "PENDING" | "RECORDED";
  pi_number?: string | null;
  pi_date?: string | null;
  erp_po_code?: number | null;
  company_name?: string | null;
  vendor_name?: string | null;
  ordered_units?: number | null;
  received_units?: number | null;
  waiting_units?: number | null;
  cancelled_units?: number | null;
  /** S7: received + waiting + cancelled -- everything ever ordered on the PO. */
  originally_ordered_units?: number | null;
  /** WAITING | PARTLY_RECEIVED | RECEIVED | CANCELLED */
  status?: string | null;
}

export interface PoListParams {
  status?: string;
  waiting?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

/** The server's default (and our page) size. */
export const PO_PAGE_SIZE = 200;

/** "/purchase-orders?status=WAITING&q=acme&limit=200&offset=0" (empty parts left out). */
export function poListPath(p: PoListParams = {}): string {
  const qs = new URLSearchParams();
  if (p.status) qs.set("status", p.status);
  if (p.waiting !== undefined) qs.set("waiting", String(p.waiting));
  const q = p.q?.trim();
  if (q) qs.set("q", q);
  if (p.limit !== undefined) qs.set("limit", String(p.limit));
  if (p.offset) qs.set("offset", String(p.offset));
  const s = qs.toString();
  return s ? `/purchase-orders?${s}` : "/purchase-orders";
}

export interface PoPage {
  rows: PoListRow[];
  /** Total matching POs before paging; null when the server did not say. */
  total: number | null;
}

/** One page of the PO list. Never throws on an odd body: no rows, unknown total. */
export async function fetchPoPage(p: PoListParams): Promise<PoPage> {
  const page = await apiClient.getPage<PoListRow[]>(poListPath(p));
  const rows = Array.isArray(page?.data) ? page.data : [];
  return { rows, total: typeof page?.total === "number" ? page.total : null };
}

/** How many POs have been loaded, and how many there are in all (null = the server did not say). */
export function loadedAndTotal(pages: PoPage[] | undefined): { loaded: number; total: number | null } {
  const list = pages ?? [];
  const loaded = list.reduce((n, p) => n + p.rows.length, 0);
  const last = list[list.length - 1];
  return { loaded, total: last?.total ?? null };
}

/**
 * The PO list, paged by the server (200 at a time) and searched by it (PO No
 * or vendor); `fetchNextPage` loads the next page ("Load more").
 */
export function usePoPages(params: Omit<PoListParams, "limit" | "offset">, enabled = true) {
  const { status, waiting, q } = params;
  return useInfiniteQuery({
    queryKey: ["purchase-orders", "list", { status: status ?? "", waiting: waiting ?? null, q: q ?? "" }],
    queryFn: ({ pageParam }) =>
      fetchPoPage({ status: status || undefined, waiting, q: q || undefined, limit: PO_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last: PoPage, all: PoPage[]) => {
      const { loaded, total } = loadedAndTotal(all);
      if (total !== null) return loaded < total ? loaded : undefined;
      return last.rows.length === PO_PAGE_SIZE ? loaded : undefined;
    },
    enabled,
  });
}

/** `value`, but only after it has stopped changing for `ms` (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** "3 lines, 104 units waiting" -- the words used after anything adds lines to a PO. */
export function linesAndUnitsSentence(lines: number, units: number): string {
  return `${plural(lines, "line")}, ${plural(units, "unit")} waiting`;
}

export { plural as countWord };
