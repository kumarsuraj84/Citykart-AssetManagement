import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";

interface Department {
  id: number;
  name: string;
}

export default function DepartmentsSetup() {
  return (
    <MasterCrudScreen<Department>
      config={{
        resource: "departments",
        title: "Departments",
        singular: "Department",
        columns: [{ key: "name", label: "Name" }],
        formFields: [{ key: "name", label: "Name" }],
        editFields: [{ key: "name", label: "Name" }],
      }}
    />
  );
}
