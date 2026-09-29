import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";

interface Category {
  id: number;
  code: string;
  name: string;
  asset_domain: string;
}

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
        ],
        formFields: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "asset_domain", label: "Responsibility", type: "select", options: DOMAIN_OPTIONS },
        ],
        // Responsibility is editable (spec §43: affects FUTURE assets only --
        // an already-created asset keeps its own recorded snapshot).
        editFields: [
          { key: "name", label: "Name" },
          { key: "asset_domain", label: "Responsibility", type: "select", options: DOMAIN_OPTIONS },
        ],
      }}
    />
  );
}
