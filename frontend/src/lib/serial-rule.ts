/** Whether items of a category / sub-category carry a serial number. Mirrors
 * app.masters.serial_rule on the server: the sub-category's own setting when it
 * has one (true/false), else its category's. Only a default -- a serial can
 * always be typed, and a missing one saved as "No serial number" (N/A). */
export interface SerialRuled {
  serial_required?: boolean | null;
}

export function effectiveSerialRequired(category: SerialRuled | undefined, subcategory: SerialRuled | undefined): boolean {
  if (subcategory && subcategory.serial_required != null) return subcategory.serial_required;
  return category?.serial_required !== false;
}

export const SERIAL_CATEGORY_OPTIONS = [
  { value: "yes", label: "Yes, has a serial number" },
  { value: "no", label: "No serial number" },
];

export const SERIAL_SUBCATEGORY_OPTIONS = [
  { value: "same", label: "Same as the category" },
  ...SERIAL_CATEGORY_OPTIONS,
];

export const yesNo = (v: boolean) => (v ? "Yes" : "No");
