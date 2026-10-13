import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Hash, PackagePlus, ScanBarcode, Search, SlidersHorizontal, UserRound, X } from "lucide-react";
import { PrintLabelsAction } from "../labels/PrintLabelsAction";
import { apiClient } from "../../lib/api-client";
import { useAccess } from "../../lib/access";
import { useMyAssetUserId } from "../../lib/auth-store";
import { useCapabilities } from "../../lib/capabilities";
import { PLACE_TYPES, placeTypeLabel, workAreaLabel, WORK_AREA_OPTIONS } from "../../lib/labels";
import { categoryOptions, companyOptions, itemOptions, placeOptions, vendorOptions } from "../../lib/option-labels";
import { useCategoryLookups, usePlaceLookups } from "../../lib/lookups";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useDebounced } from "../purchase-orders/po-list";
import type { Item } from "../items/types";
import {
  type RegisterSearch, filterKey, holderCode, holderWord, moreFilterCount, registerQuery, statusChipLabel, statusChoiceOf,
  statusChoices, withStatusChoice,
} from "./register-filters";

export type { RegisterSearch };

interface AssetRow {
  id: number;
  asset_code: string;
  legacy_asset_code: string | null;
  description: string;
  brand_id: number | null;
  model: string | null;
  serial_number: string | null;
  serial_pending?: boolean;
  /** For the label too: the Item's name and the ERP code it was bought under. */
  item_name?: string | null;
  erp_item_code?: string | null;
  barcode: string | null;
  po_number: string | null;
  po_date: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  pi_number: string | null;
  pi_date: string | null;
  purchase_cost: number | null;
  tax_percent: number | null;
  tax_amount: number | null;
  total_cost: number | null;
  purchase_date: string;
  warranty_upto: string | null;
  status: string;
  status_since: string;
  asset_domain: string;
  current_asset_user_name: string | null;
  current_asset_user_type?: string | null;
  current_asset_user_location_name?: string | null;
  /** S5: who or what holds it, in words, from one server lookup per page. */
  holder_type?: string | null;
  holder_kind_label?: string | null;
  holder_name?: string | null;
  holder_code?: string | null;
  holder_location_name?: string | null;
  company_name: string | null;
  company_code?: string | null;
  work_area?: string | null;
  work_area_label?: string | null;
  vendor_name: string | null;
  category_name: string | null;
  subcategory_name: string | null;
  cost_center_name: string | null;
  brand_name: string | null;
  custom_fields: Record<string, unknown>;
}

interface CustomFieldDef {
  id: number;
  field_key: string;
  label: string;
  field_type: "text" | "number" | "date" | "dropdown" | "checkbox";
  sort_order: number;
}

interface Option {
  id: number;
  code?: string;
  email?: string;
  name: string;
  asset_user_type?: string | null;
  company_id?: number | null;
  location_id?: number | null;
  gstin?: string | null;
}

/** "All" in a Radix Select (it allows no empty value). */
const ALL = "ALL";

function asArray<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

// Server-side pages of 50 (GET /api/assets returns a page plus the total).
export const PAGE_SIZE = 50;

const dash = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "—" : v);
const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));

function formatCustomFieldValue(raw: unknown, fieldType: CustomFieldDef["field_type"]): string {
  if (raw === undefined || raw === null || raw === "") return "—";
  if (fieldType === "checkbox") return raw ? "Yes" : "No";
  return String(raw);
}

const holderTypeOf = (a: AssetRow) => a.holder_type ?? a.current_asset_user_type ?? null;

/** "Ravi Kumar · Employee · Head Office" (who has it, what they are, where). */
function WithCell({ a }: { a: AssetRow }) {
  const name = a.holder_name ?? a.current_asset_user_name;
  const kind = a.holder_kind_label ?? placeTypeLabel(holderTypeOf(a));
  const place = a.holder_location_name ?? a.current_asset_user_location_name;
  if (!name) return <>—</>;
  const shownPlace = place && place.toLowerCase() !== name.toLowerCase() ? place : null;
  const extra = [kind, shownPlace].filter(Boolean).join(" · ");
  return (
    <span className="whitespace-nowrap">
      <span>{name}</span>
      {extra && <span className="text-muted-foreground"> · {extra}</span>}
    </span>
  );
}

interface AssetColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  className?: string;
  headerClassName?: string;
  cell: (a: AssetRow) => ReactNode;
}

// The register's columns after Code (pinned). The first eight are what most people need;
// the rest are offered by "Columns" (remembered in this browser).
const ASSET_OPTIONAL_COLUMNS: AssetColumnDef[] = [
  { key: "item", label: "Item", defaultVisible: true, cell: (a) => dash(a.item_name) },
  {
    key: "description", label: "Description", defaultVisible: true, className: "max-w-[16rem] truncate text-muted-foreground",
    cell: (a) => <span title={a.description}>{a.description}</span>,
  },
  { key: "serial_number", label: "Serial", defaultVisible: true, className: "font-mono text-xs", cell: (a) => (a.serial_pending ? "Pending" : dash(a.serial_number)) },
  { key: "with", label: "With", defaultVisible: true, cell: (a) => <WithCell a={a} /> },
  { key: "company", label: "Company", defaultVisible: true, cell: (a) => dash(a.company_code ?? a.company_name) },
  { key: "po_number", label: "PO", defaultVisible: true, cell: (a) => dash(a.po_number) },
  {
    key: "status", label: "Status", defaultVisible: true,
    cell: (a) => <StatusBadge status={a.status} holderType={holderTypeOf(a)} compact />,
  },
  { key: "category", label: "Asset group", defaultVisible: false, cell: (a) => dash(a.category_name) },
  { key: "subcategory", label: "Sub-category", defaultVisible: false, cell: (a) => dash(a.subcategory_name) },
  { key: "brand", label: "Brand", defaultVisible: false, cell: (a) => dash(a.brand_name) },
  { key: "model", label: "Model", defaultVisible: false, cell: (a) => dash(a.model) },
  { key: "asset_domain", label: "Work area", defaultVisible: false, cell: (a) => dash(workAreaLabel(a.work_area ?? a.asset_domain)) },
  { key: "legacy_asset_code", label: "Old asset code", defaultVisible: false, cell: (a) => dash(a.legacy_asset_code) },
  { key: "barcode", label: "Barcode", defaultVisible: false, cell: (a) => dash(a.barcode) },
  { key: "vendor", label: "Vendor", defaultVisible: false, cell: (a) => dash(a.vendor_name) },
  { key: "cost_center", label: "Cost Centre", defaultVisible: false, cell: (a) => dash(a.cost_center_name) },
  { key: "po_date", label: "PO Date", defaultVisible: false, cell: (a) => dash(a.po_date) },
  { key: "invoice_number", label: "Invoice Number", defaultVisible: false, cell: (a) => dash(a.invoice_number) },
  { key: "invoice_date", label: "Invoice Date", defaultVisible: false, cell: (a) => dash(a.invoice_date) },
  { key: "pi_number", label: "Purchase Invoice (PI) Number", defaultVisible: false, cell: (a) => dash(a.pi_number) },
  { key: "pi_date", label: "PI Date", defaultVisible: false, cell: (a) => dash(a.pi_date) },
  { key: "purchase_cost", label: "Purchase Cost", defaultVisible: false, className: "text-right tabular-nums", headerClassName: "text-right", cell: (a) => money(a.purchase_cost) },
  { key: "tax_percent", label: "Tax %", defaultVisible: false, className: "text-right tabular-nums", headerClassName: "text-right", cell: (a) => money(a.tax_percent) },
  { key: "tax_amount", label: "Tax Amount", defaultVisible: false, className: "text-right tabular-nums", headerClassName: "text-right", cell: (a) => money(a.tax_amount) },
  { key: "total_cost", label: "Total Cost", defaultVisible: false, className: "text-right tabular-nums", headerClassName: "text-right", cell: (a) => money(a.total_cost) },
  { key: "purchase_date", label: "Purchase Date", defaultVisible: false, cell: (a) => dash(a.purchase_date) },
  { key: "warranty_upto", label: "Warranty Upto", defaultVisible: false, cell: (a) => dash(a.warranty_upto) },
  { key: "status_since", label: "Status Since", defaultVisible: false, cell: (a) => dash(a.status_since) },
];

// Mirrors backend search_service.SORTABLE_COLUMNS (real Asset columns only).
const SORTABLE_COLUMN_KEYS = new Set([
  "description", "model", "serial_number", "status", "legacy_asset_code", "barcode",
  "po_number", "po_date", "invoice_number", "invoice_date", "pi_number", "pi_date",
  "purchase_cost", "tax_percent", "tax_amount", "total_cost", "purchase_date", "warranty_upto", "status_since",
]);

const DEFAULT_VISIBLE_COLUMN_KEYS = ASSET_OPTIONAL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
/** v2 (S5b-1): new default columns, so an older saved choice does not hide them. */
const COLUMN_VISIBILITY_STORAGE_KEY = "ckam.assetRegister.columns.v2";

function loadVisibleColumnKeys(): string[] {
  try {
    const raw = window.localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE_COLUMN_KEYS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_COLUMN_KEYS;
    const strings = parsed.filter((k): k is string => typeof k === "string");
    return strings.length > 0 ? strings : DEFAULT_VISIBLE_COLUMN_KEYS;
  } catch {
    return DEFAULT_VISIBLE_COLUMN_KEYS;
  }
}

const SEARCH_PLACEHOLDER = "Search asset code, serial, barcode, ERP code, item, vendor, PO number or person…";

interface AssetRegisterProps {
  /** The view, from the address bar. */
  search?: RegisterSearch;
  /** Changes the view (the address bar). `replace` for typing, so Back skips each key press. */
  onSearchChange?: (next: RegisterSearch, opts?: { replace?: boolean }) => void;
}

/**
 * Assets: one search box for everything people know about an asset (code,
 * serial, barcode, ERP code, Item, vendor, PO, who has it), "More filters"
 * for the rest, the active filters as removable chips -- all in the address
 * bar, so a view can be shared and Back works. Server-side paging (50) and sorting.
 */
export function AssetRegister({ search = {}, onSearchChange }: AssetRegisterProps = {}) {
  const navigate = useNavigate();
  const { can, isPrimaryOwner } = useAccess();
  const canWork = can("work");
  const myId = useMyAssetUserId();
  const canFilterMine = myId !== null && !isPrimaryOwner;
  const mine = canFilterMine && search.mine === true;
  const setSearch = (next: RegisterSearch, opts?: { replace?: boolean }) => onSearchChange?.(clean(next), opts);

  // --- The search box: typed text goes to the address bar once typing settles (Enter: at once).
  const [text, setText] = useState(search.q ?? "");
  const lastPushed = useRef(search.q ?? "");
  const settled = useDebounced(text, 300);
  useEffect(() => {
    if (settled === lastPushed.current) return;
    lastPushed.current = settled;
    setSearch({ ...search, q: settled || undefined }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);
  useEffect(() => {
    const q = search.q ?? "";
    if (q === lastPushed.current) return;
    lastPushed.current = q;
    setText(q);
  }, [search.q]);
  function searchNow() {
    lastPushed.current = text;
    setSearch({ ...search, q: text || undefined }, { replace: true });
  }

  const [moreOpen, setMoreOpen] = useState(false);
  const key = filterKey(search) + (mine ? `|mine:${myId}` : "");
  const [pageState, setPageState] = useState({ key, page: 0 });
  const page = pageState.key === key ? pageState.page : 0;
  const setPage = (p: number) => setPageState({ key, page: p });
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selection, setSelection] = useState<{ key: string; ids: number[] }>({ key: "", ids: [] });
  const selectionKey = `${key}|${page}|${sortBy}|${sortDir}`;
  const selected = selection.key === selectionKey ? selection.ids : [];
  const setSelected = (fn: (ids: number[]) => number[]) => setSelection({ key: selectionKey, ids: fn(selected) });
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(loadVisibleColumnKeys);

  function toggleColumn(colKey: string) {
    setVisibleColumnKeys((prev) => {
      const next = prev.includes(colKey) ? prev.filter((k) => k !== colKey) : [...prev, colKey];
      try {
        window.localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage blocked: the choice still applies for this visit
      }
      return next;
    });
  }

  function toggleSort(colKey: string) {
    if (sortBy !== colKey) {
      setSortBy(colKey);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortBy(null);
      setSortDir("asc");
    }
    setPage(0);
  }

  const queryString = registerQuery(search, { myId: mine ? myId : null, page, pageSize: PAGE_SIZE, sortBy, sortDir });
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["assets", "register", queryString],
    queryFn: () => apiClient.get<{ items: AssetRow[]; total: number }>(`/assets?${queryString}`),
  });
  const items = Array.isArray(data?.items) ? data!.items : [];
  const total = typeof data?.total === "number" ? data.total : 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastRow = page * PAGE_SIZE + items.length;

  // --- Names for the filters and their chips (short master lists; loaded when needed).
  const needItems = moreOpen || !!search.item;
  const needVendors = moreOpen || !!search.vendor;
  const needPeople = moreOpen || !!search.with;
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items"), enabled: needItems });
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Option[]>("/masters/vendors"), enabled: needVendors });
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Option[]>("/masters/categories") });
  const peopleQ = useQuery({ queryKey: ["asset_users"], queryFn: () => apiClient.get<Option[]>("/asset-users"), enabled: needPeople });
  const categoryLookups = useCategoryLookups(needItems);
  const placeLookups = usePlaceLookups();
  const companiesQ = useQuery({ queryKey: ["masters", "companies"], queryFn: () => apiClient.get<Option[]>("/masters/companies") });
  const { caps } = useCapabilities();
  const allCompanies = asArray<Option>(companiesQ.data);
  const companies = caps && caps.company_ids.length > 0 ? allCompanies.filter((c) => caps.company_ids.includes(c.id)) : allCompanies;
  const rowCompanies = new Set(items.map((a) => a.company_code ?? a.company_name).filter(Boolean));
  const multiCompany = companies.length > 1 || rowCompanies.size > 1;
  const categories = asArray<Option>(categoriesQ.data);
  const itemList = asArray<Item>(itemsQ.data);
  const vendors = asArray<Option>(vendorsQ.data);
  const people = asArray<Option>(peopleQ.data);
  const kind = holderCode(search.holder);
  const peopleOfKind = kind ? people.filter((p) => p.asset_user_type === kind) : people;

  // Every active Custom Field gets its own optional column.
  const { data: customFieldDefsData } = useQuery({
    queryKey: ["masters", "custom-fields"],
    queryFn: () => apiClient.get<CustomFieldDef[]>("/masters/custom-fields"),
  });
  const customFieldColumns: AssetColumnDef[] = useMemo(
    () =>
      asArray<CustomFieldDef>(customFieldDefsData)
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((f) => ({
          key: `custom:${f.field_key}`,
          label: f.label,
          defaultVisible: false,
          cell: (a: AssetRow) => formatCustomFieldValue(a.custom_fields?.[f.field_key], f.field_type),
        })),
    [customFieldDefsData],
  );
  const allOptionalColumns = useMemo(
    () => [...ASSET_OPTIONAL_COLUMNS, ...customFieldColumns].filter((c) => c.key !== "company" || multiCompany),
    [customFieldColumns, multiCompany],
  );

  // "Serial Pending (n)": one cheap count, only for people who can fill them in.
  const serialPendingQ = useQuery({
    queryKey: ["assets", "serial-pending-count"],
    queryFn: () => apiClient.get<{ total?: number }>("/assets?serial_pending=true&limit=1"),
    enabled: canWork,
  });
  const serialPendingCount = typeof serialPendingQ.data?.total === "number" ? serialPendingQ.data.total : null;

  const allSelected = items.length > 0 && items.every((a) => selected.includes(a.id));

  const columns: DataTableColumn<AssetRow>[] = [
    {
      key: "asset_code",
      header: "Code",
      cellClassName: "font-mono text-sm whitespace-nowrap",
      sortable: true,
      cell: (a) => (
        <Link to="/assets/$id" params={{ id: String(a.id) }} onClick={(e) => e.stopPropagation()}>
          {a.asset_code}
        </Link>
      ),
    },
    ...allOptionalColumns.filter((c) => visibleColumnKeys.includes(c.key)).map((c) => ({
      key: c.key,
      header: c.label,
      headerClassName: c.headerClassName,
      cellClassName: c.className,
      cell: c.cell,
      sortable: SORTABLE_COLUMN_KEYS.has(c.key),
    })),
  ];

  // --- Active filters as chips.
  const nameOf = (rows: { id: number; name: string }[], id: string | undefined) => rows.find((r) => String(r.id) === id)?.name;
  const statusChoice = statusChoiceOf(search);
  const chips: { key: string; label: string; remove: RegisterSearch }[] = [];
  if (search.status) chips.push({ key: "status", label: `Status: ${statusChipLabel(search)}`, remove: withStatusChoice(search, "") });
  if (kind && !statusChoice.includes(":")) chips.push({ key: "holder", label: `With: any ${placeTypeLabel(kind)}`, remove: { ...search, holder: undefined } });
  if (mine) chips.push({ key: "mine", label: "Mine", remove: { ...search, mine: undefined } });
  else if (search.with) chips.push({ key: "with", label: `With: ${nameOf(people, search.with) ?? "the chosen person or place"}`, remove: { ...search, with: undefined } });
  if (search.area) chips.push({ key: "area", label: `Work area: ${workAreaLabel(search.area)}`, remove: { ...search, area: undefined } });
  if (search.company) chips.push({ key: "company", label: `Company: ${nameOf(allCompanies, search.company) ?? search.company}`, remove: { ...search, company: undefined } });
  if (search.item) chips.push({ key: "item", label: `Item: ${nameOf(itemList, search.item) ?? "the chosen Item"}`, remove: { ...search, item: undefined } });
  if (search.group) chips.push({ key: "group", label: `Asset group: ${nameOf(categories, search.group) ?? "the chosen group"}`, remove: { ...search, group: undefined } });
  if (search.vendor) chips.push({ key: "vendor", label: `Vendor: ${nameOf(vendors, search.vendor) ?? "the chosen vendor"}`, remove: { ...search, vendor: undefined } });
  if (search.po) chips.push({ key: "po", label: `PO: ${search.po}`, remove: { ...search, po: undefined } });
  if (search.q && search.exact) chips.push({ key: "exact", label: "Exact match", remove: { ...search, exact: undefined } });
  const anyFilter = chips.length > 0 || !!search.q;
  const onlyCount = search.ids ? search.ids.split(",").filter((x) => /^\d+$/.test(x.trim())).length : 0;

  function clearAll() {
    setText("");
    lastPushed.current = "";
    setSearch({ ids: search.ids });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Assets"
        description="Find any asset by what you know about it; select to move or print labels."
        actions={
          canWork ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link to="/serial-pending">
                  <Hash className="h-4 w-4" aria-hidden="true" />
                  Serial Pending{serialPendingCount !== null ? ` (${serialPendingCount})` : ""}
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/assets/new">
                  <PackagePlus className="h-4 w-4" aria-hidden="true" />
                  Add Assets
                </Link>
              </Button>
            </>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="search"
                type="search"
                aria-label="Search"
                placeholder={SEARCH_PLACEHOLDER}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    searchNow();
                  }
                }}
                autoFocus={search.find}
                className="h-10 bg-background pl-8"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={moreOpen ? "secondary" : "outline"}
                size="sm"
                aria-expanded={moreOpen}
                aria-controls="register-more-filters"
                onClick={() => setMoreOpen((o) => !o)}
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                More filters{moreFilterCount(search) > 0 ? ` (${moreFilterCount(search)})` : ""}
              </Button>
              {canFilterMine && (
                <Button
                  type="button"
                  size="sm"
                  variant={mine ? "default" : "outline"}
                  aria-pressed={mine}
                  onClick={() => setSearch({ ...search, mine: mine ? undefined : true, with: undefined })}
                  title="Only the assets with you"
                >
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  Mine
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">Columns</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                  <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {allOptionalColumns.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.key}
                      checked={visibleColumnKeys.includes(c.key)}
                      onSelect={(e) => {
                        e.preventDefault();
                        toggleColumn(c.key);
                      }}
                    >
                      {c.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {moreOpen && (
            <div id="register-more-filters" className="grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4" role="group" aria-label="More filters">
              <FilterField id="filter-status" label="Status">
                <Select value={statusChoice || ALL} onValueChange={(v) => setSearch(withStatusChoice(search, v === ALL ? "" : v))}>
                  <SelectTrigger id="filter-status" aria-label="Status" className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All statuses</SelectItem>
                    {statusChoices(search.status).map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField id="filter-area" label="Work area">
                <Select value={search.area || ALL} onValueChange={(v) => setSearch({ ...search, area: v === ALL ? undefined : v })}>
                  <SelectTrigger id="filter-area" aria-label="Work area" className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All</SelectItem>
                    {WORK_AREA_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FilterField>
              {companies.length > 1 && (
                <FilterField id="filter-company" label="Company">
                  <SearchableSelect
                    id="filter-company" aria-label="Company" className="bg-background"
                    value={search.company || ALL}
                    onValueChange={(v) => setSearch({ ...search, company: v === ALL ? undefined : v })}
                    options={[{ value: ALL, label: "All companies" }, ...companyOptions(companies)]}
                  />
                </FilterField>
              )}
              <FilterField id="filter-item" label="Item">
                <SearchableSelect
                  id="filter-item" aria-label="Item" className="bg-background"
                  value={search.item || ALL}
                  onValueChange={(v) => setSearch({ ...search, item: v === ALL ? undefined : v })}
                  searchPlaceholder="Search Items…"
                  options={[{ value: ALL, label: "Any Item" }, ...itemOptions(itemList, categoryLookups)]}
                />
              </FilterField>
              <FilterField id="filter-group" label="Asset group">
                <SearchableSelect
                  id="filter-group" aria-label="Asset group" className="bg-background"
                  value={search.group || ALL}
                  onValueChange={(v) => setSearch({ ...search, group: v === ALL ? undefined : v })}
                  options={[{ value: ALL, label: "All groups" }, ...categoryOptions(categories)]}
                />
              </FilterField>
              <FilterField id="filter-vendor" label="Vendor">
                <SearchableSelect
                  id="filter-vendor" aria-label="Vendor" className="bg-background"
                  value={search.vendor || ALL}
                  onValueChange={(v) => setSearch({ ...search, vendor: v === ALL ? undefined : v })}
                  options={[{ value: ALL, label: "Any vendor" }, ...vendorOptions(vendors)]}
                />
              </FilterField>
              <PoFilter value={search.po ?? ""} onChange={(po) => setSearch({ ...search, po: po || undefined }, { replace: true })} />
              <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2 lg:col-span-4">
                <span className="text-xs font-medium" id="filter-with-label">Currently with</span>
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="filter-with-label">
                    {PLACE_TYPES.map((t) => {
                      const on = kind === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setSearch({ ...search, holder: on ? undefined : holderWord(t), with: undefined, mine: undefined, ...(statusChoice.includes(":") ? { status: undefined } : {}) })}
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-xs",
                            on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                          )}
                        >
                          {placeTypeLabel(t)}
                        </button>
                      );
                    })}
                  </div>
                  <SearchableSelect
                    id="filter-with" aria-label="With" className="bg-background lg:max-w-sm"
                    value={mine ? String(myId) : search.with || ALL}
                    onValueChange={(v) => setSearch({ ...search, with: v === ALL ? undefined : v, mine: undefined })}
                    searchPlaceholder="Code, name, place…"
                    options={[{ value: ALL, label: kind ? `Any ${placeTypeLabel(kind)}` : "Everyone" }, ...placeOptions(peopleOfKind, placeLookups)]}
                  />
                </div>
              </div>
            </div>
          )}

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
              {chips.map((c) => (
                <span key={c.key} className="inline-flex items-center gap-1 rounded-full border bg-background py-0.5 pl-2.5 pr-1 text-xs">
                  {c.label}
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Remove filter ${c.label}`}
                    onClick={() => setSearch(c.remove)}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clearAll}>Clear all</Button>
            </div>
          )}
        </div>
      </PageHeader>

      {onlyCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
          <span>Showing only the {onlyCount} new asset{onlyCount === 1 ? "" : "s"}.</span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setSearch({ ...search, ids: undefined })}>
            Show all assets
          </Button>
        </div>
      )}

      {mine && (
        <p className="text-sm text-muted-foreground" role="status">Showing only the assets with you.</p>
      )}

      {canWork && selected.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm">{selected.length} selected</span>
          <div className="flex gap-2">
            <PrintLabelsAction assets={items.filter((a) => selected.includes(a.id))} />
            <Button size="sm" onClick={() => navigate({ to: "/asset-movement", search: { ids: selected.join(",") } })}>
              <ScanBarcode className="h-4 w-4" aria-hidden="true" />
              Move ({selected.length})
            </Button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(a) => a.id}
        isLoading={isLoading}
        isError={isError}
        errorMessage="Couldn't load the asset register."
        onRetry={() => refetch()}
        onRowClick={(a) => navigate({ to: "/assets/$id", params: { id: String(a.id) } })}
        sort={sortBy ? { key: sortBy, direction: sortDir } : null}
        onSortToggle={toggleSort}
        emptyState={
          <EmptyState
            title="No assets found."
            description={anyFilter ? "Try a different search or filter." : undefined}
            action={anyFilter ? <Button size="sm" variant="outline" onClick={clearAll}>Clear search and filters</Button> : undefined}
          />
        }
        selection={
          canWork
            ? {
                isSelected: (a) => selected.includes(a.id),
                onToggle: (a, checked) => setSelected((s) => (checked ? [...s, a.id] : s.filter((x) => x !== a.id))),
                isAllSelected: allSelected,
                onToggleAll: (checked) => setSelected(() => (checked ? items.map((a) => a.id) : [])),
                rowAriaLabel: (a) => `Select ${a.asset_code}`,
              }
            : undefined
        }
        pagination={{
          summary: <>Showing {firstRow}–{lastRow} of {total.toLocaleString()} asset{total === 1 ? "" : "s"}</>,
          pageLabel: <>Page {page + 1} of {pageCount}</>,
          onPrevious: () => setPage(page - 1),
          onNext: () => setPage(page + 1),
          previousDisabled: page === 0 || isLoading,
          nextDisabled: page + 1 >= pageCount || isLoading,
        }}
      />
    </div>
  );
}

/** Drops empty values so the address bar stays short. */
function clean(s: RegisterSearch): RegisterSearch {
  const out: RegisterSearch = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function FilterField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

/** PO number: applied once typing settles (or on Enter). */
function PoFilter({ value, onChange }: { value: string; onChange: (po: string) => void }) {
  const [text, setText] = useState(value);
  const settled = useDebounced(text, 400);
  const last = useRef(value);
  useEffect(() => {
    if (settled.trim() === last.current) return;
    last.current = settled.trim();
    onChange(settled.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);
  useEffect(() => {
    if (value === last.current) return;
    last.current = value;
    setText(value);
  }, [value]);
  return (
    <FilterField id="filter-po" label="PO number">
      <Input
        id="filter-po" aria-label="PO number" className="bg-background" placeholder="Whole PO number"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            last.current = text.trim();
            onChange(text.trim());
          }
        }}
      />
    </FilterField>
  );
}
