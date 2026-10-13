import { describe, it, expect } from "vitest";
import {
  type CommonInput, type LineInput, type ReceiveInfo, andNumbers, buildReceiveBody, checkReceipt, initialLines,
  problemsFrom, refusalSummary, serialEntries, typedSerials, whyNotSentence,
} from "./receive-model";

const TODAY = "2026-10-13";

function info(over: Partial<ReceiveInfo> = {}): ReceiveInfo {
  return {
    po_id: 1, po_number: "SPO/1", po_date: "2026-01-01", is_active: true, company_id: 1, company_name: "CK", company_code: "CKSPL",
    vendor_id: 3, vendor_name: "V", received_into_asset_user_id: 5, received_into_name: "HO Stock",
    ordered_units: 6, received_units: 0, waiting_units: 6,
    lines: [
      { line_no: 1, item_id: 1, item_name: "Camera", description: "Camera", ordered: 3, received_before: 0, waiting: 3, cancelled: 0, serial_mode: "HAS_SERIAL", work_area: "IT", bundle_label: null, status: "WAITING" },
      { line_no: 2, item_id: 2, item_name: "Chair", description: "Chair", ordered: 3, received_before: 0, waiting: 3, cancelled: 0, serial_mode: "NO_SERIAL", work_area: "NON_IT", bundle_label: null, status: "WAITING" },
    ],
    required_custom_fields: [],
    blockers: [],
    ...over,
  };
}

const common = (over: Partial<CommonInput> = {}): CommonInput => ({
  receivedInto: "5", invoiceNumber: "INV-1", invoiceDate: TODAY, invoiceAmount: "100", fieldValues: {}, perUnit: false, ...over,
});

function inputs(i: ReceiveInfo, patch: Record<number, Partial<LineInput>> = {}): Record<number, LineInput> {
  const base = initialLines(i);
  for (const [k, v] of Object.entries(patch)) base[Number(k)] = { ...base[Number(k)], ...v };
  return base;
}

describe("receive-model", () => {
  it("serialEntries keeps each serial's box row, trims, and ignores blank rows", () => {
    expect(serialEntries(" A \r\n\r\nB\n\n C")).toEqual([{ value: "A", row: 1 }, { value: "B", row: 3 }, { value: "C", row: 5 }]);
    expect(serialEntries("")).toEqual([]);
  });

  it("andNumbers reads like a sentence", () => {
    expect(andNumbers([3])).toBe("3");
    expect(andNumbers([3, 7])).toBe("3 and 7");
    expect(andNumbers([2, 5, 9])).toBe("2, 5 and 9");
  });

  it("initialLines: everything waiting, or only the focused line", () => {
    const i = info();
    expect(Object.values(initialLines(i)).map((l) => l.qty)).toEqual(["3", "3"]);
    expect(Object.values(initialLines(i, 2)).map((l) => l.qty)).toEqual(["0", "3"]);
    expect(Object.values(initialLines(i, 9)).map((l) => l.qty)).toEqual(["3", "3"]);
    expect(initialLines(i)[2].mode).toBe("NO_SERIAL");
  });

  it("a complete receipt has no reasons; the body sends the common fields once and only the lines received", () => {
    const i = info();
    const inp = inputs(i, { 1: { text: "S1\nS2\nS3" } });
    expect(checkReceipt(i, common(), inp, {}, [], TODAY).reasons).toEqual([]);
    expect(buildReceiveBody(i, common(), inp)).toEqual({
      received_into_asset_user_id: 5, invoice_number: "INV-1", invoice_date: TODAY, invoice_amount: 100,
      lines: [{ line_no: 1, quantity: 3, serial_numbers: ["S1", "S2", "S3"] }, { line_no: 2, quantity: 3 }],
    });
    const skip = inputs(i, { 1: { qty: "0" } });
    expect(buildReceiveBody(i, common(), skip).lines).toEqual([{ line_no: 2, quantity: 3 }]);
  });

  it("reasons name the line and come in a useful order (blockers first)", () => {
    const i = info({ blockers: ["No code rule is set up."] });
    const r = checkReceipt(i, common({ invoiceNumber: "" }), inputs(i, { 1: { text: "S1" } }), {}, [], TODAY).reasons;
    expect(r).toEqual(["No code rule is set up.", "Enter the invoice number.", "Line 1: 3 serial numbers needed, 1 entered."]);
    expect(whyNotSentence(r)).toBe("No code rule is set up. (2 more things to fix)");
    expect(whyNotSentence(["One."])).toBe("One.");
  });

  it("duplicates inside a box and across lines are found with their rows; N/A never counts", () => {
    const i = info({ lines: [info().lines[0], { ...info().lines[1], serial_mode: "HAS_SERIAL" }] });
    const c = checkReceipt(i, common(), inputs(i, { 1: { text: "a\nB\nA" }, 2: { text: "n/a\nb\nN/A" } }), {}, [], TODAY);
    expect(c.lines[0].serialMessages).toEqual(["a is typed more than once in this box (rows 1 and 3).", "B is also typed for line 2."]);
    expect([...c.lines[0].badRows.keys()].sort()).toEqual([1, 2, 3]);
    expect(c.lines[1].serialMessages).toEqual(["b is also typed for line 1."]);
    expect([...c.lines[1].badRows.keys()]).toEqual([2]);
  });

  it("a refused receipt's unit_index / serial mark the exact row", () => {
    const i = info();
    const c = checkReceipt(i, common(), inputs(i, { 1: { text: "S1\n\nS2\nS3" } }), {}, [
      { line_no: 1, unit_index: 2, message: "refused 2" },
      { line_no: 1, serial: "s3", message: "refused s3" },
    ], TODAY);
    expect(c.lines[0].badRows.get(3)).toBe("refused 2");       // the 2nd serial sits on box row 3
    expect(c.lines[0].badRows.get(4)).toBe("refused s3");
  });

  it("problemsFrom reads err.body.problems; refusalSummary counts them", () => {
    const err = Object.assign(new Error("x"), { status: 422, body: { problems: [{ line_no: null, message: "m" }] } });
    expect(problemsFrom(err)).toEqual([{ line_no: null, message: "m" }]);
    expect(problemsFrom(new Error("x"))).toBeNull();
    expect(problemsFrom(null)).toBeNull();
    expect(refusalSummary([{ line_no: null, message: "m" }])).toBe("Nothing was received: 1 problem needs fixing, marked below. Everything you typed is still here.");
  });

  it("typedSerials: distinct, lines that take serials only, no N/A", () => {
    const i = info();
    expect(typedSerials(i, inputs(i, { 1: { text: "A\na\nN/A\nB" }, 2: { text: "Z" } }))).toEqual(["A", "B"]);
  });

  it("1,000 serials (one receipt's maximum) are checked in well under a frame's worth of work per check", () => {
    const i = info({ lines: [{ ...info().lines[0], ordered: 1000, waiting: 1000 }] });
    const text = Array.from({ length: 1000 }, (_, k) => `SERIAL-${k}`).join("\n");
    const inp = inputs(i, { 1: { text } });
    const t0 = performance.now();
    const c = checkReceipt(i, common(), inp, {}, [], TODAY);
    const ms = performance.now() - t0;
    expect(c.lines[0].entries).toHaveLength(1000);
    expect(c.reasons).toEqual([]);
    expect(ms).toBeLessThan(100);
  });
});
