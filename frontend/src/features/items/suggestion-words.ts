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
  /** S7 fix 2: the reach the server judged the suggestion for (ARTICLE / NAME / CODE). */
  suggestion_scope?: "ARTICLE" | "NAME" | "CODE" | null;
}

export function hasSuggestion(s: SuggestionFields): boolean {
  return s.suggested_item_id != null && !!(s.suggested_item_name ?? "").trim();
}

/** The server said the names are the same (not just similar). */
export function isSameName(s: SuggestionFields): boolean {
  const code = (s.suggestion_reason_code ?? "").toUpperCase();
  const reason = (s.suggestion_reason ?? "").trim().toLowerCase();
  return code === "SAME_NAME" || (!code && reason === "same name");
}

/**
 * S7 fix 2 (N1): "Use suggestion" saves a rule everyone follows, so it asks first when the name is only
 * similar, or when the rule reaches a whole ERP group. A same-name suggestion for one product name or one code
 * stays one click.
 */
export function suggestionNeedsConfirm(s: SuggestionFields, reach: string | null | undefined): boolean {
  return !isSameName(s) || reach === "ARTICLE";
}

/** "every code in group FA_CE_CAMERA", "every code named “INDOOR CAMERA”", "the ERP code CT1" (for the question). */
export function reachWords(reach: string | null | undefined, where: { group?: string | null; name?: string | null; code?: string | null }): string {
  if (reach === "ARTICLE") return `every code in group ${where.group || "this ERP group"}`;
  if (reach === "NAME") return where.name ? `every code named “${where.name}”` : `each product name in group ${where.group || "this ERP group"}`;
  if (reach === "CODE") return where.code ? `the ERP code ${where.code}` : `each code in group ${where.group || "this ERP group"}`;
  return where.code ? `the ERP code ${where.code} on this purchase order only` : "this line only";
}

/** "Use Indoor Camera for every code in group FA_CE_CAMERA? This is remembered for everyone." */
export function suggestionQuestion(itemName: string, reach: string | null | undefined, where: { group?: string | null; name?: string | null; code?: string | null }): string {
  const remembered = reach === "ARTICLE" || reach === "NAME" || reach === "CODE";
  return `Use ${itemName} for ${reachWords(reach, where)}?${remembered ? " This is remembered for everyone." : ""}`;
}

export function suggestionWords(s: SuggestionFields): string {
  if (isSameName(s)) return "Same name";
  const score = typeof s.suggestion_score === "number" && Number.isFinite(s.suggestion_score) ? s.suggestion_score : null;
  // A score is shown as a percentage, but never as 100 % unless the server said "same name" (handled above).
  if (score !== null && score > 0) return `Similar name (${Math.min(99, Math.round(score * 100))}%)`;
  return "Similar name";
}
