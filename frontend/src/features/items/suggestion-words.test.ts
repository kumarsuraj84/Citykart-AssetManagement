import { describe, it, expect } from "vitest";
import { hasSuggestion, suggestionWords } from "./suggestion-words";

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
