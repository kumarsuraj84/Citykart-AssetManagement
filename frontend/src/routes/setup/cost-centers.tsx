import { useQuery } from "@tanstack/react-query";
import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";
import { apiClient } from "../../lib/api-client";

interface CostCenter {
  id: number;
  company_id: number;
  code: string;
  name: string;
}

interface Company {
  id: number;
  name: string;
}

export default function CostCentersSetup() {
  const { data: companies = [] } = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<Company[]>("/masters/companies"),
  });

  return (
    <MasterCrudScreen<CostCenter>
      config={{
        resource: "cost-centers",
        title: "Cost Centers",
        columns: [
          { key: "company_id", label: "Company" },
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
        ],
        formFields: [
          {
            key: "company_id",
            label: "Company",
            type: "select",
            options: companies.map((c) => ({ value: c.id, label: c.name })),
          },
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
        ],
      }}
    />
  );
}
