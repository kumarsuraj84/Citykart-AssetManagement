import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../lib/api-client";
import { authFetch } from "../../lib/auth-fetch";
import { useAuthStore } from "../../lib/auth-store";
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
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  description: string;
  vendor_id: number | null;
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
  current_holder_id: number;
  status_since: string;
  custom_fields: Record<string, unknown>;
  category_name: string | null;
  subcategory_name: string | null;
  cost_center_name: string | null;
  vendor_name: string | null;
  current_holder_name: string | null;
  current_holder_type: string | null;
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
}

interface HolderOption {
  id: number;
  name: string;
}

interface ActionFormState {
  holderId: string;
  eventDate: string;
  referenceNo: string;
  remarks: string;
}

const emptyActionForm: ActionFormState = {
  holderId: "",
  eventDate: new Date().toISOString().slice(0, 10),
  referenceNo: "",
  remarks: "",
};

interface EditFormState {
  legacyAssetCode: string;
  brand: string;
  model: string;
  serialNumber: string;
  description: string;
  vendorId: string;
  poNumber: string;
  poDate: string;
  invoiceNumber: string;
  invoiceDate: string;
  piNumber: string;
  piDate: string;
  purchaseCost: string;
  taxPercent: string;
  warrantyUpto: string;
}

function editFormFromAsset(asset: Asset): EditFormState {
  return {
    legacyAssetCode: asset.legacy_asset_code ?? "",
    brand: asset.brand ?? "",
    model: asset.model ?? "",
    serialNumber: asset.serial_number ?? "",
    description: asset.description,
    vendorId: asset.vendor_id ? String(asset.vendor_id) : "",
    poNumber: asset.po_number ?? "",
    poDate: asset.po_date ?? "",
    invoiceNumber: asset.invoice_number ?? "",
    invoiceDate: asset.invoice_date ?? "",
    piNumber: asset.pi_number ?? "",
    piDate: asset.pi_date ?? "",
    purchaseCost: asset.purchase_cost != null ? String(asset.purchase_cost) : "0",
    taxPercent: asset.tax_percent != null ? String(asset.tax_percent) : "0",
    warrantyUpto: asset.warranty_upto ?? "",
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
  { key: "field", header: "Field", cell: (c) => <span className="font-mono text-xs">{c.field_name}</span> },
  { key: "old", header: "Old Value", cell: (c) => c.old_value ?? "—" },
  { key: "new", header: "New Value", cell: (c) => c.new_value ?? "—" },
  { key: "actor", header: "Changed By", cell: (c) => c.actor_name ?? `#${c.actor_id}` },
  { key: "when", header: "When", cellClassName: "text-right", cell: (c) => new Date(c.created_at).toLocaleString() },
];

export function AssetDetail({ assetId }: { assetId: number }) {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.role);
  const canEdit = role === "ADMIN" || role === "IT_TEAM";
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
  const { data: holders = [] } = useQuery({
    queryKey: ["holders", asset?.company_id],
    queryFn: () => apiClient.get<HolderOption[]>(`/holders?company_id=${asset!.company_id}`),
    enabled: asset?.company_id != null && role !== "HOLDER",
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ["masters", "vendors"],
    queryFn: () => apiClient.get<HolderOption[]>("/masters/vendors"),
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
        to_holder_id: activeAction!.needsHolder && form.holderId ? Number(form.holderId) : null,
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

  const canConfirm = !activeAction?.needsHolder || form.holderId !== "";

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
        brand: f.brand || null,
        model: f.model || null,
        serial_number: f.serialNumber || null,
        description: f.description,
        vendor_id: f.vendorId ? Number(f.vendorId) : null,
        po_number: f.poNumber || null,
        po_date: f.poDate || null,
        invoice_number: f.invoiceNumber || null,
        invoice_date: f.invoiceDate || null,
        pi_number: f.piNumber || null,
        pi_date: f.piDate || null,
        purchase_cost: Number(f.purchaseCost) || 0,
        tax_percent: Number(f.taxPercent) || 0,
        warranty_upto: f.warrantyUpto || null,
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
              <Button variant="secondary" size="sm" onClick={startEdit}>Edit</Button>
            )}
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Held by <span className="font-medium text-foreground">{asset.current_holder_name ?? "—"}</span>
          {asset.current_holder_type && ` (${asset.current_holder_type.replace(/_/g, " ").toLowerCase()})`}
          {asset.location_name && <> · {asset.location_name}</>}
        </p>
        {!editing && role !== "HOLDER" && actions.length > 0 && (
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
            <FormField htmlFor="edit-brand" label="Brand"><Input id="edit-brand" aria-label="Brand" value={editForm.brand} onChange={(e) => setEditField("brand", e.target.value)} /></FormField>
            <FormField htmlFor="edit-model" label="Model"><Input id="edit-model" aria-label="Model" value={editForm.model} onChange={(e) => setEditField("model", e.target.value)} /></FormField>
            <FormField htmlFor="edit-serial" label="Serial Number"><Input id="edit-serial" aria-label="Serial Number" value={editForm.serialNumber} onChange={(e) => setEditField("serialNumber", e.target.value)} /></FormField>
            <FormField htmlFor="edit-legacy" label="Legacy Asset Code"><Input id="edit-legacy" aria-label="Legacy Asset Code" value={editForm.legacyAssetCode} onChange={(e) => setEditField("legacyAssetCode", e.target.value)} /></FormField>
            <FormField htmlFor="edit-vendor" label="Vendor">
              <Select value={selectValue(editForm.vendorId)} onValueChange={(v) => setEditField("vendorId", v)}>
                <SelectTrigger id="edit-vendor" aria-label="Vendor"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <FormField htmlFor="edit-warranty" label="Warranty Upto"><Input id="edit-warranty" aria-label="Warranty Upto" type="date" value={editForm.warrantyUpto} onChange={(e) => setEditField("warrantyUpto", e.target.value)} /></FormField>
            <FormField htmlFor="edit-po-number" label="PO Number"><Input id="edit-po-number" aria-label="PO Number" value={editForm.poNumber} onChange={(e) => setEditField("poNumber", e.target.value)} /></FormField>
            <FormField htmlFor="edit-po-date" label="PO Date"><Input id="edit-po-date" aria-label="PO Date" type="date" value={editForm.poDate} onChange={(e) => setEditField("poDate", e.target.value)} /></FormField>
            <FormField htmlFor="edit-invoice-number" label="Invoice Number"><Input id="edit-invoice-number" aria-label="Invoice Number" value={editForm.invoiceNumber} onChange={(e) => setEditField("invoiceNumber", e.target.value)} /></FormField>
            <FormField htmlFor="edit-invoice-date" label="Invoice Date"><Input id="edit-invoice-date" aria-label="Invoice Date" type="date" value={editForm.invoiceDate} onChange={(e) => setEditField("invoiceDate", e.target.value)} /></FormField>
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
              <ReadField label="Brand" value={asset.brand} />
              <ReadField label="Model" value={asset.model} />
              <ReadField label="Serial Number" value={asset.serial_number} />
            </dl>
          </TabsContent>

          <TabsContent value="procurement" className="pt-4">
            <dl className="grid gap-4 lg:grid-cols-2">
              <ReadField label="Vendor" value={asset.vendor_name} />
              <ReadField label="PO Number" value={asset.po_number} />
              <ReadField label="PO Date" value={asset.po_date} />
              <ReadField label="Invoice Number" value={asset.invoice_number} />
              <ReadField label="Invoice Date" value={asset.invoice_date} />
              <ReadField label="PI Number" value={asset.pi_number} />
              <ReadField label="PI Date" value={asset.pi_date} />
              <ReadField label="Purchase Date" value={asset.purchase_date} />
              <ReadField label="Purchase Cost" value={asset.purchase_cost != null ? asset.purchase_cost.toFixed(2) : null} />
              <ReadField label="Tax %" value={asset.tax_percent != null ? asset.tax_percent.toFixed(2) : null} />
              <ReadField label="Tax Amount" value={asset.tax_amount != null ? asset.tax_amount.toFixed(2) : null} />
              <ReadField label="Total Cost" value={asset.total_cost != null ? asset.total_cost.toFixed(2) : null} />
              <ReadField label="Warranty Upto" value={asset.warranty_upto} />
            </dl>
          </TabsContent>

          <TabsContent value="custody" className="pt-4">
            <dl className="grid gap-4 lg:grid-cols-2">
              <ReadField label="Current Holder" value={asset.current_holder_name} />
              <ReadField label="Holder Type" value={asset.current_holder_type?.replace(/_/g, " ")} />
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
            {activeAction?.needsHolder && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="holder-select">Holder</Label>
                <Select value={form.holderId || undefined} onValueChange={(v) => setField("holderId", v)}>
                  <SelectTrigger id="holder-select" aria-label="Holder">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {holders.map((h) => (
                      <SelectItem key={h.id} value={String(h.id)}>
                        {h.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
    </div>
  );
}
