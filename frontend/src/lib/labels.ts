/**
 * The ONE place that turns CKAM's backend codes into the words people see.
 *
 * Backend values (Asset.status, AssetUser.asset_user_type, AssetUser.role,
 * asset_domain, event types, audited field names) are never changed or sent
 * from here -- every API payload keeps using the raw code. Screens call these
 * helpers whenever they *display* one of those codes, so no raw enum such as
 * IN_STOCK, STOCK_POINT or SELF_SERVICE ever reaches the screen.
 *
 * An unknown code (a value added on the server later) is shown in sentence
 * case rather than as raw upper-case-with-underscores, so nothing breaks.
 */

/** "UNDER_REPAIR" -> "Under repair" (fallback for codes not listed below). */
export function humanizeCode(code: string | null | undefined): string {
  if (!code) return "";
  const words = code.replace(/[_.]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Asset status
// ---------------------------------------------------------------------------

/** Every lifecycle state, in the order filters list them (backend ASSET_STATUSES). */
export const ASSET_STATUSES = [
  "IN_STOCK", "ALLOTTED", "INSTALLED", "UNDER_REPAIR", "LOST", "SOLD", "SCRAPPED", "DISPOSED",
] as const;

const STATUS_LABELS: Record<string, string> = {
  IN_STOCK: "In Stock",
  ALLOTTED: "With Employee / Store",
  INSTALLED: "Installed",
  UNDER_REPAIR: "Under Repair",
  LOST: "Lost",
  SOLD: "Sold",
  SCRAPPED: "Scrapped",
  DISPOSED: "Disposed",
};

/**
 * The word for an asset status. When the type of whoever holds it is known
 * (the asset row carries `current_asset_user_type`), ALLOTTED is said exactly:
 * "With Employee" or "With Store"; otherwise "With Employee / Store".
 */
export function statusLabel(status: string | null | undefined, holderType?: string | null): string {
  if (!status) return "";
  if (status === "ALLOTTED") {
    if (holderType === "EMPLOYEE") return "With Employee";
    if (holderType === "STORE") return "With Store";
  }
  return STATUS_LABELS[status] ?? humanizeCode(status);
}

/** Options for a status filter (value = backend code, label = plain word). */
export function statusOptions(): { value: string; label: string }[] {
  return ASSET_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }));
}

// ---------------------------------------------------------------------------
// People & places (backend: AssetUser.asset_user_type)
// ---------------------------------------------------------------------------

export const PLACE_TYPES = ["EMPLOYEE", "STORE", "STOCK_POINT", "INSTALLED"] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];

const PLACE_TYPE_LABELS: Record<string, string> = {
  EMPLOYEE: "Employee",
  STORE: "Store",
  STOCK_POINT: "Stock Room",
  INSTALLED: "Install Point",
};

const PLACE_TYPE_PLURALS: Record<string, string> = {
  EMPLOYEE: "Employees",
  STORE: "Stores",
  STOCK_POINT: "Stock Rooms",
  INSTALLED: "Install Points",
};

/** "STOCK_POINT" -> "Stock Room". */
export function placeTypeLabel(type: string | null | undefined): string {
  if (!type) return "";
  return PLACE_TYPE_LABELS[type] ?? humanizeCode(type);
}

/** "STOCK_POINT" -> "Stock Rooms". */
export function placeTypePlural(type: string | null | undefined): string {
  if (!type) return "";
  return PLACE_TYPE_PLURALS[type] ?? `${placeTypeLabel(type)}s`;
}

// ---------------------------------------------------------------------------
// Login roles (backend: AssetUser.role)
// ---------------------------------------------------------------------------

export const ROLES = ["ADMIN", "OPERATOR", "VIEWER", "SELF_SERVICE"] as const;

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Full Admin",
  OPERATOR: "Can Add & Move Assets",
  VIEWER: "View Only",
  SELF_SERVICE: "Own Assets Only",
};

/** The Primary Owner flag is shown as its own role word. */
export const PRIMARY_OWNER_LABEL = "Head-office Admin";

export function roleLabel(role: string | null | undefined, isPrimaryOwner = false): string {
  if (isPrimaryOwner) return PRIMARY_OWNER_LABEL;
  if (!role) return "";
  return ROLE_LABELS[role] ?? humanizeCode(role);
}

// ---------------------------------------------------------------------------
// Work area (backend: asset_domain IT / NON_IT)
// ---------------------------------------------------------------------------

const WORK_AREA_LABELS: Record<string, string> = {
  IT: "IT Team",
  NON_IT: "Admin / Non-IT Team",
  BOTH: "Both",
  ALL: "All",
};

/** "NON_IT" -> "Admin / Non-IT Team". */
export function workAreaLabel(domain: string | null | undefined): string {
  if (!domain) return "";
  return WORK_AREA_LABELS[domain] ?? humanizeCode(domain);
}

/** The two real work areas, for selects that set or filter one. */
export const WORK_AREA_OPTIONS = [
  { value: "IT", label: workAreaLabel("IT") },
  { value: "NON_IT", label: workAreaLabel("NON_IT") },
];

// ---------------------------------------------------------------------------
// Asset history (event types) and the Changes tab (audited field names)
// ---------------------------------------------------------------------------

const EVENT_LABELS: Record<string, string> = {
  PROCURED: "Received",
  IMPORTED: "Imported",
  MOVED: "Moved",
  SENT_FOR_REPAIR: "Sent for repair",
  RECEIVED_FROM_REPAIR: "Back from repair",
  DISPOSED: "Disposed",
  SOLD: "Sold",
  SCRAPPED: "Scrapped",
  LOST: "Reported lost",
  FOUND: "Found",
  CORRECTION: "Corrected",
};

export function eventLabel(eventType: string | null | undefined): string {
  if (!eventType) return "";
  return EVENT_LABELS[eventType] ?? humanizeCode(eventType);
}

const FIELD_LABELS: Record<string, string> = {
  legacy_asset_code: "Legacy asset code",
  brand_id: "Brand",
  model: "Model",
  serial_number: "Serial number",
  barcode: "Barcode",
  description: "Description",
  vendor_id: "Vendor",
  po_number: "PO number",
  po_date: "PO date",
  invoice_number: "Invoice number",
  invoice_date: "Invoice date",
  invoice_amount: "Invoice amount",
  pi_number: "Purchase Invoice (PI) number",
  pi_date: "Purchase Invoice (PI) date",
  purchase_cost: "Purchase cost",
  tax_percent: "Tax %",
  warranty_years: "Warranty (years)",
  category_id: "Category",
  subcategory_id: "Sub-category",
  purchase_date: "Purchase date",
  cost_center_id: "Cost Centre",
  item_id: "Item",
};

/**
 * A readable name for an audited field. Custom fields arrive as
 * "custom_fields.<key>"; pass the custom-field labels (key -> label) to show
 * the label the admin gave the field.
 */
export function fieldLabel(fieldName: string, customFieldLabels?: Record<string, string>): string {
  if (fieldName.startsWith("custom_fields.")) {
    const key = fieldName.slice("custom_fields.".length);
    return customFieldLabels?.[key] ?? humanizeCode(key);
  }
  return FIELD_LABELS[fieldName] ?? humanizeCode(fieldName);
}
