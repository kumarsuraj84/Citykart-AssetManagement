import { describe, it, expect } from "vitest";
import { MASKED_ASSET, serialConflictSentence } from "./serial-conflict";
import { conflictMap } from "../receive/useSerialConflicts";

describe("serialConflictSentence", () => {
  it("names the asset by its code", () => {
    expect(serialConflictSentence("111", "FA/CKSPL/IT/0007")).toBe('Serial "111" is already used by asset FA/CKSPL/IT/0007.');
  });
  it("shows the server's masked wording as returned", () => {
    expect(serialConflictSentence("111", "an asset outside your companies or work area")).toBe(
      'Serial "111" is already used by an asset outside your companies or work area.',
    );
  });
});

describe("S6: check-serials `masked`", () => {
  it("a masked conflict becomes 'an asset you cannot see'; an ordinary one keeps its code", () => {
    const map = conflictMap([
      { serial: "LAP-1", asset_code: "S0/S0IT/001", masked: false },
      { serial: "CHAIR-1", asset_code: "an asset outside your companies or work area", masked: true },
      { serial: "OLD-1", asset_code: "FA/9" },
    ]);
    expect(map).toEqual({ "lap-1": "S0/S0IT/001", "chair-1": MASKED_ASSET, "old-1": "FA/9" });
    expect(serialConflictSentence("CHAIR-1", map["chair-1"])).toBe('Serial "CHAIR-1" is already used by an asset you cannot see.');
  });
});
