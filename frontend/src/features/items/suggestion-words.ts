/**
 * How sure a suggested Item is, in honest words (S7 fix P1-3). The UAT found
 * "AI BOX (100% match)" offered for a gang box and a hop box: the old screen
 * turned a token score into a percentage "match". Now the server says WHY it
 * suggests an Item (`suggestion_reason_code`: SAME_NAME / SIMILAR_NAME) and
 * the screen repeats only that:
 *
 * - "Same name" -- only when the server says the names are the same;
 * - "Similar name (72%)" -- otherwise, with the server's score;
 * - nothing at all when the server has no safe suggestion (it sends nulls).
 *
 * A suggestion is never chosen for the person: it is one button to press.
 */
export interface SuggestionFields {
  suggested_item_id?: number | null;
  suggested_item_name?: string | null;
  suggestion_score?: number | null;
  /** S7: "same name" / "similar name". */
  suggestion_reason?: string | null;
  /** S7: SAME_NAME / SIMILAR_NAME. */
  suggestion_reason_code?: string | null;
}

export function hasSuggestion(s: SuggestionFields): boolean {
  return s.suggested_item_id != null && !!(s.suggested_item_name ?? "").trim();
}

export function suggestionWords(s: SuggestionFields): string {
  const code = (s.suggestion_reason_code ?? "").toUpperCase();
  const reason = (s.suggestion_reason ?? "").trim().toLowerCase();
  if (code === "SAME_NAME" || (!code && reason === "same name")) return "Same name";
  const score = typeof s.suggestion_score === "number" && Number.isFinite(s.suggestion_score) ? s.suggestion_score : null;
  // A score is shown as a percentage, but never as 100 % unless the server said "same name" (handled above).
  if (score !== null && score > 0) return `Similar name (${Math.min(99, Math.round(score * 100))}%)`;
  return "Similar name";
}
