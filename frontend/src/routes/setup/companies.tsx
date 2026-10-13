import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";
import type { FormField } from "../../components/master-crud/types";

interface Company {
  id: number;
  code: string;
  name: string;
  erp_company_code: string | null;
}

// What the ERP calls this company when that differs from the company's own
// Code (the Code is part of every asset code and cannot change). Empty = the
// Code is the ERP code.
const ERP_CODE_FIELD: FormField = {
  key: "erp_company_code",
  label: "ERP company code (only if different)",
  toDraft: (stored) => (stored == null ? "" : String(stored)),
  toPayload: (raw) => (String(raw ?? "").trim() === "" ? null : String(raw).trim()),
};

export default function CompaniesSetup({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <MasterCrudScreen<Company>
      embedded={embedded}
      config={{
        resource: "companies",
        title: "Companies",
        singular: "Company",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "erp_company_code", label: "ERP company code", format: (v) => (v ? String(v) : "—") },
        ],
        formFields: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          ERP_CODE_FIELD,
        ],
        editFields: [{ key: "name", label: "Name" }, ERP_CODE_FIELD],
      }}
    />
  );
}
