import { describe, it, expect } from "vitest";
import { hasSuggestion, isSameName, suggestionNeedsConfirm, suggestionQuestion, suggestionWords } from "./suggestion-words";

describe("asking before a suggestion is used (S7 fix 2, N1)", () => {
  const same = { suggestion_reason_code: "SAME_NAME", suggestion_reason: "same name", suggestion_score: 1 };
  const similar = { suggestion_reason_code: "SIMILAR_NAME", suggestion_reason: "similar name", suggestion_score: 0.85 };

  it("a same-name suggestion for a product name or a code stays one click", () => {
    expect(isSameName(same)).toBe(true);
    expect(suggestionNeedsConfirm(same, "NAME")).toBe(false);
    expect(suggestionNeedsConfirm(same, "CODE")).toBe(false);
  });

  it("a similar name, or a whole ERP group, asks first", () => {
    expect(suggestionNeedsConfirm(similar, "CODE")).toBe(true);
    expect(suggestionNeedsConfirm(similar, "NAME")).toBe(true);
    expect(suggestionNeedsConfirm(same, "ARTICLE")).toBe(true);
  });

  it("the question names the Item, the group or code, and the reach", () => {
    expect(suggestionQuestion("Indoor Camera", "ARTICLE", { group: "FA_CE_CAMERA" })).toBe(
      "Use Indoor Camera for every code in group FA_CE_CAMERA? This is remembered for everyone.");
    expect(suggestionQuestion("HOPBOX", "NAME", { name: "R-51 HOP BOX", group: "FA_CE_HOPBOX" })).toBe(
      "Use HOPBOX for every code named “R-51 HOP BOX”? This is remembered for everyone.");
    expect(suggestionQuestion("HOPBOX", "CODE", { code: "CT99609" })).toBe("Use HOPBOX for the ERP code CT99609? This is remembered for everyone.");
    expect(suggestionQuestion("HOPBOX", "NONE", { code: "CT99609" })).toBe("Use HOPBOX for the ERP code CT99609 on this purchase order only?");
  });
});

describe("suggestion words (S7 P1-3)", () => {
  it("'Same name' only when the server says the names are the same", () => {
    expect(suggestionWords({ suggestion_score: 1, suggestion_reason_code: "SAME_NAME", suggestion_reason: "same name" })).toBe("Same name");
    expect(suggestionWords({ suggestion_score: 1, suggestion_reason: "same name" })).toBe("Same name");
  });

  it("otherwise 'Similar name (72%)', never 100 % and never 'match'", () => {
    expect(suggestionWords({ suggestion_score: 0.72, suggestion_reason_code: "SIMILAR_NAME" })).toBe("Similar name (72%)");
    expect(suggestionWords({ suggestion_score: 1 })).toBe("Similar name (99%)");
    expect(suggestionWords({ suggestion_score: null })).toBe("Similar name");
  });

  it("no suggestion = nothing to show", () => {
    expect(hasSuggestion({ suggested_item_id: null, suggested_item_name: null })).toBe(false);
    expect(hasSuggestion({ suggested_item_id: 4, suggested_item_name: "HOPBOX" })).toBe(true);
  });
});
