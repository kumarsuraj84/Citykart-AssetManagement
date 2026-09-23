import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";

interface Company {
  id: number;
  code: string;
  name: string;
}

export default function CompaniesSetup() {
  return (
    <MasterCrudScreen<Company>
      config={{
        resource: "companies",
        title: "Companies",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
        ],
        formFields: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
        ],
      }}
    />
  );
}
