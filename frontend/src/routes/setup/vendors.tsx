import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";

interface Vendor {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
}

export default function VendorsSetup() {
  return (
    <MasterCrudScreen<Vendor>
      config={{
        resource: "vendors",
        title: "Vendors",
        singular: "Vendor",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "gstin", label: "GSTIN" },
          { key: "contact_name", label: "Contact" },
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
