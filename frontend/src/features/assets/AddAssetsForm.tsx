import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Minus, Plus } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { serialModeLabel, workAreaLabel } from "@/lib/labels";
import { MAX_QUANTITY, quantityHint } from "@/lib/limits";
import { computeWarrantyUpto } from "@/lib/warranty";
import { cn } from "@/lib/utils";
import {
  brandOptions, companyOptions, costCentreOptions, itemOptions, namesById, vendorOptions,
} from "@/lib/option-labels";
import { ASK_TO_ADD, canCreate as may, useCapabilities } from "@/lib/capabilities";
import { useRemember, useRememberedDefault } from "@/lib/remembered-defaults";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { ErrorState } from "@/components/shared/ErrorState";
import { NewBrandDialog, NewCostCenterDialog, NewVendorDialog } from "@/components/quick-create/masters";
import { StockRoomSelect, useStockRooms } from "@/components/quick-create/StockRoomSelect";
import type { Item } from "../items/types";
import { ItemFormDialog } from "../items/ItemFormDialog";
import { PrintLabelsAction } from "../labels/PrintLabelsAction";
import { useDebounced } from "../purchase-orders/po-list";
import { SerialBox } from "../receive/SerialBox";
import { useSerialConflicts } from "../receive/useSerialConflicts";
import { SERIAL_MODES, problemsFrom, serialEntries, todayIso, type SerialMode } from "../receive/receive-model";
import {
  type AddInput, type AddProblem, type CustomFieldDef, type ProblemPlace,
  applicableFields, buildAddBody, checkAdd, defaultDescription, emptyInput, itemSerialMode, problemPlace,
  refusalSummary, whyNotSentence,
} from "./add-assets-model";

interface Named {
  id: number;
  name: string;
  code?: string | null;
  gstin?: string | null;
}
interface CategoryRow extends Named {
  asset_domain?: string | null;
}

interface BatchResult {
  assets_created: number;
  serial_pending: number;
  assets: { asset_id: number; asset_code: string; serial_number: string | null; serial_pending: boolean }[];
  label_asset_ids: number[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
const asArray = <T,>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);
/** How long typing in the serial box settles before the box is checked again. */
const CHECK_DELAY_MS = 150;
/** New asset codes listed in the result before "and N more". */
const CODES_SHOWN = 20;
/** The register opens at most this many assets by id (the server's `ids=` limit). */
const OPEN_IDS_MAX = 200;

/**
 * Add Assets (S5b-1): one Item, how many, where they go -- and serial numbers
 * only when the Item has them. Everything the Item decides (group, work area,
 * serial rule, brand and warranty defaults) is shown, never asked. Purchase
 * details and the rarely-needed fields are folded away. 1 or 1,000 assets are
 * the same few actions; the server checks the whole batch first and writes it
 * all-or-nothing (POST /api/assets/batch).
 */
export function AddAssetsScreen({ companyId }: { companyId: number | null }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<BatchResult | null>(null);
  const [formKey, setFormKey] = useState(0);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <PageHeader title="Add Assets" description="Assets that did not come on a purchase order: choose the Item, how many and where they go." />
      {result ? (
        <ResultPanel
          result={result}
          onAddMore={() => {
            setResult(null);
            setFormKey((k) => k + 1);
          }}
        />
      ) : (
        <AddAssetsForm
          key={formKey}
          homeCompanyId={companyId}
          onAdded={(r) => {
            setResult(r);
            qc.invalidateQueries({ queryKey: ["assets"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
              try { window.scrollTo({ top: 0 }); } catch { /* jsdom */ }
            }
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

function AddAssetsForm({ homeCompanyId, onAdded }: { homeCompanyId: number | null; onAdded: (r: BatchResult) => void }) {
  const [input, setInput] = useState<AddInput>(emptyInput);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [serverProblems, setServerProblems] = useState<AddProblem[]>([]);
  const [serverSummary, setServerSummary] = useState<string | null>(null);
  const [otherError, setOtherError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState(false);
  const [newBrand, setNewBrand] = useState(false);
  const [newVendor, setNewVendor] = useState(false);
  const [newCostCenter, setNewCostCenter] = useState(false);
  // An Item made right here is known before the list reloads.
  const [madeItems, setMadeItems] = useState<Item[]>([]);

  // Company: the home company, or the first one this person works in; a picker only for more than one.
  const [companyId, setCompanyId] = useState<number | null>(homeCompanyId);
  const myCompaniesQ = useQuery({ queryKey: ["asset_users", "me", "companies"], queryFn: () => apiClient.get<Named[]>("/asset-users/me/companies") });
  const myCompanies = asArray<Named>(myCompaniesQ.data);
  if (companyId === null && myCompanies.length > 0) setCompanyId(myCompanies[0].id);

  const { caps, settled: capsSettled } = useCapabilities();
  const itemsQ = useQuery({ queryKey: ["items", "mine"], queryFn: () => apiClient.get<Item[]>("/items?work_area=mine") });
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<CategoryRow[]>("/masters/categories") });
  const subcategoriesQ = useQuery({ queryKey: ["masters", "subcategories"], queryFn: () => apiClient.get<Named[]>("/masters/subcategories") });
  const costCentersQ = useQuery({
    queryKey: ["masters", "cost-centers", companyId],
    queryFn: () => apiClient.get<Named[]>(`/masters/cost-centers?company_id=${companyId}`),
    enabled: companyId != null,
  });
  const brandsQ = useQuery({ queryKey: ["masters", "brands"], queryFn: () => apiClient.get<Named[]>("/masters/brands") });
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Named[]>("/masters/vendors") });
  const customFieldsQ = useQuery({ queryKey: ["masters", "custom-fields"], queryFn: () => apiClient.get<CustomFieldDef[]>("/masters/custom-fields") });
  const rooms = useStockRooms(companyId);

  const items = useMemo(() => {
    const listed = asArray<Item>(itemsQ.data);
    return [...listed, ...madeItems.filter((m) => !listed.some((i) => i.id === m.id))];
  }, [itemsQ.data, madeItems]);
  const categories = asArray<CategoryRow>(categoriesQ.data);
  const subcategories = asArray<Named>(subcategoriesQ.data);
  const costCenters = asArray<Named>(costCentersQ.data);
  const brands = asArray<Named>(brandsQ.data);
  const vendors = asArray<Named>(vendorsQ.data);
  const categoryNames = useMemo(() => namesById(categories), [categories]);
  const subcategoryNames = useMemo(() => namesById(subcategories), [subcategories]);
  const fields = useMemo(() => applicableFields(customFieldsQ.data, companyId), [customFieldsQ.data, companyId]);
  const requiredFields = fields.filter((f) => f.is_required);
  const optionalFields = fields.filter((f) => !f.is_required);

  const item = items.find((i) => String(i.id) === input.itemId) ?? null;
  const itemMode = itemSerialMode(item);
  const brandName = brands.find((b) => String(b.id) === input.brandId)?.name ?? null;

  const loadError = [itemsQ, costCentersQ, customFieldsQ].some((q) => q.isError);

  // Smart defaults: the Cost Centre and stock room this person used last for this company.
  const rememberChoice = useRemember();
  useRememberedDefault({
    kind: "cost_centre", companyId, value: input.costCenterId,
    setValue: (v) => setInput((s) => ({ ...s, costCenterId: v })), validIds: costCenters.map((c) => c.id), ready: costCentersQ.isSuccess,
  });
  useRememberedDefault({
    kind: "stock_room", companyId, value: input.receivedInto,
    setValue: (v) => setInput((s) => ({ ...s, receivedInto: v })), validIds: rooms.rows.map((r) => r.id), ready: rooms.isSuccess,
  });

  /** Changes part of the form; a refusal about that part is cleared (the rest stays marked). */
  function edit(patch: Partial<AddInput>, places: ProblemPlace[] = []) {
    setInput((s) => ({ ...s, ...patch }));
    if (places.length > 0) setServerProblems((ps) => ps.filter((p) => !places.includes(problemPlace(p, fields))));
    setOtherError(null);
  }

  // Picking an Item sets the serial rule to the Item's and starts the brand and warranty from its defaults.
  function chooseItem(next: Item | undefined) {
    if (!next) return;
    setInput((s) => ({
      ...s,
      itemId: String(next.id),
      mode: null,
      brandId: next.default_brand_id ? String(next.default_brand_id) : "",
      warrantyYears: next.default_warranty_years != null ? String(next.default_warranty_years) : "",
    }));
    setServerProblems((ps) => ps.filter((p) => !["item", "serials", "advanced"].includes(problemPlace(p, fields))));
    setOtherError(null);
  }

  // The serial box is checked once typing settles (a 100-row paste is checked once, not per key).
  const settledText = useDebounced(input.serialText, CHECK_DELAY_MS);
  const checkedInput = useMemo(() => ({ ...input, serialText: settledText }), [input, settledText]);
  const preCheck = checkAdd(checkedInput, item, fields);
  const typed = useMemo(
    () => (preCheck.mode === "HAS_SERIAL" ? [...new Set(serialEntries(settledText).map((e) => e.value))].filter((v) => v.toLowerCase() !== "n/a") : []),
    [preCheck.mode, settledText],
  );
  const conflicts = useSerialConflicts(typed);
  const check = checkAdd(checkedInput, item, fields, conflicts, serverProblems);
  const reasons = check.reasons;
  const qty = check.qty;

  const problemsAt = (place: ProblemPlace) => serverProblems.filter((p) => problemPlace(p, fields) === place).map((p) => p.message);

  const addMutation = useMutation({
    mutationFn: () => apiClient.post<BatchResult>("/assets/batch", buildAddBody(input, item, fields)),
    onSuccess: (r) => {
      rememberChoice(companyId, "cost_centre", input.costCenterId);
      rememberChoice(companyId, "stock_room", input.receivedInto);
      onAdded(r);
    },
    onError: (err) => {
      const problems = problemsFrom<AddProblem>(err);
      if (problems && problems.length > 0) {
        setServerProblems(problems);
        setServerSummary(refusalSummary(problems));
        setOtherError(null);
        const places = problems.map((p) => problemPlace(p, fields));
        if (places.includes("purchase")) setPurchaseOpen(true);
        if (places.includes("advanced") || (places.includes("fields") && optionalFields.length > 0)) setAdvancedOpen(true);
      } else {
        setServerProblems([]);
        setServerSummary(null);
        setOtherError(err instanceof Error ? err.message : "Nothing was added. Please try again.");
      }
    },
  });

  function submit() {
    if (addMutation.isPending) return;
    // The very latest serial text too (the settled check may be a moment behind the typing).
    if (checkAdd(input, item, fields, conflicts).reasons.length > 0) return;
    setServerSummary(null);
    addMutation.mutate();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (reasons.length === 0) submit();
    }
  }

  if (loadError) {
    return (
      <ErrorState
        message="Couldn't load what this form needs."
        onRetry={() => { itemsQ.refetch(); costCentersQ.refetch(); customFieldsQ.refetch(); }}
      />
    );
  }

  const category = item ? categories.find((c) => c.id === item.category_id) : undefined;
  const groupText = item
    ? [item.category_name ?? categoryNames[item.category_id], item.subcategory_name ?? (item.subcategory_id ? subcategoryNames[item.subcategory_id] : undefined)]
        .filter((p, i, all) => p && (i === 0 || p !== all[0]))
        .join(" › ")
    : "";
  const itemArea = item ? (item.work_area ?? category?.asset_domain ?? null) : null;
  const qtyNum = Number(input.quantity);
  const step = (delta: number) => {
    const base = Number.isInteger(qtyNum) ? qtyNum : 1;
    edit({ quantity: String(Math.min(MAX_QUANTITY, Math.max(1, base + delta))) }, ["quantity", "serials"]);
  };
  const descriptionDefault = defaultDescription(item?.name, brandName, input.model);
  const warrantyUpto = computeWarrantyUpto(input.invoiceDate, Number(input.warrantyYears) || 0);
  const purchaseCost = Number(input.purchaseCost) || 0;
  const taxAmount = Math.round(purchaseCost * (Number(input.taxPercent) || 0)) / 100;
  const countId = "add-serials-count";
  const serialServerMessages = problemsAt("serials").filter((m) => !check.serials.messages.includes(m));
  const perUnitFields = fields.filter((f) => f.field_type !== "checkbox");
  const purchaseFilled = [input.vendorId, input.poNumber, input.poDate, input.invoiceNumber, input.invoiceDate, input.invoiceAmount, input.purchaseCost, input.taxPercent]
    .filter((v) => v.trim() !== "").length;

  const perUnitToggle = perUnitFields.length > 0 && qty > 1 ? (
    <PerUnitValues fields={perUnitFields} qty={qty} input={input} onChange={(patch) => edit(patch, ["fields"])} />
  ) : null;

  return (
    <div className="flex flex-col gap-4" onKeyDown={onKeyDown}>
      {/* --- Essential --- */}
      <section className="flex flex-col gap-3 rounded-md border p-3" aria-labelledby="add-essential-heading">
        <h2 id="add-essential-heading" className="text-sm font-semibold">What and where</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {myCompanies.length > 1 && (
            <Field id="company" label="Company" required className="sm:col-span-2" help="The cost centres and stock rooms below are this company's.">
              <SearchableSelect
                id="company"
                aria-label="Company"
                value={companyId != null ? String(companyId) : undefined}
                onValueChange={(v) => {
                  edit({ costCenterId: "", receivedInto: "" }, ["costCentre", "received"]);
                  setCompanyId(Number(v));
                }}
                options={companyOptions(myCompanies)}
              />
            </Field>
          )}
          <Field
            id="item" label="Item" required className="sm:col-span-2"
            problems={problemsAt("item")}
            help={item ? undefined : "What these assets are. The Item decides their group, work area and serial number rule."}
          >
            <SearchableSelect
              id="item"
              aria-label="Item"
              value={input.itemId || undefined}
              onValueChange={(v) => chooseItem(items.find((i) => String(i.id) === v))}
              disabled={itemsQ.isLoading}
              options={itemOptions(items, { categories: categoryNames, subcategories: subcategoryNames })}
              placeholder="Choose the Item"
              searchPlaceholder="Search Items…"
              onCreateNew={may(caps, "item") ? () => setNewItem(true) : undefined}
              createLabel="New Item…"
            />
            {item && (
              <div className="flex flex-wrap gap-1.5" aria-label="What the Item decides">
                {groupText && <Chip title="Type of asset">{groupText}</Chip>}
                {itemArea && <Chip title="Work area">{workAreaLabel(itemArea)}</Chip>}
                <Chip title="Serial number rule">{serialModeLabel(itemMode)}</Chip>
              </div>
            )}
            {!itemsQ.isLoading && capsSettled && itemsQ.isSuccess && items.length === 0 && !may(caps, "item") && (
              <p className="text-xs text-muted-foreground" role="note">{ASK_TO_ADD.item}</p>
            )}
          </Field>
          <Field id="quantity" label="Quantity" required problems={problemsAt("quantity")} error={check.qtyProblem ?? undefined} help={quantityHint()}>
            <div className="flex items-center gap-1">
              <Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" tabIndex={-1} aria-label="One less" disabled={!(qtyNum > 1)} onClick={() => step(-1)}>
                <Minus className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Input
                id="quantity" aria-label="Quantity" type="number" inputMode="numeric" min={1} max={MAX_QUANTITY} step={1}
                className={cn("h-9 text-center tabular-nums", check.qtyProblem && "border-destructive")}
                aria-invalid={!!check.qtyProblem || undefined}
                value={input.quantity}
                onChange={(e) => edit({ quantity: e.target.value }, ["quantity", "serials"])}
              />
              <Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" tabIndex={-1} aria-label="One more" disabled={qtyNum >= MAX_QUANTITY} onClick={() => step(1)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </Field>
          <Field id="received-into" label="Received Into" required problems={problemsAt("received")} help="The Stock Room the assets go to.">
            <StockRoomSelect
              id="received-into"
              aria-label="Received Into"
              companyId={companyId}
              value={input.receivedInto}
              onValueChange={(v) => edit({ receivedInto: v }, ["received"])}
            />
          </Field>
          <Field id="cost-center" label="Cost Centre" required problems={problemsAt("costCentre")}>
            <SearchableSelect
              id="cost-center"
              aria-label="Cost Centre"
              value={input.costCenterId || undefined}
              onValueChange={(v) => edit({ costCenterId: v }, ["costCentre"])}
              disabled={costCentersQ.isLoading && companyId != null}
              options={costCentreOptions(costCenters)}
              placeholder="Choose the Cost Centre"
              onCreateNew={may(caps, "cost_centre") && companyId != null ? () => setNewCostCenter(true) : undefined}
              createLabel="New Cost Centre…"
            />
            {capsSettled && costCentersQ.isSuccess && costCenters.length === 0 && (
              <p className="text-xs text-muted-foreground" role="note">
                {may(caps, "cost_centre")
                  ? "This company has no cost centre yet. Add one with “New Cost Centre…” in the list."
                  : `This company has no cost centre yet. ${ASK_TO_ADD.cost_centre}`}
              </p>
            )}
          </Field>
        </div>
      </section>

      {/* --- Identification: by the serial rule --- */}
      {item && (
        <section className="flex flex-col gap-2 rounded-md border p-3" aria-labelledby="add-serial-heading">
          <h2 id="add-serial-heading" className="text-sm font-semibold">Identification</h2>
          <div role="radiogroup" aria-label="Serial number rule" className="flex flex-wrap items-center gap-1.5">
            {SERIAL_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={check.mode === m}
                onClick={() => edit({ mode: m === itemMode ? null : (m as SerialMode) }, ["serials"])}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-xs",
                  check.mode === m ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                )}
              >
                {serialModeLabel(m)}
              </button>
            ))}
          </div>
          {check.mode !== itemMode && (
            <p className="text-xs text-muted-foreground">Changed for these assets only; the Item says “{serialModeLabel(itemMode)}”.</p>
          )}
          {check.mode === "HAS_SERIAL" && qty > 0 && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="add-serials" className="text-xs">
                Serial numbers ({plural(qty, "asset")})<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
              </Label>
              <SerialBox
                id="add-serials"
                label="Serial numbers"
                text={input.serialText}
                onChange={(t) => edit({ serialText: t }, ["serials"])}
                badRows={check.serials.badRows}
                rows={qty}
                describedBy={countId}
                placeholder="One serial per line — paste a list or scan; each scan goes on a new line."
              />
              <p id={countId} className={cn("text-xs", check.serials.countProblem || check.serials.badRows.size > 0 ? "text-destructive" : "text-muted-foreground")}>
                {check.serials.entries.length} of {qty} entered
                {check.serials.entries.length > qty ? ` — ${check.serials.entries.length - qty} too many, remove ${check.serials.entries.length - qty === 1 ? "it" : "them"}` : ""}
              </p>
            </div>
          )}
          {check.mode === "SERIAL_LATER" && (
            <p className="text-xs text-muted-foreground">Serial numbers will be entered later from Assets &gt; Serial Pending.</p>
          )}
          <ProblemList label="Problems with the serial numbers" items={[...check.serials.messages, ...serialServerMessages]} />
        </section>
      )}

      {/* --- Required extra fields: prominent, never folded away --- */}
      {requiredFields.length > 0 && (
        <section className="flex flex-col gap-3 rounded-md border p-3" aria-labelledby="add-fields-heading">
          <div>
            <h2 id="add-fields-heading" className="text-sm font-semibold">Needed for every asset</h2>
            <p className="text-xs text-muted-foreground">
              Your company asks for these on every asset, so they are filled in once here and copied onto each one.
            </p>
          </div>
          <FieldInputs fields={requiredFields} input={input} messages={check.fieldMessages} onChange={(patch) => edit(patch, ["fields"])} />
          {perUnitToggle}
          <ProblemList label="Problems with the extra fields" items={problemsAt("fields")} />
        </section>
      )}

      {/* --- Purchase details (optional, folded) --- */}
      <Fold
        id="add-purchase"
        title="Purchase details"
        hint={purchaseFilled > 0 ? `${purchaseFilled} filled in` : "Optional: vendor, PO and invoice"}
        open={purchaseOpen}
        onToggle={() => setPurchaseOpen((o) => !o)}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="vendor" label="Vendor" className="sm:col-span-2 lg:col-span-3">
            <SearchableSelect
              id="vendor"
              aria-label="Vendor"
              value={input.vendorId || undefined}
              onValueChange={(v) => edit({ vendorId: v }, ["purchase"])}
              options={vendorOptions(vendors)}
              placeholder="Choose the vendor"
              onCreateNew={may(caps, "vendor") ? () => setNewVendor(true) : undefined}
              createLabel="New Vendor…"
            />
            {capsSettled && vendorsQ.isSuccess && vendors.length === 0 && !may(caps, "vendor") && (
              <p className="text-xs text-muted-foreground" role="note">{ASK_TO_ADD.vendor}</p>
            )}
          </Field>
          <Field id="po-number" label="PO No">
            <Input id="po-number" aria-label="PO No" value={input.poNumber} onChange={(e) => edit({ poNumber: e.target.value }, ["purchase"])} />
          </Field>
          <Field id="po-date" label="PO Date">
            <Input id="po-date" aria-label="PO Date" type="date" max={todayIso()} value={input.poDate} onChange={(e) => edit({ poDate: e.target.value }, ["purchase"])} />
          </Field>
          <Field id="invoice-number" label="Invoice No">
            <Input id="invoice-number" aria-label="Invoice No" value={input.invoiceNumber} onChange={(e) => edit({ invoiceNumber: e.target.value }, ["purchase"])} />
          </Field>
          <Field id="invoice-date" label="Invoice Date" help="Also the purchase date (today when left empty).">
            <Input id="invoice-date" aria-label="Invoice Date" type="date" max={todayIso()} value={input.invoiceDate} onChange={(e) => edit({ invoiceDate: e.target.value }, ["purchase"])} />
          </Field>
          <Field id="invoice-amount" label="Invoice Amount" help="The invoice total.">
            <Input id="invoice-amount" aria-label="Invoice Amount" type="number" inputMode="decimal" min={0} step="0.01" value={input.invoiceAmount} onChange={(e) => edit({ invoiceAmount: e.target.value }, ["purchase"])} />
          </Field>
          <Field id="purchase-cost" label="Cost per asset">
            <Input id="purchase-cost" aria-label="Cost per asset" type="number" inputMode="decimal" min={0} step="0.01" value={input.purchaseCost} onChange={(e) => edit({ purchaseCost: e.target.value }, ["purchase"])} />
          </Field>
          <Field id="tax-percent" label="Tax %">
            <Input id="tax-percent" aria-label="Tax %" type="number" inputMode="decimal" min={0} max={100} step="0.01" value={input.taxPercent} onChange={(e) => edit({ taxPercent: e.target.value }, ["purchase"])} />
          </Field>
        </div>
        {purchaseCost > 0 && (
          <p className="text-xs text-muted-foreground">
            Per asset: tax <span data-testid="tax-amount">{taxAmount.toFixed(2)}</span>, total <span data-testid="total-cost">{(purchaseCost + taxAmount).toFixed(2)}</span> (preview).
          </p>
        )}
        <ProblemList label="Problems with the purchase details" items={[...check.purchaseMessages, ...problemsAt("purchase")]} />
      </Fold>

      {/* --- Advanced (optional, folded) --- */}
      <Fold
        id="add-advanced"
        title="Advanced"
        hint="Optional: brand, model, warranty, description, barcode, old asset code, extra fields"
        open={advancedOpen}
        onToggle={() => setAdvancedOpen((o) => !o)}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="brand" label="Brand" help={item?.default_brand_id ? "Starts as the Item's brand." : undefined}>
            <SearchableSelect
              id="brand"
              aria-label="Brand"
              value={input.brandId || undefined}
              onValueChange={(v) => edit({ brandId: v }, ["advanced"])}
              options={brandOptions(brands)}
              placeholder="No brand"
              onCreateNew={may(caps, "brand") ? () => setNewBrand(true) : undefined}
              createLabel="New Brand…"
            />
          </Field>
          <Field id="model" label="Model">
            <Input id="model" aria-label="Model" value={input.model} onChange={(e) => edit({ model: e.target.value }, ["advanced"])} />
          </Field>
          <Field
            id="warranty-years" label="Warranty years"
            help={warrantyUpto && Number(input.warrantyYears) > 0 ? `Warranty until ${warrantyUpto} (preview).` : item?.default_warranty_years != null ? "Starts as the Item's warranty." : "Leave empty for no warranty."}
          >
            <Input id="warranty-years" aria-label="Warranty years" type="number" inputMode="numeric" min={0} step={1} value={input.warrantyYears} onChange={(e) => edit({ warrantyYears: e.target.value }, ["advanced"])} />
          </Field>
          <Field id="description" label="Description" help="Leave empty to use the Item name, brand and model.">
            <Input
              id="description" aria-label="Description" value={input.description}
              placeholder={descriptionDefault || "Item name, brand and model"}
              onChange={(e) => edit({ description: e.target.value }, ["advanced"])}
            />
          </Field>
          <Field id="barcode" label="Barcode" help="Labels use the Asset Code unless a barcode is given here.">
            <Input id="barcode" aria-label="Barcode" value={input.barcode} onChange={(e) => edit({ barcode: e.target.value }, ["advanced"])} />
          </Field>
          {qty === 1 && (
            <Field id="legacy-code" label="Old asset code" help="Only when adding one asset that had a code in the previous system.">
              <Input id="legacy-code" aria-label="Old asset code" value={input.legacyCode} onChange={(e) => edit({ legacyCode: e.target.value }, ["advanced"])} />
            </Field>
          )}
        </div>
        {optionalFields.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-muted-foreground">Extra fields</h3>
            <FieldInputs fields={optionalFields} input={input} messages={check.fieldMessages} onChange={(patch) => edit(patch, ["fields"])} />
            {requiredFields.length === 0 && perUnitToggle}
          </div>
        )}
        <ProblemList label="Problems with these details" items={problemsAt("advanced")} />
      </Fold>

      <ItemFormDialog
        open={newItem}
        onOpenChange={setNewItem}
        onSaved={(saved) => {
          setMadeItems((m) => [...m, saved]);
          chooseItem(saved);
        }}
      />
      <NewBrandDialog open={newBrand} onOpenChange={setNewBrand} onCreated={(row) => edit({ brandId: String(row.id) })} />
      <NewVendorDialog open={newVendor} onOpenChange={setNewVendor} onCreated={(row) => edit({ vendorId: String(row.id) })} />
      {companyId != null && (
        <NewCostCenterDialog companyId={companyId} open={newCostCenter} onOpenChange={setNewCostCenter} onCreated={(row) => edit({ costCenterId: String(row.id) })} />
      )}

      {/* --- Always-reachable action bar --- */}
      <div className="sticky bottom-0 z-20 -mx-4 -mb-4 flex flex-col gap-1.5 border-t bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:-mb-6 md:px-6">
        {serverSummary && <p className="text-sm font-medium text-destructive" role="alert">{serverSummary}</p>}
        <ProblemList label="Other problems" items={problemsAt("general")} />
        {otherError && <p className="text-sm text-destructive" role="alert">{otherError}</p>}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p id="add-why" className={cn("min-w-0 text-xs", reasons.length > 0 ? "text-foreground" : "text-muted-foreground")} role="status">
            {reasons.length > 0
              ? <><span className="font-medium">Why can't I add? </span>{whyNotSentence(reasons)}</>
              : "Ready. Ctrl+Enter also adds."}
          </p>
          <AsyncButton
            className="w-full shrink-0 sm:w-auto"
            onClick={submit}
            disabled={reasons.length > 0}
            pending={addMutation.isPending}
            pendingLabel="Adding…"
            aria-describedby="add-why"
            title="Ctrl+Enter"
          >
            {qty > 0 ? `Add ${plural(qty, "asset")}` : "Add assets"}
          </AsyncButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

function Field({ id, label, required, help, error, problems = [], className, children }: {
  id: string;
  label: string;
  required?: boolean;
  help?: string;
  error?: string;
  problems?: string[];
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <Label htmlFor={id} className="text-xs">
        {label}
        {required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
      {problems.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-destructive" role="alert" aria-label={`Problems with ${label}`}>
          {problems.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
    </div>
  );
}

function Chip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span className="rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground" title={title}>
      <span className="sr-only">{title}: </span>
      {children}
    </span>
  );
}

function ProblemList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-destructive" role="alert" aria-label={label}>
      {items.map((m, i) => <li key={i}>{m}</li>)}
    </ul>
  );
}

function Fold({ id, title, hint, open, onToggle, children }: {
  id: string;
  title: string;
  hint: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-md border p-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-sm font-semibold">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 text-left"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={onToggle}
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {title}
          <span className="ml-1 truncate text-xs font-normal text-muted-foreground">{hint}</span>
        </button>
      </h2>
      {open && <div id={`${id}-body`} className="flex flex-col gap-3">{children}</div>}
    </section>
  );
}

function FieldInputs({ fields, input, messages, onChange }: {
  fields: CustomFieldDef[];
  input: AddInput;
  messages: Record<string, string>;
  onChange: (patch: Partial<AddInput>) => void;
}) {
  const setValue = (key: string, v: string | boolean) => onChange({ fieldValues: { ...input.fieldValues, [key]: v } });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const id = `udf-${f.field_key}`;
        if (f.field_type === "checkbox") {
          return (
            <label key={f.field_key} className="flex items-center gap-2 text-sm sm:pt-5">
              <Checkbox id={id} aria-label={f.label} checked={input.fieldValues[f.field_key] === true} onCheckedChange={(c) => setValue(f.field_key, c === true)} />
              {f.label}
            </label>
          );
        }
        const value = typeof input.fieldValues[f.field_key] === "string" ? (input.fieldValues[f.field_key] as string) : "";
        return (
          <Field key={f.field_key} id={id} label={f.label} required={f.is_required} error={messages[f.field_key]}>
            {f.field_type === "dropdown" ? (
              <Select value={value || undefined} onValueChange={(v) => setValue(f.field_key, v)}>
                <SelectTrigger id={id} aria-label={f.label}>
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  {(f.options?.choices ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={id}
                aria-label={f.label}
                type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                value={value}
                onChange={(e) => setValue(f.field_key, e.target.value)}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}

function PerUnitValues({ fields, qty, input, onChange }: {
  fields: CustomFieldDef[];
  qty: number;
  input: AddInput;
  onChange: (patch: Partial<AddInput>) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
        aria-expanded={input.perUnit}
        onClick={() => onChange({ perUnit: !input.perUnit })}
      >
        {input.perUnit ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
        Different values per asset
      </button>
      {input.perUnit && (
        <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-2">
          <p className="text-xs text-muted-foreground">
            One value per row, in the same order as the serial numbers (row 1 = the first asset). Leave a row blank to use the value above.
          </p>
          {fields.map((f) => {
            const id = `udf-${f.field_key}-per-asset`;
            return (
              <div key={id} className="flex flex-col gap-1">
                <Label htmlFor={id} className="text-xs">{f.label} — one per asset ({plural(qty, "asset")})</Label>
                <Textarea
                  id={id}
                  rows={Math.min(Math.max(qty, 2), 6)}
                  wrap="off"
                  className="font-mono text-sm"
                  value={input.unitValues[f.field_key] ?? ""}
                  onChange={(e) => onChange({ unitValues: { ...input.unitValues, [f.field_key]: e.target.value } })}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// After adding
// ---------------------------------------------------------------------------

function ResultPanel({ result, onAddMore }: { result: BatchResult; onAddMore: () => void }) {
  const navigate = useNavigate();
  const assets = Array.isArray(result.assets) ? result.assets : [];
  const created = result.assets_created ?? assets.length;
  const ids = result.label_asset_ids?.length ? result.label_asset_ids : assets.map((a) => a.asset_id);
  const openIds = ids.slice(0, OPEN_IDS_MAX);
  return (
    <section className="flex flex-col gap-3 rounded-md border border-success/40 bg-success-soft/40 p-4" aria-label="Added">
      <div className="flex flex-col gap-0.5" role="status">
        <p className="text-base font-semibold">{plural(created, "asset")} created</p>
        {result.serial_pending > 0 && (
          <p className="text-sm">
            {plural(result.serial_pending, "serial number")} pending — enter {result.serial_pending === 1 ? "it" : "them"} later from Assets &gt; Serial Pending.
          </p>
        )}
        <p className="text-sm">Labels ready.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <PrintLabelsAction assetIds={ids} variant="default" size="default">Print labels ({ids.length})</PrintLabelsAction>
        <Button variant="outline" onClick={() => navigate({ to: "/assets", search: { ids: openIds.join(",") } })}>
          Open assets
        </Button>
        <Button variant="outline" onClick={onAddMore}>Add more</Button>
      </div>
      {ids.length > OPEN_IDS_MAX && (
        <p className="text-xs text-muted-foreground">Open assets shows the first {OPEN_IDS_MAX}; all {ids.length} are in the register.</p>
      )}
      {assets.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">New asset codes</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs" aria-label="New asset codes">
            {assets.slice(0, CODES_SHOWN).map((a) => (
              <li key={a.asset_id}>
                <Link to="/assets/$id" params={{ id: String(a.asset_id) }} className="underline">{a.asset_code}</Link>
              </li>
            ))}
          </ul>
          {assets.length > CODES_SHOWN && <p className="text-xs text-muted-foreground">and {assets.length - CODES_SHOWN} more</p>}
        </div>
      )}
    </section>
  );
}
