import { describe, it, expect } from "vitest";
import { MAX_QUANTITY, quantityHint, quantityProblem } from "./limits";

describe("quantity limits (1 to 1,000)", () => {
  it("accepts whole numbers from 1 to 1,000", () => {
    for (const v of ["1", "7", " 25 ", "1000", 500]) expect(quantityProblem(v)).toBeNull();
    expect(MAX_QUANTITY).toBe(1000);
  });

  it.each([
    ["", /enter how many/i],
    ["0", /at least 1/i],
    ["-3", /at least 1/i],
    ["1001", /at most 1,000/i],
    ["15000000000", /at most 1,000/i],
    ["2.5", /whole number/i],
    ["abc", /whole number/i],
  ])("refuses %j with a sentence", (value, pattern) => {
    expect(quantityProblem(value)).toMatch(pattern);
  });

  it("respects a lower maximum (the ERP's open quantity)", () => {
    expect(quantityProblem("7", 7)).toBeNull();
    expect(quantityProblem("8", 7)).toMatch(/at most 7/i);
  });

  it("the hint says the range", () => {
    expect(quantityHint()).toBe("Whole number, 1 to 1,000.");
    expect(quantityHint(7)).toBe("Whole number, 1 to 7.");
  });
});
