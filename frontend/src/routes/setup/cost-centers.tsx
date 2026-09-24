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
  const companyName = (id: unknown) => companies.find((c) => c.id === id)?.name ?? String(id);

  return (
    <MasterCrudScreen<CostCenter>
      config={{
        resource: "cost-centers",
        title: "Cost Centers",
        singular: "Cost Centre",
        columns: [
          { key: "company_id", label: "Company", format: companyName },
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
        editFields: [{ key: "name", label: "Name" }],
      }}
    />
  );
}
