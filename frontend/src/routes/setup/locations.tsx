import { useQuery } from "@tanstack/react-query";
import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";
import { apiClient } from "../../lib/api-client";

interface Location {
  id: number;
  company_id: number;
  code: string;
  name: string;
  address: string | null;
}

interface Company {
  id: number;
  name: string;
}

export default function LocationsSetup() {
  const { data: companies = [] } = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<Company[]>("/masters/companies"),
  });
  const companyName = (id: unknown) => companies.find((c) => c.id === id)?.name ?? String(id);

  return (
    <MasterCrudScreen<Location>
      config={{
        resource: "locations",
        title: "Locations",
        singular: "Location",
        columns: [
          { key: "company_id", label: "Company", format: companyName },
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "address", label: "Address" },
        ],
        formFields: [
          {
            key: "company_id",
            label: "Company",
            type: "select",
            options: companies.map((c) => ({ value: c.id, label: c.name })),
            format: companyName,
          },
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "address", label: "Address" },
        ],
        editFields: [
          { key: "name", label: "Name" },
          { key: "address", label: "Address" },
        ],
      }}
    />
  );
}
