import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";
import type { FormField } from "../../components/master-crud/types";
import { SwitchedOffCompanies } from "../../features/settings/SwitchedOffCompanies";

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

export default function CompaniesSetup({ embedded = false, onCreated }: {
  embedded?: boolean;
  /** Told about a company just added (Set up CKAM chooses it, S7 fix 2 N3). */
  onCreated?: (company: Company) => void;
} = {}) {
  return (
    <div className="flex flex-col gap-4">
    <MasterCrudScreen<Company>
      embedded={embedded}
      onCreated={onCreated}
      config={{
        resource: "companies",
        historyEntity: "company",
        title: "Companies",
        singular: "Company",
        emptyDescription: "No company is switched on. Add a company, or switch one back on if you switched one off.",
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
    {/* A company that was switched off is switched back on here (it no longer shows in the list above). */}
    <SwitchedOffCompanies />
    </div>
  );
}
