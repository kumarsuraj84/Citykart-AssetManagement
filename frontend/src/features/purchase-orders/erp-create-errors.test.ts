import { describe, it, expect } from "vitest";
import { lineIndexesForServerMessage } from "./erp-create-errors";

const CODES = ["CT1", "CT2", "ct1", null];

describe("lineIndexesForServerMessage", () => {
  it("'Line N (...)' points at line N", () => {
    expect(lineIndexesForServerMessage("Line 2 (CT2): the cost 60 is too far from the ERP rate 100 (...).", CODES)).toEqual([1]);
    expect(lineIndexesForServerMessage("Line 1: this ERP item code is not on the ERP purchase order X.", CODES)).toEqual([0]);
  });
  it("a line number past the end points at nothing", () => {
    expect(lineIndexesForServerMessage("Line 9 (X): nope", CODES)).toEqual([]);
    expect(lineIndexesForServerMessage("Line 0 (X): nope", CODES)).toEqual([]);
  });
  it("'CODE: n units asked ...' points at every line with that code, ignoring case", () => {
    expect(lineIndexesForServerMessage("CT1: 9 units asked, but the ERP purchase order has only 7 open.", CODES)).toEqual([0, 2]);
  });
  it("an order-level sentence points at nothing", () => {
    expect(lineIndexesForServerMessage("This purchase order was not found in the ERP.", CODES)).toEqual([]);
    expect(lineIndexesForServerMessage("Choose the ERP purchase order this is created from.", CODES)).toEqual([]);
    expect(lineIndexesForServerMessage("", CODES)).toEqual([]);
  });
});
