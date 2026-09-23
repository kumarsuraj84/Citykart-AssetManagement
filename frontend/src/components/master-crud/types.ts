export interface Column<T> {
  key: keyof T;
  label: string;
}

export interface FormField {
  key: string;
  label: string;
  type?: "text" | "number" | "select" | "checkbox";
  options?: { value: string | number; label: string }[];
}

export interface MasterConfig<T> {
  resource: string; // e.g. "vendors" -> /masters/vendors
  title: string;
  columns: Column<T>[];
  formFields: FormField[];
}
