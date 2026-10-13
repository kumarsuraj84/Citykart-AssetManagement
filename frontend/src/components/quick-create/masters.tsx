import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { suggestCode } from "../../lib/code-suggest";
import { WORK_AREA_OPTIONS } from "../../lib/labels";
import { categoryOptions, companyOptions } from "../../lib/option-labels";
import { canCreate, domainManageAreas, inAreas, useCapabilities } from "../../lib/capabilities";
import { QuickCreateDialog, type CreatedRecord, type QuickCreateProps } from "./QuickCreateDialog";

/*
 * Who may open these dialogs is decided by the caller from the capabilities
 * endpoint (lib/capabilities.ts: useCanCreate("vendor") ...); the server
 * re-checks every save and its refusal sentence is shown in the dialog.
 *
 * Vendor, Brand and Cost Centre never send a `code`: the server makes one from
 * the name. Category and Sub-category codes become part of asset codes, so one
 * is suggested from the name (S6a) and can be changed under "More".
 */

interface Named {
  id: number;
  name: string;
  code?: string | null;
  asset_domain?: string | null;
}

interface SubNamed extends Named {
  category_id: number;
}

const asArray = <T,>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);
const codesOf = (rows: Named[]) => rows.map((r) => r.code ?? "").filter(Boolean);
const trimmed = (v: string | undefined) => (v ?? "").trim();
const orNull = (v: string | undefined) => (trimmed(v) === "" ? null : trimmed(v));
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A Category's work area (backend asset_domain): "IT Team" / "Admin / Non-IT Team". */
export const DOMAIN_OPTIONS = WORK_AREA_OPTIONS;

/** One master list, shared with the screens through the same query key. */
function useMasterList<T extends Named>(resource: string, open: boolean, companyId?: number | null): T[] {
  const q = useQuery({
    queryKey: companyId == null ? ["masters", resource] : ["masters", resource, companyId],
    queryFn: () => apiClient.get<T[]>(companyId == null ? `/masters/${resource}` : `/masters/${resource}?company_id=${companyId}`),
    enabled: open,
  });
  return asArray<T>(q.data);
}

/** The existing active record with this name, for "Use the existing …" after a duplicate refusal. */
function byName(rows: Named[]) {
  return (v: Record<string, string>): CreatedRecord | undefined =>
    rows.find((r) => sameName(r.name, v.name ?? "")) as CreatedRecord | undefined;
}

/** The work-area choices this person may create a Category in (all of them for the head-office admin). */
function useManageAreaOptions() {
  const { caps } = useCapabilities();
  const areas = domainManageAreas(caps);
  return DOMAIN_OPTIONS.filter((o) => areas.includes(o.value));
}

/** New Category, from wherever a Category is needed (only offered to someone who may add one). */
export function NewCategoryDialog({ idPrefix, ...props }: QuickCreateProps & { idPrefix?: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const rows = useMasterList<Named>("categories", props.open);
  const taken = codesOf(rows);
  const areaOptions = useManageAreaOptions();
  // One work area allowed: it is already chosen.
  const onlyArea = areaOptions.length === 1 ? areaOptions[0].value : "";
  useEffect(() => {
    if (props.open && onlyArea && !values.asset_domain) setValues((v) => ({ ...v, asset_domain: onlyArea }));
  }, [props.open, onlyArea, values.asset_domain]);
  return (
    <QuickCreateDialog
      {...props}
      values={values}
      onValuesChange={setValues}
      idPrefix={idPrefix}
      title="New Category"
      endpoint="/masters/categories"
      refresh={[["masters", "categories"]]}
      initial={onlyArea ? { asset_domain: onlyArea } : undefined}
      fields={[
        { key: "name", label: "Name", required: true, placeholder: "IT Fixed Assets" },
        { key: "asset_domain", label: "Work area", kind: "select", required: true, options: areaOptions,
          helperText: "Who looks after assets of this Category: the IT Team or the Admin / Non-IT Team." },
        { key: "code", label: "Code", required: true, placeholder: "ITFA", more: true,
          helperText: "Made from the name; short and unique. It becomes part of asset codes and cannot be changed later.",
          suggest: { from: "name", make: (name) => suggestCode(name, taken) } },
      ]}
      toBody={(v) => ({ name: trimmed(v.name), code: trimmed(v.code), asset_domain: v.asset_domain })}
    />
  );
}

/** New Sub-category. Its Category can be chosen (only the person's own work areas), or created right here. */
export function NewSubcategoryDialog({ defaultCategoryId, ...props }: QuickCreateProps & { defaultCategoryId?: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [newCategory, setNewCategory] = useState(false);
  const { caps } = useCapabilities();
  const areas = domainManageAreas(caps);
  const allCategories = useMasterList<Named>("categories", props.open);
  const categories = allCategories.filter((c) => inAreas(c.asset_domain, areas));
  const subs = useMasterList<SubNamed>("subcategories", props.open);
  // A Sub-category's code is unique within its Category.
  const takenInCategory = codesOf(subs.filter((s) => String(s.category_id) === values.category_id));
  // The Category the screen behind had chosen is kept only when it is one of the person's own.
  const chosen = values.category_id;
  const notAllowed = !!chosen && allCategories.length > 0 && caps !== null && !categories.some((c) => String(c.id) === chosen)
    && allCategories.some((c) => String(c.id) === chosen);
  useEffect(() => {
    if (notAllowed) setValues((v) => ({ ...v, category_id: "" }));
  }, [notAllowed]);
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
        toBody={(v) => ({ category_id: Number(v.category_id), name: trimmed(v.name), code: trimmed(v.code) })}
        fields={[
          { key: "category_id", label: "Category", kind: "select", required: true,
            options: categoryOptions(categories),
            onCreateNew: canCreate(caps, "category") ? () => setNewCategory(true) : undefined, createLabel: "New Category…" },
          { key: "name", label: "Name", required: true, placeholder: "Network Switch" },
          { key: "code", label: "Code", required: true, placeholder: "SWT", more: true,
            helperText: "Made from the name; short and unique within the Category. It becomes part of asset codes and cannot be changed later.",
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

/** New Brand: just its name (the server makes the code). */
export function NewBrandDialog(props: QuickCreateProps) {
  const rows = useMasterList<Named>("brands", props.open);
  return (
    <QuickCreateDialog
      {...props}
      title="New Brand"
      endpoint="/masters/brands"
      refresh={[["masters", "brands"]]}
      fields={[{ key: "name", label: "Name", required: true, placeholder: "Dell" }]}
      toBody={(v) => ({ name: trimmed(v.name) })}
      findExisting={byName(rows)}
    />
  );
}

/** New Vendor: name, GSTIN if known, contact details under More (the server makes the code). */
export function NewVendorDialog(props: QuickCreateProps) {
  const rows = useMasterList<Named>("vendors", props.open);
  return (
    <QuickCreateDialog
      {...props}
      title="New Vendor"
      endpoint="/masters/vendors"
      refresh={[["masters", "vendors"]]}
      fields={[
        { key: "name", label: "Name", required: true, placeholder: "Vansh Enterprises Pvt. Ltd." },
        { key: "gstin", label: "GSTIN", placeholder: "07ABCDE1234F1Z5", helperText: "Optional." },
        { key: "contact_name", label: "Contact person", more: true },
        { key: "contact_phone", label: "Contact phone", more: true },
        { key: "contact_email", label: "Contact email", more: true },
      ]}
      toBody={(v) => ({
        name: trimmed(v.name),
        gstin: orNull(v.gstin),
        contact_name: orNull(v.contact_name),
        contact_phone: orNull(v.contact_phone),
        contact_email: orNull(v.contact_email),
      })}
      findExisting={byName(rows)}
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
      toBody={(v) => ({ company_id: companyId, name: trimmed(v.name), code: trimmed(v.code) })}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "code", label: "Code", required: true, helperText: "Unique within the company." },
      ]}
    />
  );
}

/** New Cost Centre of the company the task is for: just its name (the server makes the code). */
export function NewCostCenterDialog({ companyId, ...props }: QuickCreateProps & { companyId: number }) {
  const rows = useMasterList<Named>("cost-centers", props.open, companyId);
  return (
    <QuickCreateDialog
      {...props}
      title="New Cost Centre"
      endpoint="/masters/cost-centers"
      refresh={[["masters", "cost-centers"]]}
      toBody={(v) => ({ company_id: companyId, name: trimmed(v.name) })}
      fields={[{ key: "name", label: "Name", required: true, placeholder: "IT Head Office" }]}
      findExisting={byName(rows)}
    />
  );
}

const NEW_PLACE = "__new_place__";

/**
 * New Stock Room: its name and where it is -- an existing Place of the company,
 * or the name of a new one (the server reuses a Place with that name, else makes
 * it). The company is the task's own; only where none is known (Move) it is asked.
 * Adding a name that already exists in that company just picks that stock room.
 */
export function NewStockRoomDialog(props: QuickCreateProps & { companyId?: number | null }) {
  return (
    <NewRoomDialog
      {...props}
      idPrefix="qc-sr"
      title="New Stock Room"
      endpoint="/stock-rooms"
      noun="stock room"
      namePlaceholder="Farukhnagar Stock"
    />
  );
}

/**
 * New Install Point (S5b-2, People & Places): where things get installed -- its
 * name and where it is, exactly like a new Stock Room. The code is made by the
 * server (INS-…); the same name again in that company just picks the existing one.
 */
export function NewInstallPointDialog(props: QuickCreateProps & { companyId?: number | null }) {
  return (
    <NewRoomDialog
      {...props}
      idPrefix="qc-ip"
      title="New Install Point"
      endpoint="/people/install-points"
      noun="install point"
      namePlaceholder="HO Server Room"
    />
  );
}

function NewRoomDialog({
  companyId, idPrefix, title, endpoint, noun, namePlaceholder, ...props
}: QuickCreateProps & { companyId?: number | null; idPrefix: string; title: string; endpoint: string; noun: string; namePlaceholder: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const companiesQ = useQuery({
    queryKey: ["asset_users", "me", "companies"],
    queryFn: () => apiClient.get<Named[]>("/asset-users/me/companies"),
    enabled: props.open && companyId == null,
  });
  const companies = asArray<Named>(companiesQ.data);
  const chosenCompany = companyId ?? (values.company_id ? Number(values.company_id) : null);
  const placesQ = useQuery({
    queryKey: ["masters", "locations", chosenCompany],
    queryFn: () => apiClient.get<Named[]>(`/masters/locations?company_id=${chosenCompany}`),
    enabled: props.open && chosenCompany != null,
  });
  const places = asArray<Named>(placesQ.data);
  // No place yet for this company: type the new one straight away.
  const typing = (v: Record<string, string>) => v.location_id === NEW_PLACE || (placesQ.isSuccess && places.length === 0);
  // A single allowed company is chosen for the person.
  const onlyCompany = companyId == null && companies.length === 1 ? String(companies[0].id) : "";
  useEffect(() => {
    if (props.open && onlyCompany && !values.company_id) setValues((v) => ({ ...v, company_id: onlyCompany }));
  }, [props.open, onlyCompany, values.company_id]);
  return (
    <QuickCreateDialog
      {...props}
      idPrefix={idPrefix}
      values={values}
      // Another company has other places, so the place is chosen again.
      onValuesChange={(update) => setValues((prev) => {
        const next = update(prev);
        return prev.company_id && next.company_id !== prev.company_id ? { ...next, location_id: "" } : next;
      })}
      title={title}
      endpoint={endpoint}
      refresh={[["stock-rooms"], ["asset_users"], ["people"], ["masters", "locations"]]}
      initial={onlyCompany ? { company_id: onlyCompany } : undefined}
      fields={[
        ...(companyId == null
          ? [{ key: "company_id", label: "Company", kind: "select" as const, required: true, options: companyOptions(companies) }]
          : []),
        { key: "name", label: "Name", required: true, placeholder: namePlaceholder },
        { key: "location_id", label: "Place", kind: "select", required: true,
          options: [...places.map((p) => ({ value: String(p.id), label: p.name })), { value: NEW_PLACE, label: "A new place (type its name)" }],
          placeholder: `Where the ${noun} is`,
          helperText: "Pick the place, or choose “A new place” and type its name.",
          visible: (v) => !typing(v) },
        { key: "location_name", label: "New place name", required: true, placeholder: "Farukhnagar Warehouse",
          helperText: places.length === 0 ? `This company has no place yet; it is added with the ${noun}.` : `Added with the ${noun}.`,
          visible: typing },
      ]}
      canSave={(v) =>
        chosenCompany != null && trimmed(v.name) !== "" &&
        (typing(v) ? trimmed(v.location_name) !== "" : !!v.location_id && v.location_id !== NEW_PLACE)}
      toBody={(v) => ({
        name: trimmed(v.name),
        company_id: chosenCompany,
        ...(typing(v) ? { location_name: trimmed(v.location_name) } : { location_id: Number(v.location_id) }),
      })}
      note={`If this company already has ${noun === "install point" ? "an" : "a"} ${noun} with this name, that one is picked.`}
    />
  );
}
