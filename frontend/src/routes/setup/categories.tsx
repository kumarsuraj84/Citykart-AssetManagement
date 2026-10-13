import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";
import { DOMAIN_OPTIONS } from "../../components/quick-create/masters";
import { workAreaLabel } from "../../lib/labels";

interface Category {
  id: number;
  code: string;
  name: string;
  asset_domain: string;
}

function domainLabel(value: unknown): string {
  return workAreaLabel(typeof value === "string" ? value : null);
}

// Settings › Catalogue › Asset Groups. A Category is shown to people as an
// "Asset Group"; the title keeps "(Categories)" so it can still be found by
// its old name, and every form elsewhere still calls the field "Category".
export default function CategoriesSetup() {
  return (
    <MasterCrudScreen<Category>
      config={{
        resource: "categories",
        title: "Asset Groups (Categories)",
        singular: "Category",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "asset_domain", label: "Work area", format: domainLabel },
        ],
        formFields: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "asset_domain", label: "Work area", type: "select", options: DOMAIN_OPTIONS },
        ],
        // The work area is editable (spec §43: affects FUTURE assets only --
        // an already-created asset keeps its own recorded snapshot).
        editFields: [
          { key: "name", label: "Name" },
          { key: "asset_domain", label: "Work area", type: "select", options: DOMAIN_OPTIONS },
        ],
      }}
    />
  );
}
