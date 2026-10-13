import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { suggestCode } from "../../lib/code-suggest";
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
  code?: string | null;
}

interface SubNamed extends Named {
  category_id: number;
}

const asArray = <T,>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);
const codesOf = (rows: Named[]) => rows.map((r) => r.code ?? "").filter(Boolean);

/** A Category's work area (backend asset_domain): "IT Team" / "Admin / Non-IT Team". */
export const DOMAIN_OPTIONS = WORK_AREA_OPTIONS;

/** The codes already used by a master list (so a suggested Code is not taken). */
function useTakenCodes(resource: string, open: boolean): string[] {
  const q = useQuery({
    queryKey: ["masters", resource],
    queryFn: () => apiClient.get<Named[]>(`/masters/${resource}`),
    enabled: open,
  });
  return codesOf(asArray<Named>(q.data));
}

/** New Category, from wherever a Category is needed. */
export function NewCategoryDialog({ idPrefix, ...props }: QuickCreateProps & { idPrefix?: string }) {
  const taken = useTakenCodes("categories", props.open);
  return (
    <QuickCreateDialog
      {...props}
      idPrefix={idPrefix}
      title="New Category"
      endpoint="/masters/categories"
      refresh={[["masters", "categories"]]}
      fields={[
        { key: "name", label: "Name", required: true, placeholder: "IT Fixed Assets" },
        { key: "code", label: "Code", required: true, placeholder: "ITFA",
          helperText: "Suggested from the name; short and unique. It becomes part of asset codes and cannot be changed later.",
          suggest: { from: "name", make: (name) => suggestCode(name, taken) } },
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
  const subsQ = useQuery({ queryKey: ["masters", "subcategories"], queryFn: () => apiClient.get<SubNamed[]>("/masters/subcategories"), enabled: props.open });
  // A Sub-category's code is unique within its Category.
  const takenInCategory = codesOf(asArray<SubNamed>(subsQ.data).filter((s) => String(s.category_id) === values.category_id));
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
            options: categoryOptions(asArray<Named>(categoriesQ.data)),
            onCreateNew: canCreate ? () => setNewCategory(true) : undefined, createLabel: "New Category…" },
          { key: "name", label: "Name", required: true, placeholder: "Network Switch" },
          { key: "code", label: "Code", required: true, placeholder: "SWT",
            helperText: "Suggested from the name; short and unique within the Category. It becomes part of asset codes and cannot be changed later.",
            suggest: { from: "name", make: (name) => suggestCode(name, takenInCategory) } },
        ]}
      />
      {/* Opened on top of this dialog: its own field ids (qc-cat-name...), never two #qc-name at once. */}
      <NewCategoryDialog
        idPrefix="qc-cat"
        open={newCategory}
        onOpenChange={setNewCategory}
        onCreated={(row) => setValues((v) => ({ ...v, category_id: String(row.id) }))}
      />
    </>
  );
}

export function NewBrandDialog(props: QuickCreateProps) {
  const taken = useTakenCodes("brands", props.open);
  return (
    <QuickCreateDialog
      {...props}
      title="New Brand"
      endpoint="/masters/brands"
      refresh={[["masters", "brands"]]}
      fields={[
        { key: "name", label: "Name", required: true, placeholder: "Dell" },
        { key: "code", label: "Code", required: true, placeholder: "DELL", helperText: "Suggested from the name.",
          suggest: { from: "name", make: (name) => suggestCode(name, taken) } },
      ]}
    />
  );
}

export function NewVendorDialog(props: QuickCreateProps) {
  const taken = useTakenCodes("vendors", props.open);
  return (
    <QuickCreateDialog
      {...props}
      title="New Vendor"
      endpoint="/masters/vendors"
      refresh={[["masters", "vendors"]]}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "code", label: "Code", required: true,
          helperText: "Suggested from the name; must be unique. Contact details can be added later under Settings › Vendors.",
          suggest: { from: "name", make: (name) => suggestCode(name, taken, 10) } },
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
