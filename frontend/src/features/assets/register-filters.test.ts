import { describe, it, expect } from "vitest";
import {
  filterKey, holderCode, moreFilterCount, registerQuery, statusChipLabel, statusChoiceOf, statusChoices, withStatusChoice,
} from "./register-filters";

const opts = { myId: null, page: 0, pageSize: 50 };

describe("register filters", () => {
  it("the address bar becomes the server's query, in words it understands", () => {
    expect(registerQuery({}, opts)).toBe("limit=50&offset=0");
    expect(registerQuery({ q: " dell ", exact: true, status: "ALLOTTED", holder: "stock-room", with: "6", item: "11", vendor: "9", po: " PO-1 ", area: "IT", company: "2", group: "3" }, { ...opts, page: 2, sortBy: "po_number", sortDir: "desc" }))
      .toBe("q=dell&exact=true&status=ALLOTTED&holder_type=STOCK_POINT&asset_user_id=6&item_id=11&vendor_id=9&po_number=PO-1&work_area=IT&company_id=2&category_id=3&sort_by=po_number&sort_dir=desc&limit=50&offset=100");
    // exact only with text; Mine wins over a chosen person.
    expect(registerQuery({ exact: true }, opts)).toBe("limit=50&offset=0");
    expect(registerQuery({ mine: true, with: "6" }, { ...opts, myId: 5 })).toBe("asset_user_id=5&limit=50&offset=0");
  });

  it("holder words and codes", () => {
    expect(holderCode("install-point")).toBe("INSTALLED");
    expect(holderCode("STORE")).toBe("STORE");
    expect(holderCode("nonsense")).toBeUndefined();
  });

  it("With Employee / With Store are a status plus a holder; switching away drops the holder it brought", () => {
    const s = withStatusChoice({}, "ALLOTTED:STORE");
    expect(s).toEqual({ status: "ALLOTTED", holder: "store" });
    expect(statusChoiceOf(s)).toBe("ALLOTTED:STORE");
    expect(statusChipLabel(s)).toBe("With Store");
    expect(withStatusChoice(s, "LOST")).toEqual({ status: "LOST", holder: undefined });
    // A holder chosen on its own stays when the status changes.
    expect(withStatusChoice({ holder: "stock-room" }, "IN_STOCK")).toEqual({ holder: "stock-room", status: "IN_STOCK" });
    expect(statusChipLabel({ status: "ALLOTTED" })).toBe("With Employee / Store");
    expect(statusChoices().map((c) => c.label)).toEqual(["In Stock", "With Employee", "With Store", "Installed", "Under Repair", "Lost", "Sold", "Scrapped", "Disposed"]);
    expect(statusChoices("ALLOTTED")[1].label).toBe("With Employee / Store");
  });

  it("paging restarts when what matches changes, and the More filters count", () => {
    expect(filterKey({ q: "a" })).not.toBe(filterKey({ q: "b" }));
    expect(filterKey({ q: "a", find: true })).toBe(filterKey({ q: "a" }));
    expect(moreFilterCount({ q: "x", mine: true, status: "LOST", po: "1" })).toBe(2);
  });
});
