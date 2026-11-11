import { describe, expect, it } from "vitest";
import { fromSummary, storeOwnedRoomIds } from "./storeRooms";

const PLACES = [
  { id: 1, code: "LAM", asset_user_type: "STORE", company_id: 1 },
  { id: 2, code: "STK-LAM", asset_user_type: "STOCK_POINT", company_id: 1 },          // Lamington's own stock room
  { id: 3, code: "INS-LAM", asset_user_type: "INSTALLED", company_id: 1 },            // Lamington's own install point
  { id: 4, code: "STK-HOSTOCK", asset_user_type: "STOCK_POINT", company_id: 1 },      // a real stock point
  { id: 5, code: "INS-HOSITE", asset_user_type: "INSTALLED", company_id: 1 },         // a real site (head office)
  { id: 6, code: "STK-LAM", asset_user_type: "STOCK_POINT", company_id: 2 },          // same words, other company: no store LAM there
  { id: 7, code: "INS-LAM", asset_user_type: "STOCK_POINT", company_id: 1 },          // wrong kind for INS-: not a store's install point
  { id: 8, code: null, asset_user_type: "EMPLOYEE", company_id: 1 },
];

describe("storeOwnedRoomIds", () => {
  it("finds a store's own stock room and install point, and nothing else", () => {
    expect([...storeOwnedRoomIds(PLACES)].sort()).toEqual([2, 3]);
  });
  it("matches the store code in capitals or small letters, per company", () => {
    const ids = storeOwnedRoomIds([
      { id: 1, code: "spr2", asset_user_type: "STORE", company_id: 5 },
      { id: 2, code: "STK-SPR2", asset_user_type: "STOCK_POINT", company_id: 5 },
      { id: 3, code: "stk-spr2", asset_user_type: "STOCK_POINT", company_id: 6 },
    ]);
    expect([...ids]).toEqual([2]);
  });
  it("is empty when there are no stores", () => {
    expect(storeOwnedRoomIds([{ id: 4, code: "STK-HOSTOCK", asset_user_type: "STOCK_POINT", company_id: 1 }]).size).toBe(0);
  });
});

describe("fromSummary", () => {
  it("counts the assets by where they are now, the biggest group first", () => {
    expect(fromSummary(["WH Stock", "Ramesh", "WH Stock", "WH Stock", "Ramesh", "Meena"])).toBe("3 from WH Stock, 2 from Ramesh, 1 from Meena");
  });
  it("names a missing place plainly and is empty for no assets", () => {
    expect(fromSummary([null, "HO Stock", "HO Stock"])).toBe("2 from HO Stock, 1 from an unknown place");
    expect(fromSummary([])).toBe("");
  });
});
