import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Bundle } from "../bundles/BundlesScreen";
import { splitAmounts } from "./AddBundleDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

export interface DraftLine {
  item_code: string | null;
  description: string;
  barcode: string;
  quantity: number;
  rate: number;
  amount: number;
  tax_percent: number;
  hsn: string | null;
  group_code: string | null;
  warranty_years: number;
  category_id: number | null;
  subcategory_id: number | null;
  brand_id: number | null;
  model: string | null;
  bundle_id: number | null;
  remembered: boolean;
  category_from_group: boolean;
  warnings: string[];
}

export interface Draft {
  erp_po_code: number;
  po_number: string | null;
  po_date: string | null;
  company_id: number | null;
  company_code: string | null;
  company_name: string | null;
  cost_center_id: number | null;
  vendor_id: number | null;
  vendor_name: string | null;
  warehouse_code: string | null;
  warehouse: string | null;
  delivery_asset_user_id: number | null;
  delivery_candidates: { id: number; name: string }[];
  already_created_id: number | null;
  status: string;
  warnings: string[];
  lines: DraftLine[];
}

interface Option {
  id: number;
  name: string;
  asset_user_type?: string;
}

interface LineForm {
  itemCode: string;
  groupCode: string;
  description: string;
  barcode: string;
  quantity: string;
  rate: string;
  taxPercent: string;
  warrantyYears: string;
  categoryId: string;
  subcategoryId: string;
  brandId: string;
  model: string;
  bundleId: string;
  partAmounts: Record<number, string>;
  remember: boolean;
  remembered: boolean;
  categoryFromGroup: boolean;
  warnings: string[];
}

const str = (v: number | null | undefined) => (v == null ? "" : String(v));
const opt = (v: string) => v || undefined;
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function partAmountsFor(bundle: Bundle | undefined, rate: string): Record<number, string> {
  const price = Number(rate) || 0;
  if (!bundle || price <= 0) return {};
  const split = splitAmounts(price, bundle.parts.map((p) => p.share_percent));
  return Object.fromEntries(bundle.parts.map((p, i) => [p.id, String(split[i])]));
}

export function PoDraftCard({ draft, bundles }: { draft: Draft; bundles: Bundle[] }) {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState(str(draft.company_id));
  const [poNumber, setPoNumber] = useState(draft.po_number ?? "");
  const [poDate, setPoDate] = useState(draft.po_date ?? "");
  const [vendorId, setVendorId] = useState(str(draft.vendor_id));
  const [costCenterId, setCostCenterId] = useState(str(draft.cost_center_id));
  const [deliveryId, setDeliveryId] = useState(str(draft.delivery_asset_user_id));
  const [lines, setLines] = useState<LineForm[]>(() =>
    draft.lines.map((l) => {
      const bundle = bundles.find((b) => b.id === l.bundle_id);
      return {
        itemCode: l.item_code ?? "", groupCode: l.group_code ?? "", description: l.description, barcode: l.barcode,
        quantity: String(l.quantity), rate: String(l.rate), taxPercent: String(l.tax_percent),
        warrantyYears: String(l.warranty_years), categoryId: str(l.category_id), subcategoryId: str(l.subcategory_id),
        brandId: str(l.brand_id), model: l.model ?? "", bundleId: str(l.bundle_id),
        partAmounts: partAmountsFor(bundle, String(l.rate)), remember: true, remembered: l.remembered,
        categoryFromGroup: l.category_from_group, warnings: l.warnings,
      };
    }),
  );

  const companiesQ = useQuery({ queryKey: ["asset_users", "me", "companies"], queryFn: () => apiClient.get<Option[]>("/asset-users/me/companies") });
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Option[]>("/masters/vendors") });
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Option[]>("/masters/categories") });
  const subcategoriesQ = useQuery({
    queryKey: ["masters", "subcategories"],
    queryFn: () => apiClient.get<(Option & { category_id: number })[]>("/masters/subcategories"),
  });
  const brandsQ = useQuery({ queryKey: ["masters", "brands"], queryFn: () => apiClient.get<Option[]>("/masters/brands") });
  const costCentersQ = useQuery({
    queryKey: ["masters", "cost-centers", companyId],
    queryFn: () => apiClient.get<Option[]>(`/masters/cost-centers?company_id=${companyId}`),
    enabled: companyId !== "",
  });
  const usersQ = useQuery({
    queryKey: ["asset_users", companyId],
    queryFn: () => apiClient.get<Option[]>(`/asset-users?company_id=${companyId}`),
    enabled: companyId !== "",
  });
  const companies = companiesQ.data ?? [];
  const categories = categoriesQ.data ?? [];
  const subcategories = subcategoriesQ.data ?? [];
  const deliveryOptions = (usersQ.data ?? []).filter((u) => !u.asset_user_type || u.asset_user_type === "STOCK_POINT");

  function setLine(i: number, patch: Partial<LineForm>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function changeBundle(i: number, bundleId: string) {
    const bundle = bundles.find((b) => String(b.id) === bundleId);
    setLine(i, { bundleId, partAmounts: partAmountsFor(bundle, lines[i].rate) });
  }
  function changeRate(i: number, rate: string) {
    const bundle = bundles.find((b) => String(b.id) === lines[i].bundleId);
    setLine(i, { rate, partAmounts: partAmountsFor(bundle, rate) });
  }

  function lineProblem(l: LineForm): string | null {
    if (l.description.trim() === "") return "description is required";
    if (l.barcode.trim() === "") return "barcode is required";
    if (!(Number(l.quantity) >= 1) || !Number.isInteger(Number(l.quantity))) return "quantity must be a whole number, at least 1";
    if (!(Number(l.rate) > 0)) return "cost must be more than 0";
    if (l.bundleId) {
      const bundle = bundles.find((b) => String(b.id) === l.bundleId);
      if (!bundle) return "bundle not found";
      const total = bundle.parts.reduce((s, p) => s + (Number(l.partAmounts[p.id]) || 0), 0);
      if (Math.abs(total - Number(l.rate)) >= 0.005) return `the part amounts must add up to ${money(Number(l.rate))}`;
      return null;
    }
    if (l.categoryId === "" || l.subcategoryId === "") return "category and sub-category are required";
    return null;
  }
  const problems = useMemo(() => lines.map(lineProblem), [lines, bundles]); // eslint-disable-line react-hooks/exhaustive-deps
  const alreadyCreated = draft.already_created_id !== null;
  const canCreate =
    companyId !== "" && poNumber.trim() !== "" && poDate !== "" && costCenterId !== "" && !alreadyCreated &&
    lines.length > 0 && problems.every((p) => p === null);

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ po_id: number; po_number: string; lines_created: number }>("/erp/pos/create", {
        erp_po_code: draft.erp_po_code, company_id: Number(companyId), po_number: poNumber.trim(), po_date: poDate,
        vendor_id: vendorId ? Number(vendorId) : null, cost_center_id: Number(costCenterId),
        delivery_asset_user_id: deliveryId ? Number(deliveryId) : null, warehouse_code: draft.warehouse_code,
        lines: lines.map((l) => {
          const bundle = bundles.find((b) => String(b.id) === l.bundleId);
          return {
            item_code: l.itemCode || null, group_code: l.groupCode || null, description: l.description.trim(),
            barcode: l.barcode.trim(), quantity: Number(l.quantity), rate: Number(l.rate),
            tax_percent: Number(l.taxPercent) || 0, warranty_years: Number(l.warrantyYears) || 0,
            category_id: bundle ? null : Number(l.categoryId),
            subcategory_id: bundle ? null : Number(l.subcategoryId),
            brand_id: !bundle && l.brandId ? Number(l.brandId) : null, model: !bundle && l.model ? l.model : null,
            bundle_id: bundle ? bundle.id : null,
            bundle_parts: bundle ? bundle.parts.map((p) => ({ part_id: p.id, amount: Number(l.partAmounts[p.id]) })) : null,
            remember: l.remember && !!l.itemCode,
          };
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });

  const created = createMutation.data;
  const locked = !!created;

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4" aria-label={`Draft ${draft.po_number ?? "purchase order"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {poNumber || "Purchase order"}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            from the ERP (PO code {draft.erp_po_code})
          </span>
        </h2>
        {created && (
          <p className="text-sm text-success" role="status">
            Created. {created.lines_created} line{created.lines_created === 1 ? "" : "s"} added.{" "}
            <Link className="underline" to="/purchase-orders/$id" params={{ id: String(created.po_id) }}>Open {created.po_number}</Link>
          </p>
        )}
      </div>

      {draft.warnings.length > 0 && (
        <ul className="list-disc rounded-md border border-warning/50 bg-warning/10 p-2 pl-6 text-xs" aria-label="Things to check">
          {draft.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <fieldset disabled={locked} className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          <FormField htmlFor={`${poNumber}-company`} label="Company" required>
            <SearchableSelect
              id={`${poNumber}-company`} value={opt(companyId)}
              onValueChange={(v) => { setCompanyId(v); setCostCenterId(""); setDeliveryId(""); }}
              options={companies.map((c) => ({ value: String(c.id), label: c.name }))}
            />
          </FormField>
          <FormField htmlFor={`${poNumber}-po-number`} label="PO No" required>
            <Input id={`${poNumber}-po-number`} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
          </FormField>
          <FormField htmlFor={`${poNumber}-po-date`} label="PO Date" required>
            <Input id={`${poNumber}-po-date`} type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
          </FormField>
          <FormField htmlFor={`${poNumber}-vendor`} label="Vendor" helperText={draft.vendor_name ? `In the ERP: ${draft.vendor_name}` : undefined}>
            <SearchableSelect
              id={`${poNumber}-vendor`} value={opt(vendorId)} onValueChange={setVendorId}
              options={(vendorsQ.data ?? []).map((v) => ({ value: String(v.id), label: v.name }))}
            />
          </FormField>
          <FormField htmlFor={`${poNumber}-cost-center`} label="Cost Centre" required>
            <SearchableSelect
              id={`${poNumber}-cost-center`} value={opt(costCenterId)} onValueChange={setCostCenterId}
              options={(costCentersQ.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
            />
          </FormField>
          <FormField
            htmlFor={`${poNumber}-delivery`} label="Delivery location"
            helperText={draft.warehouse ? `Location in the ERP: ${draft.warehouse}. Becomes the Initial Asset User at delivery.` : "Becomes the Initial Asset User at delivery."}
          >
            <SearchableSelect
              id={`${poNumber}-delivery`} value={opt(deliveryId)} onValueChange={setDeliveryId}
              options={deliveryOptions.map((u) => ({ value: String(u.id), label: u.name }))}
            />
          </FormField>
        </div>

        <div className="flex flex-col gap-3">
          {lines.map((l, i) => {
            const bundle = bundles.find((b) => String(b.id) === l.bundleId);
            const visibleSubs = subcategories.filter((s) => !l.categoryId || s.category_id === Number(l.categoryId));
            const partTotal = bundle ? bundle.parts.reduce((s, p) => s + (Number(l.partAmounts[p.id]) || 0), 0) : 0;
            const id = `${poNumber}-line-${i}`;
            return (
              <div key={i} className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3" aria-label={`Line ${i + 1}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    Line {i + 1}: item code <span className="font-mono text-foreground">{l.itemCode || "—"}</span>
                    {l.remembered && <span className="ml-2 rounded bg-success/15 px-1.5 py-0.5 text-success">remembered</span>}
                  </span>
                  <label className="flex items-center gap-1.5">
                    <Checkbox
                      aria-label={`Remember this item (line ${i + 1})`} checked={l.remember} disabled={!l.itemCode}
                      onCheckedChange={(c) => setLine(i, { remember: c === true })}
                    />
                    Remember this item for next time
                  </label>
                </div>
                {l.warnings.length > 0 && (
                  <ul className="list-disc rounded-md border border-warning/50 bg-warning/10 p-2 pl-6 text-xs">
                    {l.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                )}
                <div className="grid grid-cols-6 gap-2">
                  <FormField htmlFor={`${id}-description`} label="Description" required className="col-span-3">
                    <Input id={`${id}-description`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                  </FormField>
                  <FormField htmlFor={`${id}-barcode`} label="Barcode" required>
                    <Input id={`${id}-barcode`} value={l.barcode} onChange={(e) => setLine(i, { barcode: e.target.value })} />
                  </FormField>
                  <FormField htmlFor={`${id}-quantity`} label="Quantity" required>
                    <Input id={`${id}-quantity`} type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  </FormField>
                  <FormField htmlFor={`${id}-rate`} label={bundle ? "Price per bundle" : "Cost per unit"} required>
                    <Input id={`${id}-rate`} type="number" min={0.01} step="0.01" value={l.rate} onChange={(e) => changeRate(i, e.target.value)} />
                  </FormField>
                  <FormField htmlFor={`${id}-tax`} label="Tax %">
                    <Input id={`${id}-tax`} type="number" min={0} value={l.taxPercent} onChange={(e) => setLine(i, { taxPercent: e.target.value })} />
                  </FormField>
                  <FormField htmlFor={`${id}-warranty`} label="Warranty Years">
                    <Input id={`${id}-warranty`} type="number" min={0} step={1} value={l.warrantyYears} onChange={(e) => setLine(i, { warrantyYears: e.target.value })} />
                  </FormField>
                  <FormField htmlFor={`${id}-bundle`} label="Add as a bundle" helperText={bundles.length === 0 ? "No bundles set up." : undefined} className="col-span-2">
                    <SearchableSelect
                      id={`${id}-bundle`} value={opt(l.bundleId)} onValueChange={(v) => changeBundle(i, v)}
                      options={bundles.map((b) => ({ value: String(b.id), label: b.name }))}
                      placeholder="No, a single item"
                    />
                  </FormField>
                  {bundle ? (
                    <div className="col-span-6 rounded-md border bg-background p-2 text-sm">
                      <p className="mb-1 text-xs text-muted-foreground">
                        Becomes {bundle.parts.length * (Number(l.quantity) || 0)} lines: {Number(l.quantity) || 0} of each part.
                        <button type="button" className="ml-2 underline" onClick={() => changeBundle(i, "")}>Make it a single item instead</button>
                      </p>
                      <div className="flex flex-wrap items-end gap-3">
                        {bundle.parts.map((p) => (
                          <label key={p.id} className="flex flex-col gap-1 text-xs">
                            {p.name}
                            <Input
                              aria-label={`Line ${i + 1} amount for ${p.name}`} type="number" min={0} step="0.01" className="h-8 w-28"
                              value={l.partAmounts[p.id] ?? ""}
                              onChange={(e) => setLine(i, { partAmounts: { ...l.partAmounts, [p.id]: e.target.value } })}
                            />
                          </label>
                        ))}
                        <p className={`pb-1.5 text-xs tabular-nums ${Math.abs(partTotal - Number(l.rate)) < 0.005 ? "text-muted-foreground" : "text-destructive"}`}>
                          Total {money(partTotal)} {Math.abs(partTotal - Number(l.rate)) < 0.005 ? "(matches the price)" : `(must equal ${money(Number(l.rate) || 0)})`}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <FormField htmlFor={`${id}-category`} label="Category" required className="col-span-2" helperText={l.categoryFromGroup ? "Suggested from the item group. Check it." : undefined}>
                        <SearchableSelect
                          id={`${id}-category`} value={opt(l.categoryId)}
                          onValueChange={(v) => setLine(i, { categoryId: v, subcategoryId: "", categoryFromGroup: false })}
                          options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
                        />
                      </FormField>
                      <FormField htmlFor={`${id}-subcategory`} label="Sub-Category" required className="col-span-2">
                        <SearchableSelect
                          id={`${id}-subcategory`} value={opt(l.subcategoryId)} onValueChange={(v) => setLine(i, { subcategoryId: v })}
                          options={visibleSubs.map((s) => ({ value: String(s.id), label: s.name }))}
                        />
                      </FormField>
                      <FormField htmlFor={`${id}-brand`} label="Brand">
                        <SearchableSelect
                          id={`${id}-brand`} value={opt(l.brandId)} onValueChange={(v) => setLine(i, { brandId: v })}
                          options={(brandsQ.data ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
                        />
                      </FormField>
                      <FormField htmlFor={`${id}-model`} label="Model">
                        <Input id={`${id}-model`} value={l.model} onChange={(e) => setLine(i, { model: e.target.value })} />
                      </FormField>
                    </>
                  )}
                </div>
                {problems[i] && <p className="text-xs text-destructive">Line {i + 1}: {problems[i]}.</p>}
              </div>
            );
          })}
        </div>
      </fieldset>

      {createMutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {createMutation.error instanceof Error ? createMutation.error.message : "Failed to create the purchase order."}
        </p>
      )}
      {!locked && (
        <div>
          <AsyncButton onClick={() => createMutation.mutate()} disabled={!canCreate} pending={createMutation.isPending} pendingLabel="Creating…">
            Create this purchase order
          </AsyncButton>
        </div>
      )}
    </section>
  );
}
