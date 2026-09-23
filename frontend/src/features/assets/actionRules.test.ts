import { describe, it, expect } from "vitest";
import { actionsFor } from "./actionRules";

describe("actionsFor", () => {
  it("offers Allot/Transfer, Send for Repair and Lost from IN_STOCK", () => {
    const labels = actionsFor("IN_STOCK").map((a) => a.label);
    expect(labels).toContain("Move / Allot");
    expect(labels).toContain("Send for Repair");
    expect(labels).toContain("Dispose");
    expect(labels).not.toContain("Receive from Repair");
  });

  it("offers only Receive from Repair and Scrap from UNDER_REPAIR", () => {
    const labels = actionsFor("UNDER_REPAIR").map((a) => a.label);
    expect(labels).toEqual(expect.arrayContaining(["Receive from Repair", "Scrap"]));
    expect(labels).not.toContain("Dispose");
  });

  it("offers nothing from a terminal status", () => {
    expect(actionsFor("DISPOSED")).toEqual([]);
  });
});
