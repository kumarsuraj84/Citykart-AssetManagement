import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { computeWarrantyUpto } from "../../lib/warranty";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionHeading } from "@/components/shared/SectionHeading";
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
  brandId: string;
  model: string;
  serialNumber: string;
  noSerialNumber: boolean;
  warrantyYears: string;
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
  initialHolderId: string;
}

const emptyForm: FormState = {
  categoryId: "",
  subcategoryId: "",
  costCenterId: "",
  description: "",
  legacyAssetCode: "",
  brandId: "",
  model: "",
  serialNumber: "",
  noSerialNumber: false,
  warrantyYears: "0",
  vendorId: "",
  poNumber: "",
  poDate: "",
  invoiceNumber: "",
  invoiceDate: "",
  invoiceAmount: "",
  piNumber: "",
  piDate: "",
  purchaseCost: "0",
  taxPercent: "0",
  initialHolderId: "",
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
  // AM-24: which company this NEW asset belongs to -- defaults to the
  // caller's own home company (companyId), but a caller granted access to
  // more than one company (ADMIN, or IT_TEAM with company-access grants)
  // can pick a different one. Selecting a different company resets every
  // company-scoped choice below it (Cost Centre, Initial Holder), the same
  // way changing Category already resets Sub-Category.
  const [selectedCompanyId, setSelectedCompanyId] = useState(companyId);
  const myCompaniesQ = useQuery({ queryKey: ["holders", "me", "companies"], queryFn: () => apiClient.get<Option[]>("/holders/me/companies") });
  const myCompanies = myCompaniesQ.data ?? [];

  // AM-08: Category and Vendor are genuinely global masters (no company_id
  // column at all -- confirmed against the actual schema, not assumed from
  // the AM-07 UAT observation that first flagged this), so they correctly
  // list every row for every company; only Cost Centre is company-owned and
  // is now filtered to this asset's own company via the same opt-in
  // `company_id` query param the Initial Holder lookup below already uses.
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Option[]>("/masters/categories") });
  const subcategoriesQ = useQuery({
    queryKey: ["masters", "subcategories"],
    queryFn: () => apiClient.get<(Option & { category_id: number })[]>("/masters/subcategories"),
  });
  const costCentersQ = useQuery({
    queryKey: ["masters", "cost-centers", selectedCompanyId],
    queryFn: () => apiClient.get<Option[]>(`/masters/cost-centers?company_id=${selectedCompanyId}`),
  });
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Option[]>("/masters/vendors") });
  const brandsQ = useQuery({ queryKey: ["masters", "brands"], queryFn: () => apiClient.get<Option[]>("/masters/brands") });
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
    queryKey: ["holders", "IT_STOCK", selectedCompanyId],
    queryFn: () => apiClient.get<Option[]>(`/holders?holder_type=IT_STOCK&company_id=${selectedCompanyId}`),
  });

  const categories = categoriesQ.data ?? [];
  const subcategories = subcategoriesQ.data ?? [];
  const costCenters = costCentersQ.data ?? [];
  const vendors = vendorsQ.data ?? [];
  const brands = brandsQ.data ?? [];
  const stockHolders = stockHoldersQ.data ?? [];
  // AM-05: only fields applicable to THIS asset's company -- Global
  // (company_id null) plus this company's own -- ever render, are
  // validated, or count toward requiredness here. A field scoped to a
  // different company must behave as if it doesn't exist for this form,
  // matching the backend's applicable_custom_fields (app/assets/custom_field_values.py).
  const customFields = useMemo(
    () =>
      (customFieldsQ.data ?? [])
        .filter((f) => f.company_id === null || f.company_id === selectedCompanyId)
        .sort((a, b) => a.sort_order - b.sort_order),
    [customFieldsQ.data, selectedCompanyId],
  );
  const visibleSubcategories = form.categoryId
    ? subcategories.filter((s) => s.category_id === Number(form.categoryId))
    : subcategories;

  const mastersQueries = [categoriesQ, subcategoriesQ, costCentersQ, vendorsQ, brandsQ, customFieldsQ, stockHoldersQ];
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
  // Purchase Date is always Invoice Date (never user-entered) -- Warranty
  // Upto's own preview anchors on the same field for the same reason.
  const warrantyUptoPreview = useMemo(
    () => computeWarrantyUpto(form.invoiceDate, Number(form.warrantyYears) || 0),
    [form.invoiceDate, form.warrantyYears],
  );

  function requiredCustomFieldMissing(field: CustomFieldDef): boolean {
    if (!field.is_required) return false;
    const v = customValues[field.field_key];
    if (field.field_type === "checkbox") return false; // a checkbox always has a value (true/false)
    return v === undefined || v === "";
  }

  const hasHolderOption = stockHolders.length > 0;
  const hasCostCenterOption = costCenters.length > 0;
  // AM-19: PO/Invoice/PI No+Date are no longer required here -- ground
  // reality is that paperwork routinely arrives after the physical asset
  // is already logged (see AssetCreateIn's own docstring). They can be
  // filled in later via Edit once available.
  const canSave =
    form.description.trim().length > 0 &&
    form.categoryId !== "" &&
    form.subcategoryId !== "" &&
    form.costCenterId !== "" &&
    form.vendorId !== "" &&
    (form.noSerialNumber || form.serialNumber.trim() !== "") &&
    form.initialHolderId !== "" &&
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
        company_id: selectedCompanyId,
        cost_center_id: Number(form.costCenterId),
        category_id: Number(form.categoryId),
        subcategory_id: Number(form.subcategoryId),
        description: form.description,
        legacy_asset_code: form.legacyAssetCode || null,
        brand_id: form.brandId ? Number(form.brandId) : null,
        model: form.model || null,
        serial_number: form.noSerialNumber ? "N/A" : form.serialNumber.trim(),
        warranty_years: Number(form.warrantyYears) || 0,
        vendor_id: Number(form.vendorId),
        po_number: form.poNumber || null,
        po_date: form.poDate || null,
        invoice_number: form.invoiceNumber || null,
        invoice_date: form.invoiceDate || null,
        invoice_amount: form.invoiceAmount === "" ? null : Number(form.invoiceAmount),
        pi_number: form.piNumber || null,
        pi_date: form.piDate || null,
        purchase_cost: purchaseCost,
        tax_percent: taxPercent,
        // Purchase Date is never user-entered -- it's Invoice Date when
        // given (docs/ai/DECISIONS.md), or today when Invoice Date isn't
        // known yet; the backend derives it either way, so this key is
        // simply omitted from the payload.
        initial_holder_id: Number(form.initialHolderId),
        custom_fields: buildCustomFieldsPayload(),
      }),
    onSuccess: (created) => {
      // Asset Code is always server-generated, never guessed client-side.
      // AM-19: every save now creates exactly one asset (Quantity was
      // removed -- Import is the tool for a genuine multi-unit bulk add),
      // so this always takes the single-asset branch straight to Asset 360
      // (AM-04 §12); the length!==1 branch is dead but left in place as a
      // harmless defensive fallback rather than ripped out.
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
    <div className="flex flex-col gap-5 max-w-4xl">
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
        <SectionHeading>Organization</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* AM-24: only shown when the caller actually has more than one
              company to choose from -- otherwise this stays exactly as
              before (silently the caller's own home company). */}
          {myCompanies.length > 1 && (
            <FormField htmlFor="company" label="Company" required>
              <Select
                value={String(selectedCompanyId)}
                onValueChange={(v) => {
                  setSelectedCompanyId(Number(v));
                  setField("costCenterId", "");
                  setField("initialHolderId", "");
                }}
              >
                <SelectTrigger id="company" aria-label="Company">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {myCompanies.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
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
            {!mastersLoading && !hasCostCenterOption && (
              <p className="text-sm text-destructive">
                No active cost centres are configured for this company. Add one under Setup &gt; Cost Centers first.
              </p>
            )}
          </FormField>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>Asset Classification</SectionHeading>
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

          <FormField htmlFor="subcategory" label="Sub-Category" required>
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

      <section className="flex flex-col gap-4">
        <SectionHeading>Purchase / Procurement</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Full-width and alone -- Vendor has no PO/Invoice/PI-style date partner of its
              own, so giving it its own row keeps the three Number/Date pairs below aligned
              as actual pairs instead of drifting by one slot (AM-13 density pass). */}
          <FormField htmlFor="vendor" label="Vendor" required className="sm:col-span-2">
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

          <FormField htmlFor="po-number" label="PO Number" helperText="Optional -- add it once you have it.">
            <Input id="po-number" aria-label="PO Number" value={form.poNumber} onChange={(e) => setField("poNumber", e.target.value)} />
          </FormField>
          <FormField htmlFor="po-date" label="PO Date" helperText="Optional.">
            <Input id="po-date" aria-label="PO Date" type="date" value={form.poDate} onChange={(e) => setField("poDate", e.target.value)} />
          </FormField>

          <FormField htmlFor="invoice-number" label="Invoice Number" helperText="Optional -- add it once you have it.">
            <Input id="invoice-number" aria-label="Invoice Number" value={form.invoiceNumber} onChange={(e) => setField("invoiceNumber", e.target.value)} />
          </FormField>
          <FormField
            htmlFor="invoice-date"
            label="Invoice Date"
            helperText="Optional. When given, Purchase Date is set to this date; when left blank, Purchase Date defaults to today instead."
          >
            <Input id="invoice-date" aria-label="Invoice Date" type="date" value={form.invoiceDate} onChange={(e) => setField("invoiceDate", e.target.value)} />
          </FormField>
          <FormField htmlFor="invoice-amount" label="Invoice Amount" helperText="Optional.">
            <Input id="invoice-amount" aria-label="Invoice Amount" type="number" min={0} step="0.01" value={form.invoiceAmount} onChange={(e) => setField("invoiceAmount", e.target.value)} />
          </FormField>

          <FormField htmlFor="pi-number" label="PI Number" helperText="CityKart's internal reference for the payment made to the vendor. Usually arrives from Finance after delivery -- leave blank and add it later.">
            <Input id="pi-number" aria-label="PI Number" value={form.piNumber} onChange={(e) => setField("piNumber", e.target.value)} />
          </FormField>
          <FormField htmlFor="pi-date" label="PI Date" helperText="Optional.">
            <Input id="pi-date" aria-label="PI Date" type="date" value={form.piDate} onChange={(e) => setField("piDate", e.target.value)} />
          </FormField>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>Asset Details</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField htmlFor="brand" label="Brand" helperText="Optional.">
            <Select value={selectValue(form.brandId)} onValueChange={(v) => setField("brandId", v)} disabled={mastersLoading}>
              <SelectTrigger id="brand" aria-label="Brand">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField htmlFor="model" label="Model" helperText="Optional.">
            <Input id="model" aria-label="Model" value={form.model} onChange={(e) => setField("model", e.target.value)} />
          </FormField>
          <FormField
            htmlFor="serial-number"
            label="Serial Number"
            required
            helperText="Unique across every asset in CKAM. If this category genuinely has no serial (a mouse, a cable, an IT rack…), check “No serial number” instead of guessing one."
          >
            <div className="flex flex-col gap-2">
              <Input
                id="serial-number"
                aria-label="Serial Number"
                value={form.serialNumber}
                disabled={form.noSerialNumber}
                onChange={(e) => setField("serialNumber", e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label="No serial number"
                  checked={form.noSerialNumber}
                  onCheckedChange={(checked) => {
                    const noSerial = checked === true;
                    setField("noSerialNumber", noSerial);
                    if (noSerial) setField("serialNumber", "");
                  }}
                />
                No serial number for this asset
              </label>
            </div>
          </FormField>
          <FormField
            htmlFor="warranty-years"
            label="Warranty Years"
            helperText={
              warrantyUptoPreview
                ? `Warranty Upto (preview): ${warrantyUptoPreview}`
                : "Enter 0 if this asset has no warranty."
            }
          >
            <Input
              id="warranty-years" aria-label="Warranty Years" type="number" min={0} step={1}
              value={form.warrantyYears}
              onChange={(e) => setField("warrantyYears", e.target.value)}
            />
          </FormField>
          <FormField htmlFor="legacy-asset-code" label="Legacy Asset Code" helperText="From the previous system, if applicable.">
            <Input id="legacy-asset-code" aria-label="Legacy Asset Code" value={form.legacyAssetCode} onChange={(e) => setField("legacyAssetCode", e.target.value)} />
          </FormField>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>Commercial</SectionHeading>
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

      <section className="flex flex-col gap-4">
        <SectionHeading>Initial Custody</SectionHeading>
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
        </div>
      </section>

      {customFields.length > 0 && (
        <>
          <section className="flex flex-col gap-4">
            <SectionHeading>Custom Fields</SectionHeading>
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
