import { describe, it, expect } from "vitest";
import { computeWarrantyUpto } from "./warranty";

describe("computeWarrantyUpto", () => {
  it("returns the purchase date itself when years is 0", () => {
    expect(computeWarrantyUpto("2026-04-10", 0)).toBe("2026-04-10");
  });

  it("matches the worked example: 10-Apr-2026 + 3 years -> 09-Apr-2029", () => {
    expect(computeWarrantyUpto("2026-04-10", 3)).toBe("2029-04-09");
  });

  it("handles a single warranty year", () => {
    expect(computeWarrantyUpto("2025-01-15", 1)).toBe("2026-01-14");
  });

  it("falls back to Feb 28 when a Feb 29 anchor lands on a non-leap target year", () => {
    expect(computeWarrantyUpto("2024-02-29", 1)).toBe("2025-02-27");
  });

  it("returns null when there is no purchase date yet", () => {
    expect(computeWarrantyUpto("", 3)).toBeNull();
  });
});
