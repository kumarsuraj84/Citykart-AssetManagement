import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { WORK_AREA_OPTIONS } from "../../lib/labels";
import { categoryOptions } from "../../lib/option-labels";
import { QuickCreateDialog, type QuickCreateProps } from "./QuickCreateDialog";

/** Who may create master records: the server only lets the head-office admin (Primary
 * Owner) do it, so only they are offered the "+ New ..." entries (the server still decides). */
export function useCanCreateMasters(): boolean {
  return useAuthStore((s) => s.isPrimaryOwner);
}

interface Named {
  id: number;
  name: string;
}

/** A Category's work area (backend asset_domain): "IT Team" / "Admin / Non-IT Team". */
export const DOMAIN_OPTIONS = WORK_AREA_OPTIONS;

/** New Category, from wherever a Category is needed. */
export function NewCategoryDialog(props: QuickCreateProps) {
  return (
    <QuickCreateDialog
      {...props}
      title="New Category"
      endpoint="/masters/categories"
      refresh={[["masters", "categories"]]}
      fields={[
        { key: "name", label: "Name", required: true, placeholder: "IT Fixed Assets" },
        { key: "code", label: "Code", required: true, placeholder: "ITFA", helperText: "Short and unique; it becomes part of asset codes and cannot be changed later." },
        { key: "asset_domain", label: "Work area", kind: "select", required: true, options: DOMAIN_OPTIONS,
          helperText: "Who looks after assets of this Category: the IT Team or the Admin / Non-IT Team." },
      ]}
    />
  );
}

/** New Sub-category. Its Category can be chosen, or created right here. */
export function NewSubcategoryDialog({ defaultCategoryId, ...props }: QuickCreateProps & { defaultCategoryId?: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [newCategory, setNewCategory] = useState(false);
  const canCreate = useCanCreateMasters();
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<Named[]>("/masters/categories"), enabled: props.open });
  return (
    <>
      <QuickCreateDialog
        {...props}
        values={values}
        onValuesChange={setValues}
        title="New Sub-category"
        endpoint="/masters/subcategories"
        refresh={[["masters", "subcategories"]]}
        initial={defaultCategoryId ? { category_id: defaultCategoryId } : undefined}
        toBody={(v) => ({ category_id: Number(v.category_id), name: (v.name ?? "").trim(), code: (v.code ?? "").trim() })}
        fields={[
          { key: "category_id", label: "Category", kind: "select", required: true,
            options: categoryOptions(categoriesQ.data),
            onCreateNew: canCreate ? () => setNewCategory(true) : undefined, createLabel: "New Category…" },
          { key: "name", label: "Name", required: true, placeholder: "Network Switch" },
          { key: "code", label: "Code", required: true, placeholder: "SWT", helperText: "Short and unique within the Category; it becomes part of asset codes and cannot be changed later." },
        ]}
      />
      <NewCategoryDialog
        open={newCategory}
        onOpenChange={setNewCategory}
        onCreated={(row) => setValues((v) => ({ ...v, category_id: String(row.id) }))}
      />
    </>
  );
}

export function NewBrandDialog(props: QuickCreateProps) {
  return (
    <QuickCreateDialog
      {...props}
      title="New Brand"
      endpoint="/masters/brands"
      refresh={[["masters", "brands"]]}
      fields={[
        { key: "name", label: "Name", required: true, placeholder: "Dell" },
        { key: "code", label: "Code", required: true, placeholder: "DELL" },
      ]}
    />
  );
}

export function NewVendorDialog(props: QuickCreateProps) {
  return (
    <QuickCreateDialog
      {...props}
      title="New Vendor"
      endpoint="/masters/vendors"
      refresh={[["masters", "vendors"]]}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "code", label: "Code", required: true, helperText: "Unique; often the vendor's short name. Contact details can be added later under Settings › Vendors." },
      ]}
    />
  );
}

export function NewDepartmentDialog(props: QuickCreateProps) {
  return (
    <QuickCreateDialog
      {...props}
      title="New Department"
      endpoint="/masters/departments"
      refresh={[["masters", "departments"]]}
      fields={[{ key: "name", label: "Name", required: true }]}
    />
  );
}

/** New Place (backend: location) of one company (the company is already known where this is used). */
export function NewLocationDialog({ companyId, ...props }: QuickCreateProps & { companyId: number }) {
  return (
    <QuickCreateDialog
      {...props}
      title="New Place"
      endpoint="/masters/locations"
      refresh={[["masters", "locations"]]}
      toBody={(v) => ({ company_id: companyId, name: (v.name ?? "").trim(), code: (v.code ?? "").trim() })}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "code", label: "Code", required: true, helperText: "Unique within the company." },
      ]}
    />
  );
}

/** New Cost Centre of one company. */
export function NewCostCenterDialog({ companyId, ...props }: QuickCreateProps & { companyId: number }) {
  return (
    <QuickCreateDialog
      {...props}
      title="New Cost Centre"
      endpoint="/masters/cost-centers"
      refresh={[["masters", "cost-centers"]]}
      toBody={(v) => ({ company_id: companyId, name: (v.name ?? "").trim(), code: (v.code ?? "").trim() })}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "code", label: "Code", required: true, helperText: "Unique within the company." },
      ]}
    />
  );
}
