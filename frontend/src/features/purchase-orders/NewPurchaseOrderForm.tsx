import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import type { Item } from "../items/types";
import type { Bundle } from "../bundles/bundle-parts";
import { ItemFormDialog } from "../items/ItemFormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { NewBrandDialog, NewCostCenterDialog, NewVendorDialog } from "@/components/quick-create/masters";
import { StockRoomSelect, useStockRooms } from "@/components/quick-create/StockRoomSelect";
import { brandOptions, companyOptions, costCentreOptions, itemOptions, namesById, vendorOptions } from "@/lib/option-labels";
import { ASK_TO_ADD, canCreate as may, canManage, useCapabilities } from "@/lib/capabilities";
import { useRemember, useRememberedDefault } from "@/lib/remembered-defaults";
import { MAX_QUANTITY, quantityProblem } from "@/lib/limits";
import { serialModeLabel, workAreaLabel } from "@/lib/labels";
import { SetPartAmounts, partAmountsFor, partAmountsPayload, partsMatchPrice } from "./SetPartAmounts";
import { countWord, linesAndUnitsSentence } from "./po-list";
import { setPoFlash } from "./po-flash";

interface Option {
  id: number;
  name: string;
  code?: string | null;
  gstin?: string | null;
  asset_domain?: string | null;
  category_id?: number;
}

interface CreatedPurchaseOrder {
  id: number;
  po_number?: string;
  lines_created?: number;
  units_created?: number;
}

/** One Item line as typed. Description / brand / warranty start from the Item and are sent only when changed. */
interface LineRow {
  key: number;
  itemId: string;
  quantity: string;
  cost: string;
  tax: string;
  open: boolean;
  description: string;
  descriptionTouched: boolean;
  barcode: string;
  brandId: string;
  brandTouched: boolean;
  model: string;
  warranty: string;
  warrantyTouched: boolean;
}

/** One set (bundle): `quantity` sets at `price` each, split over its parts. */
interface SetRow {
  key: number;
  bundleId: string;
  quantity: string;
  price: string;
  tax: string;
  open: boolean;
  description: string;
  barcode: string;
  warranty: string;
  amounts: Record<number, string>;
}

const DEFAULT_TAX = "18";
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trimmedOrUndefined = (v: string) => (v.trim() === "" ? undefined : v.trim());

let nextKey = 1;
const newLine = (): LineRow => ({
  key: nextKey++, itemId: "", quantity: "1", cost: "", tax: DEFAULT_TAX, open: false,
  description: "", descriptionTouched: false, barcode: "", brandId: "", brandTouched: false, model: "",
  warranty: "", warrantyTouched: false,
});
const newSet = (): SetRow => ({
  key: nextKey++, bundleId: "", quantity: "1", price: "", tax: DEFAULT_TAX, open: false,
  description: "", barcode: "", warranty: "", amounts: {},
});

/** A line nobody has started (no Item, no cost): left out of the PO rather than refused. */
const isBlankLine = (l: LineRow) => l.itemId === "" && l.cost.trim() === "" && l.description.trim() === "";
const isBlankSet = (s: SetRow) => s.bundleId === "" && s.price.trim() === "";

function taxProblem(v: string): string | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? null : "tax must be from 0 to 100";
}

/** What is wrong with a line before saving (null = fine). */
function lineProblem(l: LineRow): string | null {
  if (l.itemId === "") return "choose the Item";
  const q = quantityProblem(l.quantity);
  if (q) return `quantity: ${q.charAt(0).toLowerCase()}${q.slice(1).replace(/\.$/, "")}`;
  if (l.cost.trim() === "" || !(Number(l.cost) >= 0)) return "enter the unit cost";
  const t = taxProblem(l.tax);
  if (t) return t;
  if (l.warranty.trim() !== "" && !(Number.isInteger(Number(l.warranty)) && Number(l.warranty) >= 0)) return "warranty must be a whole number of years";
  return null;
}

function setProblem(s: SetRow, bundle: Bundle | undefined): string | null {
  if (!bundle) return "choose the set";
  const q = quantityProblem(s.quantity);
  if (q) return `quantity: ${q.charAt(0).toLowerCase()}${q.slice(1).replace(/\.$/, "")}`;
  if (!(Number(s.price) > 0)) return "enter the price per set";
  const t = taxProblem(s.tax);
  if (t) return t;
  if (!partsMatchPrice(bundle, s.amounts, s.price)) return `the part amounts must add up to ${money(Number(s.price) || 0)}`;
  return null;
}

/** "Line 2: …" / "Set 1: …" at the start of a server sentence → which entry it is about. */
export function entryForServerMessage(message: string): { kind: "line" | "set"; index: number } | null {
  const m = /^(Line|Set) (\d+)\b/i.exec(message.trim());
  if (!m) return null;
  return { kind: m[1].toLowerCase() === "set" ? "set" : "line", index: Number(m[2]) - 1 };
}

/**
 * New Purchase Order, on ONE screen (S3b-2): the header (company, PO No, date,
 * vendor, Cost Centre, where it is Received Into) and every line and set below
 * it, saved at once (POST /purchase-orders/with-lines: all or nothing). The
 * Item decides the type of asset, work area and serial rule; description,
 * brand and warranty start from the Item and can be changed under More details.
 */
export function NewPurchaseOrderForm({ companyId }: { companyId: number | null }) {
  const navigate = useNavigate();
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendorId, setVendorId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [deliveryId, setDeliveryId] = useState("");
  // AM-24: the caller's home company, selectable when they work in more than one;
  // the Primary Owner (no home company) starts with the first of theirs.
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(companyId);
  const [lines, setLines] = useState<LineRow[]>(() => [newLine()]);
  const [sets, setSets] = useState<SetRow[]>([]);

  const myCompaniesQ = useQuery({ queryKey: ["asset_users", "me", "companies"], queryFn: () => apiClient.get<Option[]>("/asset-users/me/companies") });
  const myCompanies = Array.isArray(myCompaniesQ.data) ? myCompaniesQ.data : [];
  if (selectedCompanyId === null && myCompanies.length > 0) setSelectedCompanyId(myCompanies[0].id);

  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Option[]>("/masters/vendors") });
  const vendors = Array.isArray(vendorsQ.data) ? vendorsQ.data : [];
  const costCentersQ = useQuery({
    queryKey: ["masters", "cost-centers", selectedCompanyId],
    queryFn: () => apiClient.get<Option[]>(`/masters/cost-centers?company_id=${selectedCompanyId}`),
    enabled: selectedCompanyId != null,
  });
  const costCenters = Array.isArray(costCentersQ.data) ? costCentersQ.data : [];
  const stockRoomsQ = useStockRooms(selectedCompanyId);
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items") });
  const items = (Array.isArray(itemsQ.data) ? itemsQ.data : []).filter((i) => i.is_active !== false);
  const bundlesQ = useQuery({ queryKey: ["bundles"], queryFn: () => apiClient.get<Bundle[]>("/bundles") });
  const bundles = (Array.isArray(bundlesQ.data) ? bundlesQ.data : []).filter((b) => b.is_active !== false);
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Option[]>("/masters/categories") });
  const subcategoriesQ = useQuery({ queryKey: ["masters", "subcategories"], queryFn: () => apiClient.get<Option[]>("/masters/subcategories") });
  const brandsQ = useQuery({ queryKey: ["masters", "brands"], queryFn: () => apiClient.get<Option[]>("/masters/brands") });
  const categories = Array.isArray(categoriesQ.data) ? categoriesQ.data : [];
  const subcategories = Array.isArray(subcategoriesQ.data) ? subcategoriesQ.data : [];

  // What this person may add right here (nothing while the answer loads).
  const { caps, settled: capsSettled } = useCapabilities();
  const [newVendor, setNewVendor] = useState(false);
  const [newCostCenter, setNewCostCenter] = useState(false);
  const [newItemFor, setNewItemFor] = useState<number | null>(null);
  const [newBrandFor, setNewBrandFor] = useState<number | null>(null);

  // Smart defaults: the Cost Centre and stock room this person used last for this company.
  const rememberChoice = useRemember();
  useRememberedDefault({
    kind: "cost_centre", companyId: selectedCompanyId, value: costCenterId, setValue: setCostCenterId,
    validIds: costCenters.map((c) => c.id), ready: costCentersQ.isSuccess,
  });
  useRememberedDefault({
    kind: "stock_room", companyId: selectedCompanyId, value: deliveryId, setValue: setDeliveryId,
    validIds: stockRoomsQ.rows.map((r) => r.id), ready: stockRoomsQ.isSuccess,
  });

  const itemSelectOptions = useMemo(
    () => itemOptions(items, { categories: namesById(categories), subcategories: namesById(subcategories) }),
    [items, categories, subcategories],
  );
  const brandSelectOptions = useMemo(() => brandOptions(Array.isArray(brandsQ.data) ? brandsQ.data : []), [brandsQ.data]);
  const itemById = (id: string) => items.find((i) => String(i.id) === id);
  const bundleById = (id: string) => bundles.find((b) => String(b.id) === id);

  function patchLine(key: number, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function patchSet(key: number, patch: Partial<SetRow>) {
    setSets((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  /** A new Item on a line: description, brand and warranty start from it (unless typed already). */
  function chooseItem(key: number, itemId: string) {
    const item = itemById(itemId);
    setLines((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      return {
        ...l, itemId,
        description: l.descriptionTouched ? l.description : item?.name ?? "",
        brandId: l.brandTouched ? l.brandId : item?.default_brand_id ? String(item.default_brand_id) : "",
        warranty: l.warrantyTouched ? l.warranty : item?.default_warranty_years != null ? String(item.default_warranty_years) : "",
      };
    }));
  }
  function chooseBundle(key: number, bundleId: string) {
    setSets((ss) => ss.map((s) => (s.key === key ? { ...s, bundleId, amounts: partAmountsFor(bundleById(bundleId), s.price) } : s)));
  }
  function changeSetPrice(key: number, price: string) {
    setSets((ss) => ss.map((s) => (s.key === key ? { ...s, price, amounts: partAmountsFor(bundleById(s.bundleId), price) } : s)));
  }

  // Keyboard: Enter in a line's cost or tax goes to the next line's Item (a new line after the last one).
  const [focusLine, setFocusLine] = useState<number | null>(null);
  useEffect(() => {
    if (focusLine === null) return;
    document.getElementById(`line-${focusLine}-item`)?.focus();
    setFocusLine(null);
  }, [focusLine, lines]);
  function enterToNextLine(e: KeyboardEvent<HTMLInputElement>, key: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const at = lines.findIndex((l) => l.key === key);
    if (at >= 0 && at < lines.length - 1) {
      setFocusLine(lines[at + 1].key);
      return;
    }
    const added = newLine();
    setLines((ls) => [...ls, added]);
    setFocusLine(added.key);
  }

  // What will be sent: started lines and sets only, in screen order.
  const sentLines = lines.filter((l) => !isBlankLine(l));
  const sentSets = sets.filter((s) => !isBlankSet(s));
  const lineProblems = new Map(sentLines.map((l) => [l.key, lineProblem(l)]));
  const setProblems = new Map(sentSets.map((s) => [s.key, setProblem(s, bundleById(s.bundleId))]));

  // Totals: a set is one line per part, `quantity` units on each.
  const lineCount = sentLines.length + sentSets.reduce((n, s) => n + (bundleById(s.bundleId)?.parts.length ?? 0), 0);
  const unitCount =
    sentLines.reduce((n, l) => n + (Number(l.quantity) || 0), 0) +
    sentSets.reduce((n, s) => n + (Number(s.quantity) || 0) * (bundleById(s.bundleId)?.parts.length ?? 0), 0);
  const totalWithTax =
    sentLines.reduce((t, l) => t + (Number(l.quantity) || 0) * (Number(l.cost) || 0) * (1 + (Number(l.tax) || 0) / 100), 0) +
    sentSets.reduce((t, s) => t + (Number(s.quantity) || 0) * (Number(s.price) || 0) * (1 + (Number(s.tax) || 0) / 100), 0);

  // Why Save is not ready yet, in plain words.
  const missing: string[] = [];
  if (selectedCompanyId == null) missing.push("the company");
  if (poNumber.trim() === "") missing.push("the PO No");
  if (poDate === "") missing.push("the PO Date");
  if (costCenterId === "") missing.push("the Cost Centre");
  if (sentLines.length + sentSets.length === 0) missing.push("at least one line or set");
  const badEntries = [...lineProblems.values(), ...setProblems.values()].filter((p) => p !== null).length;
  if (badEntries > 0) missing.push(`${badEntries === 1 ? "1 line or set" : `${badEntries} lines or sets`} marked in red`);
  const canSave = missing.length === 0;

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.post<CreatedPurchaseOrder>("/purchase-orders/with-lines", {
        company_id: selectedCompanyId,
        po_number: poNumber.trim(),
        po_date: poDate,
        vendor_id: vendorId ? Number(vendorId) : null,
        cost_center_id: Number(costCenterId),
        ...(deliveryId ? { delivery_asset_user_id: Number(deliveryId) } : {}),
        lines: sentLines.map((l) => {
          const item = itemById(l.itemId);
          const defaultBrand = item?.default_brand_id ? String(item.default_brand_id) : "";
          const defaultWarranty = item?.default_warranty_years != null ? String(item.default_warranty_years) : "";
          const description = l.description.trim();
          return {
            item_id: Number(l.itemId),
            quantity: Number(l.quantity),
            purchase_cost: Number(l.cost),
            tax_percent: l.tax.trim() === "" ? 0 : Number(l.tax),
            // Left out = the Item's own default (the server fills it in).
            ...(description !== "" && description !== item?.name ? { description } : {}),
            ...(trimmedOrUndefined(l.barcode) ? { barcode: l.barcode.trim() } : {}),
            ...(l.brandId !== defaultBrand && l.brandId !== "" ? { brand_id: Number(l.brandId) } : {}),
            ...(trimmedOrUndefined(l.model) ? { model: l.model.trim() } : {}),
            ...(l.warranty.trim() !== "" && l.warranty.trim() !== defaultWarranty ? { warranty_years: Number(l.warranty) } : {}),
          };
        }),
        sets: sentSets.map((s) => {
          const bundle = bundleById(s.bundleId)!;
          return {
            bundle_id: bundle.id,
            quantity: Number(s.quantity),
            price_per_set: Number(s.price),
            tax_percent: s.tax.trim() === "" ? 0 : Number(s.tax),
            ...(trimmedOrUndefined(s.description) ? { description: s.description.trim() } : {}),
            ...(trimmedOrUndefined(s.barcode) ? { barcode: s.barcode.trim() } : {}),
            ...(s.warranty.trim() !== "" ? { warranty_years: Number(s.warranty) } : {}),
            part_amounts: partAmountsPayload(bundle, s.amounts),
          };
        }),
      }),
    onSuccess: (created) => {
      rememberChoice(selectedCompanyId, "cost_centre", costCenterId);
      rememberChoice(selectedCompanyId, "stock_room", deliveryId);
      const madeLines = created.lines_created ?? lineCount;
      const madeUnits = created.units_created ?? unitCount;
      setPoFlash(created.id, `PO created: ${linesAndUnitsSentence(madeLines, madeUnits)}.`);
      navigate({ to: "/purchase-orders/$id", params: { id: String(created.id) } });
    },
  });

  // The server names the entry it refused ("Line 2: …", "Set 1: …"): mark it, keep everything typed.
  const saveMessage = saveMutation.isError
    ? saveMutation.error instanceof Error ? saveMutation.error.message : "Failed to create the purchase order."
    : null;
  const refused = saveMessage ? entryForServerMessage(saveMessage) : null;
  const refusedLineKey = refused?.kind === "line" ? sentLines[refused.index]?.key : undefined;
  const refusedSetKey = refused?.kind === "set" ? sentSets[refused.index]?.key : undefined;
  const refusedHere = refusedLineKey !== undefined || refusedSetKey !== undefined;

  // Lines nobody started are dropped first, so "Line 2" in a server sentence is the second line on screen.
  function save() {
    if (lines.some(isBlankLine)) setLines((ls) => ls.filter((l) => !isBlankLine(l)));
    if (sets.some(isBlankSet)) setSets((ss) => ss.filter((s) => !isBlankSet(s)));
    saveMutation.mutate();
  }

  const categoryOf = (item: Item | undefined) => categories.find((c) => c.id === item?.category_id);
  const subcategoryOf = (item: Item | undefined) => subcategories.find((s) => s.id === item?.subcategory_id);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="New Purchase Order"
        description="The order and its lines on one screen. The Item decides the type of asset and serial rule; open More details only to change a line."
      />

      <section aria-label="Purchase order" className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {myCompanies.length > 1 && (
          <FormField htmlFor="company" label="Company" required>
            <SearchableSelect
              id="company"
              value={selectedCompanyId != null ? String(selectedCompanyId) : undefined}
              onValueChange={(v) => { setSelectedCompanyId(Number(v)); setCostCenterId(""); setDeliveryId(""); }}
              options={companyOptions(myCompanies)}
            />
          </FormField>
        )}
        <FormField htmlFor="po-number" label="PO No" required>
          <Input id="po-number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
        </FormField>
        <FormField htmlFor="po-date" label="PO Date" required>
          <Input id="po-date" type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
        </FormField>
        <FormField htmlFor="vendor" label="Vendor">
          <SearchableSelect
            id="vendor" value={vendorId || undefined} onValueChange={setVendorId} options={vendorOptions(vendors)}
            onCreateNew={may(caps, "vendor") ? () => setNewVendor(true) : undefined} createLabel="New Vendor…"
          />
          {capsSettled && vendorsQ.isSuccess && vendors.length === 0 && !may(caps, "vendor") && (
            <p className="text-xs text-muted-foreground" role="note">{ASK_TO_ADD.vendor}</p>
          )}
        </FormField>
        <FormField htmlFor="cost-center" label="Cost Centre" required>
          <SearchableSelect
            id="cost-center" value={costCenterId || undefined} onValueChange={setCostCenterId} options={costCentreOptions(costCenters)}
            onCreateNew={may(caps, "cost_centre") && selectedCompanyId != null ? () => setNewCostCenter(true) : undefined}
            createLabel="New Cost Centre…"
          />
          {capsSettled && costCentersQ.isSuccess && costCenters.length === 0 && (
            <p className="text-xs text-muted-foreground" role="note">
              {may(caps, "cost_centre")
                ? "This company has no cost centre yet. Add one with “New Cost Centre…” in the list."
                : `This company has no cost centre yet. ${ASK_TO_ADD.cost_centre}`}
            </p>
          )}
        </FormField>
        <FormField htmlFor="delivery-location" label="Received Into" helperText="The Stock Room the goods arrive at; receiving starts with it.">
          <StockRoomSelect id="delivery-location" companyId={selectedCompanyId} value={deliveryId} onValueChange={setDeliveryId} />
        </FormField>
      </section>

      <section aria-label="Lines" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Lines</h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="w-8 px-2 py-1.5 font-medium">#</th>
                <th className="min-w-56 px-2 py-1.5 font-medium">Item</th>
                <th className="w-24 px-2 py-1.5 font-medium">Quantity</th>
                <th className="w-32 px-2 py-1.5 font-medium">Unit Cost</th>
                <th className="w-20 px-2 py-1.5 font-medium">Tax %</th>
                <th className="w-32 px-2 py-1.5 text-right font-medium">Amount</th>
                <th className="w-36 px-2 py-1.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const item = itemById(l.itemId);
                const n = i + 1;
                const problem = isBlankLine(l) ? null : lineProblems.get(l.key) ?? null;
                const serverSaid = refusedLineKey === l.key ? saveMessage : null;
                const id = `line-${l.key}`;
                const category = categoryOf(item);
                const sub = subcategoryOf(item);
                const amount = (Number(l.quantity) || 0) * (Number(l.cost) || 0);
                return [
                  <tr key={`${l.key}-row`} aria-label={`Line ${n}`} className={`border-b align-top ${serverSaid ? "bg-destructive/5" : ""}`}>
                    <td className="px-2 py-1.5 text-xs tabular-nums text-muted-foreground">{n}</td>
                    <td className="px-2 py-1">
                      <SearchableSelect
                        id={`${id}-item`} aria-label={`Line ${n} Item`} value={l.itemId || undefined}
                        onValueChange={(v) => chooseItem(l.key, v)} options={itemSelectOptions} placeholder="Choose the Item"
                        onCreateNew={may(caps, "item") ? () => setNewItemFor(l.key) : undefined} createLabel="New Item…"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        id={`${id}-quantity`} aria-label={`Line ${n} Quantity`} type="number" min={1} max={MAX_QUANTITY} step={1}
                        value={l.quantity} onChange={(e) => patchLine(l.key, { quantity: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        id={`${id}-cost`} aria-label={`Line ${n} Unit Cost`} type="number" min={0} step="0.01"
                        value={l.cost} onChange={(e) => patchLine(l.key, { cost: e.target.value })}
                        onKeyDown={(e) => enterToNextLine(e, l.key)}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        id={`${id}-tax`} aria-label={`Line ${n} Tax %`} type="number" min={0} max={100}
                        value={l.tax} onChange={(e) => patchLine(l.key, { tax: e.target.value })}
                        onKeyDown={(e) => enterToNextLine(e, l.key)}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{amount > 0 ? money(amount) : "—"}</td>
                    <td className="px-2 py-1 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button" variant="ghost" size="sm" aria-expanded={l.open} aria-controls={`${id}-more`}
                          aria-label={`Line ${n}: more details`} onClick={() => patchLine(l.key, { open: !l.open })}
                        >
                          More details
                        </Button>
                        <Button
                          type="button" variant="ghost" size="icon" aria-label={`Remove line ${n}`}
                          disabled={lines.length === 1 && sets.length === 0}
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </tr>,
                  (l.open || problem || serverSaid) && (
                    <tr key={`${l.key}-more`} className="border-b bg-muted/20">
                      <td />
                      <td colSpan={6} className="px-2 py-2">
                        {problem && <p className="mb-1 text-xs text-destructive">Line {n}: {problem}.</p>}
                        {serverSaid && (
                          <p className="mb-1 text-xs font-medium text-destructive" role="alert" aria-label={`Line ${n} refused`}>{serverSaid}</p>
                        )}
                        {l.open && (
                          <div id={`${id}-more`} className="flex flex-col gap-2">
                            {item && (
                              <p className="flex flex-wrap gap-1.5 text-xs" aria-label={`Line ${n} from the Item`}>
                                <span className="rounded-full bg-muted px-2 py-0.5">{[category?.name, sub && sub.name !== item.name ? sub.name : null].filter(Boolean).join(" › ") || "Type of asset not set"}</span>
                                {category?.asset_domain && <span className="rounded-full bg-muted px-2 py-0.5">{workAreaLabel(category.asset_domain)}</span>}
                                <span className="rounded-full bg-muted px-2 py-0.5">
                                  {serialModeLabel(item.serial_later ? "SERIAL_LATER" : item.serial_required ? "HAS_SERIAL" : "NO_SERIAL")}
                                </span>
                              </p>
                            )}
                            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                              <FormField htmlFor={`${id}-description`} label="Description" className="col-span-2">
                                <Input
                                  id={`${id}-description`} value={l.description} placeholder={item?.name ?? ""}
                                  onChange={(e) => patchLine(l.key, { description: e.target.value, descriptionTouched: true })}
                                />
                              </FormField>
                              <FormField htmlFor={`${id}-barcode`} label="Barcode" helperText="Optional.">
                                <Input id={`${id}-barcode`} value={l.barcode} onChange={(e) => patchLine(l.key, { barcode: e.target.value })} />
                              </FormField>
                              <FormField htmlFor={`${id}-brand`} label="Brand">
                                <SearchableSelect
                                  id={`${id}-brand`} value={l.brandId || undefined}
                                  onValueChange={(v) => patchLine(l.key, { brandId: v, brandTouched: true })} options={brandSelectOptions}
                                  onCreateNew={may(caps, "brand") ? () => setNewBrandFor(l.key) : undefined} createLabel="New Brand…"
                                />
                              </FormField>
                              <FormField htmlFor={`${id}-model`} label="Model">
                                <Input id={`${id}-model`} value={l.model} onChange={(e) => patchLine(l.key, { model: e.target.value })} />
                              </FormField>
                              <FormField htmlFor={`${id}-warranty`} label="Warranty Years">
                                <Input
                                  id={`${id}-warranty`} type="number" min={0} step={1} value={l.warranty}
                                  onChange={(e) => patchLine(l.key, { warranty: e.target.value, warrantyTouched: true })}
                                />
                              </FormField>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>

        {sets.map((s, i) => {
          const bundle = bundleById(s.bundleId);
          const n = i + 1;
          const problem = isBlankSet(s) ? null : setProblems.get(s.key) ?? null;
          const serverSaid = refusedSetKey === s.key ? saveMessage : null;
          const id = `set-${s.key}`;
          const qty = Number(s.quantity) || 0;
          return (
            <div key={s.key} className={`flex flex-col gap-2 rounded-md border p-3 ${serverSaid ? "bg-destructive/5" : "bg-muted/20"}`} aria-label={`Set ${n}`}>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <FormField htmlFor={`${id}-bundle`} label="Set" required className="col-span-2">
                  <SearchableSelect
                    id={`${id}-bundle`} value={s.bundleId || undefined} onValueChange={(v) => chooseBundle(s.key, v)}
                    options={bundles.map((b) => ({ value: String(b.id), label: b.name }))} placeholder="Choose the set"
                  />
                </FormField>
                <FormField htmlFor={`${id}-quantity`} label="Quantity" required>
                  <Input id={`${id}-quantity`} type="number" min={1} max={MAX_QUANTITY} step={1} value={s.quantity} onChange={(e) => patchSet(s.key, { quantity: e.target.value })} />
                </FormField>
                <FormField htmlFor={`${id}-price`} label="Price per set" required>
                  <Input id={`${id}-price`} type="number" min={0.01} step="0.01" value={s.price} onChange={(e) => changeSetPrice(s.key, e.target.value)} />
                </FormField>
                <FormField htmlFor={`${id}-tax`} label="Tax %">
                  <Input id={`${id}-tax`} type="number" min={0} max={100} value={s.tax} onChange={(e) => patchSet(s.key, { tax: e.target.value })} />
                </FormField>
              </div>
              {bundlesQ.isSuccess && bundles.length === 0 && (
                <p className="text-xs text-muted-foreground" role="note">
                  {canManage(caps, "bundle")
                    ? "No sets are set up yet. Make one on an Item (Settings › Catalogue › Items, “Comes as a set”)."
                    : "No sets are set up yet. Ask the head-office admin to make one (an Item that “Comes as a set”)."}
                </p>
              )}
              {bundle && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {bundle.name}: {linesAndUnitsSentence(bundle.parts.length, bundle.parts.length * qty)} ({qty} of each part).
                  </p>
                  <SetPartAmounts
                    bundle={bundle} price={s.price} taxPercent={s.tax} amounts={s.amounts} labelPrefix={`Set ${n}`}
                    onAmountsChange={(amounts) => patchSet(s.key, { amounts })}
                  />
                </>
              )}
              {s.open && (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <FormField htmlFor={`${id}-description`} label="Description" className="col-span-2" helperText="Each part's line is named “Description - Part”.">
                    <Input id={`${id}-description`} value={s.description} placeholder={bundle?.name ?? ""} onChange={(e) => patchSet(s.key, { description: e.target.value })} />
                  </FormField>
                  <FormField htmlFor={`${id}-barcode`} label="Barcode" helperText="Optional.">
                    <Input id={`${id}-barcode`} value={s.barcode} onChange={(e) => patchSet(s.key, { barcode: e.target.value })} />
                  </FormField>
                  <FormField htmlFor={`${id}-warranty`} label="Warranty Years">
                    <Input id={`${id}-warranty`} type="number" min={0} step={1} value={s.warranty} onChange={(e) => patchSet(s.key, { warranty: e.target.value })} />
                  </FormField>
                </div>
              )}
              {problem && <p className="text-xs text-destructive">Set {n}: {problem}.</p>}
              {serverSaid && <p className="text-xs font-medium text-destructive" role="alert" aria-label={`Set ${n} refused`}>{serverSaid}</p>}
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" aria-expanded={s.open} aria-label={`Set ${n}: more details`} onClick={() => patchSet(s.key, { open: !s.open })}>
                  More details
                </Button>
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove set ${n}`} onClick={() => setSets((ss) => ss.filter((x) => x.key !== s.key))}>
                  Remove set
                </Button>
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => { const added = newLine(); setLines((ls) => [...ls, added]); setFocusLine(added.key); }}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add line
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setSets((ss) => [...ss, newSet()])}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add set
          </Button>
        </div>
      </section>

      {saveMessage && (
        <p className="text-sm text-destructive" role="alert">
          {refusedHere ? `The purchase order was not created. Fix the ${refused?.kind === "set" ? "set" : "line"} marked in red above, then save again.` : saveMessage}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-sm tabular-nums" aria-label="Purchase order total" role="status">
          {countWord(lineCount, "line")} · {countWord(unitCount, "unit")} · ₹{money(totalWithTax)} with tax
        </p>
        <div className="flex flex-col items-end gap-1">
          <AsyncButton onClick={save} disabled={!canSave} pending={saveMutation.isPending} pendingLabel="Saving…" aria-describedby="save-po-why">
            Save PO
          </AsyncButton>
          {!canSave && (
            <p id="save-po-why" className="text-xs text-muted-foreground">Still needed: {missing.join(", ")}.</p>
          )}
        </div>
      </div>

      <NewVendorDialog open={newVendor} onOpenChange={setNewVendor} onCreated={(row) => setVendorId(String(row.id))} />
      {selectedCompanyId != null && (
        <NewCostCenterDialog
          companyId={selectedCompanyId} open={newCostCenter} onOpenChange={setNewCostCenter}
          onCreated={(row) => setCostCenterId(String(row.id))}
        />
      )}
      <ItemFormDialog
        open={newItemFor !== null}
        onOpenChange={(open) => !open && setNewItemFor(null)}
        onSaved={(saved) => {
          if (newItemFor === null) return;
          // The new Item may not be in the loaded list yet: take its defaults from the saved record.
          const key = newItemFor;
          setLines((ls) => ls.map((l) => (l.key !== key ? l : {
            ...l, itemId: String(saved.id),
            description: l.descriptionTouched ? l.description : saved.name,
            brandId: l.brandTouched ? l.brandId : saved.default_brand_id ? String(saved.default_brand_id) : "",
            warranty: l.warrantyTouched ? l.warranty : saved.default_warranty_years != null ? String(saved.default_warranty_years) : "",
          })));
        }}
      />
      <NewBrandDialog
        open={newBrandFor !== null}
        onOpenChange={(open) => !open && setNewBrandFor(null)}
        onCreated={(row) => newBrandFor !== null && patchLine(newBrandFor, { brandId: String(row.id), brandTouched: true })}
      />
    </div>
  );
}
