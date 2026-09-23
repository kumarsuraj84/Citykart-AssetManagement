import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";

interface Category {
  id: number;
  code: string;
  name: string;
}

export default function CategoriesSetup() {
  return (
    <MasterCrudScreen<Category>
      config={{
        resource: "categories",
        title: "Asset Categories",
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
