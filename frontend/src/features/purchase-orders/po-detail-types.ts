/** One unit on a PO line, as every per-unit endpoint returns it (PendingAssetOut). */
export interface PendingAssetRow {
  id: number;
  purchase_order_id: number;
  /** S2.4: the PO line (1..n) this unit was ordered on. */
  line_no?: number | null;
  description: string;
  barcode: string | null;
  category_id: number;
  subcategory_id: number | null;
  item_id?: number | null;
  brand_id: number | null;
  model: string | null;
  warranty_years: number | null;
  cost_center_id: number;
  purchase_cost: number | null;
  tax_percent: number | null;
  total_cost: number | null;
  status: "PENDING" | "DELIVERED" | "CANCELLED";
  // False for a part that never carries a serial (mouse, keyboard); the
  // delivery dialog then starts with "No serial number" ticked for it.
  serial_required?: boolean;
  // The Item's serial is read later (an amplifier): delivery starts with "add it later" ticked.
  serial_later?: boolean;
  bundle_label?: string | null;
  serial_number: string | null;
  invoice_number: string | null;
  delivered_asset_id: number | null;
  /** S4: the code of the asset this received unit became (null while waiting / cancelled). */
  delivered_asset_code?: string | null;
}

/** One PO line (GET /purchase-orders/{id}/line-groups): every unit sharing a line number. */
export interface LineGroup {
  line_no: number;
  item_id: number | null;
  item_name: string | null;
  description: string;
  barcode: string | null;
  erp_item_code?: string | null;
  category_id: number | null;
  category_name: string | null;
  subcategory_id: number | null;
  subcategory_name: string | null;
  work_area: string | null;
  brand_id: number | null;
  brand_name: string | null;
  model: string | null;
  warranty_years: number | null;
  rate: number | null;
  tax_percent: number | null;
  unit_total?: number | null;
  /** received + waiting (cancelled units are no longer ordered). */
  ordered: number;
  received: number;
  waiting: number;
  cancelled: number;
  /** S7: received + waiting + cancelled (everything ever ordered on the line), and the cancelled part's value. */
  originally_ordered?: number;
  cancelled_value?: number;
  line_value: number;
  /** WAITING | PARTLY_RECEIVED | RECEIVED | CANCELLED */
  status: string;
  /** HAS_SERIAL | NO_SERIAL | SERIAL_LATER */
  serial_mode: string;
  bundle_label: string | null;
  waiting_unit_count?: number;
}

export interface Option {
  id: number;
  code?: string;
  email?: string;
  name: string;
}

export const money = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Laptop" (the Item), else the line's own description. */
export function lineTitle(l: Pick<LineGroup, "item_name" | "description">): string {
  return l.item_name?.trim() || l.description;
}

/** How many distinct lines a list of freshly made units spans (units without a number count as one line). */
export function distinctLines(units: { line_no?: number | null }[]): number {
  const nums = new Set(units.map((u) => u.line_no ?? "none"));
  return units.length === 0 ? 0 : nums.size;
}
