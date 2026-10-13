/**
 * "Set up CKAM": seven steps whose status is read from the data that already
 * exists (S6: one `GET /api/setup/status`), never stored. A step is done when its
 * records exist, so the guide can be left and resumed at any time, and doing
 * the same work on the normal Settings screens counts too.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export interface SetupCounts {
  companies: number;
  places: number;
  stockRooms: number;
  costCentres: number;
  groups: number;
  items: number;
  vendors: number;
  employees: number;
  stores: number;
  /** An asset code format exists (assets cannot be added without one). */
  codeFormat: boolean;
}

export type SetupStepKey =
  | "company" | "stock-room" | "cost-centre" | "catalogue" | "vendors" | "people" | "code-format";

export interface SetupStep {
  n: number;
  key: SetupStepKey;
  title: string;
  /** What the step asks for, in one line. */
  what: string;
  done: boolean;
  /** What exists today ("2 places · no stock room yet"). */
  status: string;
}

export const SETUP_TOTAL = 7;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const some = (n: number, one: string, many = `${one}s`) => (n === 0 ? `no ${one} yet` : count(n, one, many));

/** The seven steps and their status (pure; exported for tests). */
export function computeSetupSteps(c: SetupCounts): SetupStep[] {
  return [
    {
      n: 1, key: "company", title: "Company",
      what: "The company (or companies) whose assets CKAM keeps.",
      done: c.companies > 0, status: some(c.companies, "company", "companies"),
    },
    {
      n: 2, key: "stock-room", title: "Stock Room / Places",
      what: "A Place (for example Head Office) and at least one Stock Room where new goods are received.",
      done: c.places > 0 && c.stockRooms > 0,
      status: `${some(c.places, "place")} · ${some(c.stockRooms, "stock room")}`,
    },
    {
      n: 3, key: "cost-centre", title: "Cost Centre",
      what: "At least one Cost Centre per company; every asset and PO is booked to one.",
      done: c.costCentres > 0, status: some(c.costCentres, "cost centre"),
    },
    {
      n: 4, key: "catalogue", title: "Asset Groups and first Items",
      what: "A group (with its work area) and the first Items people will pick.",
      done: c.groups > 0 && c.items > 0,
      status: `${some(c.groups, "group")} · ${some(c.items, "Item")}`,
    },
    {
      n: 5, key: "vendors", title: "Vendors",
      what: "Who you buy from: add them by hand or from the ERP.",
      done: c.vendors > 0, status: some(c.vendors, "vendor"),
    },
    {
      n: 6, key: "people", title: "People / Stores",
      what: "The employees and stores that will hold assets (stores can come from the ERP).",
      done: c.employees + c.stores > 0,
      status: `${some(c.employees, "employee")} · ${some(c.stores, "store")}`,
    },
    {
      n: 7, key: "code-format", title: "Asset Code Format",
      what: "How new asset codes are built; assets cannot be added until it is saved.",
      done: c.codeFormat, status: c.codeFormat ? "saved" : "not saved yet",
    },
  ];
}

/** What `GET /api/setup/status` answers (S6): counts and the seven steps from one SELECT. */
export interface SetupStatus {
  company_count: number;
  place_count: number;
  stock_room_count: number;
  cost_centre_count: number;
  category_count: number;
  subcategory_count?: number;
  item_count: number;
  vendor_count: number;
  people_count: number;
  store_count: number;
  code_rule_configured: boolean;
  steps: { key: string; label: string; done: boolean }[];
  done_count: number;
  total_steps: number;
}

export const SETUP_STATUS_KEY = ["setup", "status"];

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const EMPTY_COUNTS: SetupCounts = {
  companies: 0, places: 0, stockRooms: 0, costCentres: 0, groups: 0, items: 0, vendors: 0, employees: 0, stores: 0, codeFormat: false,
};

/** The server's counts as the steps' status words; the server's own `done` decides each step. */
export function stepsFromStatus(s: SetupStatus): SetupStep[] {
  const steps = computeSetupSteps({
    companies: num(s.company_count),
    places: num(s.place_count),
    stockRooms: num(s.stock_room_count),
    costCentres: num(s.cost_centre_count),
    groups: num(s.category_count),
    items: num(s.item_count),
    vendors: num(s.vendor_count),
    employees: num(s.people_count),
    stores: num(s.store_count),
    codeFormat: s.code_rule_configured === true,
  });
  const serverDone = new Map((Array.isArray(s.steps) ? s.steps : []).map((x) => [x.key, x.done === true]));
  return steps.map((step) => (serverDone.has(step.key) ? { ...step, done: serverDone.get(step.key)! } : step));
}

/**
 * The set-up progress from ONE call (S6: `GET /api/setup/status`) instead of eight lists.
 * Any save made while it is on screen (a Settings form, a quick-create, a wizard step)
 * asks for it again, so a step turns "Done" as soon as its data exists.
 */
export function useSetupProgress(enabled = true) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: SETUP_STATUS_KEY,
    queryFn: () => apiClient.get<SetupStatus>("/setup/status"),
    enabled,
  });
  useEffect(() => {
    if (!enabled) return;
    return qc.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success") qc.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
    });
  }, [qc, enabled]);
  const data = q.data;
  const ok = !!data && typeof data === "object" && !Array.isArray(data);
  const steps = ok ? stepsFromStatus(data) : computeSetupSteps(EMPTY_COUNTS);
  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    total: SETUP_TOTAL,
    isLoading: q.isLoading,
    isError: q.isError || (q.isSuccess && !ok),
  };
}
