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
  erp_vendor_code: string | null;
}

export default function VendorsSetup() {
  return (
    <MasterCrudScreen<Vendor>
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
          { key: "erp_vendor_code", label: "ERP code" },
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
