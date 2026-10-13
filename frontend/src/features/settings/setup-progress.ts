/**
 * "Set up CKAM": seven steps whose status is read from the data that already
 * exists (the normal list endpoints), never stored. A step is done when its
 * records exist, so the guide can be left and resumed at any time, and doing
 * the same work on the normal Settings screens counts too.
 */
import { useQuery } from "@tanstack/react-query";
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

interface Row {
  id: number;
}
interface PersonRow extends Row {
  asset_user_type?: string;
  is_primary_owner?: boolean;
}

const len = (d: unknown) => (Array.isArray(d) ? d.length : 0);

/** Reads the same lists (and query keys) the Settings screens use, so their saves refresh this too. */
export function useSetupProgress(enabled = true) {
  const companiesQ = useQuery({ queryKey: ["masters", "companies"], queryFn: () => apiClient.get<Row[]>("/masters/companies"), enabled });
  const placesQ = useQuery({ queryKey: ["masters", "locations"], queryFn: () => apiClient.get<Row[]>("/masters/locations"), enabled });
  const costQ = useQuery({ queryKey: ["masters", "cost-centers"], queryFn: () => apiClient.get<Row[]>("/masters/cost-centers"), enabled });
  const groupsQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Row[]>("/masters/categories"), enabled });
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Row[]>("/items"), enabled });
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Row[]>("/masters/vendors"), enabled });
  const peopleQ = useQuery({ queryKey: ["asset_users"], queryFn: () => apiClient.get<PersonRow[]>("/asset-users"), enabled });
  const rulesQ = useQuery({ queryKey: ["code-rules"], queryFn: () => apiClient.get<Row[]>("/code-rules"), enabled });
  const all = [companiesQ, placesQ, costQ, groupsQ, itemsQ, vendorsQ, peopleQ, rulesQ];

  const people = (Array.isArray(peopleQ.data) ? peopleQ.data : []).filter((p) => !p.is_primary_owner);
  const ofType = (t: string) => people.filter((p) => p.asset_user_type === t).length;
  const steps = computeSetupSteps({
    companies: len(companiesQ.data),
    places: len(placesQ.data),
    stockRooms: ofType("STOCK_POINT"),
    costCentres: len(costQ.data),
    groups: len(groupsQ.data),
    items: len(itemsQ.data),
    vendors: len(vendorsQ.data),
    employees: ofType("EMPLOYEE"),
    stores: ofType("STORE"),
    codeFormat: len(rulesQ.data) > 0,
  });
  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    total: SETUP_TOTAL,
    isLoading: all.some((q) => q.isLoading),
    isError: all.some((q) => q.isError),
  };
}
