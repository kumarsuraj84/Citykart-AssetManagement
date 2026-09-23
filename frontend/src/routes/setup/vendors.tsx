import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";

interface Vendor {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
}

export default function VendorsSetup() {
  return (
    <MasterCrudScreen<Vendor>
      config={{
        resource: "vendors",
        title: "Vendors",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "gstin", label: "GSTIN" },
        ],
        formFields: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "gstin", label: "GSTIN" },
        ],
      }}
    />
  );
}
