import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";

interface Department {
  id: number;
  name: string;
}

export default function DepartmentsSetup({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <MasterCrudScreen<Department>
      embedded={embedded}
      config={{
        resource: "departments",
        historyEntity: "department",
        title: "Departments",
        singular: "Department",
        columns: [{ key: "name", label: "Name" }],
        formFields: [{ key: "name", label: "Name" }],
        editFields: [{ key: "name", label: "Name" }],
      }}
    />
  );
}
