import { describe, it, expect } from "vitest";
import {
  BRAND_AREA_CHOICES, brandAreaChoiceOf, brandAreasOfChoice, brandAreasText, brandChoicesFor, brandsForArea,
} from "./brand-areas";

const DELL = { id: 1, name: "Dell", work_areas: ["IT"] };
const GODREJ = { id: 2, name: "Godrej", work_areas: ["NON_IT"] };
const SAMSUNG = { id: 3, name: "Samsung", work_areas: ["IT", "NON_IT"] };
const OLD = { id: 4, name: "Old server's brand" };            // an older server sends no work_areas: it counts as every area

describe("brands and work areas", () => {
  it("lists only the brands used for the work area, a brand for both in each, and everything when the area is not known", () => {
    const all = [DELL, GODREJ, SAMSUNG, OLD];
    expect(brandsForArea(all, "IT").map((b) => b.name)).toEqual(["Dell", "Samsung", "Old server's brand"]);
    expect(brandsForArea(all, "NON_IT").map((b) => b.name)).toEqual(["Godrej", "Samsung", "Old server's brand"]);
    expect(brandsForArea(all, null)).toHaveLength(4);
    expect(brandsForArea(all, undefined)).toHaveLength(4);
  });

  it("the picker options keep the brand already chosen even when it does not fit", () => {
    const names = (opts: { label: string }[]) => opts.map((o) => o.label);
    expect(names(brandChoicesFor([DELL, GODREJ, SAMSUNG], "IT", ""))).toEqual(["Dell", "Samsung"]);
    expect(names(brandChoicesFor([DELL, GODREJ, SAMSUNG], "IT", "2"))).toEqual(["Dell", "Samsung", "Godrej"]);
  });

  it("says where a brand is used in words", () => {
    expect(brandAreasText(["IT"])).toBe("IT");
    expect(brandAreasText(["NON_IT"])).toBe("Non-IT");
    expect(brandAreasText(["IT", "NON_IT"])).toBe("IT and Non-IT");
    expect(brandAreasText(undefined)).toBe("IT and Non-IT");
  });

  it("the Used for choice and the stored areas turn into each other", () => {
    for (const choice of BRAND_AREA_CHOICES) {
      expect(brandAreaChoiceOf(brandAreasOfChoice(choice.value))).toBe(choice.value);
    }
    expect(brandAreaChoiceOf(["NON_IT", "IT"])).toBe("BOTH");        // any order
    expect(brandAreaChoiceOf(undefined)).toBe("BOTH");
    expect(brandAreasOfChoice("NON_IT")).toEqual(["NON_IT"]);
    expect(brandAreasOfChoice("nonsense")).toEqual(["IT", "NON_IT"]);
  });
});
