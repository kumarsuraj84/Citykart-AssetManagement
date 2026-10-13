/**
 * Add Assets (S5b-1): the rules of the batch form, kept pure (no React) so they
 * are cheap to run on every key press and easy to test -- what the Item says,
 * what is still missing ("Why can't I add?"), the request body
 * (POST /api/assets/batch) and how a refused batch's `problems` map back onto
 * the screen.
 *
 * Serial lists are split once per check and compared with Maps (never one
 * serial against every other), so 1,000 serials stay instant -- the same
 * helpers the Receive screen uses.
 */
import { MAX_QUANTITY, quantityProblem } from "@/lib/limits";
import { serialConflictSentence } from "../purchase-orders/serial-conflict";
import type { Item } from "../items/types";
import { andNumbers, serialEntries, todayIso, unitValueRows, type SerialEntry, type SerialMode } from "../receive/receive-model";

export type { SerialMode };

/** A custom field definition as `GET /masters/custom-fields` returns it. */
export interface CustomFieldDef {
  id: number;
  field_key: string;
  label: string;
  field_type: "text" | "number" | "date" | "dropdown" | "checkbox";
  options: { choices?: string[] } | null;
  is_required: boolean;
  sort_order: number;
  /** null = every company; otherwise only that company's assets. */
  company_id: number | null;
}

/** The serial rule the Item sets (the default; the person may change it for this batch). */
export function itemSerialMode(item: Pick<Item, "serial_required" | "serial_later"> | null | undefined): SerialMode {
  if (!item) return "HAS_SERIAL";
  if (item.serial_required === false) return "NO_SERIAL";
  return item.serial_later === true ? "SERIAL_LATER" : "HAS_SERIAL";
}

/** The fields that apply to assets of this company (global ones + the company's own), in order. */
export function applicableFields(defs: CustomFieldDef[] | undefined | null, companyId: number | null): CustomFieldDef[] {
  return (Array.isArray(defs) ? defs : [])
    .filter((f) => f.company_id === null || f.company_id === companyId)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
}

// ---------------------------------------------------------------------------
// What the person typed
// ---------------------------------------------------------------------------

export interface AddInput {
  itemId: string;
  quantity: string;
  receivedInto: string;
  costCenterId: string;
  /** null = follow the Item's rule. */
  mode: SerialMode | null;
  serialText: string;
  // Purchase details (optional)
  vendorId: string;
  poNumber: string;
  poDate: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceAmount: string;
  purchaseCost: string;
  taxPercent: string;
  // Advanced (optional)
  brandId: string;
  model: string;
  warrantyYears: string;
  description: string;
  barcode: string;
  legacyCode: string;
  /** Extra-field values for every asset (checkbox -> boolean). */
  fieldValues: Record<string, string | boolean>;
  /** "Different values per asset" is open. */
  perUnit: boolean;
  /** field key -> one value per row (row i = asset i). */
  unitValues: Record<string, string>;
}

export function emptyInput(): AddInput {
  return {
    itemId: "", quantity: "1", receivedInto: "", costCenterId: "", mode: null, serialText: "",
    vendorId: "", poNumber: "", poDate: "", invoiceNumber: "", invoiceDate: "", invoiceAmount: "",
    purchaseCost: "", taxPercent: "",
    brandId: "", model: "", warrantyYears: "", description: "", barcode: "", legacyCode: "",
    fieldValues: {}, perUnit: false, unitValues: {},
  };
}

/** The serial rule in force: the person's choice, else the Item's. */
export function effectiveMode(input: Pick<AddInput, "mode">, item: Item | null | undefined): SerialMode {
  return input.mode ?? itemSerialMode(item);
}

/** "Indoor Camera Dell Latitude": what the server uses when no description is typed. */
export function defaultDescription(itemName: string | null | undefined, brandName: string | null | undefined, model: string): string {
  return [itemName, brandName, model.trim()].filter((p) => p && p.trim() !== "").join(" ");
}

/** The quantity as a whole number 1..1000, or 0 while the box is not valid. */
export function quantityOf(raw: string): number {
  return quantityProblem(raw) ? 0 : Number(raw.trim());
}

// ---------------------------------------------------------------------------
// The whole form checked
// ---------------------------------------------------------------------------

/** One refusal reason of a 422 batch. `unit_index` = the i-th serial (1-based). */
export interface AddProblem {
  unit_index?: number | null;
  serial?: string | null;
  message: string;
}

export interface SerialCheck {
  entries: SerialEntry[];
  /** "3 serial numbers needed, 2 entered." or null. */
  countProblem: string | null;
  /** Box row -> why it is wrong (duplicate, already used, refused). */
  badRows: Map<number, string>;
  /** Plain sentences about the serials (duplicates with rows, used serials). */
  messages: string[];
}

export interface AddCheck {
  qty: number;
  qtyProblem: string | null;
  mode: SerialMode;
  serials: SerialCheck;
  /** Extra-field problems shown next to the fields. */
  fieldMessages: Record<string, string>;
  /** Purchase-detail problems shown in that section. */
  purchaseMessages: string[];
  /** Every reason the batch cannot be sent yet, most important first (empty = it can). */
  reasons: string[];
}

const isNA = (s: string) => s.toLowerCase() === "n/a";
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

function fieldValueProblem(f: CustomFieldDef, raw: string): string | null {
  if (raw === "") return null;
  if (f.field_type === "number" && !Number.isFinite(Number(raw))) return `${f.label} must be a number.`;
  if (f.field_type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${f.label} must be a date (yyyy-mm-dd).`;
  if (f.field_type === "dropdown") {
    const choices = f.options?.choices ?? [];
    if (choices.length > 0 && !choices.includes(raw)) return `${f.label} must be one of: ${choices.join(", ")}.`;
  }
  return null;
}

function amountProblem(label: string, raw: string, max?: number): string | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return `${label} must be a number, 0 or more.`;
  if (max !== undefined && n > max) return `${label} must be at most ${max}.`;
  return null;
}

/** The serial box checked: count, rows typed twice, serials CKAM already has, the last refusal's rows. */
export function checkSerials(text: string, qty: number, conflicts: Record<string, string> = {}, server: AddProblem[] = []): SerialCheck {
  const entries = serialEntries(text);
  let countProblem: string | null = null;
  if (qty > 0 && entries.length !== qty) {
    countProblem = entries.length > qty
      ? `${plural(entries.length - qty, "serial number")} too many: ${qty} needed, ${entries.length} entered.`
      : `${plural(qty, "serial number")} needed, ${entries.length} entered.`;
  }
  const badRows = new Map<number, string>();
  const messages: string[] = [];
  const seen = new Map<string, SerialEntry[]>();
  for (const e of entries) {
    if (isNA(e.value)) continue;
    const k = e.value.toLowerCase();
    const list = seen.get(k);
    if (list) list.push(e);
    else seen.set(k, [e]);
  }
  for (const list of seen.values()) {
    if (list.length < 2) continue;
    const sentence = `${list[0].value} is typed more than once (rows ${andNumbers(list.map((e) => e.row))}).`;
    messages.push(sentence);
    for (const e of list) badRows.set(e.row, sentence);
  }
  for (const e of entries) {
    const code = conflicts[e.value.toLowerCase()];
    if (code === undefined || isNA(e.value)) continue;
    const sentence = `Row ${e.row}: ${serialConflictSentence(e.value, code)}`;
    messages.push(sentence);
    badRows.set(e.row, sentence);
  }
  for (const p of server) {
    if (p.unit_index != null && entries[p.unit_index - 1]) badRows.set(entries[p.unit_index - 1].row, p.message);
    if (p.serial) {
      const k = p.serial.toLowerCase();
      for (const e of entries) if (e.value.toLowerCase() === k) badRows.set(e.row, p.message);
    }
  }
  return { entries, countProblem, badRows, messages };
}

/**
 * Checks the whole form. `conflicts` = serials CKAM already has (lower-case
 * serial -> asset code, from the advisory check-serials call); `server` = the
 * problems of the last refused attempt (they mark rows; they never block a retry).
 */
export function checkAdd(
  input: AddInput,
  item: Item | null | undefined,
  fields: CustomFieldDef[],
  conflicts: Record<string, string> = {},
  server: AddProblem[] = [],
  today: string = todayIso(),
): AddCheck {
  const qtyProblem = quantityProblem(input.quantity);
  const qty = qtyProblem ? 0 : Number(input.quantity.trim());
  const mode = effectiveMode(input, item);
  // Serial numbers are asked for only once the Item (and so its rule) is known.
  const serials = item && mode === "HAS_SERIAL" && qty > 0
    ? checkSerials(input.serialText, qty, conflicts, server)
    : { entries: [], countProblem: null, badRows: new Map<number, string>(), messages: [] };

  // Extra fields: the common value, or (when chosen) one value for every asset.
  const fieldMessages: Record<string, string> = {};
  const fieldReasons: string[] = [];
  for (const f of fields) {
    if (f.field_type === "checkbox") continue; // a tick box always has a value
    const commonRaw = typeof input.fieldValues[f.field_key] === "string" ? (input.fieldValues[f.field_key] as string).trim() : "";
    const bad = fieldValueProblem(f, commonRaw);
    if (bad) { fieldMessages[f.field_key] = bad; fieldReasons.push(bad); continue; }
    const rows = input.perUnit && qty > 1 ? unitValueRows(input.unitValues[f.field_key]) : [];
    if (rows.length > qty && qty > 0) {
      const m = `${f.label}: ${plural(rows.length, "value")} typed for ${plural(qty, "asset")}.`;
      fieldMessages[f.field_key] = m;
      fieldReasons.push(m);
      continue;
    }
    const rowBad = rows.map((v, i) => [fieldValueProblem(f, v), i] as const).find(([m]) => m);
    if (rowBad) {
      const m = `${rowBad[0]} (row ${rowBad[1] + 1})`;
      fieldMessages[f.field_key] = m;
      fieldReasons.push(m);
      continue;
    }
    if (f.is_required && commonRaw === "") {
      const covered = qty > 0 && rows.length >= qty && rows.slice(0, qty).every((v) => v !== "");
      // Not marked red next to the field (it is only empty yet): the asterisk and the "why" line say it.
      if (!covered) {
        fieldReasons.push(input.perUnit && qty > 1 ? `${f.label} is needed for every asset (fill every row or the value above).` : `${f.label} is needed for every asset.`);
      }
    }
  }

  // Purchase details: all optional, but what is typed must make sense.
  const purchaseMessages: string[] = [];
  if (input.poDate && input.poDate > today) purchaseMessages.push("The PO date cannot be in the future.");
  if (input.invoiceDate && input.invoiceDate > today) purchaseMessages.push("The invoice date cannot be in the future.");
  if (input.poDate && input.invoiceDate && input.invoiceDate < input.poDate) purchaseMessages.push("The invoice date cannot be before the PO date.");
  for (const m of [
    amountProblem("The invoice amount", input.invoiceAmount),
    amountProblem("The cost per asset", input.purchaseCost),
    amountProblem("Tax %", input.taxPercent, 100),
  ]) if (m) purchaseMessages.push(m);

  const reasons: string[] = [];
  if (input.itemId === "") reasons.push("Choose the Item.");
  if (qtyProblem) reasons.push(`Quantity: ${qtyProblem}`);
  if (input.receivedInto === "") reasons.push("Choose where the assets are Received Into.");
  if (input.costCenterId === "") reasons.push("Choose the Cost Centre.");
  if (serials.countProblem) reasons.push(serials.countProblem);
  if (serials.messages.length > 0) reasons.push(serials.messages[0]);
  reasons.push(...fieldReasons);
  reasons.push(...purchaseMessages.map((m) => `Purchase details: ${m}`));
  const warranty = input.warrantyYears.trim();
  if (warranty !== "" && !(Number.isInteger(Number(warranty)) && Number(warranty) >= 0 && Number(warranty) <= 100)) {
    reasons.push("Warranty years must be a whole number from 0 to 100.");
  }
  return { qty, qtyProblem, mode, serials, fieldMessages, purchaseMessages, reasons };
}

/** The one line printed next to the Add button. */
export function whyNotSentence(reasons: string[]): string {
  if (reasons.length === 0) return "";
  return reasons.length === 1 ? reasons[0] : `${reasons[0]} (${plural(reasons.length - 1, "more thing")} to fix)`;
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

type FieldValue = string | number | boolean;

function fieldValue(f: CustomFieldDef, raw: string | boolean | undefined): FieldValue | undefined {
  if (f.field_type === "checkbox") return raw === true;
  const t = typeof raw === "string" ? raw.trim() : "";
  if (t === "") return undefined;
  return f.field_type === "number" ? Number(t) : t;
}

export interface AddBody {
  item_id: number;
  quantity: number;
  received_into_asset_user_id: number;
  cost_center_id: number;
  serial_mode?: SerialMode;
  serial_numbers?: string[];
  vendor_id?: number;
  po_number?: string;
  po_date?: string;
  invoice_number?: string;
  invoice_date?: string;
  invoice_amount?: number;
  purchase_cost?: number;
  tax_percent?: number;
  brand_id?: number;
  model?: string;
  warranty_years?: number;
  description?: string;
  barcode?: string;
  legacy_asset_code?: string;
  custom_fields?: Record<string, FieldValue>;
  unit_custom_fields?: (Record<string, FieldValue> | null)[];
}

const text = (v: string) => (v.trim() === "" ? undefined : v.trim());
const num = (v: string) => (v.trim() === "" ? undefined : Number(v.trim()));

/**
 * POST /api/assets/batch. Only what was typed is sent: the server takes the
 * company from the cost centre and the brand, warranty, serial rule and
 * description from the Item when they are left out.
 */
export function buildAddBody(input: AddInput, item: Item | null | undefined, fields: CustomFieldDef[]): AddBody {
  const qty = Number(input.quantity.trim());
  const mode = effectiveMode(input, item);
  const body: AddBody = {
    item_id: Number(input.itemId),
    quantity: qty,
    received_into_asset_user_id: Number(input.receivedInto),
    cost_center_id: Number(input.costCenterId),
  };
  if (input.mode !== null && input.mode !== itemSerialMode(item)) body.serial_mode = input.mode;
  if (mode === "HAS_SERIAL") body.serial_numbers = serialEntries(input.serialText).map((e) => e.value);
  const optional: Partial<AddBody> = {
    vendor_id: input.vendorId ? Number(input.vendorId) : undefined,
    po_number: text(input.poNumber),
    po_date: input.poDate || undefined,
    invoice_number: text(input.invoiceNumber),
    invoice_date: input.invoiceDate || undefined,
    invoice_amount: num(input.invoiceAmount),
    purchase_cost: num(input.purchaseCost),
    tax_percent: num(input.taxPercent),
    brand_id: input.brandId ? Number(input.brandId) : undefined,
    model: text(input.model),
    warranty_years: num(input.warrantyYears),
    description: text(input.description),
    barcode: text(input.barcode),
    legacy_asset_code: qty === 1 ? text(input.legacyCode) : undefined,
  };
  for (const [k, v] of Object.entries(optional)) if (v !== undefined) (body as unknown as Record<string, unknown>)[k] = v;

  const common: Record<string, FieldValue> = {};
  for (const f of fields) {
    const v = fieldValue(f, input.fieldValues[f.field_key] ?? (f.field_type === "checkbox" ? false : ""));
    if (v !== undefined) common[f.field_key] = v;
  }
  if (Object.keys(common).length > 0) body.custom_fields = common;
  if (input.perUnit && qty > 1) {
    const perUnit: (Record<string, FieldValue> | null)[] = Array.from({ length: qty }, () => null);
    let any = false;
    for (const f of fields) {
      if (f.field_type === "checkbox") continue;
      unitValueRows(input.unitValues[f.field_key]).slice(0, qty).forEach((raw, i) => {
        const v = fieldValue(f, raw);
        if (v === undefined) return;
        perUnit[i] = { ...(perUnit[i] ?? {}), [f.field_key]: v };
        any = true;
      });
    }
    if (any) body.unit_custom_fields = perUnit;
  }
  return body;
}

// ---------------------------------------------------------------------------
// A refused batch (422)
// ---------------------------------------------------------------------------

/** Where on the screen a server sentence belongs. */
export type ProblemPlace = "serials" | "item" | "quantity" | "received" | "costCentre" | "purchase" | "advanced" | "fields" | "general";

/** Puts a refusal sentence next to the part of the form it is about (by its words). */
export function problemPlace(p: AddProblem, fields: CustomFieldDef[] = []): ProblemPlace {
  if (p.unit_index != null || p.serial) return "serials";
  const m = p.message;
  if (fields.some((f) => m.includes(f.label)) || /extra[- ]field/i.test(m)) return "fields";
  if (/serial/i.test(m)) return "serials";
  if (/cost cent(re|er)/i.test(m)) return "costCentre";
  if (/received|stock room|place/i.test(m)) return "received";
  if (/quantity/i.test(m)) return "quantity";
  if (/vendor|invoice|\bPO\b|purchase order|tax|cost per|purchase cost/i.test(m)) return "purchase";
  if (/brand|warranty|barcode|old asset code|legacy|description|model/i.test(m)) return "advanced";
  if (/\bItem\b/.test(m)) return "item";
  return "general";
}

/** "Nothing was added: 3 problems need fixing, marked below. Everything you typed is still here." */
export function refusalSummary(problems: AddProblem[]): string {
  return `Nothing was added: ${plural(problems.length, "problem needs", "problems need")} fixing, marked below. Everything you typed is still here.`;
}

/** At most this many serials in one request (the server's limit). */
export const MAX_SERIALS = MAX_QUANTITY;
