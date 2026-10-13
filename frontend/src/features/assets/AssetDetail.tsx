import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { apiClient, ApiError } from "../../lib/api-client";
import { authFetch } from "../../lib/auth-fetch";
import { useAuthStore } from "../../lib/auth-store";
import { computeWarrantyUpto } from "../../lib/warranty";
import { choicesFor, type MoveChoice } from "./actionRules";
import { fieldLabel, humanizeCode, placeTypeLabel, workAreaLabel } from "../../lib/labels";
import { brandOptions, categoryOptions, nameOptions, vendorOptions } from "../../lib/option-labels";
import { canCreate as may, useCapabilities } from "../../lib/capabilities";
import { NewBrandDialog, NewVendorDialog } from "@/components/quick-create/masters";
import { Timeline, type AssetEvent } from "./Timeline";
import { DocumentsTab } from "./DocumentsTab";
import { PrintLabelsAction } from "../labels/PrintLabelsAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";

interface Asset {
  id: number;
  asset_code: string;
  legacy_asset_code: string | null;
  company_id: number;
  cost_center_id: number;
  category_id: number;
  subcategory_id: number | null;
  brand_id: number | null;
  model: string | null;
  serial_number: string | null;
  serial_pending?: boolean;
  barcode: string | null;
  description: string;
  vendor_id: number | null;
  po_number: string | null;
  po_date: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_amount: number | null;
  pi_number: string | null;
  pi_date: string | null;
  purchase_cost: number | null;
  tax_percent: number | null;
  tax_amount: number | null;
  total_cost: number | null;
  purchase_date: string;
  warranty_years: number | null;
  warranty_upto: string | null;
  status: string;
  current_asset_user_id: number;
  status_since: string;
  // IT / NON_IT, derived server-side from Category at creation (spec §18).
  asset_domain: string;
  custom_fields: Record<string, unknown>;
  category_name: string | null;
  subcategory_name: string | null;
  cost_center_name: string | null;
  vendor_name: string | null;
  brand_name: string | null;
  // CityKart's own Item this asset is, and the ERP item code it was bought
  // under (a link back to the PO / receipt / PI, not what the asset IS).
  item_name?: string | null;
  erp_item_code?: string | null;
  current_asset_user_name: string | null;
  current_asset_user_type: string | null;
  location_name: string | null;
  department_name: string | null;
  company_name?: string | null;
}

interface CustomFieldDef {
  field_key: string;
  label: string;
  field_type: "text" | "number" | "date" | "dropdown" | "checkbox";
  options: { choices?: string[] } | null;
  is_required: boolean;
  sort_order: number;
  // AM-05: null = Global (applies to every company); a real id = applies
  // only to that company's assets. See app/assets/custom_field_values.py
  // on the backend for the matching applicability rule.
  company_id: number | null;
}

interface FieldChange {
  id: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  actor_id: number;
  actor_name: string | null;
  request_id: string;
  created_at: string;
  // AM-07: only ever populated for a controlled correction row -- NULL on
  // an ordinary descriptive/procurement edit row. Its presence is the
  // signal the Changes tab uses to render a row as "Correction".
  reason: string | null;
}

interface MasterOption {
  id: number;
  name: string;
  code?: string | null;
}

interface VendorOption extends MasterOption {
  gstin?: string | null;
}

interface EditFormState {
  legacyAssetCode: string;
  brandId: string;
  model: string;
  serialNumber: string;
  barcode: string;
  description: string;
  vendorId: string;
  poNumber: string;
  poDate: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceAmount: string;
  piNumber: string;
  piDate: string;
  purchaseCost: string;
  taxPercent: string;
  // AM-18: "" means "leave exactly as-is, don't recompute Warranty Upto"
  // (a legacy asset's warranty_years may genuinely be unset) -- distinct
  // from an explicit "0" ("no warranty"). See the submit payload below.
  warrantyYears: string;
}

function editFormFromAsset(asset: Asset): EditFormState {
  return {
    legacyAssetCode: asset.legacy_asset_code ?? "",
    brandId: asset.brand_id ? String(asset.brand_id) : "",
    model: asset.model ?? "",
    serialNumber: asset.serial_number ?? "",
    barcode: asset.barcode ?? "",
    description: asset.description,
    vendorId: asset.vendor_id ? String(asset.vendor_id) : "",
    poNumber: asset.po_number ?? "",
    poDate: asset.po_date ?? "",
    invoiceNumber: asset.invoice_number ?? "",
    invoiceDate: asset.invoice_date ?? "",
    invoiceAmount: asset.invoice_amount != null ? String(asset.invoice_amount) : "",
    piNumber: asset.pi_number ?? "",
    piDate: asset.pi_date ?? "",
    purchaseCost: asset.purchase_cost != null ? String(asset.purchase_cost) : "0",
    taxPercent: asset.tax_percent != null ? String(asset.tax_percent) : "0",
    warrantyYears: asset.warranty_years != null ? String(asset.warranty_years) : "",
  };
}

/** The server's own sentence for an attempt to clear a serial number (shown before saving too). */
const SERIAL_REMOVED_TEXT = "The serial number cannot be removed. Type N/A if the asset has none.";

type CustomFieldValue = string | number | boolean;

function customValuesFromAsset(asset: Asset): Record<string, CustomFieldValue> {
  const out: Record<string, CustomFieldValue> = {};
  for (const [k, v] of Object.entries(asset.custom_fields)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

function selectValue(v: string): string | undefined {
  return v || undefined;
}

function ReadField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value === null || value === undefined || value === "" ? "—" : value}</dd>
    </div>
  );
}

/** One titled block of Asset 360 (a named region, so it can be found by its title). */
function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`flex flex-col gap-3 rounded-md border p-3 ${className ?? ""}`}>
      <h2 id={id} className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const money = (v: number | null | undefined) => (v != null ? v.toFixed(2) : null);
/** "PO-1 · 2025-05-20": a number and its date as one fact. */
const withDate = (num: string | null, date: string | null) => [num, date].filter(Boolean).join(" · ") || null;

/** The serial in plain words: the serial, "Pending: still to be added", or "None (N/A)". */
function serialValue(asset: { serial_number: string | null; serial_pending?: boolean }): ReactNode {
  if (asset.serial_pending) return <span className="text-warning-foreground">Pending: still to be added</span>;
  if (asset.serial_number && asset.serial_number.trim().toUpperCase() === "N/A") return "None (N/A)";
  return asset.serial_number;
}

function warrantyValue(years: number | null, upto: string | null): string | null {
  if (years == null && !upto) return null;
  const y = years != null ? `${years} year${years === 1 ? "" : "s"}` : null;
  return [y, upto ? `until ${upto}` : null].filter(Boolean).join(" · ");
}

/** The Changes tab's columns; custom fields show the label the admin gave them. */
function changeColumns(customFieldLabels: Record<string, string>): DataTableColumn<FieldChange>[] {
  return [
  {
    key: "type",
    header: "Type",
    cell: (c) =>
      c.reason ? (
        <span className="rounded-full border-transparent bg-info-soft px-2 py-0.5 text-xs font-medium text-on-info-soft">
          Correction
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Edit</span>
      ),
  },
  { key: "field", header: "Field", cell: (c) => fieldLabel(c.field_name, customFieldLabels) },
  { key: "old", header: "Old Value", cell: (c) => c.old_value ?? "—" },
  { key: "new", header: "New Value", cell: (c) => c.new_value ?? "—" },
  { key: "reason", header: "Reason", cell: (c) => c.reason ?? "—" },
  { key: "actor", header: "Changed By", cell: (c) => c.actor_name ?? "Unknown" },
  { key: "when", header: "When", cellClassName: "text-right", cell: (c) => new Date(c.created_at).toLocaleString() },
  ];
}

/** "← Assets": back to the register. */
function BackToAssets() {
  return (
    <nav aria-label="Breadcrumb">
      <Link to="/assets" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Assets
      </Link>
    </nav>
  );
}

export function AssetDetail({ assetId }: { assetId: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);
  // Print, Move, Edit, Correct and every lifecycle choice are for ADMIN/OPERATOR
  // only (VIEWER and SELF_SERVICE just look). The server re-checks every write.
  const canEdit = role === "ADMIN" || role === "OPERATOR";
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [editCustomValues, setEditCustomValues] = useState<Record<string, CustomFieldValue>>({});

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    async function loadQr() {
      const res = await authFetch(`/assets/${assetId}/qr.png`);
      if (!res.ok || cancelled) return;
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) setQrUrl(objectUrl);
    }
    loadQr();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);

  const assetQ = useQuery({
    queryKey: ["assets", assetId],
    queryFn: () => apiClient.get<Asset>(`/assets/${assetId}`),
    retry: (failureCount, error) => !(error instanceof ApiError && error.status === 404) && failureCount < 2,
  });
  const asset = assetQ.data;

  const { data: events = [] } = useQuery({
    queryKey: ["assets", assetId, "events"],
    queryFn: () => apiClient.get<AssetEvent[]>(`/assets/${assetId}/events`),
    enabled: !!asset,
  });
  const { data: changes = [] } = useQuery({
    queryKey: ["assets", assetId, "changes"],
    queryFn: () => apiClient.get<FieldChange[]>(`/assets/${assetId}/changes`),
    enabled: !!asset,
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ["masters", "vendors"],
    queryFn: () => apiClient.get<VendorOption[]>("/masters/vendors"),
    enabled: editing,
  });
  const { data: brands = [] } = useQuery({
    queryKey: ["masters", "brands"],
    queryFn: () => apiClient.get<MasterOption[]>("/masters/brands"),
    enabled: editing,
  });
  // A missing brand or vendor is added right here by whoever may (capabilities endpoint).
  const { caps } = useCapabilities();
  const [newBrand, setNewBrand] = useState(false);
  const [newVendor, setNewVendor] = useState(false);
  const { data: customFieldDefsRaw = [] } = useQuery({
    queryKey: ["masters", "custom-fields"],
    queryFn: () => apiClient.get<CustomFieldDef[]>("/masters/custom-fields"),
  });
  // AM-05: only fields applicable to THIS asset's company -- Global
  // (company_id null) plus this company's own -- are offered for editing
  // here. A value already stored under a key that falls outside this set
  // (e.g. its field was later scoped to a different company) still shows
  // via the read-only Custom Fields tab and is preserved by
  // buildEditCustomFieldsPayload's activeDefsByKey fallback below -- it's
  // only kept out of the *editable* set, never hidden.
  const customFieldDefs = useMemo(
    () =>
      customFieldDefsRaw
        .filter((d) => d.company_id === null || d.company_id === asset?.company_id)
        .sort((a, b) => a.sort_order - b.sort_order),
    [customFieldDefsRaw, asset?.company_id],
  );
  const activeDefsByKey = useMemo(
    () => new Map(customFieldDefs.map((d) => [d.field_key, d])),
    [customFieldDefs],
  );
  // Every known custom field's label (any company), for the Changes tab and
  // the read-only Custom Fields tab.
  const customFieldLabelsByKey = useMemo(() => {
    const out: Record<string, string> = {};
    for (const d of customFieldDefsRaw) out[d.field_key] = d.label;
    return out;
  }, [customFieldDefsRaw]);
  const changeCols = useMemo(() => changeColumns(customFieldLabelsByKey), [customFieldLabelsByKey]);

  // Every lifecycle choice happens on the one Move screen, opened with this asset
  // already in the batch (and the choice already made, when one was picked here).
  function openMove(choice?: MoveChoice) {
    navigate({ to: "/asset-movement", search: { ids: String(assetId), ...(choice ? { choice: choice.key } : {}) } });
  }

  function startEdit() {
    if (!asset) return;
    setEditForm(editFormFromAsset(asset));
    setEditCustomValues(customValuesFromAsset(asset));
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditForm(null);
    editMutation.reset();
  }

  function setEditField<K extends keyof EditFormState>(key: K, value: EditFormState[K]) {
    setEditForm((f) => (f ? { ...f, [key]: value } : f));
  }

  function setEditCustomValue(key: string, value: CustomFieldValue) {
    setEditCustomValues((v) => ({ ...v, [key]: value }));
  }

  function requiredCustomFieldMissing(fieldDef: CustomFieldDef): boolean {
    if (!fieldDef.is_required) return false;
    if (fieldDef.field_type === "checkbox") return false;
    const v = editCustomValues[fieldDef.field_key];
    return v === undefined || v === "";
  }

  const editHasMissingRequiredUdf = editing && customFieldDefs.some(requiredCustomFieldMissing);

  function buildEditCustomFieldsPayload(): Record<string, CustomFieldValue> {
    const payload: Record<string, CustomFieldValue> = {};
    for (const field of customFieldDefs) {
      const raw = editCustomValues[field.field_key];
      if (field.field_type === "checkbox") {
        payload[field.field_key] = raw === true;
        continue;
      }
      if (raw === undefined || raw === "") continue;
      payload[field.field_key] = field.field_type === "number" ? Number(raw) : raw;
    }
    // Preserve values for keys the currently-active definitions don't cover
    // (e.g. a definition deactivated after this asset last saved) -- editing
    // other fields must not silently drop that retained history.
    for (const [k, v] of Object.entries(editCustomValues)) {
      if (!activeDefsByKey.has(k) && !(k in payload)) payload[k] = v;
    }
    return payload;
  }

  // The serial number is sent only when it was changed (a request without it keeps the stored one), and never
  // blank: the server refuses to remove a serial ("Type N/A if the asset has none."), so the form says so first.
  const originalSerial = (asset?.serial_number ?? "").trim();
  const typedSerial = (editForm?.serialNumber ?? "").trim();
  const serialRemoved = editing && originalSerial !== "" && typedSerial === "";
  const serialPatch = (typed: string, original: string): { serial_number?: string } =>
    typed !== "" && typed !== original ? { serial_number: typed } : {};

  const editMutation = useMutation({
    mutationFn: () => {
      const f = editForm!;
      return apiClient.put<Asset>(`/assets/${assetId}`, {
        legacy_asset_code: f.legacyAssetCode || null,
        brand_id: f.brandId ? Number(f.brandId) : null,
        model: f.model || null,
        ...serialPatch(f.serialNumber.trim(), originalSerial),
        barcode: f.barcode || null,
        description: f.description,
        vendor_id: f.vendorId ? Number(f.vendorId) : null,
        po_number: f.poNumber || null,
        po_date: f.poDate || null,
        invoice_number: f.invoiceNumber || null,
        invoice_date: f.invoiceDate || null,
        invoice_amount: f.invoiceAmount === "" ? null : Number(f.invoiceAmount),
        pi_number: f.piNumber || null,
        pi_date: f.piDate || null,
        purchase_cost: Number(f.purchaseCost) || 0,
        tax_percent: Number(f.taxPercent) || 0,
        // AM-18: "" -> null ("leave exactly as-is, don't recompute"),
        // otherwise the explicit int the user typed (0 included).
        warranty_years: f.warrantyYears.trim() === "" ? null : Number(f.warrantyYears),
        custom_fields: buildEditCustomFieldsPayload(),
      });
    },
    onSuccess: (updated) => {
      qc.setQueryData(["assets", assetId], updated);
      qc.invalidateQueries({ queryKey: ["assets", assetId, "changes"] });
      setEditing(false);
      setEditForm(null);
    },
  });

  // AM-07: Correct Classification / Purchase Date -- a deliberately
  // separate dialog from Edit mode above, never folded into it. Category/
  // Subcategory/Purchase Date are ordinary Selects/Input here (unlike
  // Edit mode, which never renders them as controls at all) because this
  // dialog's entire purpose IS changing them, through the dedicated
  // correction endpoint, never PUT /api/assets/{id}.
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionCategoryId, setCorrectionCategoryId] = useState("");
  const [correctionSubcategoryId, setCorrectionSubcategoryId] = useState("");
  const [correctionPurchaseDate, setCorrectionPurchaseDate] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");

  const { data: categories = [] } = useQuery({
    queryKey: ["masters", "categories"],
    queryFn: () => apiClient.get<MasterOption[]>("/masters/categories"),
    enabled: correctionOpen,
  });
  const { data: subcategoriesRaw = [] } = useQuery({
    queryKey: ["masters", "subcategories"],
    queryFn: () => apiClient.get<(MasterOption & { category_id: number })[]>("/masters/subcategories"),
    enabled: correctionOpen,
  });
  const correctionSubcategories = subcategoriesRaw.filter((s) => String(s.category_id) === correctionCategoryId);
  const categoryName = (id: string) => categories.find((c) => String(c.id) === id)?.name ?? id;
  const subcategoryName = (id: string) => (id ? subcategoriesRaw.find((s) => String(s.id) === id)?.name ?? id : "—");

  function openCorrection() {
    if (!asset) return;
    setCorrectionCategoryId(String(asset.category_id));
    setCorrectionSubcategoryId(asset.subcategory_id != null ? String(asset.subcategory_id) : "");
    setCorrectionPurchaseDate(asset.purchase_date);
    setCorrectionReason("");
    correctionMutation.reset();
    setCorrectionOpen(true);
  }

  function closeCorrection() {
    setCorrectionOpen(false);
  }

  function handleCorrectionCategoryChange(value: string) {
    setCorrectionCategoryId(value);
    // A subcategory that doesn't belong to the newly-picked category is
    // cleared automatically, never silently left selected and pointing at
    // an invalid pair the server would just reject anyway.
    const stillValid = subcategoriesRaw.some(
      (s) => String(s.id) === correctionSubcategoryId && String(s.category_id) === value,
    );
    if (!stillValid) setCorrectionSubcategoryId("");
  }

  const correctionCategoryChanged = asset ? correctionCategoryId !== String(asset.category_id) : false;
  const correctionSubcategoryChanged = asset
    ? correctionSubcategoryId !== (asset.subcategory_id != null ? String(asset.subcategory_id) : "")
    : false;
  const correctionDateChanged = asset ? correctionPurchaseDate !== asset.purchase_date : false;
  const correctionHasChange = correctionCategoryChanged || correctionSubcategoryChanged || correctionDateChanged;
  const correctionReasonValid = correctionReason.trim().length > 0;

  const correctionMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { reason: correctionReason.trim() };
      if (correctionCategoryChanged) body.category_id = Number(correctionCategoryId);
      if (correctionSubcategoryChanged) body.subcategory_id = correctionSubcategoryId ? Number(correctionSubcategoryId) : null;
      if (correctionDateChanged) body.purchase_date = correctionPurchaseDate;
      return apiClient.post<Asset>(`/assets/${assetId}/corrections`, body);
    },
    onSuccess: (updated) => {
      qc.setQueryData(["assets", assetId], updated);
      qc.invalidateQueries({ queryKey: ["assets", assetId, "changes"] });
      closeCorrection();
    },
  });

  if (assetQ.isError && assetQ.error instanceof ApiError && assetQ.error.status === 404) {
    return (
      <div className="flex flex-col gap-4">
        <BackToAssets />
        <PageHeader title="Asset" />
        <EmptyState title="Asset not found." description="It may have been removed, or you may not have access to it." />
      </div>
    );
  }

  if (assetQ.isError) {
    return (
      <div className="flex flex-col gap-4">
        <BackToAssets />
        <PageHeader title="Asset" />
        <ErrorState message="Couldn't load this asset." onRetry={() => assetQ.refetch()} />
      </div>
    );
  }

  if (assetQ.isLoading || !asset) {
    return (
      <div className="flex flex-col gap-4">
        <BackToAssets />
        <PageHeader title="Asset" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  // The same rule the Move screen uses to decide what an asset can do next.
  const choices = choicesFor(asset.status, { isAdmin: role === "ADMIN" });
  const customFieldEntries = Object.entries(asset.custom_fields ?? {});

  return (
    <div className="flex flex-col gap-4">
      <BackToAssets />

      {/* Summary: what it is, where it is, whose it is -- and what can be done with it. */}
      <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3" data-testid="asset-summary">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {qrUrl && <img src={qrUrl} alt="Asset QR code" width={56} height={56} className="shrink-0 rounded-sm border bg-white" />}
            <div className="flex flex-col gap-1">
              <h1 className="font-mono text-xl font-semibold text-foreground">{asset.asset_code}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={asset.status} holderType={asset.current_asset_user_type} />
                {asset.asset_domain && (
                  <Badge variant="outline" className="font-normal" title="Work area" data-testid="work-area-chip">
                    <span className="sr-only">Work area: </span>
                    <span>{workAreaLabel(asset.asset_domain)}</span>
                  </Badge>
                )}
              </div>
            </div>
          </div>
          {canEdit && !editing && (
            <div className="flex flex-wrap items-center gap-2">
              {choices.length > 0 && (
                <Button size="sm" onClick={() => openMove()}>Move…</Button>
              )}
              <PrintLabelsAction assets={[asset]}>Print Label</PrintLabelsAction>
              <Button variant="secondary" size="sm" onClick={startEdit}>Edit</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" aria-label="More actions">
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {choices.length > 0 && (
                    <>
                      <DropdownMenuLabel>Move or change status</DropdownMenuLabel>
                      {choices.map((c) => (
                        <DropdownMenuItem key={c.key} onSelect={() => openMove(c)}>{c.label}</DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onSelect={openCorrection}>Correct Classification</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <ReadField label="Item" value={asset.item_name} />
          <ReadField
            label="With"
            value={
              <>
                <span className="font-medium">{asset.current_asset_user_name ?? "—"}</span>
                {asset.current_asset_user_type && ` (${placeTypeLabel(asset.current_asset_user_type)})`}
                {asset.location_name && <span className="text-muted-foreground"> · {asset.location_name}</span>}
              </>
            }
          />
          <ReadField label="Company" value={asset.company_name} />
        </dl>
      </div>

      {editing && editForm ? (
        <div className="flex flex-col gap-4 rounded-md border p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Edit Asset</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <FormField htmlFor="edit-description" label="Description" required className="sm:col-span-2">
              <Textarea id="edit-description" aria-label="Description" value={editForm.description} onChange={(e) => setEditField("description", e.target.value)} />
            </FormField>
            <FormField htmlFor="edit-brand" label="Brand">
              <SearchableSelect
                id="edit-brand"
                aria-label="Brand"
                value={selectValue(editForm.brandId)}
                onValueChange={(v) => setEditField("brandId", v)}
                options={brandOptions(brands)}
                onCreateNew={may(caps, "brand") ? () => setNewBrand(true) : undefined}
                createLabel="New Brand…"
              />
              <NewBrandDialog open={newBrand} onOpenChange={setNewBrand} onCreated={(row) => setEditField("brandId", String(row.id))} />
            </FormField>
            <FormField htmlFor="edit-model" label="Model"><Input id="edit-model" aria-label="Model" value={editForm.model} onChange={(e) => setEditField("model", e.target.value)} /></FormField>
            <FormField
              htmlFor="edit-serial"
              label="Serial Number"
              helperText="Unique across every asset in CKAM. Use “No serial number” for a category that genuinely has none."
              errorText={serialRemoved ? SERIAL_REMOVED_TEXT : undefined}
            >
              <div className="flex flex-col gap-2">
                <Input
                  id="edit-serial"
                  aria-label="Serial Number"
                  value={editForm.serialNumber}
                  disabled={editForm.serialNumber.trim().toUpperCase() === "N/A"}
                  onChange={(e) => setEditField("serialNumber", e.target.value)}
                />
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    aria-label="No serial number"
                    checked={editForm.serialNumber.trim().toUpperCase() === "N/A"}
                    onCheckedChange={(checked) => setEditField("serialNumber", checked === true ? "N/A" : "")}
                  />
                  No serial number for this asset
                </label>
              </div>
            </FormField>
            <FormField htmlFor="edit-barcode" label="Barcode"><Input id="edit-barcode" aria-label="Barcode" value={editForm.barcode} onChange={(e) => setEditField("barcode", e.target.value)} /></FormField>
            <FormField htmlFor="edit-legacy" label="Legacy Asset Code"><Input id="edit-legacy" aria-label="Legacy Asset Code" value={editForm.legacyAssetCode} onChange={(e) => setEditField("legacyAssetCode", e.target.value)} /></FormField>
            <FormField htmlFor="edit-vendor" label="Vendor">
              <SearchableSelect
                id="edit-vendor"
                aria-label="Vendor"
                value={selectValue(editForm.vendorId)}
                onValueChange={(v) => setEditField("vendorId", v)}
                options={vendorOptions(vendors)}
                onCreateNew={may(caps, "vendor") ? () => setNewVendor(true) : undefined}
                createLabel="New Vendor…"
              />
              <NewVendorDialog open={newVendor} onOpenChange={setNewVendor} onCreated={(row) => setEditField("vendorId", String(row.id))} />
            </FormField>
            <FormField
              htmlFor="edit-warranty-years" label="Warranty Years"
              helperText={
                editForm.warrantyYears.trim() === ""
                  ? "Never set for this asset -- leave blank to keep it that way."
                  : `Warranty Upto (preview): ${computeWarrantyUpto(asset.purchase_date, Number(editForm.warrantyYears) || 0)}`
              }
            >
              <Input
                id="edit-warranty-years" aria-label="Warranty Years" type="number" min={0} step={1}
                value={editForm.warrantyYears}
                onChange={(e) => setEditField("warrantyYears", e.target.value)}
              />
            </FormField>
            <FormField htmlFor="edit-po-number" label="PO Number"><Input id="edit-po-number" aria-label="PO Number" value={editForm.poNumber} onChange={(e) => setEditField("poNumber", e.target.value)} /></FormField>
            <FormField htmlFor="edit-po-date" label="PO Date"><Input id="edit-po-date" aria-label="PO Date" type="date" value={editForm.poDate} onChange={(e) => setEditField("poDate", e.target.value)} /></FormField>
            <FormField htmlFor="edit-invoice-number" label="Invoice Number"><Input id="edit-invoice-number" aria-label="Invoice Number" value={editForm.invoiceNumber} onChange={(e) => setEditField("invoiceNumber", e.target.value)} /></FormField>
            <FormField htmlFor="edit-invoice-date" label="Invoice Date"><Input id="edit-invoice-date" aria-label="Invoice Date" type="date" value={editForm.invoiceDate} onChange={(e) => setEditField("invoiceDate", e.target.value)} /></FormField>
            <FormField htmlFor="edit-invoice-amount" label="Invoice Amount"><Input id="edit-invoice-amount" aria-label="Invoice Amount" type="number" min={0} step="0.01" value={editForm.invoiceAmount} onChange={(e) => setEditField("invoiceAmount", e.target.value)} /></FormField>
            <FormField htmlFor="edit-pi-number" label="Purchase Invoice (PI) Number" helperText="CityKart's internal reference for the payment made to the vendor."><Input id="edit-pi-number" aria-label="Purchase Invoice (PI) Number" value={editForm.piNumber} onChange={(e) => setEditField("piNumber", e.target.value)} /></FormField>
            <FormField htmlFor="edit-pi-date" label="PI Date"><Input id="edit-pi-date" aria-label="PI Date" type="date" value={editForm.piDate} onChange={(e) => setEditField("piDate", e.target.value)} /></FormField>
            <FormField htmlFor="edit-purchase-cost" label="Purchase Cost"><Input id="edit-purchase-cost" aria-label="Purchase Cost" type="number" value={editForm.purchaseCost} onChange={(e) => setEditField("purchaseCost", e.target.value)} /></FormField>
            <FormField htmlFor="edit-tax-percent" label="Tax %"><Input id="edit-tax-percent" aria-label="Tax %" type="number" value={editForm.taxPercent} onChange={(e) => setEditField("taxPercent", e.target.value)} /></FormField>
          </div>

          {customFieldDefs.length > 0 && (
            <>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Custom Fields</h3>
              <div className="grid gap-4 lg:grid-cols-2">
                {customFieldDefs.map((fieldDef) => {
                  const htmlId = `edit-udf-${fieldDef.field_key}`;
                  const missing = requiredCustomFieldMissing(fieldDef);
                  if (fieldDef.field_type === "checkbox") {
                    return (
                      <div key={fieldDef.field_key} className="flex items-center gap-2 pt-6">
                        <Checkbox
                          id={htmlId}
                          aria-label={fieldDef.label}
                          checked={editCustomValues[fieldDef.field_key] === true}
                          onCheckedChange={(checked) => setEditCustomValue(fieldDef.field_key, checked === true)}
                        />
                        <label htmlFor={htmlId} className="text-sm font-medium">{fieldDef.label}</label>
                      </div>
                    );
                  }
                  return (
                    <FormField
                      key={fieldDef.field_key}
                      htmlFor={htmlId}
                      label={fieldDef.label}
                      required={fieldDef.is_required}
                      errorText={missing ? `${fieldDef.label} is required.` : undefined}
                    >
                      {fieldDef.field_type === "dropdown" ? (
                        <Select
                          value={selectValue(String(editCustomValues[fieldDef.field_key] ?? ""))}
                          onValueChange={(v) => setEditCustomValue(fieldDef.field_key, v)}
                        >
                          <SelectTrigger id={htmlId} aria-label={fieldDef.label}><SelectValue placeholder="Select…" /></SelectTrigger>
                          <SelectContent>
                            {(fieldDef.options?.choices ?? []).map((choice) => (
                              <SelectItem key={choice} value={choice}>{choice}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={htmlId}
                          aria-label={fieldDef.label}
                          type={fieldDef.field_type === "number" ? "number" : fieldDef.field_type === "date" ? "date" : "text"}
                          value={String(editCustomValues[fieldDef.field_key] ?? "")}
                          onChange={(e) => setEditCustomValue(fieldDef.field_key, e.target.value)}
                        />
                      )}
                    </FormField>
                  );
                })}
              </div>
            </>
          )}

          {editMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {editMutation.error instanceof Error ? editMutation.error.message : "Failed to save changes."}
            </p>
          )}

          <div className="flex gap-2">
            <AsyncButton
              onClick={() => editMutation.mutate()}
              disabled={editForm.description.trim().length === 0 || editHasMissingRequiredUdf || serialRemoved}
              pending={editMutation.isPending}
              pendingLabel="Saving…"
            >
              Save
            </AsyncButton>
            <Button variant="outline" onClick={cancelEdit} disabled={editMutation.isPending}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Identity">
              <dl className="grid gap-3 sm:grid-cols-2">
                <ReadField label="Serial Number" value={serialValue(asset)} />
                <ReadField label="Barcode" value={asset.barcode} />
                <ReadField label="ERP Item Code" value={asset.erp_item_code ? <span className="font-mono">{asset.erp_item_code}</span> : null} />
                <ReadField label="Brand" value={asset.brand_name} />
                <ReadField label="Model" value={asset.model} />
                <ReadField label="Warranty" value={warrantyValue(asset.warranty_years, asset.warranty_upto)} />
                <div className="sm:col-span-2">
                  <ReadField label="Description" value={asset.description} />
                </div>
              </dl>
            </Section>

            <Section title="Procurement">
              <dl className="grid gap-3 sm:grid-cols-2">
                <ReadField label="Vendor" value={asset.vendor_name} />
                <ReadField label="PO" value={withDate(asset.po_number, asset.po_date)} />
                <ReadField label="Invoice" value={withDate(asset.invoice_number, asset.invoice_date)} />
                <ReadField label="Invoice Amount" value={money(asset.invoice_amount)} />
                <ReadField label="Purchase Invoice (PI)" value={withDate(asset.pi_number, asset.pi_date)} />
                <ReadField label="Purchase Date" value={asset.purchase_date} />
                <ReadField label="Cost" value={money(asset.purchase_cost)} />
                <ReadField
                  label="Tax"
                  value={asset.tax_percent != null || asset.tax_amount != null
                    ? [asset.tax_percent != null ? `${asset.tax_percent.toFixed(2)}%` : null, money(asset.tax_amount)].filter(Boolean).join(" · ")
                    : null}
                />
                <ReadField label="Total" value={money(asset.total_cost)} />
                <ReadField label="Cost Centre" value={asset.cost_center_name} />
              </dl>
            </Section>
          </div>

          <Section title="Where it is & history">
            <dl className="grid gap-3 sm:grid-cols-3">
              <ReadField label="Status and place since" value={asset.status_since} />
              <ReadField label="Department" value={asset.department_name} />
            </dl>
            <Timeline events={events} />
          </Section>

          <Section title="More">
            <Tabs defaultValue="documents">
              <div className="overflow-x-auto">
                <TabsList>
                  <TabsTrigger value="documents">Documents</TabsTrigger>
                  <TabsTrigger value="changes">Field changes</TabsTrigger>
                  <TabsTrigger value="custom-fields">Custom fields</TabsTrigger>
                  <TabsTrigger value="advanced">Advanced</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="documents" className="pt-3">
                <DocumentsTab assetId={assetId} />
              </TabsContent>

              <TabsContent value="changes" className="pt-3">
                <DataTable
                  columns={changeCols}
                  rows={changes}
                  rowKey={(c) => c.id}
                  emptyState={<EmptyState title="No edits yet." description="Moves and status changes are shown under Where it is & history, not here." />}
                />
              </TabsContent>

              <TabsContent value="custom-fields" className="pt-3">
                {customFieldEntries.length === 0 ? (
                  <EmptyState title="No custom field values recorded for this asset." />
                ) : (
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {customFieldEntries.map(([key, value]) => {
                      const def = activeDefsByKey.get(key);
                      const label = def?.label ?? `${customFieldLabelsByKey[key] ?? humanizeCode(key)} (retired field)`;
                      const display = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "—");
                      return <ReadField key={key} label={label} value={display} />;
                    })}
                  </dl>
                )}
              </TabsContent>

              <TabsContent value="advanced" className="pt-3">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <ReadField label="Legacy Asset Code" value={asset.legacy_asset_code} />
                  <ReadField label="Category" value={asset.category_name} />
                  <ReadField label="Sub-category" value={asset.subcategory_name} />
                </dl>
              </TabsContent>
            </Tabs>
          </Section>
        </>
      )}

      {/*
        AM-07: a deliberately separate dialog from ordinary Edit mode above
        -- Category/Subcategory/Purchase Date only ever change through here,
        never through PUT /api/assets/{id}. Asset Code is shown but never
        editable, with explicit text saying so.
      */}
      <Dialog open={correctionOpen} onOpenChange={(open) => !open && closeCorrection()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Correct Classification / Purchase Date</DialogTitle>
          </DialogHeader>

          {asset && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Asset Code</span>
                  <span className="font-mono font-medium">{asset.asset_code}</span>
                </div>
                <p className="text-xs text-muted-foreground">Asset Code will not change.</p>
              </div>

              <FormField htmlFor="correction-category" label="Category">
                <SearchableSelect
                  id="correction-category"
                  aria-label="Category"
                  value={correctionCategoryId || undefined}
                  onValueChange={handleCorrectionCategoryChange}
                  options={categoryOptions(categories)}
                />
              </FormField>

              <FormField htmlFor="correction-subcategory" label="Sub-category" helperText="Optional.">
                <SearchableSelect
                  id="correction-subcategory"
                  aria-label="Sub-category"
                  value={correctionSubcategoryId || undefined}
                  onValueChange={(v) => setCorrectionSubcategoryId(v)}
                  options={nameOptions(correctionSubcategories)}
                  placeholder="None"
                />
              </FormField>

              <FormField htmlFor="correction-purchase-date" label="Purchase Date">
                <Input
                  id="correction-purchase-date"
                  aria-label="Purchase Date"
                  type="date"
                  value={correctionPurchaseDate}
                  onChange={(e) => setCorrectionPurchaseDate(e.target.value)}
                />
              </FormField>

              {correctionHasChange && (
                <div className="flex flex-col gap-1 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Impact Summary</p>
                  {correctionCategoryChanged && (
                    <p>Category: {categoryName(String(asset.category_id))} → {categoryName(correctionCategoryId)}</p>
                  )}
                  {correctionSubcategoryChanged && (
                    <p>
                      Sub-category: {subcategoryName(asset.subcategory_id != null ? String(asset.subcategory_id) : "")}
                      {" → "}
                      {subcategoryName(correctionSubcategoryId)}
                    </p>
                  )}
                  {correctionDateChanged && (
                    <p>Purchase Date: {asset.purchase_date} → {correctionPurchaseDate}</p>
                  )}
                  <p className="text-muted-foreground">Asset Code: {asset.asset_code} — unchanged</p>
                </div>
              )}

              <FormField htmlFor="correction-reason" label="Reason" required helperText="Required. Explain why this correction is needed.">
                <Textarea
                  id="correction-reason"
                  aria-label="Reason"
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                />
              </FormField>

              {correctionMutation.isError && (
                <p className="text-sm text-destructive" role="alert">
                  {correctionMutation.error instanceof Error ? correctionMutation.error.message : "Correction failed."}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeCorrection}>
              Cancel
            </Button>
            <AsyncButton
              onClick={() => correctionMutation.mutate()}
              disabled={!correctionHasChange || !correctionReasonValid}
              pending={correctionMutation.isPending}
              pendingLabel="Saving…"
            >
              Confirm Correction
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
