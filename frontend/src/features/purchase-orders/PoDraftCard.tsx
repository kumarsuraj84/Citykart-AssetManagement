import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Bundle } from "../bundles/BundlesScreen";
import type { Item } from "../items/types";
import { splitAmounts } from "./AddBundleDialog";
import { Input } from "@/components/ui/input";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ItemFormDialog } from "../items/ItemFormDialog";
import { NewBrandDialog, NewCostCenterDialog, NewVendorDialog, useCanCreateMasters } from "@/components/quick-create/masters";
import { brandOptions, companyOptions, costCentreOptions, itemOptions, namesById, stockRoomOptions, vendorOptions } from "@/lib/option-labels";
import { usePlaceLookups } from "@/lib/lookups";

export type MapScope = "NONE" | "ARTICLE" | "NAME" | "CODE";
/** How far a "not tracked" decision reaches: one code, a product name, an Article, or a whole Department / Section / Division. */
export type NotTrackedScope = "CODE" | "NAME" | "ARTICLE" | "DEPARTMENT" | "SECTION" | "DIVISION";

/** A line of the ERP PO that CKAM does not track, so it is left out of the draft. */
export interface UntrackedLine {
  item_code: string | null;
  description: string;
  quantity: number;
  rate: number;
  why: string | null;
}

export interface DraftLine {
  item_code: string | null;
  description: string;
  barcode: string;
  quantity: number;
  rate: number;
  amount: number;
  tax_percent: number;
  hsn: string | null;
  unit?: string | null;
  warranty_years: number;
  brand_id: number | null;
  model: string | null;
  // The CityKart Item this ERP code belongs to (null = not linked yet), and why.
  item_id: number | null;
  item_name: string | null;
  matched_by: "CODE" | "NAME" | "ARTICLE" | null;
  category_name: string | null;
  subcategory_name: string | null;
  bundle_id: number | null;
  bundle_name: string | null;
  // What the ERP says about this code: words to read beside the code.
  erp_description: string | null;
  erp_name: string | null;
  article_key: string | null;
  article_name: string | null;
  section: string | null;
  department: string | null;
  division?: string | null;
  name_key: string | null;
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
  /** Lines of this PO that CKAM does not track (cables, hangers…): not part of the draft. */
  untracked_lines?: UntrackedLine[];
}

interface Option {
  id: number;
  name: string;
  code?: string | null;
  gstin?: string | null;
  asset_user_type?: string;
  company_id?: number | null;
  location_id?: number | null;
}

interface LineForm {
  src: DraftLine;
  description: string;
  barcode: string;
  quantity: string;
  rate: string;
  taxPercent: string;
  warrantyYears: string;
  brandId: string;
  model: string;
  itemId: string;
  partAmounts: Record<number, string>;
  mapScope: MapScope;
  notTrackedScope: NotTrackedScope;
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

const SCOPE_LABEL: Record<MapScope, string> = {
  NONE: "Do not remember this choice",
  ARTICLE: "Remember for every code of this Article",
  NAME: "Remember for this product name only",
  CODE: "Remember for this ERP code only",
};

export function PoDraftCard({ draft, bundles, items }: { draft: Draft; bundles: Bundle[]; items: Item[] }) {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState(str(draft.company_id));
  const [poNumber, setPoNumber] = useState(draft.po_number ?? "");
  const [poDate, setPoDate] = useState(draft.po_date ?? "");
  const [vendorId, setVendorId] = useState(str(draft.vendor_id));
  const [costCenterId, setCostCenterId] = useState(str(draft.cost_center_id));
  const [deliveryId, setDeliveryId] = useState(str(draft.delivery_asset_user_id));
  const itemById = (id: string) => items.find((i) => String(i.id) === id);
  const bundleOf = (itemId: string) => bundles.find((b) => b.id === itemById(itemId)?.bundle_id);
  const [lines, setLines] = useState<LineForm[]>(() =>
    draft.lines.map((l) => {
      const bundle = bundles.find((b) => b.id === l.bundle_id);
      return {
        src: l, description: l.description, barcode: l.barcode, quantity: String(l.quantity), rate: String(l.rate),
        taxPercent: String(l.tax_percent), warrantyYears: String(l.warranty_years), brandId: str(l.brand_id), model: l.model ?? "",
        itemId: str(l.item_id), partAmounts: partAmountsFor(bundle, String(l.rate)),
        // An unlinked code is remembered by default (for its whole Article when it has one).
        mapScope: l.item_id === null ? (l.article_key ? "ARTICLE" : "CODE") : "NONE",
        notTrackedScope: l.article_key ? "ARTICLE" : "CODE",
      };
    }),
  );

  const companiesQ = useQuery({ queryKey: ["asset_users", "me", "companies"], queryFn: () => apiClient.get<Option[]>("/asset-users/me/companies") });
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Option[]>("/masters/vendors") });
  const brandsQ = useQuery({ queryKey: ["masters", "brands"], queryFn: () => apiClient.get<Option[]>("/masters/brands") });
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Option[]>("/masters/categories") });
  const subcategoriesQ = useQuery({ queryKey: ["masters", "subcategories"], queryFn: () => apiClient.get<Option[]>("/masters/subcategories") });
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
  // A missing Item, Brand, Vendor or Cost Centre is created right here, then picked.
  const canCreateMasters = useCanCreateMasters();
  const [newItemFor, setNewItemFor] = useState<number | null>(null);
  const [newBrandFor, setNewBrandFor] = useState<number | null>(null);
  const [newVendor, setNewVendor] = useState(false);
  const [newCostCenter, setNewCostCenter] = useState(false);
  const deliveryOptions = (usersQ.data ?? []).filter((u) => !u.asset_user_type || u.asset_user_type === "STOCK_POINT");
  const placeLookups = usePlaceLookups();
  // Dropdown options with context ("Laptop · IT Fixed Assets", "HO Stock · Head Office").
  const itemSelectOptions = useMemo(
    () => itemOptions(items, { categories: namesById(categoriesQ.data), subcategories: namesById(subcategoriesQ.data) }),
    [items, categoriesQ.data, subcategoriesQ.data],
  );
  const brandSelectOptions = useMemo(() => brandOptions(brandsQ.data), [brandsQ.data]);

  function setLine(i: number, patch: Partial<LineForm>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function changeItem(i: number, itemId: string) {
    const before = lines[i];
    // Re-pointing a code that was already linked fixes the rule that matched it;
    // choosing for an unlinked one remembers it for the whole Article by default.
    const scope: MapScope = before.src.matched_by ?? (before.src.article_key ? "ARTICLE" : "CODE");
    const fallback: MapScope = before.src.article_key ? scope : "CODE";
    setLine(i, { itemId, partAmounts: partAmountsFor(bundleOf(itemId), before.rate), mapScope: fallback });
  }
  function changeRate(i: number, rate: string) {
    setLine(i, { rate, partAmounts: partAmountsFor(bundleOf(lines[i].itemId), rate) });
  }

  function lineProblem(l: LineForm): string | null {
    if (l.itemId === "") return "choose the Item";
    if (l.description.trim() === "") return "description is required";
    if (l.barcode.trim() === "") return "barcode is required";
    if (!(Number(l.quantity) >= 1) || !Number.isInteger(Number(l.quantity))) return "quantity must be a whole number, at least 1";
    if (!(Number(l.rate) > 0)) return "cost must be more than 0";
    const bundle = bundleOf(l.itemId);
    if (bundle) {
      const total = bundle.parts.reduce((s, p) => s + (Number(l.partAmounts[p.id]) || 0), 0);
      if (Math.abs(total - Number(l.rate)) >= 0.005) return `the part amounts must add up to ${money(Number(l.rate))}`;
    }
    return null;
  }
  const problems = useMemo(() => lines.map(lineProblem), [lines, items, bundles]); // eslint-disable-line react-hooks/exhaustive-deps
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
          const bundle = bundleOf(l.itemId);
          const keep = l.mapScope !== "NONE";
          return {
            item_code: l.src.item_code, description: l.description.trim(), barcode: l.barcode.trim(),
            quantity: Number(l.quantity), rate: Number(l.rate), tax_percent: Number(l.taxPercent) || 0,
            warranty_years: Number(l.warrantyYears) || 0, item_id: Number(l.itemId),
            brand_id: !bundle && l.brandId ? Number(l.brandId) : null, model: !bundle && l.model ? l.model : null,
            bundle_parts: bundle ? bundle.parts.map((p) => ({ part_id: p.id, amount: Number(l.partAmounts[p.id]) })) : null,
            map_scope: keep ? l.mapScope : null,
            article_key: keep ? l.src.article_key : null, article_name: keep ? l.src.article_name : null,
            section: keep ? l.src.section : null, department: keep ? l.src.department : null, name_key: keep ? l.src.name_key : null,
          };
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["items"] });
    },
  });

  // "Not tracked": CKAM does not manage this (a cable, a hanger). Remembered as a rule for this PO's company, then the draft is read again
  // without those lines.
  const notTrackedMutation = useMutation({
    mutationFn: (l: LineForm) => {
      const s = l.src;
      const base = { not_tracked: true, match_type: l.notTrackedScope, ...(companyId ? { company_id: Number(companyId) } : {}) };
      const article = { article_key: s.article_key, article_name: s.article_name, section: s.section, department: s.department };
      if (l.notTrackedScope === "CODE") return apiClient.post("/items/maps", { ...base, ...article, erp_item_code: s.item_code });
      if (l.notTrackedScope === "NAME") return apiClient.post("/items/maps", { ...base, ...article, name_key: s.name_key });
      if (l.notTrackedScope === "ARTICLE") return apiClient.post("/items/maps", { ...base, ...article });
      const level = { DEPARTMENT: s.department, SECTION: s.section, DIVISION: s.division }[l.notTrackedScope];
      return apiClient.post("/items/maps", { ...base, level_key: level });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["erp", "draft"] });
      qc.invalidateQueries({ queryKey: ["erp", "pos"] });
      qc.invalidateQueries({ queryKey: ["items"] });
    },
  });
  const notTrackedChoices = (s: DraftLine): { value: NotTrackedScope; label: string }[] => {
    const out: { value: NotTrackedScope; label: string }[] = [{ value: "CODE", label: "This ERP code only" }];
    if (s.article_key && s.name_key) out.push({ value: "NAME", label: "This product name" });
    if (s.article_key) out.push({ value: "ARTICLE", label: `Every code of this Article` });
    if (s.department) out.push({ value: "DEPARTMENT", label: `The whole Department ${s.department}` });
    if (s.section) out.push({ value: "SECTION", label: `The whole Section ${s.section}` });
    if (s.division) out.push({ value: "DIVISION", label: `The whole Division ${s.division}` });
    return out;
  };

  const created = createMutation.data;
  const locked = !!created;
  const leftOut = draft.untracked_lines ?? [];
  const categoryName = (id: number) => categoriesQ.data?.find((c) => c.id === id)?.name ?? "";
  const subcategoryName = (id: number | null) => (id ? subcategoriesQ.data?.find((s) => s.id === id)?.name ?? "" : "");

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4" aria-label={`Draft ${draft.po_number ?? "purchase order"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {poNumber || "Purchase order"}{" "}
          <span className="text-xs font-normal text-muted-foreground">from the ERP (PO code {draft.erp_po_code})</span>
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
              options={companyOptions(companies)}
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
              options={vendorOptions(vendorsQ.data)}
              onCreateNew={canCreateMasters ? () => setNewVendor(true) : undefined} createLabel="New Vendor…"
            />
          </FormField>
          <FormField htmlFor={`${poNumber}-cost-center`} label="Cost Centre" required>
            <SearchableSelect
              id={`${poNumber}-cost-center`} value={opt(costCenterId)} onValueChange={setCostCenterId}
              options={costCentreOptions(costCentersQ.data)}
              onCreateNew={canCreateMasters && companyId !== "" ? () => setNewCostCenter(true) : undefined} createLabel="New Cost Centre…"
            />
          </FormField>
          <FormField
            htmlFor={`${poNumber}-delivery`} label="Received Into"
            helperText={draft.warehouse ? `Location in the ERP: ${draft.warehouse}. The Stock Room the delivery goes to.` : "The Stock Room the delivery goes to."}
          >
            <SearchableSelect
              id={`${poNumber}-delivery`} value={opt(deliveryId)} onValueChange={setDeliveryId}
              options={stockRoomOptions(deliveryOptions, placeLookups)}
            />
          </FormField>
        </div>

        <div className="flex flex-col gap-3">
          {lines.map((l, i) => {
            const item = itemById(l.itemId);
            const bundle = bundleOf(l.itemId);
            const partTotal = bundle ? bundle.parts.reduce((s, p) => s + (Number(l.partAmounts[p.id]) || 0), 0) : 0;
            const id = `${poNumber}-line-${i}`;
            const s = l.src;
            return (
              <div key={i} className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3" aria-label={`Line ${i + 1}`}>
                <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  <span>
                    Line {i + 1}: ERP code <span className="font-mono text-foreground">{s.item_code || "—"}</span>
                    {s.section && <> · {s.section} › {s.department} › {s.article_name}</>}
                  </span>
                  {s.erp_description && <span>In the ERP: <span className="text-foreground">{s.erp_description}</span></span>}
                </div>
                {s.warnings.length > 0 && (
                  <ul className="list-disc rounded-md border border-warning/50 bg-warning/10 p-2 pl-6 text-xs">
                    {s.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                )}
                <div className="grid grid-cols-6 gap-2">
                  <FormField
                    htmlFor={`${id}-item`} label="Item" required className="col-span-3"
                    helperText={
                      item
                        ? `${[categoryName(item.category_id), subcategoryName(item.subcategory_id)].filter(Boolean).join(" › ")}${l.itemId === str(s.item_id) && s.matched_by ? ` · linked ${s.matched_by === "ARTICLE" ? "through its Article" : s.matched_by === "NAME" ? "by its product name" : "by its code"}` : ""}`
                        : "What this asset is, in CityKart's words."
                    }
                  >
                    <SearchableSelect
                      id={`${id}-item`} value={opt(l.itemId)} onValueChange={(v) => changeItem(i, v)}
                      options={itemSelectOptions} placeholder="Choose the Item"
                      onCreateNew={canCreateMasters ? () => setNewItemFor(i) : undefined} createLabel="New Item…"
                    />
                  </FormField>
                  <FormField htmlFor={`${id}-scope`} label="Remember" className="col-span-3">
                    <SearchableSelect
                      id={`${id}-scope`} value={l.mapScope} onValueChange={(v) => setLine(i, { mapScope: v as MapScope })}
                      options={(["NONE", "ARTICLE", "NAME", "CODE"] as MapScope[])
                        .filter((m) => m === "NONE" || m === "CODE" || (m === "ARTICLE" && !!s.article_key) || (m === "NAME" && !!s.article_key && !!s.name_key))
                        .map((m) => ({ value: m, label: SCOPE_LABEL[m] }))}
                    />
                  </FormField>
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
                  {bundle ? (
                    <div className="col-span-6 rounded-md border bg-background p-2 text-sm">
                      <p className="mb-1 text-xs text-muted-foreground">
                        {item?.name} is a bundle: becomes {bundle.parts.length * (Number(l.quantity) || 0)} lines, {Number(l.quantity) || 0} of each part.
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
                      <FormField htmlFor={`${id}-brand`} label="Brand" className="col-span-2">
                        <SearchableSelect
                          id={`${id}-brand`} value={opt(l.brandId)} onValueChange={(v) => setLine(i, { brandId: v })}
                          options={brandSelectOptions}
                          onCreateNew={canCreateMasters ? () => setNewBrandFor(i) : undefined} createLabel="New Brand…"
                        />
                      </FormField>
                      <FormField htmlFor={`${id}-model`} label="Model" className="col-span-2">
                        <Input id={`${id}-model`} value={l.model} onChange={(e) => setLine(i, { model: e.target.value })} />
                      </FormField>
                    </>
                  )}
                </div>
                {problems[i] && <p className="text-xs text-destructive">Line {i + 1}: {problems[i]}.</p>}
                {canCreateMasters && s.item_id === null && s.item_code && (
                  <div className="flex flex-wrap items-end gap-2 border-t pt-2" aria-label={`Line ${i + 1} not tracked`}>
                    <span className="pb-2 text-xs text-muted-foreground">Not something CKAM tracks (a cable, a hanger)?</span>
                    <div className="w-64">
                      <SearchableSelect
                        id={`${id}-not-tracked-scope`} aria-label={`Line ${i + 1}: how far this reaches`} value={l.notTrackedScope}
                        onValueChange={(v) => setLine(i, { notTrackedScope: v as NotTrackedScope })}
                        options={notTrackedChoices(s)}
                      />
                    </div>
                    <AsyncButton
                      type="button" variant="outline" size="sm" pending={notTrackedMutation.isPending} pendingLabel="Saving…"
                      aria-label={`Line ${i + 1}: not tracked`} onClick={() => notTrackedMutation.mutate(l)}
                    >
                      Not tracked
                    </AsyncButton>
                  </div>
                )}
              </div>
            );
          })}
          {notTrackedMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {notTrackedMutation.error instanceof Error ? notTrackedMutation.error.message : "Could not save that decision."}
            </p>
          )}
          {leftOut.length > 0 && (
            <details className="rounded-md border bg-muted/20 p-2 text-sm" aria-label="Lines left out">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {leftOut.length} line{leftOut.length === 1 ? "" : "s"} left out: not tracked in CKAM
              </summary>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                {leftOut.map((u) => (
                  <li key={`${u.item_code}-${u.description}`}>
                    <span className="font-mono">{u.item_code}</span> {u.description} · {u.quantity} × {money(u.rate)}
                    {u.why && <span className="text-muted-foreground"> · {u.why}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </fieldset>

      {createMutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {createMutation.error instanceof Error ? createMutation.error.message : "Failed to create the purchase order."}
        </p>
      )}

      <ItemFormDialog
        open={newItemFor !== null}
        onOpenChange={(open) => !open && setNewItemFor(null)}
        // Start from the ERP's own words for this product.
        initialName={newItemFor !== null ? (lines[newItemFor]?.src.erp_name || lines[newItemFor]?.src.article_name || undefined) ?? undefined : undefined}
        onSaved={(saved) => newItemFor !== null && changeItem(newItemFor, String(saved.id))}
      />
      <NewBrandDialog
        open={newBrandFor !== null}
        onOpenChange={(open) => !open && setNewBrandFor(null)}
        onCreated={(row) => newBrandFor !== null && setLine(newBrandFor, { brandId: String(row.id) })}
      />
      <NewVendorDialog open={newVendor} onOpenChange={setNewVendor} onCreated={(row) => setVendorId(String(row.id))} />
      {companyId !== "" && (
        <NewCostCenterDialog
          companyId={Number(companyId)} open={newCostCenter} onOpenChange={setNewCostCenter}
          onCreated={(row) => setCostCenterId(String(row.id))}
        />
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
