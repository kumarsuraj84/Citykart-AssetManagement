/** The serial-number rule lives on the Item only (Setup > Items). It is just a
 * default: a serial can always be typed, and a missing one saved as "No serial
 * number" (N/A). */
export const yesNo = (v: boolean) => (v ? "Yes" : "No");
