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

  return (
    <MasterCrudScreen<Subcategory>
      config={{
        resource: "subcategories",
        title: "Asset Subcategories",
        columns: [
          { key: "category_id", label: "Category" },
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
        ],
        formFields: [
          {
            key: "category_id",
            label: "Category",
            type: "select",
            options: categories.map((c) => ({ value: c.id, label: c.name })),
          },
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
        ],
      }}
    />
  );
}
