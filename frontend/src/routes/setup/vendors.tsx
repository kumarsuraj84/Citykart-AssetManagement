import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";
import { ErpVendorsDialog } from "../../features/vendors/ErpVendorsDialog";

interface Vendor {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  /** One supplier code per company: the same code is a different supplier in each company's ERP. */
  erp_links: { company_id: number; company_code: string; erp_vendor_code: string }[];
}

const linksText = (value: unknown) =>
  (Array.isArray(value) ? (value as Vendor["erp_links"]) : []).map((l) => `${l.company_code} ${l.erp_vendor_code}`).join(" · ");

export default function VendorsSetup({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <MasterCrudScreen<Vendor>
      embedded={embedded}
      extraActions={<ErpVendorsDialog />}
      config={{
        resource: "vendors",
        title: "Vendors",
        singular: "Vendor",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "gstin", label: "GSTIN" },
          { key: "contact_name", label: "Contact" },
          { key: "erp_links", label: "ERP codes", format: linksText },
        ],
        formFields: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "gstin", label: "GSTIN" },
          { key: "contact_name", label: "Contact Name" },
          { key: "contact_phone", label: "Contact Phone" },
          { key: "contact_email", label: "Contact Email" },
        ],
        editFields: [
          { key: "name", label: "Name" },
          { key: "gstin", label: "GSTIN" },
          { key: "contact_name", label: "Contact Name" },
          { key: "contact_phone", label: "Contact Phone" },
          { key: "contact_email", label: "Contact Email" },
        ],
      }}
    />
  );
}
