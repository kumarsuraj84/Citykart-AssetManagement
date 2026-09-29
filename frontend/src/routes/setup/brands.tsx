import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";

interface Brand {
  id: number;
  code: string;
  name: string;
}

export default function BrandsSetup() {
  return (
    <MasterCrudScreen<Brand>
      config={{
        resource: "brands",
        title: "Brands",
        singular: "Brand",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
        ],
        formFields: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
        ],
        editFields: [{ key: "name", label: "Name" }],
      }}
    />
  );
}
