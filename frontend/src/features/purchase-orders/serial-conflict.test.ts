import { describe, it, expect } from "vitest";
import { serialConflictSentence } from "./serial-conflict";

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
