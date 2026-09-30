import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../lib/api-client";
import { authFetch } from "../../lib/auth-fetch";
import { useAuthStore } from "../../lib/auth-store";
import { computeWarrantyUpto } from "../../lib/warranty";
import { actionsFor, type ActionDef } from "./actionRules";
import { Timeline, type AssetEvent } from "./Timeline";
import { DocumentsTab } from "./DocumentsTab";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  current_asset_user_name: string | null;
  current_asset_user_type: string | null;
  location_name: string | null;
  department_name: string | null;
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

interface AssetUserOption {
  id: number;
  code?: string;
  email?: string;
  name: string;
}

// Lets someone find an Asset User by typing their code or email, not just
// their name -- the same fields AssetUsersScreen's own Code/Email columns
// show, so the search matches what's actually on their record.
function assetUserKeywords(h: AssetUserOption): string[] {
  return [h.code, h.email].filter((v): v is string => Boolean(v));
}

interface MasterOption {
  id: number;
  name: string;
}

interface ActionFormState {
  assetUserId: string;
  eventDate: string;
  referenceNo: string;
  remarks: string;
}

const emptyActionForm: ActionFormState = {
  assetUserId: "",
  eventDate: new Date().toISOString().slice(0, 10),
  referenceNo: "",
  remarks: "",
};

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

const CHANGE_COLUMNS: DataTableColumn<FieldChange>[] = [
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
  { key: "field", header: "Field", cell: (c) => <span className="font-mono text-xs">{c.field_name}</span> },
  { key: "old", header: "Old Value", cell: (c) => c.old_value ?? "—" },
  { key: "new", header: "New Value", cell: (c) => c.new_value ?? "—" },
  { key: "reason", header: "Reason", cell: (c) => c.reason ?? "—" },
  { key: "actor", header: "Changed By", cell: (c) => c.actor_name ?? `#${c.actor_id}` },
  { key: "when", header: "When", cellClassName: "text-right", cell: (c) => new Date(c.created_at).toLocaleString() },
];

export function AssetDetail({ assetId }: { assetId: number }) {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.role);
  const canEdit = role === "ADMIN" || role === "OPERATOR";
  const [activeAction, setActiveAction] = useState<ActionDef | null>(null);
  const [form, setForm] = useState<ActionFormState>(emptyActionForm);
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
  const { data: asset_users = [] } = useQuery({
    queryKey: ["asset_users", asset?.company_id],
    queryFn: () => apiClient.get<AssetUserOption[]>(`/asset-users?company_id=${asset!.company_id}`),
    enabled: asset?.company_id != null && role !== "SELF_SERVICE",
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ["masters", "vendors"],
    queryFn: () => apiClient.get<AssetUserOption[]>("/masters/vendors"),
    enabled: editing,
  });
  const { data: brands = [] } = useQuery({
    queryKey: ["masters", "brands"],
    queryFn: () => apiClient.get<MasterOption[]>("/masters/brands"),
    enabled: editing,
  });
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

  function setField<K extends keyof ActionFormState>(key: K, value: ActionFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openAction(action: ActionDef) {
    setForm(emptyActionForm);
    setActiveAction(action);
  }

  function closeAction() {
    setActiveAction(null);
    setForm(emptyActionForm);
  }

  const actMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/assets/${assetId}/events`, {
        event_type: activeAction!.eventType,
        to_asset_user_id: activeAction!.needsAssetUser && form.assetUserId ? Number(form.assetUserId) : null,
        event_date: form.eventDate ? new Date(form.eventDate).toISOString() : undefined,
        reference_no: form.referenceNo || null,
        remarks: form.remarks || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets", assetId] });
      qc.invalidateQueries({ queryKey: ["assets", assetId, "events"] });
      closeAction();
    },
  });

  const canConfirm = !activeAction?.needsAssetUser || form.assetUserId !== "";

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

  const editMutation = useMutation({
    mutationFn: () => {
      const f = editForm!;
      return apiClient.put<Asset>(`/assets/${assetId}`, {
        legacy_asset_code: f.legacyAssetCode || null,
        brand_id: f.brandId ? Number(f.brandId) : null,
        model: f.model || null,
        serial_number: f.serialNumber || null,
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
        <PageHeader title="Asset" />
        <EmptyState title="Asset not found." description="It may have been removed, or you may not have access to it." />
      </div>
    );
  }

  if (assetQ.isError) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Asset" />
        <ErrorState message="Couldn't load this asset." onRetry={() => assetQ.refetch()} />
      </div>
    );
  }

  if (assetQ.isLoading || !asset) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Asset" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  const actions = actionsFor(asset.status);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={asset.asset_code}
        description={asset.description}
        actions={
          <>
            <StatusBadge status={asset.status} />
            {qrUrl && <img src={qrUrl} alt="Asset QR code" width={64} height={64} />}
            <Button variant="outline" size="sm" onClick={() => window.print()}>Print Label</Button>
            {canEdit && !editing && (
              <>
                <Button variant="outline" size="sm" onClick={openCorrection}>Correct Classification</Button>
                <Button variant="secondary" size="sm" onClick={startEdit}>Edit</Button>
              </>
            )}
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Held by <span className="font-medium text-foreground">{asset.current_asset_user_name ?? "—"}</span>
          {asset.current_asset_user_type && ` (${asset.current_asset_user_type.replace(/_/g, " ").toLowerCase()})`}
          {asset.location_name && <> · {asset.location_name}</>}
        </p>
        {!editing && role !== "SELF_SERVICE" && actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button key={a.eventType + a.label} variant="secondary" size="sm" onClick={() => openAction(a)}>
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </PageHeader>

      {editing && editForm ? (
        <div className="flex flex-col gap-4 rounded-md border p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Edit Asset</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <FormField htmlFor="edit-description" label="Description" required className="sm:col-span-2">
              <Textarea id="edit-description" aria-label="Description" value={editForm.description} onChange={(e) => setEditField("description", e.target.value)} />
            </FormField>
            <FormField htmlFor="edit-brand" label="Brand">
              <Select value={selectValue(editForm.brandId)} onValueChange={(v) => setEditField("brandId", v)}>
                <SelectTrigger id="edit-brand" aria-label="Brand"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {brands.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <FormField htmlFor="edit-model" label="Model"><Input id="edit-model" aria-label="Model" value={editForm.model} onChange={(e) => setEditField("model", e.target.value)} /></FormField>
            <FormField
              htmlFor="edit-serial"
              label="Serial Number"
              helperText="Unique across every asset in CKAM. Use “No serial number” for a category that genuinely has none."
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
              <Select value={selectValue(editForm.vendorId)} onValueChange={(v) => setEditField("vendorId", v)}>
                <SelectTrigger id="edit-vendor" aria-label="Vendor"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
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
            <FormField htmlFor="edit-pi-number" label="PI Number" helperText="CityKart's internal reference for the payment made to the vendor."><Input id="edit-pi-number" aria-label="PI Number" value={editForm.piNumber} onChange={(e) => setEditField("piNumber", e.target.value)} /></FormField>
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
              disabled={editForm.description.trim().length === 0 || editHasMissingRequiredUdf}
              pending={editMutation.isPending}
              pendingLabel="Saving…"
            >
              Save
            </AsyncButton>
            <Button variant="outline" onClick={cancelEdit} disabled={editMutation.isPending}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Tabs defaultValue="overview">
          {/* 7 tabs don't fit an inline-flex TabsList at narrow widths without
              this -- without its own scroll container the list pushed the
              whole page wider instead of scrolling itself (found in AM-04's
              768px browser check). */}
          <div className="overflow-x-auto">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="procurement">Procurement</TabsTrigger>
              <TabsTrigger value="custody">Custody</TabsTrigger>
              <TabsTrigger value="custom-fields">Custom Fields</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="changes">Changes</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="pt-4">
            <dl className="grid gap-4 lg:grid-cols-2">
              <ReadField label="Asset Code" value={<span className="font-mono">{asset.asset_code}</span>} />
              <ReadField label="Legacy Asset Code" value={asset.legacy_asset_code} />
              <ReadField label="Description" value={asset.description} />
              <ReadField label="Category" value={asset.category_name} />
              <ReadField label="Sub-Category" value={asset.subcategory_name} />
              <ReadField label="Brand" value={asset.brand_name} />
              <ReadField label="Model" value={asset.model} />
              <ReadField label="Serial Number" value={asset.serial_number} />
              <ReadField label="Barcode" value={asset.barcode} />
            </dl>
          </TabsContent>

          <TabsContent value="procurement" className="pt-4">
            <dl className="grid gap-4 lg:grid-cols-2">
              <ReadField label="Vendor" value={asset.vendor_name} />
              <ReadField label="PO Number" value={asset.po_number} />
              <ReadField label="PO Date" value={asset.po_date} />
              <ReadField label="Invoice Number" value={asset.invoice_number} />
              <ReadField label="Invoice Date" value={asset.invoice_date} />
              <ReadField label="Invoice Amount" value={asset.invoice_amount != null ? asset.invoice_amount.toFixed(2) : null} />
              <ReadField label="PI Number" value={asset.pi_number} />
              <ReadField label="PI Date" value={asset.pi_date} />
              <ReadField label="Purchase Date" value={asset.purchase_date} />
              <ReadField label="Purchase Cost" value={asset.purchase_cost != null ? asset.purchase_cost.toFixed(2) : null} />
              <ReadField label="Tax %" value={asset.tax_percent != null ? asset.tax_percent.toFixed(2) : null} />
              <ReadField label="Tax Amount" value={asset.tax_amount != null ? asset.tax_amount.toFixed(2) : null} />
              <ReadField label="Total Cost" value={asset.total_cost != null ? asset.total_cost.toFixed(2) : null} />
              <ReadField label="Warranty Years" value={asset.warranty_years != null ? String(asset.warranty_years) : null} />
              <ReadField label="Warranty Upto" value={asset.warranty_upto} />
            </dl>
          </TabsContent>

          <TabsContent value="custody" className="pt-4">
            <dl className="grid gap-4 lg:grid-cols-2">
              <ReadField label="Responsibility" value={asset.asset_domain === "NON_IT" ? "Admin / Non-IT" : asset.asset_domain} />
              <ReadField label="Current Asset User" value={asset.current_asset_user_name} />
              <ReadField label="Asset User Type" value={asset.current_asset_user_type?.replace(/_/g, " ")} />
              <ReadField label="Location" value={asset.location_name} />
              <ReadField label="Department" value={asset.department_name} />
              <ReadField label="Cost Centre" value={asset.cost_center_name} />
              <ReadField label="Status" value={<StatusBadge status={asset.status} />} />
              <ReadField label="Status Since" value={asset.status_since} />
            </dl>
          </TabsContent>

          <TabsContent value="custom-fields" className="pt-4">
            {Object.keys(asset.custom_fields).length === 0 ? (
              <EmptyState title="No custom field values recorded for this asset." />
            ) : (
              <dl className="grid gap-4 lg:grid-cols-2">
                {Object.entries(asset.custom_fields).map(([key, value]) => {
                  const def = activeDefsByKey.get(key);
                  const label = def?.label ?? `${key} (retired field)`;
                  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "—");
                  return <ReadField key={key} label={label} value={display} />;
                })}
              </dl>
            )}
          </TabsContent>

          <TabsContent value="history" className="pt-4">
            <Timeline events={events} />
          </TabsContent>

          <TabsContent value="changes" className="pt-4">
            <DataTable
              columns={CHANGE_COLUMNS}
              rows={changes}
              rowKey={(c) => c.id}
              emptyState={<EmptyState title="No descriptive/procurement edits yet." description="Lifecycle moves and other custody changes are shown under History, not here." />}
            />
          </TabsContent>

          <TabsContent value="documents" className="pt-4">
            <DocumentsTab assetId={assetId} />
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={activeAction !== null} onOpenChange={(open) => !open && closeAction()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{activeAction?.label}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {activeAction?.needsAssetUser && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="asset-user-select">Asset User</Label>
                <SearchableSelect
                  id="asset-user-select"
                  aria-label="Asset User"
                  value={form.assetUserId || undefined}
                  onValueChange={(v) => setField("assetUserId", v)}
                  options={asset_users.map((h) => ({ value: String(h.id), label: h.name, keywords: assetUserKeywords(h) }))}
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-date">Date</Label>
              <Input
                id="event-date"
                aria-label="Date"
                type="date"
                value={form.eventDate}
                onChange={(e) => setField("eventDate", e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reference-no">Reference No</Label>
              <Input
                id="reference-no"
                aria-label="Reference No"
                value={form.referenceNo}
                onChange={(e) => setField("referenceNo", e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="remarks">Remarks</Label>
              <Textarea
                id="remarks"
                aria-label="Remarks"
                value={form.remarks}
                onChange={(e) => setField("remarks", e.target.value)}
              />
            </div>

            {actMutation.isError && (
              <p className="text-sm text-destructive">
                {actMutation.error instanceof Error ? actMutation.error.message : "Failed to record event."}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeAction}>
              Cancel
            </Button>
            <AsyncButton onClick={() => actMutation.mutate()} disabled={!canConfirm} pending={actMutation.isPending} pendingLabel="Saving…">
              Confirm
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                <Select value={correctionCategoryId || undefined} onValueChange={handleCorrectionCategoryChange}>
                  <SelectTrigger id="correction-category" aria-label="Category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField htmlFor="correction-subcategory" label="Sub-Category" helperText="Optional.">
                <Select
                  value={correctionSubcategoryId || undefined}
                  onValueChange={(v) => setCorrectionSubcategoryId(v)}
                >
                  <SelectTrigger id="correction-subcategory" aria-label="Sub-Category">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    {correctionSubcategories.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                      Sub-Category: {subcategoryName(asset.subcategory_id != null ? String(asset.subcategory_id) : "")}
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
