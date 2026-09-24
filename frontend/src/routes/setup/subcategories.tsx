import { useQuery } from "@tanstack/react-query";
import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";
import { apiClient } from "../../lib/api-client";

interface Subcategory {
  id: number;
  category_id: number;
  code: string;
  name: string;
}

interface Category {
  id: number;
  name: string;
}

export default function SubcategoriesSetup() {
  const { data: categories = [] } = useQuery({
    queryKey: ["masters", "categories"],
    queryFn: () => apiClient.get<Category[]>("/masters/categories"),
  });
  const categoryName = (id: unknown) => categories.find((c) => c.id === id)?.name ?? String(id);

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
        ],
        editFields: [{ key: "name", label: "Name" }],
      }}
    />
  );
}
