export interface Column<T> {
  key: keyof T;
  label: string;
  /** Renders the raw value for display -- e.g. mapping a `company_id` FK to
   * the company's name -- instead of showing the raw id. Defaults to
   * `String(value)`. */
  format?: (value: unknown, row: T) => string;
}

export interface FormField {
  key: string;
  label: string;
  type?: "text" | "number" | "select" | "checkbox";
  options?: { value: string | number; label: string }[];
  /** Renders the raw value when shown read-only in the Edit dialog (a
   * `formFields` entry not repeated in `editFields`, e.g. an immutable
   * relational id) -- same purpose as `Column.format` above, e.g. mapping a
   * `category_id` FK to its category's name instead of the raw id. Defaults
   * to `String(value)`. */
  format?: (value: unknown, row: Record<string, unknown>) => string;
  /** What the field starts as in the Add dialog (e.g. a select's first choice)
   * -- without it the field starts empty and is left out of the request. */
  defaultValue?: unknown;
  /** Row value -> the value the form field holds, for a stored value that is
   * not directly one of the select's option values (e.g. true/false/null). */
  toDraft?: (stored: unknown) => unknown;
  /** The form field's value -> what is sent to the server. */
  toPayload?: (raw: unknown) => unknown;
}

export interface MasterConfig<T> {
  resource: string; // e.g. "vendors" -> /masters/vendors
  title: string;
  /** Singular noun for dialog titles and confirmation copy (e.g. "Vendor",
   * "Cost Centre"). Defaults to `title` when omitted. */
  singular?: string;
  columns: Column<T>[];
  formFields: FormField[];
  /** Fields editable after creation -- a subset of `formFields` (AM-05). A
   * `formFields` entry not repeated here (e.g. an immutable `code`) is shown
   * read-only in the Edit dialog rather than omitted outright, so an admin
   * can still see it; it's simply never sent in the PUT body. Matches each
   * master's narrower `*EditIn` schema on the backend. */
  editFields: FormField[];
}
