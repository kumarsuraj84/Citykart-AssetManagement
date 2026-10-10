import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { QuickCreateDialog, type QuickCreateProps } from "./QuickCreateDialog";

/** Who may create master records: the server only lets the Primary Owner do it, so
 * only they are offered the "+ New ..." entries (the server still decides). */
export function useCanCreateMasters(): boolean {
  return useAuthStore((s) => s.isPrimaryOwner);
}

interface Named {
  id: number;
  name: string;
}

export const DOMAIN_OPTIONS = [
  { value: "IT", label: "IT" },
  { value: "NON_IT", label: "Admin / Non-IT" },
];

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
        { key: "asset_domain", label: "Responsibility", kind: "select", required: true, options: DOMAIN_OPTIONS,
          helperText: "Who looks after assets of this Category: the IT team or Admin / Non-IT." },
      ]}
    />
  );
}

/** New Sub-Category. Its Category can be chosen, or created right here. */
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
        title="New Sub-Category"
        endpoint="/masters/subcategories"
        refresh={[["masters", "subcategories"]]}
        initial={defaultCategoryId ? { category_id: defaultCategoryId } : undefined}
        toBody={(v) => ({ category_id: Number(v.category_id), name: (v.name ?? "").trim(), code: (v.code ?? "").trim() })}
        fields={[
          { key: "category_id", label: "Category", kind: "select", required: true,
            options: (categoriesQ.data ?? []).map((c) => ({ value: String(c.id), label: c.name })),
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
        { key: "code", label: "Code", required: true, helperText: "Unique; often the vendor's short name. Contact details can be added later under Setup > Vendors." },
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

/** New Location of one company (the company is already known where this is used). */
export function NewLocationDialog({ companyId, ...props }: QuickCreateProps & { companyId: number }) {
  return (
    <QuickCreateDialog
      {...props}
      title="New Location"
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
