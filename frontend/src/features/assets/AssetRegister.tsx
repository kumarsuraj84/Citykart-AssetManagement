import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AsyncButton } from "@/components/shared/AsyncButton";

interface AssetRow {
  id: number;
  asset_code: string;
  legacy_asset_code: string | null;
  description: string;
  brand_id: number | null;
  model: string | null;
  serial_number: string | null;
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
  // AM-11: populated server-side by a page-scoped batch lookup (never a
  // per-row join) -- the register must answer "who holds it, in which
  // company" without a click into every row. Extended to Category/
  // Sub-Category/Vendor/Cost Centre so every FK column on the register can
  // show a name instead of a bare id.
  current_asset_user_name: string | null;
  company_name: string | null;
  category_name: string | null;
  subcategory_name: string | null;
  cost_center_name: string | null;
  vendor_name: string | null;
  brand_name: string | null;
}

interface Option {
  id: number;
  name: string;
}

// Fixed list, matches backend/app/assets/models.py ASSET_STATUSES -- this is a closed set
// of lifecycle states, not master data, so there's nothing to fetch.
const ASSET_STATUSES = ["IN_STOCK", "ALLOTTED", "INSTALLED", "UNDER_REPAIR", "DISPOSED", "SOLD", "SCRAPPED", "LOST"];

// Radix Select doesn't allow an empty-string item value, so "an unfiltered dimension" is
// represented by this sentinel rather than by the empty string the query param logic uses.
const ALL = "ALL";

// A shared mock (as AssetRegister.test.tsx's first test uses) resolves every apiClient.get
// call the same way, including these masters/asset-users lookups -- guard against that shape
// mismatch (and against any other unexpected response) rather than letting `.map` throw.
function asOptionArray(data: unknown): Option[] {
  return Array.isArray(data) ? (data as Option[]) : [];
}

// Server-side pagination (spec §7.3): GET /api/assets returns one page plus the
// total count of every matching asset.
export const PAGE_SIZE = 50;

const dash = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "—" : v);
// Matches AssetDetail.tsx's own ReadField formatting for these same four
// money fields (toFixed(2), no currency symbol) -- one number convention
// across the register and Asset 360, not two.
const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));

interface AssetColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  className?: string;
  headerClassName?: string;
  cell: (a: AssetRow) => ReactNode;
}

// Every remaining Asset field (backend/app/assets/models.py) beyond the Code
// column, which is pinned and always shown separately below. A field added
// to the Asset model later gets a register column by adding one entry here
// -- the one place this table's field list lives, rather than the frontend
// silently staying stale as the backend grows (docs request: "if any new
// field added ... that should come outside also").
const ASSET_OPTIONAL_COLUMNS: AssetColumnDef[] = [
  { key: "category", label: "Category", defaultVisible: true, cell: (a) => dash(a.category_name) },
  { key: "subcategory", label: "Sub-Category", defaultVisible: true, cell: (a) => dash(a.subcategory_name) },
  { key: "description", label: "Description", defaultVisible: true, cell: (a) => a.description },
  { key: "brand", label: "Brand", defaultVisible: true, cell: (a) => dash(a.brand_name) },
  { key: "model", label: "Model", defaultVisible: true, cell: (a) => dash(a.model) },
  { key: "serial_number", label: "Serial Number", defaultVisible: true, cell: (a) => dash(a.serial_number) },
  { key: "status", label: "Status", defaultVisible: true, cell: (a) => <StatusBadge status={a.status} compact /> },
  { key: "asset_user", label: "Asset User", defaultVisible: true, cell: (a) => dash(a.current_asset_user_name) },
  { key: "company", label: "Company", defaultVisible: true, cell: (a) => dash(a.company_name) },
  { key: "legacy_asset_code", label: "Legacy Asset Code", defaultVisible: false, cell: (a) => dash(a.legacy_asset_code) },
  { key: "barcode", label: "Barcode", defaultVisible: false, cell: (a) => dash(a.barcode) },
  { key: "vendor", label: "Vendor", defaultVisible: false, cell: (a) => dash(a.vendor_name) },
  { key: "cost_center", label: "Cost Centre", defaultVisible: false, cell: (a) => dash(a.cost_center_name) },
  { key: "po_number", label: "PO Number", defaultVisible: false, cell: (a) => dash(a.po_number) },
  { key: "po_date", label: "PO Date", defaultVisible: false, cell: (a) => dash(a.po_date) },
  { key: "invoice_number", label: "Invoice Number", defaultVisible: false, cell: (a) => dash(a.invoice_number) },
  { key: "invoice_date", label: "Invoice Date", defaultVisible: false, cell: (a) => dash(a.invoice_date) },
  { key: "pi_number", label: "PI Number", defaultVisible: false, cell: (a) => dash(a.pi_number) },
  { key: "pi_date", label: "PI Date", defaultVisible: false, cell: (a) => dash(a.pi_date) },
  // AM-16: right-aligned + tabular-nums -- these are genuinely numeric,
  // scanned-down-a-column values (unlike the mixed-content columns above),
  // matching every other numeric column already right-aligned in the app
  // (Dashboard KPIs, PO Value, PO summary tiles).
  {
    key: "purchase_cost", label: "Purchase Cost", defaultVisible: false,
    className: "text-right tabular-nums", headerClassName: "text-right", cell: (a) => money(a.purchase_cost),
  },
  {
    key: "tax_percent", label: "Tax %", defaultVisible: false,
    className: "text-right tabular-nums", headerClassName: "text-right", cell: (a) => money(a.tax_percent),
  },
  {
    key: "tax_amount", label: "Tax Amount", defaultVisible: false,
    className: "text-right tabular-nums", headerClassName: "text-right", cell: (a) => money(a.tax_amount),
  },
  {
    key: "total_cost", label: "Total Cost", defaultVisible: false,
    className: "text-right tabular-nums", headerClassName: "text-right", cell: (a) => money(a.total_cost),
  },
  { key: "purchase_date", label: "Purchase Date", defaultVisible: false, cell: (a) => dash(a.purchase_date) },
  { key: "warranty_upto", label: "Warranty Upto", defaultVisible: false, cell: (a) => dash(a.warranty_upto) },
  { key: "status_since", label: "Status Since", defaultVisible: false, cell: (a) => dash(a.status_since) },
];

// AM-21: mirrors backend/app/assets/search_service.py::SORTABLE_COLUMNS --
// real Asset columns only. The register's own *_name columns (category/
// subcategory/asset_user/company/vendor/cost_center) are page-scoped label
// lookups, not sortable database columns, so they're deliberately left out.
const SORTABLE_COLUMN_KEYS = new Set([
  "description", "model", "serial_number", "status", "legacy_asset_code", "barcode",
  "po_number", "po_date", "invoice_number", "invoice_date", "pi_number", "pi_date",
  "purchase_cost", "tax_percent", "tax_amount", "total_cost", "purchase_date", "warranty_upto", "status_since",
]);

const ASSET_OPTIONAL_COLUMN_KEYS = ASSET_OPTIONAL_COLUMNS.map((c) => c.key);
const DEFAULT_VISIBLE_COLUMN_KEYS = ASSET_OPTIONAL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
const COLUMN_VISIBILITY_STORAGE_KEY = "ckam.assetRegister.visibleColumns";

// Per-browser only (localStorage), not synced anywhere -- a display
// preference, not business state. Falls back to the defaults whenever
// nothing is stored yet, storage is unavailable (private browsing), or the
// stored list turns out empty after dropping keys that no longer exist
// (e.g. a renamed column from an older version of this page).
function loadVisibleColumnKeys(): string[] {
  try {
    const raw = window.localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE_COLUMN_KEYS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_COLUMN_KEYS;
    const known = parsed.filter((k): k is string => typeof k === "string" && ASSET_OPTIONAL_COLUMN_KEYS.includes(k));
    return known.length > 0 ? known : DEFAULT_VISIBLE_COLUMN_KEYS;
  } catch {
    return DEFAULT_VISIBLE_COLUMN_KEYS;
  }
}

interface AssetRegisterProps {
  // AM-12: the Dashboard's exception summary deep-links here (e.g.
  // `/assets?status=UNDER_REPAIR`) so a KPI count is a real navigation
  // target, not a decorative number -- applied once, on first render, the
  // same way every other filter starts empty and is then user-driven.
  initialStatus?: string;
}

export function AssetRegister({ initialStatus }: AssetRegisterProps = {}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQRaw] = useState("");
  const [status, setStatusRaw] = useState(initialStatus ?? "");
  const [categoryId, setCategoryIdRaw] = useState("");
  const [assetUserId, setAssetUserIdRaw] = useState("");
  const [companyId, setCompanyIdRaw] = useState("");
  const [page, setPageRaw] = useState(0);
  const [sortBy, setSortByRaw] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<number[]>([]);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(loadVisibleColumnKeys);

  function toggleColumn(key: string) {
    setVisibleColumnKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        window.localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Best-effort persistence only -- a full/blocked storage shouldn't stop the toggle
        // from taking effect for the rest of this session.
      }
      return next;
    });
  }

  // Selection is per visible page: changing page or filters clears it, so a bulk
  // move can never act on rows the user can no longer see.
  function setPage(next: number) {
    setPageRaw(next);
    setSelected([]);
  }
  // Any filter change starts again from the first page.
  function resettingPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(0);
    };
  }
  const setQ = resettingPage(setQRaw);
  const setStatus = resettingPage(setStatusRaw);
  const setCategoryId = resettingPage(setCategoryIdRaw);
  const setAssetUserId = resettingPage(setAssetUserIdRaw);
  const setCompanyId = resettingPage(setCompanyIdRaw);
  // Server-side sort (search_assets.SORTABLE_COLUMNS) -- click cycle matches
  // useTableSort's own client-side one (unsorted -> asc -> desc -> unsorted)
  // for a consistent feel with every other sortable table in the app, even
  // though this one drives a query param + refetch instead of a local sort.
  function toggleSort(key: string) {
    if (sortBy !== key) {
      setSortByRaw(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortByRaw(null);
      setSortDir("asc");
    }
    setPage(0);
  }
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveAssetUserId, setMoveAssetUserId] = useState("");
  // A snapshot of the selected rows taken when the Move dialog opens, so that if the
  // register's own list changes shape after a partial move (an asset that moved may drop
  // out of the current filter/status view on refetch) the dialog can still show which
  // asset codes the failures below belong to.
  const [moveTargets, setMoveTargets] = useState<AssetRow[]>([]);

  const queryString = new URLSearchParams({
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(categoryId ? { category_id: categoryId } : {}),
    ...(assetUserId ? { asset_user_id: assetUserId } : {}),
    ...(companyId ? { company_id: companyId } : {}),
    ...(sortBy ? { sort_by: sortBy, sort_dir: sortDir } : {}),
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  }).toString();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["assets", "register", q, status, categoryId, assetUserId, companyId, sortBy, sortDir, page],
    queryFn: () => apiClient.get<{ items: AssetRow[]; total: number }>(`/assets?${queryString}`),
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastRow = page * PAGE_SIZE + items.length;

  const { data: categoriesData } = useQuery({
    queryKey: ["masters", "categories"],
    queryFn: () => apiClient.get<Option[]>("/masters/categories"),
  });
  const categories = asOptionArray(categoriesData);

  const { data: companiesData } = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<Option[]>("/masters/companies"),
  });
  const companies = asOptionArray(companiesData);

  // Every asset user, for both the filter bar's "Asset User" dimension and the bulk-move "Move to"
  // picker -- the register spans companies for an ADMIN, so unlike AssetDetail.tsx's
  // single-asset action dialog there's no one company to scope this list to.
  const { data: asset_usersData } = useQuery({
    queryKey: ["asset_users"],
    queryFn: () => apiClient.get<Option[]>("/asset-users"),
  });
  const asset_users = asOptionArray(asset_usersData);

  const allSelected = items.length > 0 && items.every((a) => selected.includes(a.id));

  function toggleAll(checked: boolean) {
    setSelected(checked ? items.map((a) => a.id) : []);
  }

  function toggleOne(id: number, checked: boolean) {
    setSelected((s) => (checked ? [...s, id] : s.filter((existing) => existing !== id)));
  }

  function openMove() {
    bulkMoveMutation.reset();
    setMoveTargets(items.filter((a) => selected.includes(a.id)));
    setMoveAssetUserId("");
    setMoveOpen(true);
  }

  function closeMove() {
    setMoveOpen(false);
    bulkMoveMutation.reset();
  }

  const bulkMoveMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ moved: number; failed: { asset_id: number; reason: string }[] }>("/assets/bulk-move", {
        asset_ids: selected,
        to_asset_user_id: Number(moveAssetUserId),
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["assets", "register"] });
      if (result.failed.length === 0) {
        // Full success -- nothing left needing the user's attention, so close up.
        setSelected([]);
        setMoveOpen(false);
        setMoveAssetUserId("");
      } else {
        // Partial failure: keep the dialog open with the failure detail visible, and
        // narrow the selection down to just the assets that still need attention (the
        // ones that did move are done; re-selecting them would just re-attempt a move
        // that already succeeded).
        setSelected(result.failed.map((f) => f.asset_id));
      }
    },
  });

  // "Code" is pinned: always shown first, not part of the Manage Columns picker --
  // it's the register's identity column into Asset 360, not an optional field.
  const columns: DataTableColumn<AssetRow>[] = [
    {
      key: "asset_code",
      header: "Code",
      cellClassName: "font-mono text-sm",
      sortable: true,
      // A real, independently keyboard-focusable link -- the row's own onClick
      // below is a mouse-convenience shortcut to the same destination, not the
      // only way to reach it. stopPropagation avoids double-navigating.
      cell: (a) => (
        <Link to="/assets/$id" params={{ id: String(a.id) }} onClick={(e) => e.stopPropagation()}>
          {a.asset_code}
        </Link>
      ),
    },
    ...ASSET_OPTIONAL_COLUMNS.filter((c) => visibleColumnKeys.includes(c.key)).map((c) => ({
      key: c.key,
      header: c.label,
      headerClassName: c.headerClassName,
      cellClassName: c.className,
      cell: c.cell,
      sortable: SORTABLE_COLUMN_KEYS.has(c.key),
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Asset Register" description="Search, filter and bulk-move assets.">
        {/* AM-14: one toolbar band (subtle bg-muted/40 + border) groups search/
            filters and the Columns view-option together, instead of the filter
            row and the Columns button floating as two structurally-unrelated
            rows above the table. */}
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border bg-muted/40 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="search">Search</Label>
            <Input
              id="search"
              aria-label="Search"
              placeholder="Asset code, description, serial, PO, invoice…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-64"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-status">Status</Label>
            <Select value={status || ALL} onValueChange={(v) => setStatus(v === ALL ? "" : v)}>
              <SelectTrigger id="filter-status" aria-label="Status" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {ASSET_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-category">Category</Label>
            <Select value={categoryId || ALL} onValueChange={(v) => setCategoryId(v === ALL ? "" : v)}>
              <SelectTrigger id="filter-category" aria-label="Category" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-asset-user">Asset User</Label>
            <Select value={assetUserId || ALL} onValueChange={(v) => setAssetUserId(v === ALL ? "" : v)}>
              <SelectTrigger id="filter-asset-user" aria-label="Asset User" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All asset_users</SelectItem>
                {asset_users.map((h) => (
                  <SelectItem key={h.id} value={String(h.id)}>
                    {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-company">Company</Label>
            <Select value={companyId || ALL} onValueChange={(v) => setCompanyId(v === ALL ? "" : v)}>
              <SelectTrigger id="filter-company" aria-label="Company" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All companies</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ASSET_OPTIONAL_COLUMNS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={visibleColumnKeys.includes(c.key)}
                // Keep the menu open across multiple toggles -- Radix closes a
                // checkbox item's menu on select by default, which would force
                // reopening it for every single field when picking several at once.
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
      </PageHeader>

      {selected.length > 0 && (
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm">{selected.length} selected</span>
          <Button size="sm" onClick={openMove}>
            Move
          </Button>
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
            description={q || status || categoryId || assetUserId || companyId ? "Try a different search or filter." : undefined}
          />
        }
        selection={{
          isSelected: (a) => selected.includes(a.id),
          onToggle: (a, checked) => toggleOne(a.id, checked),
          isAllSelected: allSelected,
          onToggleAll: toggleAll,
          rowAriaLabel: (a) => `Select ${a.asset_code}`,
        }}
        pagination={{
          summary: (
            <>
              Showing {firstRow}–{lastRow} of {total.toLocaleString()} asset{total === 1 ? "" : "s"}
            </>
          ),
          pageLabel: (
            <>
              Page {page + 1} of {pageCount}
            </>
          ),
          onPrevious: () => setPage(page - 1),
          onNext: () => setPage(page + 1),
          previousDisabled: page === 0 || isLoading,
          nextDisabled: page + 1 >= pageCount || isLoading,
        }}
      />

      <Dialog open={moveOpen} onOpenChange={(open) => !open && closeMove()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {selected.length} asset{selected.length === 1 ? "" : "s"}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="move-asset-user">Move to</Label>
            <Select value={moveAssetUserId || undefined} onValueChange={setMoveAssetUserId}>
              <SelectTrigger id="move-asset-user" aria-label="Move to">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {asset_users.map((h) => (
                  <SelectItem key={h.id} value={String(h.id)}>
                    {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {bulkMoveMutation.isError && (
            <p className="text-sm text-destructive">
              {bulkMoveMutation.error instanceof Error ? bulkMoveMutation.error.message : "Failed to move assets."}
            </p>
          )}
          {bulkMoveMutation.isSuccess && bulkMoveMutation.data.failed.length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-destructive">
                {bulkMoveMutation.data.moved} moved, {bulkMoveMutation.data.failed.length} failed:
              </p>
              <ul className="list-disc pl-5 text-destructive">
                {bulkMoveMutation.data.failed.map((f) => {
                  const target = moveTargets.find((t) => t.id === f.asset_id);
                  return (
                    <li key={f.asset_id}>
                      {target?.asset_code ?? `Asset #${f.asset_id}`}: {f.reason}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeMove}>
              {bulkMoveMutation.isSuccess && bulkMoveMutation.data.failed.length > 0 ? "Done" : "Cancel"}
            </Button>
            <AsyncButton
              onClick={() => bulkMoveMutation.mutate()}
              disabled={!moveAssetUserId}
              pending={bulkMoveMutation.isPending}
              pendingLabel="Moving…"
            >
              Confirm
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
