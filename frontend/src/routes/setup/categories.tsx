import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";
import type { FormField } from "../../components/master-crud/types";
import { SERIAL_CATEGORY_OPTIONS, yesNo } from "../../lib/serial-rule";

interface Category {
  id: number;
  code: string;
  name: string;
  asset_domain: string;
  serial_required: boolean;
}

const SERIAL_FIELD: FormField = {
  key: "serial_required", label: "Serial number", type: "select", options: SERIAL_CATEGORY_OPTIONS,
  defaultValue: "yes",
  toDraft: (stored) => (stored === false ? "no" : "yes"),
  toPayload: (raw) => raw !== "no",
};

const DOMAIN_OPTIONS = [
  { value: "IT", label: "IT" },
  { value: "NON_IT", label: "Admin / Non-IT" },
];

function domainLabel(value: unknown): string {
  return DOMAIN_OPTIONS.find((o) => o.value === value)?.label ?? String(value);
}

export default function CategoriesSetup() {
  return (
    <MasterCrudScreen<Category>
      config={{
        resource: "categories",
        title: "Asset Categories",
        singular: "Category",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "asset_domain", label: "Responsibility", format: domainLabel },
          { key: "serial_required", label: "Serial number", format: (v) => yesNo(v !== false) },
        ],
        formFields: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "asset_domain", label: "Responsibility", type: "select", options: DOMAIN_OPTIONS },
          SERIAL_FIELD,
        ],
        // Responsibility is editable (spec §43: affects FUTURE assets only --
        // an already-created asset keeps its own recorded snapshot).
        editFields: [
          { key: "name", label: "Name" },
          { key: "asset_domain", label: "Responsibility", type: "select", options: DOMAIN_OPTIONS },
          SERIAL_FIELD,
        ],
      }}
    />
  );
}
