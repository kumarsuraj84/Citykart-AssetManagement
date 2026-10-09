import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { FormField } from "@/components/shared/FormField";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { AddBundleDialog } from "./AddBundleDialog";

interface PurchaseOrderOut {
  id: number;
  company_id: number;
  po_number: string;
  po_date: string;
  vendor_id: number | null;
  cost_center_id: number | null;
}

/** AM-14: a compact KPI tile for the PO detail summary row -- a smaller,
 * denser sibling of Dashboard's own KPI Card (that one needs a title+
 * description header slot; this one is just label+number, so it isn't
 * built out of `Card`/`CardHeader`/`CardContent` at all). */
function SummaryTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

interface PendingAssetRow {
  id: number;
  purchase_order_id: number;
  description: string;
  barcode: string | null;
  category_id: number;
  subcategory_id: number | null;
  brand_id: number | null;
  model: string | null;
  warranty_years: number | null;
  cost_center_id: number;
  purchase_cost: number | null;
  tax_percent: number | null;
  total_cost: number | null;
  status: "PENDING" | "DELIVERED" | "CANCELLED";
  // False for a part that never carries a serial (mouse, keyboard); the
  // delivery dialog then starts with "No serial number" ticked for it.
  serial_required?: boolean;
  bundle_label?: string | null;
  serial_number: string | null;
  invoice_number: string | null;
  delivered_asset_id: number | null;
}

// A line made from a bundle carries a small tag naming it ("Desktop"), so it's
// clear where the CPU/TFT/Keyboard/Mouse lines of one order came from.
function descriptionCell(l: PendingAssetRow): ReactNode {
  if (!l.bundle_label) return l.description;
  return (
    <>
      <span>{l.description}</span>
      <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{l.bundle_label}</span>
    </>
  );
}

interface DeliveryGroup {
  key: string;
  lines: PendingAssetRow[];
}

// Units created from one PO line item (qty N) are identical, so they're
// grouped back together for delivery; any difference (description, barcode,
// category, brand, model, cost...) keeps two items in separate groups.
function groupUnits(units: PendingAssetRow[]): DeliveryGroup[] {
  const byKey = new Map<string, PendingAssetRow[]>();
  for (const u of units) {
    const key = [
      u.description, u.barcode ?? "", u.category_id, u.subcategory_id ?? "", u.brand_id ?? "", u.model ?? "",
      u.purchase_cost ?? "",
    ].join("|");
    const list = byKey.get(key);
    if (list) list.push(u);
    else byKey.set(key, [u]);
  }
  return [...byKey].map(([key, lines]) => ({ key, lines }));
}

// One serial per line of pasted/scanned text; blank lines are ignored.
function parseSerials(text: string): string[] {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

interface RecordPiResult {
  invoice_number: string;
  updated: string[];
  skipped: string[];
}

interface Option {
  id: number;
  code?: string;
  email?: string;
  name: string;
}

// Lets someone find an Asset User by typing their code or email, not just
// their name -- the same fields AssetUsersScreen's own Code/Email columns
// show, so the search matches what's actually on their record.
function assetUserKeywords(h: Option): string[] {
  return [h.code, h.email].filter((v): v is string => Boolean(v));
}

interface CategoryOption extends Option {
  // IT / NON_IT (spec §17/§19) -- drives the read-only Responsibility
  // preview on the Add Line dialog; the backend independently re-derives
  // it from this Category when the line is saved.
  asset_domain: string;
}

function domainLabel(value: string): string {
  return value === "NON_IT" ? "Admin / Non-IT" : value;
}

function selectValue(v: string): string | undefined {
  return v || undefined;
}

// `scope` disambiguates the aria-label (e.g. "Search Barcode (Pending)" vs.
// "Search Barcode (Delivered)") now that Pending/Delivered are two separate
// tables that can each carry a same-named column -- without it, a screen
// reader (and anything else querying by accessible name) can't tell the two
// apart.
function ColumnSearchHeader({ label, value, onChange, scope }: { label: string; value: string; onChange: (v: string) => void; scope: string }) {
  return (
    <div className="flex flex-col gap-1 py-1">
      <span>{label}</span>
      <Input
        aria-label={`Search ${label} (${scope})`}
        placeholder="Search…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs font-normal"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export function PurchaseOrderDetail({ poId }: { poId: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isPrimaryOwner = useAuthStore((s) => s.isPrimaryOwner);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const poQ = useQuery({
    queryKey: ["purchase-order", poId],
    queryFn: () => apiClient.get<PurchaseOrderOut>(`/purchase-orders/${poId}`),
  });
  const linesQ = useQuery({
    queryKey: ["purchase-order", poId, "lines"],
    queryFn: () => apiClient.get<PendingAssetRow[]>(`/purchase-orders/${poId}/lines`),
  });
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<CategoryOption[]>("/masters/categories") });
  const subcategoriesQ = useQuery({
    queryKey: ["masters", "subcategories"],
    queryFn: () => apiClient.get<(Option & { category_id: number })[]>("/masters/subcategories"),
  });
  const costCentersQ = useQuery({
    queryKey: ["masters", "cost-centers", poQ.data?.company_id],
    queryFn: () => apiClient.get<Option[]>(`/masters/cost-centers?company_id=${poQ.data!.company_id}`),
    enabled: !!poQ.data,
  });
  const asset_usersQ = useQuery({
    queryKey: ["asset_users", poQ.data?.company_id],
    queryFn: () => apiClient.get<Option[]>(`/asset-users?company_id=${poQ.data!.company_id}`),
    enabled: !!poQ.data,
  });
  // AM-14: the header previously named PO Date/Cost Centre but never Vendor --
  // the same master-list lookup PurchaseOrdersList.tsx already uses.
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Option[]>("/masters/vendors") });
  const brandsQ = useQuery({ queryKey: ["masters", "brands"], queryFn: () => apiClient.get<Option[]>("/masters/brands") });

  const categories = categoriesQ.data ?? [];
  const subcategories = subcategoriesQ.data ?? [];
  const costCenters = costCentersQ.data ?? [];
  const asset_users = asset_usersQ.data ?? [];
  const vendors = vendorsQ.data ?? [];
  const brands = brandsQ.data ?? [];
  const lines = linesQ.data ?? [];
  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? String(id);
  const costCenterName = (id: number | null) => (id == null ? "—" : costCenters.find((c) => c.id === id)?.name ?? String(id));
  const vendorName = (id: number | null) => (id == null ? "—" : vendors.find((v) => v.id === id)?.name ?? String(id));

  // AM-14 summary row -- derived entirely from `lines`, already fetched for the
  // table below, so this costs zero extra requests. Value is every non-
  // cancelled line's own total_cost (matches the table's own "PO Value" column).
  const pendingCount = lines.filter((l) => l.status === "PENDING").length;
  const deliveredCount = lines.filter((l) => l.status === "DELIVERED").length;
  // Unfiltered (unlike deliveredLines below, which only reflects whatever
  // the column search boxes currently narrow to) -- deleting the PO removes
  // every one of these, so the confirmation must name every one of them.
  const allDeliveredLines = useMemo(() => lines.filter((l) => l.status === "DELIVERED"), [lines]);
  const totalValue = lines
    .filter((l) => l.status !== "CANCELLED")
    .reduce((sum, l) => sum + (l.total_cost ?? 0), 0);

  // --- Record PI (AM-19) ---
  // PI arrives from Finance per Invoice, not per PO -- a PO delivered across
  // several partial deliveries can have several invoices, each getting its
  // own PI later. Derived entirely from already-fetched `lines`, zero extra
  // requests, matching the KPI summary row's own pattern above.
  const deliveredInvoiceNumbers = Array.from(new Set(
    lines.filter((l) => l.status === "DELIVERED" && l.invoice_number).map((l) => l.invoice_number as string),
  ));
  const [recordPiInvoice, setRecordPiInvoice] = useState<string | null>(null);
  const [recordPiForm, setRecordPiForm] = useState({ piNumber: "", piDate: "", overwrite: false });
  const [recordPiResult, setRecordPiResult] = useState<RecordPiResult | null>(null);

  function openRecordPi(invoiceNumber: string) {
    setRecordPiInvoice(invoiceNumber);
    setRecordPiForm({ piNumber: "", piDate: "", overwrite: false });
    setRecordPiResult(null);
  }

  const recordPiMutation = useMutation({
    mutationFn: () =>
      apiClient.post<RecordPiResult>(`/purchase-orders/${poId}/record-pi`, {
        invoice_number: recordPiInvoice,
        pi_number: recordPiForm.piNumber,
        pi_date: recordPiForm.piDate,
        overwrite: recordPiForm.overwrite,
      }),
    onSuccess: (result) => {
      setRecordPiResult(result);
      qc.invalidateQueries({ queryKey: ["purchase-order", poId, "lines"] });
    },
  });
  const canRecordPi = recordPiForm.piNumber.trim() !== "" && recordPiForm.piDate !== "";

  // --- Add Line form ---
  // AM-14: collapsed by default -- the form previously stayed permanently
  // expanded, always paying its vertical space even when nobody was adding a
  // line. Same fields/mutation/validation, purely a visibility toggle.
  const [showAddLine, setShowAddLine] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [lineForm, setLineForm] = useState({
    description: "", barcode: "", categoryId: "", subcategoryId: "",
    brandId: "", model: "", warrantyYears: "0",
    purchaseCost: "0", taxPercent: "0", quantity: "1",
  });
  const visibleSubcategories = lineForm.categoryId
    ? subcategories.filter((s) => s.category_id === Number(lineForm.categoryId))
    : subcategories;
  const canAddLine =
    lineForm.description.trim() !== "" &&
    lineForm.barcode.trim() !== "" &&
    lineForm.categoryId !== "" &&
    lineForm.subcategoryId !== "" &&
    Number(lineForm.purchaseCost) > 0 &&
    Number(lineForm.quantity) >= 1 &&
    lineForm.warrantyYears.trim() !== "" &&
    Number(lineForm.warrantyYears) >= 0;

  const addLineMutation = useMutation({
    mutationFn: () =>
      apiClient.post<PendingAssetRow[]>(`/purchase-orders/${poId}/lines`, {
        description: lineForm.description,
        barcode: lineForm.barcode || null,
        category_id: Number(lineForm.categoryId),
        subcategory_id: lineForm.subcategoryId ? Number(lineForm.subcategoryId) : null,
        brand_id: lineForm.brandId ? Number(lineForm.brandId) : null,
        model: lineForm.model || null,
        warranty_years: Number(lineForm.warrantyYears) || 0,
        purchase_cost: Number(lineForm.purchaseCost) || 0,
        tax_percent: Number(lineForm.taxPercent) || 0,
        quantity: Number(lineForm.quantity) || 1,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-order", poId, "lines"] });
      setLineForm({
        description: "", barcode: "", categoryId: "", subcategoryId: "",
        brandId: "", model: "", warrantyYears: "0", purchaseCost: "0", taxPercent: "0", quantity: "1",
      });
    },
  });

  // --- Edit line dialog ---
  const [editingLine, setEditingLine] = useState<PendingAssetRow | null>(null);
  const [editForm, setEditForm] = useState({
    description: "", barcode: "", categoryId: "", subcategoryId: "",
    brandId: "", model: "", warrantyYears: "0", purchaseCost: "0", taxPercent: "0",
  });

  function openEdit(line: PendingAssetRow) {
    setEditingLine(line);
    setEditForm({
      description: line.description, barcode: line.barcode ?? "", categoryId: String(line.category_id),
      subcategoryId: line.subcategory_id ? String(line.subcategory_id) : "",
      brandId: line.brand_id ? String(line.brand_id) : "", model: line.model ?? "", warrantyYears: String(line.warranty_years ?? 0),
      purchaseCost: String(line.purchase_cost ?? 0),
      taxPercent: String(line.tax_percent ?? 0),
    });
  }

  const canSaveEdit =
    editForm.description.trim() !== "" && editForm.barcode.trim() !== "" && Number(editForm.purchaseCost) > 0 &&
    editForm.warrantyYears.trim() !== "" && Number(editForm.warrantyYears) >= 0;

  const editMutation = useMutation({
    mutationFn: () =>
      apiClient.put<PendingAssetRow>(`/purchase-orders/lines/${editingLine!.id}`, {
        description: editForm.description, barcode: editForm.barcode || null, category_id: Number(editForm.categoryId),
        subcategory_id: editForm.subcategoryId ? Number(editForm.subcategoryId) : null,
        brand_id: editForm.brandId ? Number(editForm.brandId) : null, model: editForm.model || null,
        warranty_years: Number(editForm.warrantyYears) || 0,
        purchase_cost: Number(editForm.purchaseCost) || 0, tax_percent: Number(editForm.taxPercent) || 0,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-order", poId, "lines"] });
      setEditingLine(null);
    },
  });

  // --- Cancel line ---
  const cancelMutation = useMutation({
    mutationFn: (lineId: number) => apiClient.post(`/purchase-orders/lines/${lineId}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-order", poId, "lines"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete<{ cancelled_lines: number; deleted_assets: number }>(`/purchase-orders/${poId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      navigate({ to: "/purchase-orders" });
    },
  });

  // --- Lines tables: Pending/Delivered/Cancelled are shown as three
  // separate tables (never one mixed list) so marking delivery only ever
  // shows rows that still need it -- a delivered row sitting in the same
  // table as a pending one was confusing to select against. Each table
  // keeps its own per-column search, independent of the others, since the
  // column sets themselves differ (Serial No only exists once delivered;
  // Edit/Cancel actions only make sense while still pending).
  const [pendingFilters, setPendingFilters] = useState({ description: "", barcode: "", category: "", cost: "" });
  const [deliveredFilters, setDeliveredFilters] = useState({ description: "", barcode: "", category: "", cost: "", serial: "" });
  function setPendingFilter(key: keyof typeof pendingFilters, value: string) {
    setPendingFilters((f) => ({ ...f, [key]: value }));
  }
  function setDeliveredFilter(key: keyof typeof deliveredFilters, value: string) {
    setDeliveredFilters((f) => ({ ...f, [key]: value }));
  }
  function matchesCommonFilters(l: PendingAssetRow, f: { description: string; barcode: string; category: string; cost: string }) {
    const cost = (l.total_cost ?? 0).toFixed(2);
    return (
      l.description.toLowerCase().includes(f.description.toLowerCase()) &&
      (l.barcode ?? "").toLowerCase().includes(f.barcode.toLowerCase()) &&
      categoryName(l.category_id).toLowerCase().includes(f.category.toLowerCase()) &&
      cost.includes(f.cost.toLowerCase())
    );
  }
  const pendingLines = useMemo(
    () => lines.filter((l) => l.status === "PENDING" && matchesCommonFilters(l, pendingFilters)),
    [lines, pendingFilters, categories],
  );
  const deliveredLines = useMemo(
    () => lines.filter((l) =>
      l.status === "DELIVERED" && matchesCommonFilters(l, deliveredFilters) &&
      (l.serial_number ?? "").toLowerCase().includes(deliveredFilters.serial.toLowerCase()),
    ),
    [lines, deliveredFilters, categories],
  );
  const cancelledLines = useMemo(() => lines.filter((l) => l.status === "CANCELLED"), [lines]);

  // --- Selection + Delivery Done ---
  const [selected, setSelected] = useState<number[]>([]);
  function toggleOne(id: number, checked: boolean) {
    setSelected((s) => (checked ? [...s, id] : s.filter((x) => x !== id)));
  }

  // Select All acts only on the currently-visible (filtered) Pending rows --
  // a hidden/filtered-out row's own selection state is never touched by it,
  // matching the requested "select all of what's currently filtered, or
  // everything if nothing is filtered" behavior.
  const isAllVisibleSelected =
    pendingLines.length > 0 && pendingLines.every((l) => selected.includes(l.id));
  function toggleAllVisible(checked: boolean) {
    const visibleIds = new Set(pendingLines.map((l) => l.id));
    setSelected((s) =>
      checked ? [...new Set([...s, ...visibleIds])] : s.filter((id) => !visibleIds.has(id)),
    );
  }

  const [deliverOpen, setDeliverOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceAmount, setInvoiceAmount] = useState("");
  // A PO is delivered to one location only, so the Initial Asset User is
  // chosen once for the whole delivery. Serial numbers are entered per
  // product (all identical units of one line item together), not per unit:
  // a pasted/scanned list, one serial per line, is handed to the units in
  // order, or "No serial number" sets N/A for the whole product.
  const [initialAssetUserId, setInitialAssetUserId] = useState("");
  const [groupInput, setGroupInput] = useState<Record<string, { text: string; noSerial: boolean }>>({});
  // Deliberate opt-in to deliver only the units that have a serial and leave
  // the rest in Pending Delivery (instead of cancelling and re-selecting).
  const [leavePending, setLeavePending] = useState(false);
  // lower-cased serial -> asset code of the asset in CKAM that already has it,
  // from the advisory check-serials call below.
  const [existingSerials, setExistingSerials] = useState<Record<string, string>>({});

  function openDeliver() {
    deliverMutation.reset();
    setInvoiceNumber("");
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setInvoiceAmount("");
    setInitialAssetUserId("");
    // Parts that never carry a serial (a bundle's mouse/keyboard) start with
    // "No serial number" already ticked; it can still be unticked.
    setGroupInput(
      Object.fromEntries(
        groupUnits(lines.filter((l) => selected.includes(l.id))).map((g) => [
          g.key, { text: "", noSerial: g.lines[0].serial_required === false },
        ]),
      ),
    );
    setLeavePending(false);
    setExistingSerials({});
    setDeliverOpen(true);
  }

  function setGroupField(key: string, patch: Partial<{ text: string; noSerial: boolean }>) {
    setGroupInput((p) => ({ ...p, [key]: { ...(p[key] ?? { text: "", noSerial: false }), ...patch } }));
  }

  const selectedLines = useMemo(() => lines.filter((l) => selected.includes(l.id)), [lines, selected]);
  const deliveryGroups = useMemo(() => groupUnits(selectedLines), [selectedLines]);

  // Serials typed (not "N/A") that appear more than once in THIS delivery,
  // compared case-insensitively like the server does. Lower-cased keys. The
  // server separately checks every serial against the whole system.
  const duplicateSerials = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of deliveryGroups) {
      if (groupInput[g.key]?.noSerial) continue;
      for (const s of parseSerials(groupInput[g.key]?.text ?? "")) {
        const k = s.toLowerCase();
        if (k === "n/a") continue;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([s]) => s));
  }, [deliveryGroups, groupInput]);

  // One serial per unit of a group: N/A for all, or the pasted list in order
  // ("" where the list is shorter than the group).
  function serialsForGroup(g: DeliveryGroup): string[] {
    const inp = groupInput[g.key];
    if (inp?.noSerial) return g.lines.map(() => "N/A");
    const tokens = parseSerials(inp?.text ?? "");
    return g.lines.map((_, i) => tokens[i] ?? "");
  }
  // A block is broken (not merely unfinished) if it has more serials than
  // units, a serial repeated in this delivery, or one CKAM already has.
  function groupHasProblem(g: DeliveryGroup): boolean {
    const inp = groupInput[g.key];
    if (inp?.noSerial) return false;
    const tokens = parseSerials(inp?.text ?? "");
    return tokens.length > g.lines.length ||
      tokens.some((s) => duplicateSerials.has(s.toLowerCase()) || existingSerials[s.toLowerCase()] !== undefined);
  }
  // Units of a group that would be delivered: all if "No serial number", else
  // as many as there are serials (never more than the units).
  function deliverCountForGroup(g: DeliveryGroup): number {
    if (groupInput[g.key]?.noSerial) return g.lines.length;
    return Math.min(parseSerials(groupInput[g.key]?.text ?? "").length, g.lines.length);
  }
  const deliverUnits = deliveryGroups.reduce((sum, g) => sum + deliverCountForGroup(g), 0);
  const unitsWithoutSerial = selectedLines.length - deliverUnits;
  const anyProblem = deliveryGroups.some(groupHasProblem);

  const canDeliver =
    initialAssetUserId !== "" && invoiceNumber.trim() !== "" && invoiceDate !== "" && invoiceAmount !== "" &&
    !anyProblem && deliverUnits > 0 && (unitsWithoutSerial === 0 || leavePending);

  // Advisory, debounced: ask the server which of the serials typed so far
  // CKAM already has, so the user finds out now rather than after Confirm.
  // The delivery itself re-checks everything, so a failed lookup is ignored.
  const typedSerials = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of deliveryGroups) {
      if (groupInput[g.key]?.noSerial) continue;
      for (const s of parseSerials(groupInput[g.key]?.text ?? "")) {
        if (s.toLowerCase() !== "n/a" && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
      }
    }
    return [...seen.values()];
  }, [deliveryGroups, groupInput]);
  const typedSerialsKey = typedSerials.join("\n");
  useEffect(() => {
    if (!deliverOpen || typedSerials.length === 0) {
      setExistingSerials((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      apiClient
        .post<{ conflicts: { serial: string; asset_code: string }[] }>("/purchase-orders/check-serials", { serials: typedSerials })
        .then((r) => {
          if (!cancelled) setExistingSerials(Object.fromEntries((r?.conflicts ?? []).map((c) => [c.serial.toLowerCase(), c.asset_code])));
        })
        .catch(() => {
          if (!cancelled) setExistingSerials({});
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverOpen, typedSerialsKey]);

  const deliverMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/purchase-orders/${poId}/deliver`, {
        invoice_number: invoiceNumber, invoice_date: invoiceDate, invoice_amount: Number(invoiceAmount) || 0,
        // Only units that have a serial; the rest (if the user chose to leave
        // them pending) are simply not sent and stay in Pending Delivery.
        lines: deliveryGroups.flatMap((g) => {
          const serials = serialsForGroup(g);
          return g.lines
            .map((l, i) => ({ pending_asset_id: l.id, serial_number: serials[i], initial_asset_user_id: Number(initialAssetUserId) }))
            .filter((line) => line.serial_number !== "");
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-order", poId, "lines"] });
      setSelected([]);
      setDeliverOpen(false);
    },
  });

  const pendingColumns: DataTableColumn<PendingAssetRow>[] = [
    {
      key: "select",
      header: pendingLines.length > 0 ? (
        <Checkbox
          aria-label="Select all pending lines"
          checked={isAllVisibleSelected}
          onCheckedChange={(checked) => toggleAllVisible(checked === true)}
        />
      ) : null,
      cell: (l) => (
        <Checkbox
          aria-label={`Select ${l.description}`}
          checked={selected.includes(l.id)}
          onCheckedChange={(checked) => toggleOne(l.id, checked === true)}
        />
      ),
    },
    {
      key: "description",
      header: <ColumnSearchHeader label="Description" value={pendingFilters.description} onChange={(v) => setPendingFilter("description", v)} scope="Pending" />,
      cell: (l) => descriptionCell(l),
    },
    {
      key: "barcode",
      header: <ColumnSearchHeader label="Barcode" value={pendingFilters.barcode} onChange={(v) => setPendingFilter("barcode", v)} scope="Pending" />,
      cell: (l) => l.barcode ?? "—",
    },
    {
      key: "category",
      header: <ColumnSearchHeader label="Category" value={pendingFilters.category} onChange={(v) => setPendingFilter("category", v)} scope="Pending" />,
      cell: (l) => categoryName(l.category_id),
    },
    {
      key: "cost",
      header: <ColumnSearchHeader label="PO Value" value={pendingFilters.cost} onChange={(v) => setPendingFilter("cost", v)} scope="Pending" />,
      headerClassName: "text-right", cellClassName: "text-right tabular-nums",
      cell: (l) => (l.total_cost ?? 0).toFixed(2),
    },
    {
      key: "actions",
      header: "",
      cell: (l) => (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => openEdit(l)}>
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => cancelMutation.mutate(l.id)}>
            Cancel
          </Button>
        </div>
      ),
    },
  ];

  const deliveredColumns: DataTableColumn<PendingAssetRow>[] = [
    {
      key: "description",
      header: <ColumnSearchHeader label="Description" value={deliveredFilters.description} onChange={(v) => setDeliveredFilter("description", v)} scope="Delivered" />,
      cell: (l) => descriptionCell(l),
    },
    {
      key: "barcode",
      header: <ColumnSearchHeader label="Barcode" value={deliveredFilters.barcode} onChange={(v) => setDeliveredFilter("barcode", v)} scope="Delivered" />,
      cell: (l) => l.barcode ?? "—",
    },
    {
      key: "category",
      header: <ColumnSearchHeader label="Category" value={deliveredFilters.category} onChange={(v) => setDeliveredFilter("category", v)} scope="Delivered" />,
      cell: (l) => categoryName(l.category_id),
    },
    {
      key: "cost",
      header: <ColumnSearchHeader label="PO Value" value={deliveredFilters.cost} onChange={(v) => setDeliveredFilter("cost", v)} scope="Delivered" />,
      headerClassName: "text-right", cellClassName: "text-right tabular-nums",
      cell: (l) => (l.total_cost ?? 0).toFixed(2),
    },
    {
      key: "serial",
      header: <ColumnSearchHeader label="Serial No" value={deliveredFilters.serial} onChange={(v) => setDeliveredFilter("serial", v)} scope="Delivered" />,
      cell: (l) => l.serial_number ?? "—",
    },
  ];

  // No search boxes here -- cancelled lines are a small, rarely-reviewed
  // tail, not something an operator hunts through the way pending/delivered
  // rows get searched while working a PO.
  const cancelledColumns: DataTableColumn<PendingAssetRow>[] = [
    { key: "description", header: "Description", cell: (l) => l.description },
    { key: "barcode", header: "Barcode", cell: (l) => l.barcode ?? "—" },
    { key: "category", header: "Category", cell: (l) => categoryName(l.category_id) },
    {
      key: "cost", header: "PO Value", headerClassName: "text-right", cellClassName: "text-right tabular-nums",
      cell: (l) => (l.total_cost ?? 0).toFixed(2),
    },
  ];

  if (poQ.isError) return <ErrorState message="Couldn't load this purchase order." onRetry={() => poQ.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={poQ.data ? `Purchase Order ${poQ.data.po_number}` : "Purchase Order"}
        description={
          poQ.data
            ? `Vendor: ${vendorName(poQ.data.vendor_id)} · PO Date: ${poQ.data.po_date} · Cost Centre: ${costCenterName(poQ.data.cost_center_id)}`
            : undefined
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/purchase-orders">Close</Link>
            </Button>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete PO
            </Button>
            <Button onClick={openDeliver} disabled={selected.length === 0}>
              Mark {selected.length > 0 ? selected.length : ""} Delivery Done
            </Button>
          </>
        }
      />

      {/* AM-14: a KPI summary row, derived from the already-fetched `lines` --
          the page previously had no at-a-glance sense of this PO's overall
          size/progress/value without reading every table row. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Total Lines" value={lines.length} />
        <SummaryTile label="Pending" value={pendingCount} />
        <SummaryTile label="Delivered" value={deliveredCount} />
        <SummaryTile label="Value" value={totalValue.toFixed(2)} />
      </div>

      {deliveredInvoiceNumbers.length > 0 && (
        <div className="rounded-md border p-3">
          <h2 className="mb-2 text-sm font-semibold">Invoices delivered under this PO</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            PI Number/Date arrive from Finance per invoice, not per PO -- a partial delivery on a
            different invoice gets its own PI, recorded separately.
          </p>
          <ul className="flex flex-col gap-1.5">
            {deliveredInvoiceNumbers.map((invoiceNumber) => (
              <li key={invoiceNumber} className="flex items-center justify-between gap-2 rounded-sm border bg-muted/40 px-2 py-1.5 text-sm">
                <span className="font-medium">{invoiceNumber}</span>
                <Button size="sm" variant="outline" onClick={() => openRecordPi(invoiceNumber)}>
                  Record PI
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add Line</h2>
          <div className="flex gap-2">
            {!showAddLine && (
              <Button size="sm" variant="outline" onClick={() => setShowAddLine(true)}>
                + Add Line
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setBundleOpen(true)}>
              + Add Bundle
            </Button>
          </div>
        </div>
        {showAddLine && (
        <>
        <div className="grid grid-cols-3 gap-2">
          <FormField htmlFor="line-description" label="Description" required>
            <Input id="line-description" value={lineForm.description} onChange={(e) => setLineForm((f) => ({ ...f, description: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-barcode" label="Barcode" required helperText="CityKart's own internal tag — may repeat across assets.">
            <Input id="line-barcode" value={lineForm.barcode} onChange={(e) => setLineForm((f) => ({ ...f, barcode: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-category" label="Category" required>
            <SearchableSelect
              id="line-category"
              value={selectValue(lineForm.categoryId)}
              onValueChange={(v) => setLineForm((f) => ({ ...f, categoryId: v, subcategoryId: "" }))}
              options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
            />
          </FormField>
          <FormField htmlFor="line-subcategory" label="Sub-Category" required>
            <SearchableSelect
              id="line-subcategory"
              value={selectValue(lineForm.subcategoryId)}
              onValueChange={(v) => setLineForm((f) => ({ ...f, subcategoryId: v }))}
              options={visibleSubcategories.map((s) => ({ value: String(s.id), label: s.name }))}
            />
          </FormField>
          {lineForm.categoryId && (
            <FormField htmlFor="line-responsibility" label="Responsibility" helperText="Derived from Category.">
              <Input
                id="line-responsibility"
                value={domainLabel(categories.find((c) => c.id === Number(lineForm.categoryId))?.asset_domain ?? "")}
                disabled
                readOnly
              />
            </FormField>
          )}
          <FormField htmlFor="line-cost" label="Cost" required>
            <Input id="line-cost" type="number" min={0.01} step="0.01" value={lineForm.purchaseCost} onChange={(e) => setLineForm((f) => ({ ...f, purchaseCost: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-tax" label="Tax %">
            <Input id="line-tax" type="number" value={lineForm.taxPercent} onChange={(e) => setLineForm((f) => ({ ...f, taxPercent: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-quantity" label="Quantity" required>
            <Input id="line-quantity" type="number" min={1} value={lineForm.quantity} onChange={(e) => setLineForm((f) => ({ ...f, quantity: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-brand" label="Brand">
            <SearchableSelect
              id="line-brand"
              value={selectValue(lineForm.brandId)}
              onValueChange={(v) => setLineForm((f) => ({ ...f, brandId: v }))}
              options={brands.map((b) => ({ value: String(b.id), label: b.name }))}
            />
          </FormField>
          <FormField htmlFor="line-model" label="Model">
            <Input id="line-model" value={lineForm.model} onChange={(e) => setLineForm((f) => ({ ...f, model: e.target.value }))} />
          </FormField>
          <FormField htmlFor="line-warranty-years" label="Warranty Years" required helperText="Enter 0 if there is no warranty.">
            <Input id="line-warranty-years" type="number" min={0} step={1} value={lineForm.warrantyYears} onChange={(e) => setLineForm((f) => ({ ...f, warrantyYears: e.target.value }))} />
          </FormField>
        </div>
        {addLineMutation.isError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {addLineMutation.error instanceof Error ? addLineMutation.error.message : "Failed to add line."}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <AsyncButton onClick={() => addLineMutation.mutate()} disabled={!canAddLine} pending={addLineMutation.isPending} pendingLabel="Adding…">
            Add Line
          </AsyncButton>
          <Button variant="ghost" onClick={() => setShowAddLine(false)}>
            Cancel
          </Button>
        </div>
        </>
        )}
      </div>

      <div className="rounded-md border p-3">
        <h2 className="mb-2 text-sm font-semibold">Pending Delivery ({pendingLines.length})</h2>
        <DataTable
          columns={pendingColumns}
          rows={pendingLines}
          rowKey={(l) => l.id}
          isLoading={linesQ.isLoading}
          emptyState={
            <EmptyState title={pendingCount === 0 ? "Nothing pending delivery." : "No pending lines match the current search."} />
          }
        />
      </div>

      <div className="rounded-md border p-3">
        <h2 className="mb-2 text-sm font-semibold">Delivered ({deliveredLines.length})</h2>
        <DataTable
          columns={deliveredColumns}
          rows={deliveredLines}
          rowKey={(l) => l.id}
          isLoading={linesQ.isLoading}
          emptyState={
            <EmptyState title={deliveredCount === 0 ? "Nothing delivered yet." : "No delivered lines match the current search."} />
          }
        />
      </div>

      {cancelledLines.length > 0 && (
        <div className="rounded-md border p-3">
          <h2 className="mb-2 text-sm font-semibold">Cancelled ({cancelledLines.length})</h2>
          <DataTable
            columns={cancelledColumns}
            rows={cancelledLines}
            rowKey={(l) => l.id}
            emptyState={<EmptyState title="No cancelled lines." />}
          />
        </div>
      )}

      <Dialog open={editingLine !== null} onOpenChange={(open) => !open && setEditingLine(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit line</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <FormField htmlFor="edit-description" label="Description" required>
              <Input id="edit-description" value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
            </FormField>
            <FormField htmlFor="edit-barcode" label="Barcode" required>
              <Input id="edit-barcode" value={editForm.barcode} onChange={(e) => setEditForm((f) => ({ ...f, barcode: e.target.value }))} />
            </FormField>
            <FormField htmlFor="edit-cost" label="Cost" required>
              <Input id="edit-cost" type="number" min={0.01} step="0.01" value={editForm.purchaseCost} onChange={(e) => setEditForm((f) => ({ ...f, purchaseCost: e.target.value }))} />
            </FormField>
            <FormField htmlFor="edit-tax" label="Tax %">
              <Input id="edit-tax" type="number" value={editForm.taxPercent} onChange={(e) => setEditForm((f) => ({ ...f, taxPercent: e.target.value }))} />
            </FormField>
            <FormField htmlFor="edit-brand" label="Brand">
              <SearchableSelect
                id="edit-brand"
                value={selectValue(editForm.brandId)}
                onValueChange={(v) => setEditForm((f) => ({ ...f, brandId: v }))}
                options={brands.map((b) => ({ value: String(b.id), label: b.name }))}
              />
            </FormField>
            <FormField htmlFor="edit-model" label="Model">
              <Input id="edit-model" value={editForm.model} onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))} />
            </FormField>
            <FormField htmlFor="edit-warranty-years" label="Warranty Years" required helperText="Enter 0 if there is no warranty.">
              <Input id="edit-warranty-years" type="number" min={0} step={1} value={editForm.warrantyYears} onChange={(e) => setEditForm((f) => ({ ...f, warrantyYears: e.target.value }))} />
            </FormField>
          </div>
          {editMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {editMutation.error instanceof Error ? editMutation.error.message : "Failed to update line."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLine(null)}>
              Cancel
            </Button>
            <AsyncButton onClick={() => editMutation.mutate()} disabled={!canSaveEdit} pending={editMutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={recordPiInvoice !== null} onOpenChange={(open) => !open && setRecordPiInvoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record PI for invoice {recordPiInvoice}</DialogTitle>
          </DialogHeader>
          {recordPiResult ? (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                Updated <span className="font-semibold tabular-nums">{recordPiResult.updated.length}</span> asset(s).
              </p>
              {recordPiResult.skipped.length > 0 && (
                <p className="text-muted-foreground">
                  Skipped <span className="font-semibold tabular-nums">{recordPiResult.skipped.length}</span> asset(s)
                  that already had a PI Number (tick "Overwrite existing values" and run it again to force-correct them).
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <FormField htmlFor="record-pi-number" label="PI Number" required>
                <Input
                  id="record-pi-number" aria-label="PI Number" value={recordPiForm.piNumber}
                  onChange={(e) => setRecordPiForm((f) => ({ ...f, piNumber: e.target.value }))}
                />
              </FormField>
              <FormField htmlFor="record-pi-date" label="PI Date" required>
                <Input
                  id="record-pi-date" aria-label="PI Date" type="date" value={recordPiForm.piDate}
                  onChange={(e) => setRecordPiForm((f) => ({ ...f, piDate: e.target.value }))}
                />
              </FormField>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label="Overwrite existing values"
                  checked={recordPiForm.overwrite}
                  onCheckedChange={(checked) => setRecordPiForm((f) => ({ ...f, overwrite: checked === true }))}
                />
                Overwrite existing values
              </label>
              <p className="text-xs text-muted-foreground">
                Off (default): only fills in assets from this invoice that don't have a PI yet.
                On: replaces the PI on every asset from this invoice, even ones already set -- use this to fix a typo.
              </p>
              {recordPiMutation.isError && (
                <p className="text-sm text-destructive" role="alert">
                  {recordPiMutation.error instanceof Error ? recordPiMutation.error.message : "Failed to record PI."}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordPiInvoice(null)}>
              {recordPiResult ? "Close" : "Cancel"}
            </Button>
            {!recordPiResult && (
              <AsyncButton onClick={() => recordPiMutation.mutate()} disabled={!canRecordPi} pending={recordPiMutation.isPending} pendingLabel="Saving…">
                Save
              </AsyncButton>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddBundleDialog poId={poId} open={bundleOpen} onOpenChange={setBundleOpen} />

      <Dialog open={deliverOpen} onOpenChange={(open) => !open && setDeliverOpen(false)}>
        {/* flex flex-col + max-h + overflow-hidden caps the dialog to the
            viewport; only the per-line list below scrolls (flex-1 min-h-0),
            so Cancel/Confirm in the footer stay reachable no matter how many
            lines were selected -- previously the dialog just grew past the
            viewport with no way to scroll down to them. */}
        <DialogContent className="flex max-h-[85vh] max-w-xl flex-col gap-3 overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-base">
              Mark {selectedLines.length} asset{selectedLines.length === 1 ? "" : "s"} delivered
            </DialogTitle>
          </DialogHeader>

          <div className="flex shrink-0 flex-col gap-1">
            <Label htmlFor="initial-asset-user" className="text-xs">
              Initial Asset User<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </Label>
            <SearchableSelect
              id="initial-asset-user"
              value={selectValue(initialAssetUserId)}
              onValueChange={setInitialAssetUserId}
              options={asset_users.map((h) => ({ value: String(h.id), label: h.name, keywords: assetUserKeywords(h) }))}
            />
            <p className="text-xs text-muted-foreground">Where this delivery goes. Applies to every asset below.</p>
          </div>

          <div className="grid shrink-0 grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="invoice-number" className="text-xs">
                Invoice No<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input id="invoice-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="invoice-date" className="text-xs">
                Invoice Date<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input id="invoice-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="invoice-amount" className="text-xs">
                Invoice Amount<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input id="invoice-amount" type="number" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {deliveryGroups.map((g) => {
              const n = g.lines.length;
              const first = g.lines[0];
              const inp = groupInput[g.key] ?? { text: "", noSerial: false };
              const tokens = parseSerials(inp.text);
              const extra = Math.max(0, tokens.length - n);
              const dups = [...new Set(tokens.filter((s) => duplicateSerials.has(s.toLowerCase())))];
              const taken = [...new Set(tokens.filter((s) => existingSerials[s.toLowerCase()] !== undefined))];
              const problem = !inp.noSerial && (extra > 0 || dups.length > 0 || taken.length > 0);
              return (
                <div key={g.key} className="flex flex-col gap-2 rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-xs font-medium">{first.description}</div>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                      {n} unit{n === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={n === 1 ? `serial-${first.id}` : `serials-${first.id}`} className="text-xs">
                      {n === 1 ? "Serial Number" : "Serial Numbers"}
                      <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
                    </Label>
                    {n === 1 ? (
                      <Input
                        id={`serial-${first.id}`}
                        value={inp.noSerial ? "N/A" : inp.text}
                        disabled={inp.noSerial}
                        onChange={(e) => setGroupField(g.key, { text: e.target.value })}
                      />
                    ) : (
                      <Textarea
                        id={`serials-${first.id}`}
                        rows={Math.min(Math.max(n, 2), 6)}
                        value={inp.noSerial ? `N/A for all ${n} units` : inp.text}
                        disabled={inp.noSerial}
                        placeholder="One serial per line. Paste a list or scan; each scan goes on a new line."
                        onChange={(e) => setGroupField(g.key, { text: e.target.value })}
                      />
                    )}
                    {n > 1 && !inp.noSerial && (
                      <p className={`text-xs ${problem ? "text-destructive" : "text-muted-foreground"}`}>
                        {tokens.length} of {n} entered
                        {extra > 0 && ` -- ${extra} too many, remove ${extra === 1 ? "it" : "them"}`}
                        {dups.length > 0 && ` -- duplicate: ${dups.join(", ")}`}
                        {tokens.length < n && leavePending && ` -- ${n - tokens.length} will stay pending`}
                      </p>
                    )}
                    {n === 1 && dups.length > 0 && !inp.noSerial && (
                      <p className="text-xs text-destructive">Duplicate serial: {dups.join(", ")}</p>
                    )}
                    {!inp.noSerial && taken.map((s) => (
                      <p key={s} className="text-xs text-destructive" role="alert">
                        Serial "{s}" is already used by asset {existingSerials[s.toLowerCase()]}
                      </p>
                    ))}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      aria-label={`No serial number for ${first.description}`}
                      checked={inp.noSerial}
                      onCheckedChange={(checked) => setGroupField(g.key, { noSerial: checked === true })}
                    />
                    No serial number{n > 1 ? " (sets N/A for all units)" : ""}
                  </label>
                </div>
              );
            })}
          </div>

          {unitsWithoutSerial > 0 && !anyProblem && (
            <label className="flex shrink-0 items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs">
              <Checkbox
                aria-label="Leave the remaining units pending"
                checked={leavePending}
                onCheckedChange={(checked) => setLeavePending(checked === true)}
              />
              <span>
                {unitsWithoutSerial} unit{unitsWithoutSerial === 1 ? " has" : "s have"} no serial yet. Tick to deliver only the{" "}
                {deliverUnits} with serials and leave {unitsWithoutSerial === 1 ? "it" : "them"} in Pending Delivery.
              </span>
            </label>
          )}

          {deliverMutation.isError && (
            <p className="shrink-0 text-sm text-destructive" role="alert">
              {deliverMutation.error instanceof Error ? deliverMutation.error.message : "Failed to mark delivery done."}
            </p>
          )}

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setDeliverOpen(false)}>
              Cancel
            </Button>
            <AsyncButton onClick={() => deliverMutation.mutate()} disabled={!canDeliver} pending={deliverMutation.isPending} pendingLabel="Saving…">
              Confirm
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (!open) deleteMutation.reset(); }}>
        <DialogContent>
          {allDeliveredLines.length > 0 && !isPrimaryOwner ? (
            <>
              <DialogHeader>
                <DialogTitle>This purchase order already has delivered items</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {allDeliveredLines.length} item{allDeliveredLines.length === 1 ? "" : "s"} under this PO
                {allDeliveredLines.length === 1 ? " has" : " have"} already been delivered into the Fixed Asset
                Register. Only the Primary Owner can delete a purchase order once items have been delivered.
              </p>
              <DialogFooter>
                <Button onClick={() => setDeleteOpen(false)}>Close</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Delete Purchase Order {poQ.data?.po_number}?</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-2 text-sm">
                {pendingCount > 0 && (
                  <p>{pendingCount} pending line{pendingCount === 1 ? "" : "s"} will be cancelled.</p>
                )}
                {allDeliveredLines.length > 0 ? (
                  <>
                    <p className="font-medium text-destructive">
                      This will also permanently remove {allDeliveredLines.length} asset
                      {allDeliveredLines.length === 1 ? "" : "s"} already in the Fixed Asset Register:
                    </p>
                    <ul className="list-disc pl-5">
                      {allDeliveredLines.map((l) => (
                        <li key={l.id}>
                          {l.description} (Barcode: {l.barcode ?? "—"}, Serial: {l.serial_number ?? "—"})
                        </li>
                      ))}
                    </ul>
                    <p className="text-muted-foreground">
                      This is refused if any of these assets have already moved or been processed beyond their
                      original delivery -- they would need to be handled individually first.
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">Nothing has been delivered under this PO yet -- no assets are affected.</p>
                )}
              </div>
              {deleteMutation.isError && (
                <p className="text-sm text-destructive" role="alert">
                  {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Failed to delete this purchase order."}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                  Cancel
                </Button>
                <AsyncButton
                  onClick={() => deleteMutation.mutate()}
                  pending={deleteMutation.isPending}
                  pendingLabel="Deleting…"
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AsyncButton>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
