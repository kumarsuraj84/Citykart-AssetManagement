import { describe, it, expect } from "vitest";
import {
  brandOptions,
  codesById,
  costCentreOptions,
  itemOption,
  itemOptions,
  namesById,
  placeOption,
  placeOptions,
  spansCompanies,
  stockRoomOptions,
  vendorOptions,
} from "./option-labels";

const text = (o: { label: string; detail?: string }) => (o.detail ? `${o.label} · ${o.detail}` : o.label);

describe("option-labels: every important dropdown shows context", () => {
  const categories = { 1: "IT Fixed Assets", 2: "Furniture" };
  const subcategories = { 10: "Laptop", 20: "Office Desks" };

  it("Item: 'Laptop · IT Fixed Assets' (the Sub-category only when it adds something)", () => {
    expect(text(itemOption({ id: 5, name: "Laptop", category_id: 1, subcategory_id: 10 }, { categories, subcategories }))).toBe(
      "Laptop · IT Fixed Assets",
    );
    expect(text(itemOption({ id: 6, name: "Desk", category_id: 2, subcategory_id: 20 }, { categories, subcategories }))).toBe(
      "Desk · Furniture › Office Desks",
    );
    // Names the endpoint already sent win; no lookups needed.
    expect(text(itemOption({ id: 7, name: "UPS", category_name: "Power", subcategory_name: null }))).toBe("UPS · Power");
    // Nothing known: just the name, value is the id.
    expect(itemOption({ id: 8, name: "Fan" })).toEqual({ value: "8", label: "Fan", detail: undefined });
    expect(itemOptions(undefined)).toEqual([]);
  });

  it("people/places: 'CODE · Name · Place', company only when the list spans companies, never name-only", () => {
    const locations = { 1: "Head Office", 2: "Lamington Road" };
    const companies = { 1: "CKSPL", 2: "CKV" };
    const one = [
      { id: 1, code: "CS6872", name: "Ankur Pahwa", asset_user_type: "EMPLOYEE", company_id: 1, location_id: 1, email: "a@x.in" },
      { id: 2, code: "LAM", name: "Lamington Road", asset_user_type: "STORE", company_id: 1, location_id: 2 },
    ];
    const opts = placeOptions(one, { locations, companies });
    expect(opts.map(text)).toEqual(["CS6872 · Ankur Pahwa · Head Office", "LAM · Lamington Road"]);
    // Searchable by code and email.
    expect(opts[0].keywords).toEqual(["CS6872", "a@x.in"]);

    const two = [...one, { id: 3, code: "STK-HO", name: "HO Stock", asset_user_type: "STOCK_POINT", company_id: 2, location_id: 1 }];
    expect(spansCompanies(two)).toBe(true);
    expect(placeOptions(two, { locations, companies }).map(text)).toEqual([
      "CS6872 · Ankur Pahwa · Head Office · CKSPL",
      "LAM · Lamington Road · CKSPL",
      "HO Stock · Head Office · CKV",
    ]);
  });

  it("Stock Room: 'HO Stock · Head Office · CKSPL'", () => {
    const rows = [{ id: 3, code: "STK-HO", name: "HO Stock", company_id: 1, location_id: 1 }];
    expect(stockRoomOptions(rows, { locations: { 1: "Head Office" }, companies: { 1: "CKSPL" }, showCompany: true }).map(text)).toEqual([
      "HO Stock · Head Office · CKSPL",
    ]);
    expect(text(placeOption({ id: 4, name: "Somebody" }))).toBe("Somebody");
  });

  it("Cost Centre 'IT-HO · IT Head Office', Vendor 'Name · GSTIN', Brand by name", () => {
    expect(costCentreOptions([{ id: 1, code: "IT-HO", name: "IT Head Office" }]).map(text)).toEqual(["IT-HO · IT Head Office"]);
    expect(vendorOptions([{ id: 1, name: "Acme", gstin: "07ABCDE1234F1Z5" }, { id: 2, name: "No Gst", gstin: null }]).map(text)).toEqual([
      "Acme · 07ABCDE1234F1Z5",
      "No Gst",
    ]);
    expect(brandOptions([{ id: 1, name: "Dell" }]).map(text)).toEqual(["Dell"]);
  });

  it("lookup helpers tolerate odd responses", () => {
    expect(namesById(undefined)).toEqual({});
    expect(codesById([{ id: 1, name: "CityKart", code: "CKSPL" }, { id: 2, name: "No Code" }])).toEqual({ 1: "CKSPL", 2: "No Code" });
  });
});
