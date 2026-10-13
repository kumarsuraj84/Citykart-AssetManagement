import { describe, it, expect } from "vitest";
import {
  type AddInput, type CustomFieldDef, applicableFields, buildAddBody, checkAdd, checkSerials, defaultDescription, emptyInput,
  itemSerialMode, problemPlace, refusalSummary, whyNotSentence,
} from "./add-assets-model";
import type { Item } from "../items/types";

const item = (over: Partial<Item> = {}): Item => ({
  id: 11, name: "Laptop", category_id: 1, subcategory_id: 2, serial_required: true, serial_later: false, bundle_id: null,
  default_brand_id: null, default_warranty_years: null, is_active: true, map_count: 0, ...over,
});

const ready = (over: Partial<AddInput> = {}): AddInput => ({
  ...emptyInput(), itemId: "11", quantity: "2", receivedInto: "4", costCenterId: "3", serialText: "A\nB", ...over,
});

const field = (over: Partial<CustomFieldDef>): CustomFieldDef => ({
  id: 1, field_key: "tag", label: "Tag", field_type: "text", options: null, is_required: false, sort_order: 1, company_id: null, ...over,
});

describe("add-assets model", () => {
  it("the Item's serial rule", () => {
    expect(itemSerialMode(item())).toBe("HAS_SERIAL");
    expect(itemSerialMode(item({ serial_required: false }))).toBe("NO_SERIAL");
    expect(itemSerialMode(item({ serial_later: true }))).toBe("SERIAL_LATER");
    expect(itemSerialMode(null)).toBe("HAS_SERIAL");
  });

  it("only global fields and the company's own apply, in order", () => {
    const defs = [field({ field_key: "b", sort_order: 2 }), field({ field_key: "a", sort_order: 1, company_id: 1 }), field({ field_key: "c", company_id: 2 })];
    expect(applicableFields(defs, 1).map((f) => f.field_key)).toEqual(["a", "b"]);
    expect(applicableFields(undefined, 1)).toEqual([]);
  });

  it("the minimal body has exactly the four essentials and the serials", () => {
    expect(buildAddBody(ready(), item(), [])).toEqual({
      item_id: 11, quantity: 2, received_into_asset_user_id: 4, cost_center_id: 3, serial_numbers: ["A", "B"],
    });
    // The Item's own rule is never sent; a different one is.
    expect(buildAddBody(ready({ mode: "HAS_SERIAL" }), item(), [])).not.toHaveProperty("serial_mode");
    expect(buildAddBody(ready({ mode: "SERIAL_LATER" }), item(), [])).toEqual({
      item_id: 11, quantity: 2, received_into_asset_user_id: 4, cost_center_id: 3, serial_mode: "SERIAL_LATER",
    });
  });

  it("optional values are sent only when typed; the old code only for one asset", () => {
    const body = buildAddBody(ready({ quantity: "1", serialText: "A", vendorId: "7", poNumber: " PO-1 ", invoiceAmount: "0", taxPercent: "18", warrantyYears: "0", legacyCode: "OLD" }), item(), []);
    expect(body).toMatchObject({ vendor_id: 7, po_number: "PO-1", invoice_amount: 0, tax_percent: 18, warranty_years: 0, legacy_asset_code: "OLD" });
    expect(body).not.toHaveProperty("description");
    expect(buildAddBody(ready({ legacyCode: "OLD" }), item(), [])).not.toHaveProperty("legacy_asset_code");
  });

  it("extra fields: common values typed by type, per-asset rows as unit_custom_fields", () => {
    const fields = [field({ field_key: "tag" }), field({ field_key: "ram", field_type: "number" }), field({ field_key: "new", field_type: "checkbox" })];
    const body = buildAddBody(ready({ fieldValues: { tag: "T", ram: "16" }, perUnit: true, unitValues: { tag: "X\n\nZ", ram: "8" } }), item(), fields);
    expect(body.custom_fields).toEqual({ tag: "T", ram: 16, new: false });
    expect(body.unit_custom_fields).toEqual([{ tag: "X", ram: 8 }, null]);
  });

  it("serial box: count, typed twice (any case, rows named), N/A never a duplicate, known serials, refused rows", () => {
    const c = checkSerials("A1\nb2\nN/A\na1\nn/a", 4, { b2: "FA/7" }, [{ unit_index: 4, serial: "a1", message: "refused" }]);
    expect(c.countProblem).toBe("1 serial number too many: 4 needed, 5 entered.");
    expect(c.messages[0]).toBe("A1 is typed more than once (rows 1 and 4).");
    expect(c.messages[1]).toBe('Row 2: Serial "b2" is already used by asset FA/7.');
    expect([...c.badRows.keys()].sort()).toEqual([1, 2, 4]);
    expect(checkSerials("A\nB", 3).countProblem).toBe("3 serial numbers needed, 2 entered.");
  });

  it("1,000 serials are checked in well under a tenth of a second", () => {
    const text = Array.from({ length: 1000 }, (_, i) => `SN-${i}`).join("\n");
    const t0 = performance.now();
    const c = checkSerials(text, 1000);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(c.countProblem).toBeNull();
  });

  it("reasons come most important first; nothing about serials before an Item is chosen", () => {
    expect(checkAdd(emptyInput(), null, []).reasons).toEqual([
      "Choose the Item.", "Choose where the assets are Received Into.", "Choose the Cost Centre.",
    ]);
    expect(checkAdd(ready(), item(), []).reasons).toEqual([]);
    expect(checkAdd(ready({ quantity: "1001" }), item(), []).reasons[0]).toBe("Quantity: At most 1,000 at a time.");
    expect(checkAdd(ready({ warrantyYears: "-1" }), item(), []).reasons).toEqual(["Warranty years must be a whole number from 0 to 100."]);
    const req = [field({ is_required: true })];
    expect(checkAdd(ready(), item(), req).reasons).toEqual(["Tag is needed for every asset."]);
    expect(checkAdd(ready({ perUnit: true, unitValues: { tag: "a\nb" } }), item(), req).reasons).toEqual([]);
    expect(whyNotSentence(["a", "b", "c"])).toBe("a (2 more things to fix)");
  });

  it("refusals land next to what they are about", () => {
    const fields = [field({ label: "Warranty card" })];
    expect(problemPlace({ unit_index: 2, message: "x" })).toBe("serials");
    expect(problemPlace({ message: "Warranty card is required." }, fields)).toBe("fields");
    expect(problemPlace({ message: "3 serial numbers are needed, 2 were typed." })).toBe("serials");
    expect(problemPlace({ message: "The cost centre HO is no longer active." })).toBe("costCentre");
    expect(problemPlace({ message: "HO Stock is no longer active, so goods cannot be received there." })).toBe("received");
    expect(problemPlace({ message: "The invoice date cannot be in the future." })).toBe("purchase");
    expect(problemPlace({ message: "An old asset code can only be given when adding one asset." })).toBe("advanced");
    expect(problemPlace({ message: "The Item you chose is no longer active." })).toBe("item");
    expect(problemPlace({ message: "No code rule is set up." })).toBe("general");
    expect(refusalSummary([{ message: "a" }])).toBe("Nothing was added: 1 problem needs fixing, marked below. Everything you typed is still here.");
  });

  it("the default description is Item + brand + model", () => {
    expect(defaultDescription("Indoor Camera", "Dell", " Latitude ")).toBe("Indoor Camera Dell Latitude");
    expect(defaultDescription("Mouse", null, "")).toBe("Mouse");
  });
});
