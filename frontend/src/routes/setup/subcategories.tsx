import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";
import { NewCategoryDialog, useCanCreateMasters } from "../../components/quick-create/masters";
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
  const canCreate = useCanCreateMasters();
  const { data: categories = [] } = useQuery({
    queryKey: ["masters", "categories"],
    queryFn: () => apiClient.get<Category[]>("/masters/categories"),
  });
  const categoryName = (id: unknown) => categories.find((c) => c.id === id)?.name ?? String(id);
  // The Category a new Sub-category needs can be created without leaving this screen;
  // `fillCategory` puts the new one into the open form.
  const [fillCategory, setFillCategory] = useState<((value: string) => void) | null>(null);

  return (
    <>
      <MasterCrudScreen<Subcategory>
        config={{
          resource: "subcategories",
          title: "Sub-categories",
          singular: "Sub-category",
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
              searchable: true,
              onCreateNew: canCreate ? (select) => setFillCategory(() => select) : undefined,
              createLabel: "New Category…",
            },
            { key: "code", label: "Code" },
            { key: "name", label: "Name" },
          ],
          editFields: [{ key: "name", label: "Name" }],
        }}
      />
      <NewCategoryDialog
        open={fillCategory !== null}
        onOpenChange={(open) => !open && setFillCategory(null)}
        onCreated={(row) => fillCategory?.(String(row.id))}
      />
    </>
  );
}
