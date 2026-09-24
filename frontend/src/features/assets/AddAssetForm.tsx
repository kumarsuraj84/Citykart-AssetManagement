import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormField } from "@/components/shared/FormField";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { ErrorState } from "@/components/shared/ErrorState";

interface Option {
  id: number;
  code?: string;
  name: string;
}

interface CustomFieldDef {
  id: number;
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

interface CreatedAsset {
  id: number;
  asset_code: string;
}

interface FormState {
  categoryId: string;
  subcategoryId: string;
  costCenterId: string;
  description: string;
  legacyAssetCode: string;
  brand: string;
  model: string;
  serialNumber: string;
  warrantyUpto: string;
  vendorId: string;
  poNumber: string;
  poDate: string;
  invoiceNumber: string;
  invoiceDate: string;
  piNumber: string;
  piDate: string;
  purchaseDate: string;
  purchaseCost: string;
  taxPercent: string;
  initialHolderId: string;
  quantity: string;
}

const emptyForm: FormState = {
  categoryId: "",
  subcategoryId: "",
  costCenterId: "",
  description: "",
  legacyAssetCode: "",
  brand: "",
  model: "",
  serialNumber: "",
  warrantyUpto: "",
  vendorId: "",
  poNumber: "",
  poDate: "",
  invoiceNumber: "",
  invoiceDate: "",
  piNumber: "",
  piDate: "",
  purchaseDate: new Date().toISOString().slice(0, 10),
  purchaseCost: "0",
  taxPercent: "0",
  initialHolderId: "",
  quantity: "1",
};

// Empty-string sentinel for a Radix Select with no selection yet -- it can't take
// value="" itself (SelectItem forbids an empty-string value), so undefined is used
// for "nothing picked" and the field's own FormState key stays "" until then.
function selectValue(v: string): string | undefined {
  return v || undefined;
}

type CustomFieldValue = string | number | boolean;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function AddAssetForm({ companyId }: { companyId: number }) {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [customValues, setCustomValues] = useState<Record<string, CustomFieldValue>>({});
  const [createdAssets, setCreatedAssets] = useState<CreatedAsset[]>([]);

  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Option[]>("/masters/categories") });
  const subcategoriesQ = useQuery({
    queryKey: ["masters", "subcategories"],
    queryFn: () => apiClient.get<(Option & { category_id: number })[]>("/masters/subcategories"),
  });
  const costCentersQ = useQuery({ queryKey: ["masters", "cost-centers"], queryFn: () => apiClient.get<Option[]>("/masters/cost-centers") });
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Option[]>("/masters/vendors") });
  const customFieldsQ = useQuery({
    queryKey: ["masters", "custom-fields"],
    queryFn: () => apiClient.get<CustomFieldDef[]>("/masters/custom-fields"),
  });
  // Scoped to this company's IT_STOCK holders only -- a company can have more than
  // one (one per location), so the backend deliberately has no server-side default
  // and requires an explicit initial_holder_id. The admin must explicitly choose
  // one; canSave below blocks submission until they do (never auto-picked, since
  // HolderService.list has no stable ordering and guessing risks silently misfiling
  // a purchase into the wrong location's stock).
  const stockHoldersQ = useQuery({
    queryKey: ["holders", "IT_STOCK", companyId],
    queryFn: () => apiClient.get<Option[]>(`/holders?holder_type=IT_STOCK&company_id=${companyId}`),
  });

  const categories = categoriesQ.data ?? [];
  const subcategories = subcategoriesQ.data ?? [];
  const costCenters = costCentersQ.data ?? [];
  const vendors = vendorsQ.data ?? [];
  const stockHolders = stockHoldersQ.data ?? [];
  // AM-05: only fields applicable to THIS asset's company -- Global
  // (company_id null) plus this company's own -- ever render, are
  // validated, or count toward requiredness here. A field scoped to a
  // different company must behave as if it doesn't exist for this form,
  // matching the backend's applicable_custom_fields (app/assets/custom_field_values.py).
  const customFields = useMemo(
    () =>
      (customFieldsQ.data ?? [])
        .filter((f) => f.company_id === null || f.company_id === companyId)
        .sort((a, b) => a.sort_order - b.sort_order),
    [customFieldsQ.data, companyId],
  );
  const visibleSubcategories = form.categoryId
    ? subcategories.filter((s) => s.category_id === Number(form.categoryId))
    : subcategories;

  const mastersQueries = [categoriesQ, subcategoriesQ, costCentersQ, vendorsQ, customFieldsQ, stockHoldersQ];
  const mastersError = mastersQueries.some((q) => q.isError);
  const mastersLoading = mastersQueries.some((q) => q.isLoading);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setCustomValue(key: string, value: CustomFieldValue) {
    setCustomValues((v) => ({ ...v, [key]: value }));
  }

  const purchaseCost = Number(form.purchaseCost) || 0;
  const taxPercent = Number(form.taxPercent) || 0;
  const taxAmount = useMemo(() => round2((purchaseCost * taxPercent) / 100), [purchaseCost, taxPercent]);
  const totalCost = round2(purchaseCost + taxAmount);

  function requiredCustomFieldMissing(field: CustomFieldDef): boolean {
    if (!field.is_required) return false;
    const v = customValues[field.field_key];
    if (field.field_type === "checkbox") return false; // a checkbox always has a value (true/false)
    return v === undefined || v === "";
  }

  const hasHolderOption = stockHolders.length > 0;
  const canSave =
    form.description.trim().length > 0 &&
    form.categoryId !== "" &&
    form.costCenterId !== "" &&
    form.initialHolderId !== "" &&
    form.purchaseDate !== "" &&
    !customFields.some(requiredCustomFieldMissing);

  function buildCustomFieldsPayload(): Record<string, CustomFieldValue> {
    const payload: Record<string, CustomFieldValue> = {};
    for (const field of customFields) {
      const raw = customValues[field.field_key];
      if (field.field_type === "checkbox") {
        payload[field.field_key] = raw === true;
        continue;
      }
      if (raw === undefined || raw === "") continue;
      payload[field.field_key] = field.field_type === "number" ? Number(raw) : raw;
    }
    return payload;
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.post<CreatedAsset[]>("/assets", {
        company_id: companyId,
        cost_center_id: Number(form.costCenterId),
        category_id: Number(form.categoryId),
        subcategory_id: form.subcategoryId ? Number(form.subcategoryId) : null,
        description: form.description,
        legacy_asset_code: form.legacyAssetCode || null,
        brand: form.brand || null,
        model: form.model || null,
        serial_number: form.serialNumber || null,
        warranty_upto: form.warrantyUpto || null,
        vendor_id: form.vendorId ? Number(form.vendorId) : null,
        po_number: form.poNumber || null,
        po_date: form.poDate || null,
        invoice_number: form.invoiceNumber || null,
        invoice_date: form.invoiceDate || null,
        pi_number: form.piNumber || null,
        pi_date: form.piDate || null,
        purchase_cost: purchaseCost,
        tax_percent: taxPercent,
        purchase_date: form.purchaseDate,
        initial_holder_id: Number(form.initialHolderId),
        quantity: Number(form.quantity) || 1,
        custom_fields: buildCustomFieldsPayload(),
      }),
    onSuccess: (created) => {
      // Asset Code is always server-generated, never guessed client-side. A
      // single-asset save goes straight to its Asset 360 (AM-04 §12); the
      // "buying 20 mice" bulk case creates several assets at once, so there is
      // no single destination to jump to -- list every generated code instead,
      // each linking to its own Asset 360 (existing product behavior this
      // stage's authorization explicitly allows keeping).
      if (created.length === 1) {
        navigate({ to: "/assets/$id", params: { id: String(created[0].id) } });
        return;
      }
      setCreatedAssets(created);
      setForm(emptyForm);
      setCustomValues({});
    },
  });

  function handleSave() {
    if (!canSave) return;
    setCreatedAssets([]);
    saveMutation.mutate();
  }

  if (mastersError) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Add Asset" />
        <ErrorState
          message="Couldn't load the master data this form needs."
          onRetry={() => mastersQueries.forEach((q) => q.refetch())}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <PageHeader title="Add Asset" description="Record a new asset and where it goes into stock." />

      {createdAssets.length > 0 && (
        <div className="rounded-md border bg-success-soft/60 p-3 text-sm">
          <p className="font-medium text-on-success-soft">
            {createdAssets.length} asset{createdAssets.length === 1 ? "" : "s"} created.
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono">
            {createdAssets.map((a) => (
              <li key={a.id}>
                <Link to="/assets/$id" params={{ id: String(a.id) }} className="underline">
                  {a.asset_code}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Organization</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="cost-center" label="Cost Centre" required>
            <Select value={selectValue(form.costCenterId)} onValueChange={(v) => setField("costCenterId", v)} disabled={mastersLoading}>
              <SelectTrigger id="cost-center" aria-label="Cost Centre">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {costCenters.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Asset Classification</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="category" label="Category" required>
            <Select
              value={selectValue(form.categoryId)}
              onValueChange={(v) => {
                setField("categoryId", v);
                setField("subcategoryId", "");
              }}
              disabled={mastersLoading}
            >
              <SelectTrigger id="category" aria-label="Category">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField htmlFor="subcategory" label="Sub-Category" helperText="Optional.">
            <Select value={selectValue(form.subcategoryId)} onValueChange={(v) => setField("subcategoryId", v)} disabled={mastersLoading}>
              <SelectTrigger id="subcategory" aria-label="Sub-Category">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {visibleSubcategories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField htmlFor="description" label="Description" required className="sm:col-span-2">
            <Input id="description" aria-label="Description" value={form.description} onChange={(e) => setField("description", e.target.value)} />
          </FormField>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Purchase / Procurement</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="vendor" label="Vendor" helperText="Optional.">
            <Select value={selectValue(form.vendorId)} onValueChange={(v) => setField("vendorId", v)} disabled={mastersLoading}>
              <SelectTrigger id="vendor" aria-label="Vendor">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField htmlFor="purchase-date" label="Purchase Date" required>
            <Input id="purchase-date" aria-label="Purchase Date" type="date" value={form.purchaseDate} onChange={(e) => setField("purchaseDate", e.target.value)} />
          </FormField>

          <FormField htmlFor="po-number" label="PO Number" helperText="Optional.">
            <Input id="po-number" aria-label="PO Number" value={form.poNumber} onChange={(e) => setField("poNumber", e.target.value)} />
          </FormField>
          <FormField htmlFor="po-date" label="PO Date" helperText="Optional.">
            <Input id="po-date" aria-label="PO Date" type="date" value={form.poDate} onChange={(e) => setField("poDate", e.target.value)} />
          </FormField>

          <FormField htmlFor="invoice-number" label="Invoice Number" helperText="Optional.">
            <Input id="invoice-number" aria-label="Invoice Number" value={form.invoiceNumber} onChange={(e) => setField("invoiceNumber", e.target.value)} />
          </FormField>
          <FormField htmlFor="invoice-date" label="Invoice Date" helperText="Optional.">
            <Input id="invoice-date" aria-label="Invoice Date" type="date" value={form.invoiceDate} onChange={(e) => setField("invoiceDate", e.target.value)} />
          </FormField>

          <FormField htmlFor="pi-number" label="PI Number" helperText="CityKart's internal reference for the payment made to the vendor.">
            <Input id="pi-number" aria-label="PI Number" value={form.piNumber} onChange={(e) => setField("piNumber", e.target.value)} />
          </FormField>
          <FormField htmlFor="pi-date" label="PI Date" helperText="Optional.">
            <Input id="pi-date" aria-label="PI Date" type="date" value={form.piDate} onChange={(e) => setField("piDate", e.target.value)} />
          </FormField>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Asset Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="brand" label="Brand" helperText="Optional.">
            <Input id="brand" aria-label="Brand" value={form.brand} onChange={(e) => setField("brand", e.target.value)} />
          </FormField>
          <FormField htmlFor="model" label="Model" helperText="Optional.">
            <Input id="model" aria-label="Model" value={form.model} onChange={(e) => setField("model", e.target.value)} />
          </FormField>
          <FormField htmlFor="serial-number" label="Serial Number" helperText="Optional.">
            <Input id="serial-number" aria-label="Serial Number" value={form.serialNumber} onChange={(e) => setField("serialNumber", e.target.value)} />
          </FormField>
          <FormField htmlFor="warranty-upto" label="Warranty Upto" helperText="Optional.">
            <Input id="warranty-upto" aria-label="Warranty Upto" type="date" value={form.warrantyUpto} onChange={(e) => setField("warrantyUpto", e.target.value)} />
          </FormField>
          <FormField htmlFor="legacy-asset-code" label="Legacy Asset Code" helperText="From the previous system, if applicable.">
            <Input id="legacy-asset-code" aria-label="Legacy Asset Code" value={form.legacyAssetCode} onChange={(e) => setField("legacyAssetCode", e.target.value)} />
          </FormField>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Commercial</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="purchase-cost" label="Purchase Cost" helperText="Optional.">
            <Input id="purchase-cost" aria-label="Purchase Cost" type="number" value={form.purchaseCost} onChange={(e) => setField("purchaseCost", e.target.value)} />
          </FormField>
          <FormField htmlFor="tax-percent" label="Tax %" helperText="Optional.">
            <Input id="tax-percent" aria-label="Tax %" type="number" value={form.taxPercent} onChange={(e) => setField("taxPercent", e.target.value)} />
          </FormField>
        </div>
        {/* Preview only, computed with the same arithmetic/rounding the backend uses --
            the authoritative values always come back from the create/Asset 360 response. */}
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Tax Amount (preview): <span data-testid="tax-amount">{taxAmount.toFixed(2)}</span></span>
          <span>Total Cost (preview): <span data-testid="total-cost">{totalCost.toFixed(2)}</span></span>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Initial Custody</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="initial-holder" label="Goes Into" required>
            <Select value={selectValue(form.initialHolderId)} onValueChange={(v) => setField("initialHolderId", v)} disabled={mastersLoading}>
              <SelectTrigger id="initial-holder" aria-label="Goes Into">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {stockHolders.map((h) => (
                  <SelectItem key={h.id} value={String(h.id)}>{h.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!mastersLoading && !hasHolderOption && (
              <p className="text-sm text-destructive">No IT Stock holder found for this company. Add one under Setup &gt; Users first.</p>
            )}
          </FormField>

          <FormField htmlFor="quantity" label="Quantity" helperText="For procuring several identical units at once.">
            <Input id="quantity" aria-label="Quantity" type="number" min={1} max={100} value={form.quantity} onChange={(e) => setField("quantity", e.target.value)} />
          </FormField>
        </div>
      </section>

      {customFields.length > 0 && (
        <>
          <Separator />
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Custom Fields</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {customFields.map((field) => {
                const htmlId = `udf-${field.field_key}`;
                const missing = requiredCustomFieldMissing(field);
                if (field.field_type === "checkbox") {
                  return (
                    <div key={field.field_key} className="flex items-center gap-2 pt-6">
                      <Checkbox
                        id={htmlId}
                        aria-label={field.label}
                        checked={customValues[field.field_key] === true}
                        onCheckedChange={(checked) => setCustomValue(field.field_key, checked === true)}
                      />
                      <label htmlFor={htmlId} className="text-sm font-medium">{field.label}</label>
                    </div>
                  );
                }
                return (
                  <FormField
                    key={field.field_key}
                    htmlFor={htmlId}
                    label={field.label}
                    required={field.is_required}
                    errorText={missing ? `${field.label} is required.` : undefined}
                  >
                    {field.field_type === "dropdown" ? (
                      <Select
                        value={selectValue(String(customValues[field.field_key] ?? ""))}
                        onValueChange={(v) => setCustomValue(field.field_key, v)}
                      >
                        <SelectTrigger id={htmlId} aria-label={field.label}>
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          {(field.options?.choices ?? []).map((choice) => (
                            <SelectItem key={choice} value={choice}>{choice}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={htmlId}
                        aria-label={field.label}
                        type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"}
                        value={String(customValues[field.field_key] ?? "")}
                        onChange={(e) => setCustomValue(field.field_key, e.target.value)}
                      />
                    )}
                  </FormField>
                );
              })}
            </div>
          </section>
        </>
      )}

      {saveMutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {saveMutation.error instanceof Error ? saveMutation.error.message : "Failed to save asset."}
        </p>
      )}

      <div>
        <AsyncButton onClick={handleSave} disabled={!canSave} pending={saveMutation.isPending} pendingLabel="Saving…">
          Save
        </AsyncButton>
      </div>
    </div>
  );
}
