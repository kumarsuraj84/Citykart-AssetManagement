import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";

interface Brand {
  id: number;
  code: string;
  name: string;
}

export default function BrandsSetup({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <MasterCrudScreen<Brand>
      embedded={embedded}
      config={{
        resource: "brands",
        historyEntity: "brand",
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
