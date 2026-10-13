/**
 * The Receive screen's rules, kept pure (no React) so they are cheap to run
 * and easy to test: what the server sent (GET /purchase-orders/{id}/receive-info),
 * what the person typed, what is still wrong ("Why can't I receive?"), the
 * request body (POST /purchase-orders/{id}/receive) and how a refused
 * receipt's `problems` map back onto the screen.
 *
 * Serial lists are split once per check and compared with Sets / Maps
 * (never one serial against every other), so 1,000 serials stay instant.
 */
import { MAX_QUANTITY } from "@/lib/limits";
import { serialConflictSentence } from "../purchase-orders/serial-conflict";

export type SerialMode = "HAS_SERIAL" | "NO_SERIAL" | "SERIAL_LATER";
export const SERIAL_MODES: SerialMode[] = ["HAS_SERIAL", "NO_SERIAL", "SERIAL_LATER"];

export function asSerialMode(v: string | null | undefined): SerialMode {
  return v === "NO_SERIAL" || v === "SERIAL_LATER" ? v : "HAS_SERIAL";
}

export interface ReceiveInfoLine {
  line_no: number;
  item_id: number | null;
  item_name: string | null;
  description: string;
  ordered: number;
  received_before: number;
  waiting: number;
  cancelled: number;
  serial_mode: string;
  work_area: string | null;
  rate?: number | null;
  tax_percent?: number | null;
  unit_total?: number | null;
  erp_item_code?: string | null;
  brand_name?: string | null;
  model?: string | null;
  bundle_label: string | null;
  status: string;
}

export interface RequiredField {
  id: number;
  key: string;
  label: string;
  /** text | number | date | dropdown | checkbox */
  type: string;
  options: { choices?: string[] } | null;
  sort_order?: number;
}

export interface ReceiveInfo {
  po_id: number;
  po_number: string;
  po_date: string;
  is_active: boolean;
  company_id: number;
  company_name: string | null;
  company_code: string | null;
  vendor_id: number | null;
  vendor_name: string | null;
  received_into_asset_user_id: number | null;
  received_into_name: string | null;
  ordered_units: number;
  received_units: number;
  waiting_units: number;
  lines: ReceiveInfoLine[];
  required_custom_fields: RequiredField[];
  blockers: string[];
}

export interface ReceivedAsset {
  asset_id: number;
  asset_code: string;
  line_no: number | null;
  serial_number: string | null;
  serial_pending: boolean;
}

export interface ReceiveResult {
  po_id: number;
  invoice_number: string;
  assets_created: number;
  serial_pending: number;
  assets: ReceivedAsset[];
  label_asset_ids: number[];
  po_status: string | null;
  waiting_units: number | null;
}

/** One refusal reason of a 422 receipt; `line_no` null = the common fields. */
export interface ReceiveProblem {
  line_no: number | null;
  unit_index?: number;
  serial?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// What the person typed
// ---------------------------------------------------------------------------

export interface LineInput {
  /** "Receiving now" as typed (a whole number 0..waiting). */
  qty: string;
  mode: SerialMode;
  /** The serial box: one serial per row. */
  text: string;
  /** Per-asset extra-field values: field key -> one value per row (row i = asset i). */
  unitValues: Record<string, string>;
}

export interface CommonInput {
  receivedInto: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceAmount: string;
  /** Extra-field values for every asset received (checkbox -> boolean). */
  fieldValues: Record<string, string | boolean>;
  /** "Different values per asset" is open. */
  perUnit: boolean;
}

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The starting input for each line: everything waiting (or only `focusLine`'s, the others 0). */
export function initialLines(info: ReceiveInfo, focusLine?: number | null): Record<number, LineInput> {
  const focus = focusLine != null && info.lines.some((l) => l.line_no === focusLine && l.waiting > 0) ? focusLine : null;
  return Object.fromEntries(
    info.lines.map((l) => [
      l.line_no,
      {
        qty: String(focus === null || focus === l.line_no ? l.waiting : 0),
        mode: asSerialMode(l.serial_mode),
        text: "",
        unitValues: {},
      },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Serial boxes
// ---------------------------------------------------------------------------

/** One serial typed in a box: its text and the box row it is on (1-based). */
export interface SerialEntry {
  value: string;
  row: number;
}

/** Rows of a serial box, trimmed; blank rows are ignored (the server does the same). */
export function serialEntries(text: string): SerialEntry[] {
  const out: SerialEntry[] = [];
  const rows = text.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i].trim();
    if (v !== "") out.push({ value: v, row: i + 1 });
  }
  return out;
}

const isNA = (s: string) => s.toLowerCase() === "n/a";

/** A list of numbers in words: "3 and 7", "2, 5 and 9". */
export function andNumbers(ns: number[]): string {
  if (ns.length <= 1) return ns.join("");
  return `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// The whole receipt checked: per line and "why can't I receive?"
// ---------------------------------------------------------------------------

export interface LineCheck {
  lineNo: number;
  /** The quantity as a number (0 while the box is invalid). */
  qty: number;
  qtyProblem: string | null;
  /** A serial box is shown (has serial + something being received). */
  needsSerials: boolean;
  entries: SerialEntry[];
  /** "48 of 50 entered" and what is wrong with the count, or null. */
  countProblem: string | null;
  /** Box row -> why it is wrong (duplicate, already used, server refusal). */
  badRows: Map<number, string>;
  /** Plain sentences about this line's serials (duplicates with their rows, used serials). */
  serialMessages: string[];
  /** Extra-field problems of this line (missing / wrong per-asset values). */
  fieldMessages: string[];
  /** Units left waiting after this receipt. */
  staysWaiting: number;
}

export interface ReceiptCheck {
  lines: LineCheck[];
  totalQty: number;
  /** Every reason the receipt cannot be sent yet, most important first (empty = it can). */
  reasons: string[];
}

export function lineTitle(l: Pick<ReceiveInfoLine, "item_name" | "description">): string {
  return l.item_name?.trim() || l.description;
}

function qtyProblemOf(raw: string, waiting: number): string | null {
  const t = raw.trim();
  if (t === "") return "Enter how many (0 skips this line).";
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return "Enter a whole number.";
  if (n < 0) return "Enter 0 or more.";
  if (n > waiting) return `Only ${plural(waiting, "unit is", "units are")} waiting.`;
  return null;
}

function valueProblem(field: RequiredField, raw: string): string | null {
  if (raw === "") return null;
  if (field.type === "number" && !Number.isFinite(Number(raw))) return `${field.label} must be a number.`;
  if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${field.label} must be a date (yyyy-mm-dd).`;
  if (field.type === "dropdown") {
    const choices = field.options?.choices ?? [];
    if (choices.length > 0 && !choices.includes(raw)) return `${field.label} must be one of: ${choices.join(", ")}.`;
  }
  return null;
}

/** Per-asset values typed for one field on one line: row i = asset i ("" = use the common value). */
export function unitValueRows(text: string | undefined): string[] {
  const rows = (text ?? "").split(/\r?\n/).map((s) => s.trim());
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  return rows;
}

/**
 * Checks the whole receipt. `conflicts` = serials CKAM already has (lower-case
 * serial -> asset code, from the advisory check-serials call); `server` = the
 * problems of the last refused attempt, still shown until that part is edited.
 */
export function checkReceipt(
  info: ReceiveInfo,
  common: CommonInput,
  inputs: Record<number, LineInput>,
  conflicts: Record<string, string> = {},
  server: ReceiveProblem[] = [],
  today: string = todayIso(),
): ReceiptCheck {
  const fields = info.required_custom_fields ?? [];
  const checks: LineCheck[] = info.lines.map((l) => {
    const inp = inputs[l.line_no] ?? { qty: "0", mode: asSerialMode(l.serial_mode), text: "", unitValues: {} };
    const qtyProblem = qtyProblemOf(inp.qty, l.waiting);
    const qty = qtyProblem ? 0 : Number(inp.qty.trim());
    const needsSerials = inp.mode === "HAS_SERIAL" && qty > 0;
    const entries = needsSerials ? serialEntries(inp.text) : [];
    let countProblem: string | null = null;
    if (needsSerials && entries.length !== qty) {
      countProblem = entries.length > qty
        ? `${plural(entries.length - qty, "serial number")} too many: ${qty} needed, ${entries.length} entered.`
        : `${plural(qty, "serial number")} needed, ${entries.length} entered.`;
    }
    return {
      lineNo: l.line_no, qty, qtyProblem, needsSerials, entries, countProblem,
      badRows: new Map<number, string>(), serialMessages: [], fieldMessages: [],
      staysWaiting: Math.max(0, l.waiting - qty),
    };
  });

  // Serials typed more than once in THIS receipt (any letter case; N/A never counts), with their rows.
  const seen = new Map<string, { lineNo: number; row: number; value: string }[]>();
  for (const c of checks) {
    for (const e of c.entries) {
      if (isNA(e.value)) continue;
      const k = e.value.toLowerCase();
      const list = seen.get(k);
      if (list) list.push({ lineNo: c.lineNo, row: e.row, value: e.value });
      else seen.set(k, [{ lineNo: c.lineNo, row: e.row, value: e.value }]);
    }
  }
  const byLine = new Map(checks.map((c) => [c.lineNo, c]));
  for (const places of seen.values()) {
    if (places.length < 2) continue;
    const lineNos = [...new Set(places.map((p) => p.lineNo))];
    for (const lineNo of lineNos) {
      const c = byLine.get(lineNo)!;
      const mine = places.filter((p) => p.lineNo === lineNo);
      const others = lineNos.filter((n) => n !== lineNo);
      const rows = mine.map((p) => p.row);
      const parts: string[] = [];
      if (mine.length > 1) parts.push(`typed more than once in this box (rows ${andNumbers(rows)})`);
      if (others.length > 0) parts.push(`also typed for line ${andNumbers(others)}`);
      const sentence = `${mine[0].value} is ${parts.join(" and ")}.`;
      c.serialMessages.push(sentence);
      for (const r of rows) c.badRows.set(r, sentence);
    }
  }

  // Serials CKAM already has (advisory server check).
  for (const c of checks) {
    for (const e of c.entries) {
      const code = conflicts[e.value.toLowerCase()];
      if (code === undefined || isNA(e.value)) continue;
      const sentence = `Row ${e.row}: ${serialConflictSentence(e.value, code)}`;
      c.serialMessages.push(sentence);
      c.badRows.set(e.row, sentence);
    }
  }

  // The last refused attempt's problems that point at a unit / serial: mark their rows.
  for (const p of server) {
    if (p.line_no == null) continue;
    const c = byLine.get(p.line_no);
    if (!c) continue;
    if (p.unit_index != null && c.entries[p.unit_index - 1]) c.badRows.set(c.entries[p.unit_index - 1].row, p.message);
    if (p.serial) {
      const k = p.serial.toLowerCase();
      for (const e of c.entries) if (e.value.toLowerCase() === k) c.badRows.set(e.row, p.message);
    }
  }

  // Required extra fields: the common value, or (when chosen) a value for every asset of the line.
  const fieldReasons: string[] = [];
  for (const f of fields) {
    if (f.type === "checkbox") continue; // a tick box always has a value
    const commonRaw = typeof common.fieldValues[f.key] === "string" ? (common.fieldValues[f.key] as string).trim() : "";
    const commonBad = valueProblem(f, commonRaw);
    if (commonBad) fieldReasons.push(commonBad);
    const missingOn: number[] = [];
    for (const c of checks) {
      if (c.qty === 0) continue;
      const rows = common.perUnit ? unitValueRows(inputs[c.lineNo]?.unitValues[f.key]) : [];
      if (rows.length > c.qty) {
        c.fieldMessages.push(`${f.label}: ${plural(rows.length, "value")} typed for ${plural(c.qty, "asset")}.`);
      }
      rows.forEach((v, i) => {
        const bad = valueProblem(f, v);
        if (bad) c.fieldMessages.push(`${bad} (row ${i + 1})`);
      });
      if (commonRaw === "") {
        const covered = rows.length >= c.qty && rows.slice(0, c.qty).every((v) => v !== "");
        if (!covered) missingOn.push(c.lineNo);
      }
    }
    if (missingOn.length > 0) {
      fieldReasons.push(
        common.perUnit
          ? `${f.label} is needed for every asset (line ${andNumbers(missingOn)}).`
          : `${f.label} is needed for every asset received.`,
      );
    }
  }

  const totalQty = checks.reduce((n, c) => n + c.qty, 0);
  const reasons: string[] = [...(info.blockers ?? [])];
  if (totalQty === 0 && checks.every((c) => !c.qtyProblem)) reasons.push("Enter how many you are receiving on at least one line.");
  if (totalQty > MAX_QUANTITY) reasons.push(`At most ${MAX_QUANTITY.toLocaleString("en-IN")} units can be received at once; receive the rest next.`);
  if (common.receivedInto === "") reasons.push("Choose where the goods are Received Into.");
  if (common.invoiceNumber.trim() === "") reasons.push("Enter the invoice number.");
  if (common.invoiceDate === "") reasons.push("Enter the invoice date.");
  else if (common.invoiceDate > today) reasons.push("The invoice date cannot be in the future.");
  const amount = common.invoiceAmount.trim();
  if (amount === "") reasons.push("Enter the invoice amount (the invoice total).");
  else if (!Number.isFinite(Number(amount)) || Number(amount) < 0) reasons.push("The invoice amount must be a number, 0 or more.");
  for (const c of checks) {
    if (c.qtyProblem) reasons.push(`Line ${c.lineNo}: ${c.qtyProblem}`);
    else if (c.countProblem) reasons.push(`Line ${c.lineNo}: ${c.countProblem}`);
    if (c.serialMessages.length > 0) reasons.push(`Line ${c.lineNo}: ${c.serialMessages[0]}`);
    if (c.fieldMessages.length > 0) reasons.push(`Line ${c.lineNo}: ${c.fieldMessages[0]}`);
  }
  reasons.push(...fieldReasons);
  return { lines: checks, totalQty, reasons };
}

/** The one line printed next to the Receive button. */
export function whyNotSentence(reasons: string[]): string {
  if (reasons.length === 0) return "";
  return reasons.length === 1 ? reasons[0] : `${reasons[0]} (${plural(reasons.length - 1, "more thing")} to fix)`;
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

type FieldValue = string | number | boolean;

function fieldValue(f: RequiredField, raw: string | boolean): FieldValue | undefined {
  if (f.type === "checkbox") return raw === true;
  const t = typeof raw === "string" ? raw.trim() : "";
  if (t === "") return undefined;
  return f.type === "number" ? Number(t) : t;
}

export interface ReceiveLineBody {
  line_no: number;
  quantity: number;
  serial_mode?: SerialMode;
  serial_numbers?: string[];
  custom_fields?: Record<string, FieldValue>;
  unit_custom_fields?: (Record<string, FieldValue> | null)[];
}

export interface ReceiveBody {
  received_into_asset_user_id: number;
  invoice_number: string;
  invoice_date: string;
  invoice_amount: number;
  lines: ReceiveLineBody[];
}

/** POST /purchase-orders/{id}/receive: common fields once, then only the lines being received. */
export function buildReceiveBody(info: ReceiveInfo, common: CommonInput, inputs: Record<number, LineInput>): ReceiveBody {
  const fields = info.required_custom_fields ?? [];
  const commonValues: Record<string, FieldValue> = {};
  for (const f of fields) {
    const v = fieldValue(f, common.fieldValues[f.key] ?? (f.type === "checkbox" ? false : ""));
    if (v !== undefined) commonValues[f.key] = v;
  }
  const lines: ReceiveLineBody[] = [];
  for (const l of info.lines) {
    const inp = inputs[l.line_no];
    if (!inp) continue;
    const qty = Number(inp.qty.trim());
    if (!Number.isInteger(qty) || qty <= 0) continue;
    const body: ReceiveLineBody = { line_no: l.line_no, quantity: qty };
    // The line's own rule is used when none is sent; only a change is sent.
    if (inp.mode !== asSerialMode(l.serial_mode)) body.serial_mode = inp.mode;
    if (inp.mode === "HAS_SERIAL") body.serial_numbers = serialEntries(inp.text).map((e) => e.value);
    if (Object.keys(commonValues).length > 0) body.custom_fields = { ...commonValues };
    if (common.perUnit) {
      const perUnit: (Record<string, FieldValue> | null)[] = Array.from({ length: qty }, () => null);
      let any = false;
      for (const f of fields) {
        if (f.type === "checkbox") continue;
        unitValueRows(inp.unitValues[f.key]).slice(0, qty).forEach((raw, i) => {
          const v = fieldValue(f, raw);
          if (v === undefined) return;
          perUnit[i] = { ...(perUnit[i] ?? {}), [f.key]: v };
          any = true;
        });
      }
      if (any) body.unit_custom_fields = perUnit;
    }
    lines.push(body);
  }
  return {
    received_into_asset_user_id: Number(common.receivedInto),
    invoice_number: common.invoiceNumber.trim(),
    invoice_date: common.invoiceDate,
    invoice_amount: Number(common.invoiceAmount.trim()),
    lines,
  };
}

// ---------------------------------------------------------------------------
// A refused receipt (422) and the advisory serial check
// ---------------------------------------------------------------------------

/** The structured `problems` of a refused receipt (or bulk serials), or null. */
export function problemsFrom<T = ReceiveProblem>(err: unknown): T[] | null {
  const body = (err as { body?: unknown } | null)?.body;
  const problems = body && typeof body === "object" ? (body as { problems?: unknown }).problems : undefined;
  return Array.isArray(problems) ? (problems as T[]) : null;
}

/** "Nothing was received: 3 problems need fixing, marked below. Everything you typed is still here." */
export function refusalSummary(problems: ReceiveProblem[]): string {
  return `Nothing was received: ${plural(problems.length, "problem needs", "problems need")} fixing, marked below. Everything you typed is still here.`;
}

/** Every distinct serial typed on the lines that take serials (for check-serials). */
export function typedSerials(info: ReceiveInfo, inputs: Record<number, LineInput>): string[] {
  const seen = new Map<string, string>();
  for (const l of info.lines) {
    const inp = inputs[l.line_no];
    if (!inp || inp.mode !== "HAS_SERIAL" || !(Number(inp.qty) > 0)) continue;
    for (const e of serialEntries(inp.text)) {
      const k = e.value.toLowerCase();
      if (!isNA(e.value) && !seen.has(k)) seen.set(k, e.value);
    }
  }
  return [...seen.values()];
}
