import { describe, it, expect } from "vitest";
import { actionsFor, targetLabelFor } from "./actionRules";

describe("targetLabelFor", () => {
  it("says Move To for a move and Received Into for a return from repair or a found asset", () => {
    expect(targetLabelFor("MOVED")).toBe("Move To");
    expect(targetLabelFor("RECEIVED_FROM_REPAIR")).toBe("Received Into");
    expect(targetLabelFor("FOUND")).toBe("Received Into");
  });

  it("every action that needs a person/place has a plain label (never 'Asset User')", () => {
    for (const status of ["IN_STOCK", "ALLOTTED", "INSTALLED", "UNDER_REPAIR", "LOST"]) {
      for (const a of actionsFor(status).filter((x) => x.needsAssetUser)) {
        expect(targetLabelFor(a.eventType)).not.toMatch(/asset user|holder/i);
      }
    }
  });
});

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
