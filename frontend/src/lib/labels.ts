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

/**
 * S7 (P3-4): a holder's name as people read it. Records made by older set-up steps carry an
 * auto-made "Stock Point - " in front of the name ("Stock Point - WH Stores Farukhnagar");
 * the screens show just "WH Stores Farukhnagar" (the kind is shown next to it anyway).
 */
export function holderDisplayName(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/^\s*stock\s*point\s*[-–—:]\s*/i, "").trim() || name.trim();
}

/** The same words, ignoring case and outer spaces (two cells saying the same thing). */
export function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
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
// Purchase orders: the status of a PO or of one of its lines, a unit's own
// status, and a line's serial mode (S2)
// ---------------------------------------------------------------------------

/** PO / PO line statuses, in the order the filter chips list them. */
export const PO_STATUSES = ["WAITING", "PARTLY_RECEIVED", "RECEIVED", "CANCELLED"] as const;

const PO_STATUS_LABELS: Record<string, string> = {
  WAITING: "Waiting",
  PARTLY_RECEIVED: "Partly Received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

/** "PARTLY_RECEIVED" -> "Partly Received" (a PO or one of its lines). */
export function poStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return PO_STATUS_LABELS[status] ?? humanizeCode(status);
}

const PO_UNIT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Waiting",
  DELIVERED: "Received",
  CANCELLED: "Cancelled",
};

/** One unit on a PO line: "PENDING" -> "Waiting", "DELIVERED" -> "Received". */
export function poUnitStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return PO_UNIT_STATUS_LABELS[status] ?? humanizeCode(status);
}

const SERIAL_MODE_LABELS: Record<string, string> = {
  HAS_SERIAL: "Has serial number",
  NO_SERIAL: "No serial number",
  SERIAL_LATER: "Serial will be entered later",
};

/** A PO line's `serial_mode` in plain words. */
export function serialModeLabel(mode: string | null | undefined): string {
  if (!mode) return "";
  return SERIAL_MODE_LABELS[mode] ?? humanizeCode(mode);
}

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

// ---------------------------------------------------------------------------
// S8: Logs & Diagnostics (audit categories / actions / outcomes, record types,
// error levels and kinds, system components, problem-report kinds and statuses).
// The raw code stays visible in the detail views as a muted technical line.
// ---------------------------------------------------------------------------

export const AUDIT_CATEGORIES = ["DATA", "SECURITY", "ACCESS", "IMPORT", "EXPORT", "ERP", "LIFECYCLE", "SYSTEM"] as const;

const AUDIT_CATEGORY_LABELS: Record<string, string> = {
  DATA: "Data change",
  SECURITY: "Security",
  ACCESS: "Access",
  IMPORT: "Import",
  EXPORT: "Export",
  ERP: "ERP",
  LIFECYCLE: "Asset movement",
  SYSTEM: "System",
};

export function auditCategoryLabel(category: string | null | undefined): string {
  if (!category) return "";
  return AUDIT_CATEGORY_LABELS[category.toUpperCase()] ?? humanizeCode(category);
}

export const AUDIT_OUTCOMES = ["OK", "DENIED", "FAILED"] as const;

const AUDIT_OUTCOME_LABELS: Record<string, string> = { OK: "Done", DENIED: "Refused", FAILED: "Failed" };

export function auditOutcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return "";
  return AUDIT_OUTCOME_LABELS[outcome.toUpperCase()] ?? humanizeCode(outcome);
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: "Created",
  UPDATE: "Changed",
  DEACTIVATE: "Deactivated",
  REACTIVATE: "Reactivated",
  DELETE: "Deleted",
  WRITE: "Saved (no specific entry)",
  LOGIN: "Signed in",
  LOGIN_FAILED: "Failed sign-in",
  LOCKED: "Account locked",
  LOGOUT: "Signed out",
  TOKEN_REFRESH_FAILED: "Session could not be renewed",
  INVALID_TOKEN: "Invalid session",
  PASSWORD_CHANGED: "Password changed",
  PASSWORD_CHANGE_FAILED: "Password change failed",
  PASSWORD_RESET: "Password reset",
  ACCESS_CHANGED: "Access changed",
  PRIMARY_OWNER_GRANTED: "Made head-office admin",
  PRIMARY_OWNER_REVOKED: "No longer head-office admin",
  PERMISSION_DENIED: "Refused",
  CODE_RULE_CHANGED: "Asset code format changed",
  SUSPICIOUS_INPUT: "Suspicious input",
  EXPORT: "Exported",
  IMPORT_PREVIEW: "Import checked",
  IMPORT_COMMIT: "Imported",
  RECEIVE: "Received",
  BATCH_ADD: "Assets added",
  MOVE: "Moved",
  LINK: "Linked",
  SERIALS_FILLED: "Serial numbers filled in",
  LINES_ADDED: "Lines added",
  LINE_UPDATE: "Line changed",
  CANCEL_WAITING: "Waiting units cancelled",
  DELETE_PO: "Purchase order deleted",
  PI_RECORDED: "Purchase invoice recorded",
  SENT_FOR_REPAIR: "Sent for repair",
  RECEIVED_FROM_REPAIR: "Back from repair",
  DISPOSED: "Disposed",
  SOLD: "Sold",
  SCRAPPED: "Scrapped",
  LOST: "Reported lost",
  FOUND: "Found",
  CORRECTION: "Corrected",
  DOCUMENT_UPLOADED: "Document uploaded",
  DOCUMENT_DOWNLOADED: "Document downloaded",
  IDEMPOTENT_REPLAY: "Repeated save answered",
  IDEMPOTENT_CONFLICT: "Repeated save refused",
  LOGS_VIEWED: "Logs viewed",
  DIAGNOSTICS_VIEWED: "Diagnostics viewed",
  DIAGNOSTICS_BUNDLE: "Diagnostics copied",
  CLIENT_REPORT_STATUS: "Problem report marked",
  ERP_SYNC: "ERP data copied",
  STORES_CREATE: "Stores created from the ERP",
  CREATE_FROM_ERP: "Created from the ERP",
  ERP_CHANGES_APPLIED: "ERP changes applied",
};

/** The audit actions offered in the filter. */
export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABELS);

/** "LOGIN_FAILED" -> "Failed sign-in"; an unknown action as its raw value capitalised ("Some new action"). */
export function auditActionLabel(action: string | null | undefined): string {
  if (!action) return "";
  return AUDIT_ACTION_LABELS[action.toUpperCase()] ?? humanizeCode(action);
}

const ENTITY_LABELS: Record<string, string> = {
  vendor: "Vendor",
  vendor_erp_link: "Vendor ERP link",
  item: "Item",
  item_map: "ERP item code link",
  asset_user: "Person / place",
  purchase_order: "Purchase order",
  purchase_order_erp_baseline: "Purchase order (ERP copy)",
  asset: "Asset",
  asset_document: "Asset document",
  company: "Company",
  location: "Place",
  department: "Department",
  cost_center: "Cost Centre",
  category: "Asset group",
  subcategory: "Sub-category",
  brand: "Brand",
  bundle: "Set",
  bundle_part: "Set part",
  custom_field: "Custom field",
  code_rule: "Asset code format",
  app_setting: "App setting",
  client_report: "Problem report",
};

/** The record types offered in the filter. */
export const AUDIT_ENTITIES = Object.keys(ENTITY_LABELS);

export function entityLabel(entity: string | null | undefined): string {
  if (!entity) return "";
  return ENTITY_LABELS[entity] ?? humanizeCode(entity);
}

export const LOG_LEVELS = ["INFO", "WARNING", "ERROR", "CRITICAL"] as const;

const LOG_LEVEL_LABELS: Record<string, string> = {
  DEBUG: "Detail",
  INFO: "Information",
  WARNING: "Warning",
  ERROR: "Error",
  CRITICAL: "Critical",
};

export function logLevelLabel(level: string | null | undefined): string {
  if (!level) return "";
  return LOG_LEVEL_LABELS[level.toUpperCase()] ?? humanizeCode(level);
}

const ERROR_KIND_LABELS: Record<string, string> = {
  exception: "Unexpected error",
  slow_request: "Slow request",
  slow_sql: "Slow database query",
};

export const ERROR_KINDS = Object.keys(ERROR_KIND_LABELS);

export function errorKindLabel(kind: string | null | undefined): string {
  if (!kind) return "";
  return ERROR_KIND_LABELS[kind] ?? humanizeCode(kind);
}

const ERROR_SOURCE_LABELS: Record<string, string> = { api: "Server", db: "Database", job: "Background job", client: "Browser" };

export function errorSourceLabel(source: string | null | undefined): string {
  if (!source) return "";
  return ERROR_SOURCE_LABELS[source] ?? humanizeCode(source);
}

const SYSTEM_COMPONENT_LABELS: Record<string, string> = {
  startup: "Start-up",
  shutdown: "Shut-down",
  migration: "Database version",
  erp_sync: "ERP data copy",
  backup: "Backup",
  scheduler: "Background checks",
  db: "Database",
  retention: "Log clean-up",
  config: "Configuration",
};

export const SYSTEM_COMPONENTS = Object.keys(SYSTEM_COMPONENT_LABELS);

export function systemComponentLabel(component: string | null | undefined): string {
  if (!component) return "";
  return SYSTEM_COMPONENT_LABELS[component] ?? humanizeCode(component);
}

const SYSTEM_EVENT_LABELS: Record<string, string> = {
  started: "Started",
  stopped: "Stopped",
  head_mismatch: "Database version differs",
  sync_started: "Copy started",
  sync_success: "Copy finished",
  sync_failed: "Copy failed",
  sync_skipped: "Copy skipped",
  loop_error: "Background check failed",
  purge_finished: "Old logs removed",
  log_dir_unwritable: "Log folder not writable",
  connectivity_lost: "Database unreachable",
  connectivity_restored: "Database back",
};

export function systemEventLabel(event: string | null | undefined): string {
  if (!event) return "";
  return SYSTEM_EVENT_LABELS[event] ?? humanizeCode(event);
}

const REPORT_KIND_LABELS: Record<string, string> = {
  JS_ERROR: "Screen error",
  API_ERROR: "Failed request",
  USER_REPORT: "Reported by a person",
};

export const REPORT_KINDS = Object.keys(REPORT_KIND_LABELS);

export function reportKindLabel(kind: string | null | undefined): string {
  if (!kind) return "";
  return REPORT_KIND_LABELS[kind] ?? humanizeCode(kind);
}

const REPORT_STATUS_LABELS: Record<string, string> = { NEW: "New", REVIEWED: "Reviewed" };

export function reportStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return REPORT_STATUS_LABELS[status] ?? humanizeCode(status);
}

const LOG_SOURCE_LABELS: Record<string, string> = { api: "The app", job: "Background job", script: "Set-up script" };

/** Where an audit row came from (api / job / script). */
export function logSourceLabel(source: string | null | undefined): string {
  if (!source) return "";
  return LOG_SOURCE_LABELS[source] ?? humanizeCode(source);
}
