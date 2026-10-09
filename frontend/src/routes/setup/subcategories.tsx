import { useQuery } from "@tanstack/react-query";
import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";
import type { FormField } from "../../components/master-crud/types";
import { apiClient } from "../../lib/api-client";
import { SERIAL_SUBCATEGORY_OPTIONS, yesNo } from "../../lib/serial-rule";

interface Subcategory {
  id: number;
  category_id: number;
  code: string;
  name: string;
  serial_required: boolean | null;
}

interface Category {
  id: number;
  name: string;
  serial_required: boolean;
}

// null = follow the category; true/false overrides it (a Mouse under Accessories).
const SERIAL_FIELD: FormField = {
  key: "serial_required", label: "Serial number", type: "select", options: SERIAL_SUBCATEGORY_OPTIONS,
  defaultValue: "same",
  toDraft: (stored) => (stored === true ? "yes" : stored === false ? "no" : "same"),
  toPayload: (raw) => (raw === "yes" ? true : raw === "no" ? false : null),
};

export default function SubcategoriesSetup() {
  const { data: categories = [] } = useQuery({
    queryKey: ["masters", "categories"],
    queryFn: () => apiClient.get<Category[]>("/masters/categories"),
  });
  const categoryName = (id: unknown) => categories.find((c) => c.id === id)?.name ?? String(id);
  // What this sub-category effectively does, spelling out the inherited answer.
  const serialLabel = (stored: unknown, row: Subcategory) => {
    if (stored === true || stored === false) return yesNo(stored);
    const parent = categories.find((c) => c.id === row.category_id);
    return `Same as category (${yesNo(parent?.serial_required !== false)})`;
  };

  return (
    <MasterCrudScreen<Subcategory>
      config={{
        resource: "subcategories",
        title: "Asset Subcategories",
        singular: "Subcategory",
        columns: [
          { key: "category_id", label: "Category", format: categoryName },
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "serial_required", label: "Serial number", format: serialLabel },
        ],
        formFields: [
          {
            key: "category_id",
            label: "Category",
            type: "select",
            options: categories.map((c) => ({ value: c.id, label: c.name })),
            format: categoryName,
          },
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          SERIAL_FIELD,
        ],
        editFields: [{ key: "name", label: "Name" }, SERIAL_FIELD],
      }}
    />
  );
}
