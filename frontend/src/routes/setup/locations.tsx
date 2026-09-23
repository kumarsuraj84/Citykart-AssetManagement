import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";

interface Location {
  id: number;
  code: string;
  name: string;
  address: string | null;
}

export default function LocationsSetup() {
  return (
    <MasterCrudScreen<Location>
      config={{
        resource: "locations",
        title: "Locations",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "address", label: "Address" },
        ],
        formFields: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "address", label: "Address" },
        ],
      }}
    />
  );
}
