import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Bundle } from "../bundles/bundle-parts";
import type { Item } from "../items/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ItemFormDialog } from "../items/ItemFormDialog";
import { NewBrandDialog, NewCostCenterDialog } from "@/components/quick-create/masters";
import { StockRoomSelect, useStockRooms } from "@/components/quick-create/StockRoomSelect";
import { brandOptions, companyOptions, costCentreOptions, itemOptions, namesById, placeOption, stockRoomOption, vendorOptions } from "@/lib/option-labels";
import { ASK_TO_ADD, canCreate as may, useCapabilities } from "@/lib/capabilities";
import { useRemember, useRememberedDefault } from "@/lib/remembered-defaults";
import { MAX_QUANTITY, quantityHint } from "@/lib/limits";
import { RATE_HIGH_FACTOR, RATE_LOW_FACTOR, lineIndexesForServerMessage } from "./erp-create-errors";
import { linesAndUnitsSentence } from "./po-list";
import { SetPartAmounts, partAmountsFor, partAmountsPayload, partTotal } from "./SetPartAmounts";

export type MapScope = "NONE" | "ARTICLE" | "NAME" | "CODE";
/** How far a "not tracked" decision reaches: one code, a product name, an Article, or a whole Department / Section / Division. */
export type NotTrackedScope = "CODE" | "NAME" | "ARTICLE" | "DEPARTMENT" | "SECTION" | "DIVISION";
export type SuggestedScope = "ARTICLE" | "NAME" | "CODE";

/** S3a-2: how a line's ERP code is decided. */
export interface LineResolution {
  state: "MATCHED" | "NEEDS_ITEM" | "NOT_TRACKED";
  item_id?: number | null;
  item_name?: string | null;
  via?: string | null;
  why?: string | null;
}

/** A line of the ERP PO that CKAM does not track, so it is left out of the draft. */
export interface UntrackedLine {
  item_code: string | null;
  description: string;
  quantity: number;
  rate: number;
  why: string | null;
  resolution?: LineResolution | null;
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
  // S3a-2 (additive)
  resolution?: LineResolution | null;
  suggested_item_id?: number | null;
  suggested_item_name?: string | null;
  suggestion_score?: number | null;
  suggested_scope?: SuggestedScope | null;
}

export interface ErpVendorInfo {
  code: string;
  name: string;
  gstin: string | null;
  pan?: string | null;
  group_key?: string | null;
}

export interface VendorSuggestion {
  vendor_id: number;
  name: string;
  gstin: string | null;
  reason: string;
}

export interface VendorRegistration {
  erp_code: string;
  name: string;
  gstin: string | null;
  linked: boolean;
  linked_vendor_id: number | null;
  linked_vendor_name: string | null;
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
  // S3a-2 (additive): the ERP supplier and how to match it when it is not linked yet.
  vendor?: { id: number; name: string } | null;
  vendor_linked?: boolean;
  erp_vendor?: ErpVendorInfo | null;
  vendor_suggestions?: VendorSuggestion[];
  vendor_registrations?: VendorRegistration[];
  readiness?: string;
  problems?: { kind: string; message: string; count?: number }[];
  undecided_item_count?: number;
}

/** What `POST /erp/pos/{po_code}/not-tracked` answers. */
interface NotTrackedResult {
  lines?: { item_code: string | null; description?: string; quantity?: number; resolution?: LineResolution | null }[];
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
  /** Position in the draft as read (stays the same when other lines leave as "not tracked"). */
  uid: number;
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

type VendorChoice = { action: "LINK"; vendor_id: number; name: string } | { action: "CREATE" };

const str = (v: number | null | undefined) => (v == null ? "" : String(v));
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "a", "a and b", "a, b and c". */
function andList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
const capitalised = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "Remember" in plain words (S3b-2). */
export const SCOPE_LABEL: Record<MapScope, string> = {
  ARTICLE: "Use this Item for every code in this ERP group",
  NAME: "Use this Item for this product name",
  CODE: "Use this Item for this code only",
  NONE: "Don't remember",
};

const MATCHED_BY: Record<string, string> = { CODE: "matched by code", NAME: "matched by product name", ARTICLE: "matched by ERP group" };

const REASON_WORDS: Record<string, string> = { GSTIN: "same GSTIN", PAN: "same company PAN", NAME: "same name" };
export const reasonWords = (reason: string | null | undefined) => (reason ? REASON_WORDS[reason.toUpperCase()] ?? reason.toLowerCase() : "");

/** The reaches this line can be remembered for (an Article and a product name are needed for the wider ones). */
function scopesFor(s: DraftLine): SuggestedScope[] {
  const out: SuggestedScope[] = [];
  if (s.article_key) out.push("ARTICLE");
  if (s.name_key) out.push("NAME");
  out.push("CODE");
  return out;
}

/** The server's suggested reach when it can be used here, else the widest one this line has. */
function defaultScope(s: DraftLine): SuggestedScope {
  const allowed = scopesFor(s);
  if (s.suggested_scope && allowed.includes(s.suggested_scope)) return s.suggested_scope;
  return allowed[0];
}

const needsItem = (s: DraftLine) => (s.resolution?.state ? s.resolution.state === "NEEDS_ITEM" : s.item_id === null);

/**
 * The review of one ERP purchase order, EXCEPTIONS ONLY (S3b-2): a one-line summary of the header (Change opens
 * it), matched lines folded to one row each (Details opens them), and only what needs a person open: a line with
 * no Item yet (suggestion, choose, new Item, not tracked, remember) and a supplier not matched to a vendor yet.
 * A sentence at the top says what is left; Create says why it is not ready.
 */
export function PoDraftCard({ draft, bundles, items }: { draft: Draft; bundles: Bundle[]; items: Item[] }) {
  const qc = useQueryClient();
  const { caps } = useCapabilities();
  const [companyId, setCompanyId] = useState(str(draft.company_id));
  // The PO number and date are the ERP's: shown, never edited.
  const poNumber = draft.po_number ?? "";
  const poDate = draft.po_date ?? "";
  const [costCenterId, setCostCenterId] = useState(str(draft.cost_center_id));
  const [deliveryId, setDeliveryId] = useState(str(draft.delivery_asset_user_id));
  // The header opens by itself when something in it is still missing.
  const [headerOpen, setHeaderOpen] = useState(draft.cost_center_id === null || draft.company_id === null);
  const itemById = (id: string) => items.find((i) => String(i.id) === id);
  const bundleOf = (itemId: string) => bundles.find((b) => b.id === itemById(itemId)?.bundle_id);
  const [lines, setLines] = useState<LineForm[]>(() =>
    draft.lines.map((l, uid) => {
      const bundle = bundles.find((b) => b.id === l.bundle_id);
      const scope = defaultScope(l);
      return {
        uid, src: l, description: l.description, barcode: l.barcode, quantity: String(l.quantity), rate: String(l.rate),
        taxPercent: String(l.tax_percent), warrantyYears: String(l.warranty_years), brandId: str(l.brand_id), model: l.model ?? "",
        itemId: str(l.item_id), partAmounts: partAmountsFor(bundle, l.rate),
        // A line still to decide is remembered by default, as far as the server suggests.
        mapScope: needsItem(l) ? scope : "NONE",
        notTrackedScope: scope,
      };
    }),
  );
  const [leftOut, setLeftOut] = useState<UntrackedLine[]>(draft.untracked_lines ?? []);
  const [openDetails, setOpenDetails] = useState<Set<number>>(new Set());

  // The ERP supplier: matched to a vendor here, or still to match (inside this PO's own create).
  const vendorUnmatched = draft.vendor_linked === false || (draft.vendor_linked === undefined && draft.vendor_id === null);
  const [vendorChoice, setVendorChoice] = useState<VendorChoice | null>(null);
  const siblings = (draft.vendor_registrations ?? []).filter((r) => !r.linked && r.erp_code !== draft.erp_vendor?.code);
  const [alsoLink, setAlsoLink] = useState(false);

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
  const stockRoomsQ = useStockRooms(companyId === "" ? null : Number(companyId));
  const companies = Array.isArray(companiesQ.data) ? companiesQ.data : [];
  const vendors = Array.isArray(vendorsQ.data) ? vendorsQ.data : [];
  const [newItemFor, setNewItemFor] = useState<number | null>(null);
  const [newBrandFor, setNewBrandFor] = useState<number | null>(null);
  const [newCostCenter, setNewCostCenter] = useState(false);
  // The ERP's suggested delivery place, kept in the list even if it is not a stock room.
  const draftDelivery = draft.delivery_candidates.find((c) => c.id === draft.delivery_asset_user_id);
  const deliveryExtra = draftDelivery && companyId === str(draft.company_id) ? [placeOption(draftDelivery)] : [];

  // Smart defaults, only where the ERP draft did not say: the Cost Centre and stock room used last.
  const rememberChoice = useRemember();
  useRememberedDefault({
    kind: "cost_centre", companyId, value: costCenterId, setValue: setCostCenterId,
    validIds: (costCentersQ.data ?? []).map((c) => c.id), ready: costCentersQ.isSuccess,
  });
  useRememberedDefault({
    kind: "stock_room", companyId, value: deliveryId, setValue: setDeliveryId,
    validIds: stockRoomsQ.rows.map((r) => r.id), ready: stockRoomsQ.isSuccess,
  });
  const itemSelectOptions = useMemo(
    () => itemOptions(items, { categories: namesById(categoriesQ.data), subcategories: namesById(subcategoriesQ.data) }),
    [items, categoriesQ.data, subcategoriesQ.data],
  );
  const brandSelectOptions = useMemo(() => brandOptions(brandsQ.data), [brandsQ.data]);

  function setLine(uid: number, patch: Partial<LineForm>) {
    setLines((ls) => ls.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  }
  function toggleDetails(uid: number) {
    setOpenDetails((s) => {
      const next = new Set(s);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  }
  function changeItem(uid: number, itemId: string) {
    const before = lines.find((l) => l.uid === uid);
    if (!before) return;
    const s = before.src;
    // A line still to decide keeps its reach. Changing the Item of a line that was already matched only
    // changes that decision for the head-office admin; anyone else remembers it for this code only.
    const scope: MapScope = needsItem(s)
      ? before.mapScope === "NONE" ? "NONE" : before.mapScope
      : itemId === str(s.item_id) ? "NONE" : caps?.is_head_office_admin ? (s.matched_by ?? defaultScope(s)) : "CODE";
    setLine(uid, { itemId, partAmounts: partAmountsFor(bundleOf(itemId), before.rate), mapScope: scope });
  }
  function changeRate(uid: number, rate: string) {
    const l = lines.find((x) => x.uid === uid);
    setLine(uid, { rate, partAmounts: partAmountsFor(bundleOf(l?.itemId ?? ""), rate) });
  }

  function lineProblem(l: LineForm): string | null {
    if (l.itemId === "") return "choose the Item";
    if (l.description.trim() === "") return "description is required";
    if (l.barcode.trim() === "") return "barcode is required";
    const q = Number(l.quantity);
    if (l.quantity.trim() === "" || !(q >= 1) || !Number.isInteger(q)) return "quantity must be a whole number, at least 1";
    if (q > MAX_QUANTITY) return `quantity can be at most ${MAX_QUANTITY.toLocaleString("en-IN")} on one line`;
    if (q > l.src.quantity) return `quantity cannot be more than the ${l.src.quantity.toLocaleString("en-IN")} the ERP still has open`;
    if (!(Number(l.rate) > 0)) return "cost must be more than 0";
    const erpRate = l.src.rate;
    if (erpRate > 0) {
      const low = erpRate * RATE_LOW_FACTOR;
      const high = erpRate * RATE_HIGH_FACTOR;
      if (Number(l.rate) < low || Number(l.rate) > high) {
        return `cost must be between ${money(low)} and ${money(high)} (half to double the ERP rate of ${money(erpRate)})`;
      }
    }
    const bundle = bundleOf(l.itemId);
    if (bundle && Math.abs(partTotal(bundle, l.partAmounts) - Number(l.rate)) >= 0.005) {
      return `the part amounts must add up to ${money(Number(l.rate))}`;
    }
    return null;
  }
  const problems = new Map(lines.map((l) => [l.uid, lineProblem(l)]));
  const alreadyCreated = draft.already_created_id !== null;

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ po_id: number; po_number: string; lines_created: number; units_created?: number }>("/erp/pos/create", {
        // erp_po_code is always sent: the server re-reads this ERP purchase order and takes the number and date from it.
        erp_po_code: draft.erp_po_code, company_id: Number(companyId), po_number: poNumber.trim(), po_date: poDate,
        // A supplier not matched yet sends how to match it instead of a vendor (done in the same create).
        ...(vendorUnmatched
          ? {
              vendor_choice: {
                ...(vendorChoice?.action === "LINK" ? { action: "LINK", vendor_id: vendorChoice.vendor_id } : { action: "CREATE" }),
                also_link_codes: alsoLink ? siblings.map((r) => r.erp_code) : [],
              },
            }
          : { vendor_id: draft.vendor_id }),
        cost_center_id: Number(costCenterId),
        delivery_asset_user_id: deliveryId ? Number(deliveryId) : null, warehouse_code: draft.warehouse_code,
        lines: lines.map((l) => {
          const bundle = bundleOf(l.itemId);
          const keep = l.mapScope !== "NONE";
          // The reach the server suggested is its default: only a different one is spelled out.
          const scope = keep && !(l.src.suggested_scope && l.mapScope === l.src.suggested_scope) ? l.mapScope : null;
          return {
            item_code: l.src.item_code, description: l.description.trim(), barcode: l.barcode.trim(),
            quantity: Number(l.quantity), rate: Number(l.rate), tax_percent: Number(l.taxPercent) || 0,
            warranty_years: Number(l.warrantyYears) || 0, item_id: Number(l.itemId),
            brand_id: !bundle && l.brandId ? Number(l.brandId) : null, model: !bundle && l.model ? l.model : null,
            bundle_parts: bundle ? partAmountsPayload(bundle, l.partAmounts) : null,
            remember: keep,
            map_scope: scope,
            article_key: keep ? l.src.article_key : null, article_name: keep ? l.src.article_name : null,
            section: keep ? l.src.section : null, department: keep ? l.src.department : null, name_key: keep ? l.src.name_key : null,
          };
        }),
      }),
    onSuccess: () => {
      rememberChoice(companyId, "cost_centre", costCenterId);
      rememberChoice(companyId, "stock_room", deliveryId);
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["erp", "pos"] });
      qc.invalidateQueries({ queryKey: ["erp", "inbox"] });
      if (vendorUnmatched) qc.invalidateQueries({ queryKey: ["masters", "vendors"] });
    },
  });

  // "Not tracked": CKAM does not manage this (a cable, a hanger). Saved as a rule for this PO's company; the lines it
  // covers leave the review and are listed under "left out".
  const notTrackedMutation = useMutation({
    mutationFn: (l: LineForm) =>
      apiClient.post<NotTrackedResult>(`/erp/pos/${draft.erp_po_code}/not-tracked`, { icode: l.src.item_code, scope: l.notTrackedScope }),
    onSuccess: (result, l) => {
      const codes = new Set<string>([(l.src.item_code ?? "").toUpperCase()]);
      for (const r of result?.lines ?? []) {
        if (r.resolution?.state === "NOT_TRACKED" && r.item_code) codes.add(r.item_code.toUpperCase());
      }
      const leaving = lines.filter((x) => codes.has((x.src.item_code ?? "").toUpperCase()));
      setLines((ls) => ls.filter((x) => !codes.has((x.src.item_code ?? "").toUpperCase())));
      setLeftOut((out) => [
        ...out,
        ...leaving.map((x) => ({
          item_code: x.src.item_code, description: x.src.description, quantity: x.src.quantity, rate: x.src.rate,
          why: NOT_TRACKED_WHY[l.notTrackedScope] ?? null,
        })),
      ]);
      qc.invalidateQueries({ queryKey: ["erp", "pos"] });
      qc.invalidateQueries({ queryKey: ["erp", "inbox"] });
      qc.invalidateQueries({ queryKey: ["items"] });
    },
  });
  const notTrackedChoices = (s: DraftLine): { value: NotTrackedScope; label: string }[] => {
    const out: { value: NotTrackedScope; label: string }[] = [{ value: "CODE", label: "This ERP code only" }];
    if (s.name_key) out.push({ value: "NAME", label: "This product name" });
    if (s.article_key) out.push({ value: "ARTICLE", label: "Every code in this ERP group" });
    // Whole Departments / Sections / Divisions are the head-office admin's (server rule).
    if (caps?.is_head_office_admin) {
      if (s.department) out.push({ value: "DEPARTMENT", label: `The whole Department ${s.department}` });
      if (s.section) out.push({ value: "SECTION", label: `The whole Section ${s.section}` });
      if (s.division) out.push({ value: "DIVISION", label: `The whole Division ${s.division}` });
    }
    return out;
  };

  const created = createMutation.data;
  const locked = !!created;
  // S4: the server answers lines_created (lines: one per draft line, one per part of a set) and
  // units_created. An older server sent only lines_created, holding the UNIT count; then the lines
  // are counted from the draft as before.
  const createdLines = created
    ? typeof created.units_created === "number"
      ? created.lines_created
      : lines.reduce((n, l) => n + (bundleOf(l.itemId)?.parts.length ?? 1), 0)
    : 0;
  const createdUnits = created ? (typeof created.units_created === "number" ? created.units_created : created.lines_created) : 0;
  // The server checks the draft against the ERP again; when it refuses one line its sentence is shown under that line.
  const createMessage = createMutation.isError
    ? createMutation.error instanceof Error ? createMutation.error.message : "Failed to create the purchase order."
    : null;
  const serverLineIdx = createMessage ? lineIndexesForServerMessage(createMessage, lines.map((l) => l.src.item_code)) : [];
  const serverLineUids = serverLineIdx.map((i) => lines[i]?.uid).filter((u): u is number => u !== undefined);
  const vendorShown = vendors.find((v) => v.id === draft.vendor_id)?.name ?? draft.vendor?.name ?? draft.vendor_name ?? "";
  const categoryName = (id: number) => categoriesQ.data?.find((c) => c.id === id)?.name ?? "";
  const subcategoryName = (id: number | null) => (id ? subcategoriesQ.data?.find((s) => s.id === id)?.name ?? "" : "");
  const costCentreText = (costCentersQ.data ?? []).find((c) => String(c.id) === costCenterId);
  const deliveryRow = stockRoomsQ.rows.find((r) => String(r.id) === deliveryId);
  const deliveryText = deliveryRow ? stockRoomOption(deliveryRow).label : draftDelivery && String(draftDelivery.id) === deliveryId ? draftDelivery.name : "";
  const poValue = lines.reduce((t, l) => t + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);

  // What is left before Create, in plain words.
  const todo: string[] = [];
  if (vendorUnmatched && !vendorChoice) todo.push("match the vendor");
  const needItemCount = lines.filter((l) => l.itemId === "").length;
  if (needItemCount > 0) todo.push(`${needItemCount} ${needItemCount === 1 ? "line needs" : "lines need"} an Item`);
  if (companyId === "") todo.push("choose the company");
  if (costCenterId === "") todo.push("choose the Cost Centre");
  const otherBad = lines.filter((l) => { const p = problems.get(l.uid); return p && p !== "choose the Item"; }).length;
  if (otherBad > 0) todo.push(`fix ${otherBad === 1 ? "1 line" : `${otherBad} lines`} marked in red`);
  if (lines.length === 0) todo.push("keep at least one line CKAM tracks");
  const canCreate = !alreadyCreated && todo.length === 0;
  const leftSentence = alreadyCreated
    ? "This purchase order was already created here."
    : todo.length > 0
      ? `${capitalised(andList(todo))}, then you can create the PO.`
      : "Everything is ready: check and create the PO.";

  const vendorRefusal = createMessage && serverLineIdx.length === 0 && vendorUnmatched ? createMessage : null;

  function renderDetails(l: LineForm, i: number) {
    const bundle = bundleOf(l.itemId);
    const item = itemById(l.itemId);
    const id = `${poNumber}-line-${i}`;
    const s = l.src;
    const showItem = !needsItem(s);
    const changed = !needsItem(s) && l.itemId !== str(s.item_id);
    return (
      <div className="grid grid-cols-6 gap-2 border-t pt-2">
        {showItem && (
          <>
            <FormField
              htmlFor={`${id}-item`} label="Item" required className="col-span-3"
              helperText={item ? [categoryName(item.category_id), subcategoryName(item.subcategory_id)].filter(Boolean).join(" › ") : undefined}
            >
              <SearchableSelect
                id={`${id}-item`} value={l.itemId || undefined} onValueChange={(v) => changeItem(l.uid, v)}
                options={itemSelectOptions} placeholder="Choose the Item"
                onCreateNew={may(caps, "item") ? () => setNewItemFor(l.uid) : undefined} createLabel="New Item…"
              />
            </FormField>
            {changed ? (
              <FormField htmlFor={`${id}-scope`} label="Remember" className="col-span-3">
                <SearchableSelect
                  id={`${id}-scope`} value={l.mapScope} onValueChange={(v) => setLine(l.uid, { mapScope: v as MapScope })}
                  options={[...scopesFor(s), "NONE" as const].map((m) => ({ value: m, label: SCOPE_LABEL[m] }))}
                />
              </FormField>
            ) : <div className="col-span-3" />}
          </>
        )}
        <FormField htmlFor={`${id}-description`} label="Description" required className="col-span-3">
          <Input id={`${id}-description`} value={l.description} onChange={(e) => setLine(l.uid, { description: e.target.value })} />
        </FormField>
        <FormField htmlFor={`${id}-barcode`} label="Barcode" required>
          <Input id={`${id}-barcode`} value={l.barcode} onChange={(e) => setLine(l.uid, { barcode: e.target.value })} />
        </FormField>
        <FormField
          htmlFor={`${id}-quantity`} label="Quantity" required
          helperText={
            s.quantity <= MAX_QUANTITY
              ? `The ERP has ${s.quantity.toLocaleString("en-IN")} open: 1 to ${s.quantity.toLocaleString("en-IN")}.`
              : `${quantityHint()} The ERP has ${s.quantity.toLocaleString("en-IN")} open.`
          }
        >
          <Input
            id={`${id}-quantity`} type="number" min={1} max={Math.min(MAX_QUANTITY, s.quantity)} step={1}
            value={l.quantity} onChange={(e) => setLine(l.uid, { quantity: e.target.value })}
          />
        </FormField>
        <FormField
          htmlFor={`${id}-rate`} label={bundle ? "Price per set" : "Cost per unit"} required
          helperText={s.rate > 0 ? `ERP rate ${money(s.rate)}; keep within half to double.` : undefined}
        >
          <Input id={`${id}-rate`} type="number" min={0.01} step="0.01" value={l.rate} onChange={(e) => changeRate(l.uid, e.target.value)} />
        </FormField>
        <FormField htmlFor={`${id}-tax`} label="Tax %">
          <Input id={`${id}-tax`} type="number" min={0} value={l.taxPercent} onChange={(e) => setLine(l.uid, { taxPercent: e.target.value })} />
        </FormField>
        <FormField htmlFor={`${id}-warranty`} label="Warranty Years">
          <Input id={`${id}-warranty`} type="number" min={0} step={1} value={l.warrantyYears} onChange={(e) => setLine(l.uid, { warrantyYears: e.target.value })} />
        </FormField>
        {bundle ? (
          <div className="col-span-6 flex flex-col gap-1 text-sm">
            <p className="text-xs text-muted-foreground">
              {item?.name} is a set: becomes {bundle.parts.length} line{bundle.parts.length === 1 ? "" : "s"},{" "}
              {bundle.parts.length * (Number(l.quantity) || 0)} units ({Number(l.quantity) || 0} of each part).
            </p>
            <SetPartAmounts
              bundle={bundle} price={l.rate} taxPercent={l.taxPercent} amounts={l.partAmounts} labelPrefix={`Line ${i + 1}`}
              onAmountsChange={(partAmounts) => setLine(l.uid, { partAmounts })}
            />
          </div>
        ) : (
          <>
            <FormField htmlFor={`${id}-brand`} label="Brand" className="col-span-2">
              <SearchableSelect
                id={`${id}-brand`} value={l.brandId || undefined} onValueChange={(v) => setLine(l.uid, { brandId: v })}
                options={brandSelectOptions}
                onCreateNew={may(caps, "brand") ? () => setNewBrandFor(l.uid) : undefined} createLabel="New Brand…"
              />
            </FormField>
            <FormField htmlFor={`${id}-model`} label="Model" className="col-span-2">
              <Input id={`${id}-model`} value={l.model} onChange={(e) => setLine(l.uid, { model: e.target.value })} />
            </FormField>
          </>
        )}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4" aria-label={`Draft ${draft.po_number ?? "purchase order"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {poNumber || "Purchase order"}{" "}
          <span className="text-xs font-normal text-muted-foreground">from the ERP (PO code {draft.erp_po_code})</span>
        </h2>
        {created && (
          <p className="text-sm text-success" role="status">
            PO created: {linesAndUnitsSentence(createdLines, createdUnits)}.{" "}
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
        {/* One line for the header; Change opens it. */}
        <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4" aria-label="Purchase order summary">
            <div><dt className="text-xs text-muted-foreground">PO</dt><dd className="font-medium">{poNumber || "—"} · {poDate || "—"}</dd></div>
            <div>
              <dt className="text-xs text-muted-foreground">Vendor</dt>
              <dd>
                {vendorUnmatched
                  ? <span className="text-on-warning-soft">{draft.erp_vendor?.name ?? draft.vendor_name ?? "ERP supplier"} · needs matching</span>
                  : vendorShown || "—"}
              </dd>
            </div>
            <div><dt className="text-xs text-muted-foreground">Company</dt><dd>{draft.company_name ?? draft.company_code ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Cost Centre</dt><dd>{costCentreText ? costCentreText.name : <span className="text-destructive">Not chosen</span>}</dd></div>
            <div>
              <dt className="text-xs text-muted-foreground">Received Into</dt>
              <dd>{deliveryText || (draft.warehouse ? <span className="text-muted-foreground">{draft.warehouse} (ERP)</span> : "—")}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Lines</dt>
              <dd className="tabular-nums">{lines.length}{leftOut.length > 0 ? ` (+${leftOut.length} left out)` : ""}</dd>
            </div>
            <div><dt className="text-xs text-muted-foreground">Value</dt><dd className="tabular-nums">₹{money(poValue)}</dd></div>
          </dl>
          <Button type="button" size="sm" variant="ghost" aria-expanded={headerOpen} onClick={() => setHeaderOpen((o) => !o)}>
            {headerOpen ? "Done" : "Change"}
          </Button>
        </div>

        {headerOpen && (
          <div className="grid grid-cols-3 gap-2" aria-label="Purchase order header">
            <FormField htmlFor={`${poNumber}-company`} label="Company" required>
              {draft.company_id !== null ? (
                <Input id={`${poNumber}-company`} value={draft.company_name ?? draft.company_code ?? ""} readOnly aria-readonly="true" className="bg-muted/40" />
              ) : (
                <SearchableSelect
                  id={`${poNumber}-company`} value={companyId || undefined}
                  onValueChange={(v) => { setCompanyId(v); setCostCenterId(""); setDeliveryId(""); }}
                  options={companyOptions(companies)}
                />
              )}
            </FormField>
            <FormField htmlFor={`${poNumber}-po-number`} label="PO No" helperText="From the ERP.">
              <Input id={`${poNumber}-po-number`} value={poNumber} readOnly aria-readonly="true" className="bg-muted/40" />
            </FormField>
            <FormField htmlFor={`${poNumber}-po-date`} label="PO Date" helperText="From the ERP.">
              <Input id={`${poNumber}-po-date`} type="date" value={poDate} readOnly aria-readonly="true" className="bg-muted/40" />
            </FormField>
            <FormField htmlFor={`${poNumber}-cost-center`} label="Cost Centre" required>
              <SearchableSelect
                id={`${poNumber}-cost-center`} value={costCenterId || undefined} onValueChange={setCostCenterId}
                options={costCentreOptions(costCentersQ.data)}
                onCreateNew={may(caps, "cost_centre") && companyId !== "" ? () => setNewCostCenter(true) : undefined} createLabel="New Cost Centre…"
              />
              {costCentersQ.isSuccess && (costCentersQ.data ?? []).length === 0 && !may(caps, "cost_centre") && caps && (
                <p className="text-xs text-muted-foreground" role="note">{ASK_TO_ADD.cost_centre}</p>
              )}
            </FormField>
            <FormField
              htmlFor={`${poNumber}-delivery`} label="Received Into" className="col-span-2"
              helperText={draft.warehouse ? `Location in the ERP: ${draft.warehouse}. The Stock Room the delivery goes to.` : "The Stock Room the delivery goes to."}
            >
              <StockRoomSelect
                id={`${poNumber}-delivery`} companyId={companyId === "" ? null : Number(companyId)}
                value={deliveryId} onValueChange={setDeliveryId} extraOptions={deliveryExtra}
              />
            </FormField>
          </div>
        )}

        {vendorUnmatched && !alreadyCreated && (
          <section className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm" aria-label="Vendor needs matching">
            <h3 className="font-semibold">Vendor needs matching</h3>
            <p className="text-xs">
              In the ERP: <span className="font-medium">{draft.erp_vendor?.name ?? draft.vendor_name ?? "this supplier"}</span>
              {draft.erp_vendor?.gstin ? <> · GSTIN <span className="font-mono">{draft.erp_vendor.gstin}</span></> : null}
              {draft.erp_vendor?.code ? <> · ERP code {draft.erp_vendor.code}</> : null}
            </p>
            {vendorChoice ? (
              <div className="flex flex-wrap items-center gap-2" role="status" aria-label="Vendor choice">
                <span>
                  {vendorChoice.action === "LINK"
                    ? `Will be linked to ${vendorChoice.name} when the PO is created.`
                    : `A new vendor is made from the ERP supplier (name, GSTIN, contact) when the PO is created.`}
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setVendorChoice(null)}>Change</Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {(draft.vendor_suggestions ?? []).map((sg) => (
                  <Button
                    key={sg.vendor_id} type="button" size="sm" variant="outline"
                    onClick={() => setVendorChoice({ action: "LINK", vendor_id: sg.vendor_id, name: sg.name })}
                  >
                    Link to {sg.name}{sg.reason ? ` (${reasonWords(sg.reason)})` : ""}
                  </Button>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={() => setVendorChoice({ action: "CREATE" })}>
                  Create new vendor
                </Button>
                <div className="w-64">
                  <SearchableSelect
                    id={`${poNumber}-link-vendor`} aria-label="Link to another vendor" value={undefined}
                    placeholder="Or link to another vendor…" options={vendorOptions(vendors)}
                    onValueChange={(v) => {
                      const row = vendors.find((x) => String(x.id) === v);
                      if (row) setVendorChoice({ action: "LINK", vendor_id: row.id, name: row.name });
                    }}
                  />
                </div>
              </div>
            )}
            {siblings.length > 0 && (
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={alsoLink} onCheckedChange={(v) => setAlsoLink(v === true)} aria-label={`Also link the other ${siblings.length} registrations`} />
                Also link the other {siblings.length} registration{siblings.length === 1 ? "" : "s"} of this supplier (same PAN):{" "}
                {siblings.map((r) => `${r.name} (${r.erp_code})`).join(", ")}
              </label>
            )}
            {vendorRefusal && <p className="text-xs font-medium text-destructive" role="alert">{vendorRefusal}</p>}
          </section>
        )}

        <p className="text-sm" aria-label="What is left" role="note">
          <span className={todo.length > 0 && !alreadyCreated ? "font-medium" : "text-muted-foreground"}>{leftSentence}</span>
        </p>

        <div className="flex flex-col gap-2">
          {lines.map((l, i) => {
            const s = l.src;
            const item = itemById(l.itemId);
            const bundle = bundleOf(l.itemId);
            const problem = problems.get(l.uid) ?? null;
            const exception = needsItem(s);
            const serverSaid = serverLineUids.includes(l.uid) && createMessage ? createMessage : null;
            const detailsOpen = openDetails.has(l.uid) || (problem !== null && problem !== "choose the Item") || serverSaid !== null;
            const id = `${poNumber}-line-${i}`;
            const scopeOptions = [...scopesFor(s), "NONE" as const].map((m) => ({ value: m, label: SCOPE_LABEL[m] }));
            const suggestion = s.suggested_item_id != null ? items.find((x) => x.id === s.suggested_item_id) : undefined;
            return (
              <div
                key={l.uid}
                className={`flex flex-col gap-2 rounded-md border p-2.5 ${exception ? "border-warning/60 bg-warning/5" : "bg-background"}`}
                aria-label={`Line ${i + 1}`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="font-medium">{exception && !item ? (s.erp_name || s.description) : item?.name ?? s.item_name ?? s.description}</span>
                  <span className="tabular-nums">{Number(l.quantity) || 0} × {money(Number(l.rate) || 0)}</span>
                  <span className="text-xs text-muted-foreground">Tax {Number(l.taxPercent) || 0}%</span>
                  {bundle && <span className="text-xs text-muted-foreground">Set: {linesAndUnitsSentence(bundle.parts.length, bundle.parts.length * (Number(l.quantity) || 0))}</span>}
                  {exception
                    ? <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs">{l.itemId ? "Item chosen" : "Needs an Item"}</span>
                    : l.itemId === str(s.item_id) && s.matched_by && <span className="text-xs text-muted-foreground">{MATCHED_BY[s.matched_by]}</span>}
                  <Button
                    type="button" size="sm" variant="ghost" className="ml-auto" aria-expanded={detailsOpen}
                    aria-label={`Line ${i + 1}: details`} onClick={() => toggleDetails(l.uid)}
                  >
                    Details
                  </Button>
                </div>

                {exception && (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                      <span>
                        ERP code <span className="font-mono text-foreground">{s.item_code || "—"}</span>
                        {s.section && <> · {s.section} › {s.department} › {s.article_name}</>}
                      </span>
                      {s.erp_description && <span>In the ERP: <span className="text-foreground">{s.erp_description}</span></span>}
                    </div>
                    {s.warnings.length > 0 && (
                      <ul className="list-disc rounded-md border border-warning/50 bg-warning/10 p-2 pl-6 text-xs">
                        {s.warnings.map((w) => <li key={w}>{w}</li>)}
                      </ul>
                    )}
                    {s.suggested_item_id != null && l.itemId !== String(s.suggested_item_id) && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span>
                          Suggested: <span className="font-medium">{s.suggested_item_name ?? suggestion?.name}</span>
                          {s.suggestion_score != null ? <span className="text-muted-foreground"> ({Math.round(s.suggestion_score * 100)}% match)</span> : null}
                        </span>
                        <Button
                          type="button" size="sm" variant="outline" aria-label={`Line ${i + 1}: use the suggestion ${s.suggested_item_name ?? ""}`.trim()}
                          disabled={!suggestion} onClick={() => changeItem(l.uid, String(s.suggested_item_id))}
                        >
                          Use suggestion
                        </Button>
                      </div>
                    )}
                    <div className="grid grid-cols-6 gap-2">
                      <FormField
                        htmlFor={`${id}-item`} label="Item" required className="col-span-3"
                        helperText={item ? [categoryName(item.category_id), subcategoryName(item.subcategory_id)].filter(Boolean).join(" › ") : "Choose the Item, or add a new one."}
                      >
                        <SearchableSelect
                          id={`${id}-item`} value={l.itemId || undefined} onValueChange={(v) => changeItem(l.uid, v)}
                          options={itemSelectOptions} placeholder="Choose Item"
                          onCreateNew={may(caps, "item") ? () => setNewItemFor(l.uid) : undefined} createLabel="New Item…"
                        />
                      </FormField>
                      <FormField htmlFor={`${id}-scope`} label="Remember" className="col-span-3">
                        <SearchableSelect
                          id={`${id}-scope`} value={l.mapScope} onValueChange={(v) => setLine(l.uid, { mapScope: v as MapScope })}
                          options={scopeOptions}
                        />
                      </FormField>
                    </div>
                    {s.item_code && (
                      <div className="flex flex-wrap items-end gap-2" aria-label={`Line ${i + 1} not tracked`}>
                        <span className="pb-2 text-xs text-muted-foreground">Not something CKAM tracks (a cable, a hanger)?</span>
                        <div className="w-64">
                          <SearchableSelect
                            id={`${id}-not-tracked-scope`} aria-label={`Line ${i + 1}: how far this reaches`} value={l.notTrackedScope}
                            onValueChange={(v) => setLine(l.uid, { notTrackedScope: v as NotTrackedScope })}
                            options={notTrackedChoices(s)}
                          />
                        </div>
                        <AsyncButton
                          type="button" variant="outline" size="sm" pending={notTrackedMutation.isPending && notTrackedMutation.variables?.uid === l.uid}
                          pendingLabel="Saving…" aria-label={`Line ${i + 1}: not tracked`} onClick={() => notTrackedMutation.mutate(l)}
                        >
                          Not tracked
                        </AsyncButton>
                      </div>
                    )}
                  </div>
                )}

                {detailsOpen && renderDetails(l, i)}
                {problem && (exception ? problem !== "choose the Item" || !l.itemId : true) && (
                  <p className="text-xs text-destructive">Line {i + 1}: {problem}.</p>
                )}
                {serverSaid && (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-medium text-destructive" role="alert" aria-label={`Line ${i + 1} refused`}>{serverSaid}</p>
                    {/Remember this choice for this code only/i.test(serverSaid) && l.mapScope !== "CODE" && (
                      <Button type="button" size="sm" variant="outline" onClick={() => { setLine(l.uid, { mapScope: "CODE" }); createMutation.reset(); }}>
                        Remember for this code only
                      </Button>
                    )}
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
                {leftOut.map((u, k) => (
                  <li key={`${u.item_code}-${u.description}-${k}`}>
                    <span className="font-mono">{u.item_code}</span> {u.description} · {u.quantity} × {money(u.rate)}
                    {u.why && <span className="text-muted-foreground"> · {u.why}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </fieldset>

      {createMessage && !vendorRefusal && (
        <p className="text-sm text-destructive" role="alert">
          {serverLineIdx.length > 0
            ? `The purchase order was not created. Fix ${serverLineIdx.length === 1 ? `line ${serverLineIdx[0] + 1}` : "the lines"} marked in red above, then try again.`
            : createMessage}
        </p>
      )}

      <ItemFormDialog
        open={newItemFor !== null}
        onOpenChange={(open) => !open && setNewItemFor(null)}
        // Start from the ERP's own words for this product.
        initialName={(() => {
          const src = lines.find((l) => l.uid === newItemFor)?.src;
          return src ? src.erp_name || src.article_name || undefined : undefined;
        })()}
        onSaved={(saved) => newItemFor !== null && changeItem(newItemFor, String(saved.id))}
      />
      <NewBrandDialog
        open={newBrandFor !== null}
        onOpenChange={(open) => !open && setNewBrandFor(null)}
        onCreated={(row) => newBrandFor !== null && setLine(newBrandFor, { brandId: String(row.id) })}
      />
      {companyId !== "" && (
        <NewCostCenterDialog
          companyId={Number(companyId)} open={newCostCenter} onOpenChange={setNewCostCenter}
          onCreated={(row) => setCostCenterId(String(row.id))}
        />
      )}
      {!locked && (
        <div className="flex flex-col items-start gap-1">
          <AsyncButton
            onClick={() => createMutation.mutate()} disabled={!canCreate} pending={createMutation.isPending} pendingLabel="Creating…"
            aria-describedby={`${poNumber}-create-why`}
          >
            Create this purchase order
          </AsyncButton>
          {!canCreate && (
            <p id={`${poNumber}-create-why`} className="text-xs text-muted-foreground">
              {alreadyCreated ? "This purchase order was already created here." : `Create is not available yet: ${andList(todo)}.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

const NOT_TRACKED_WHY: Record<NotTrackedScope, string> = {
  CODE: "Code", NAME: "Product name", ARTICLE: "ERP group", DEPARTMENT: "Department", SECTION: "Section", DIVISION: "Division",
};
