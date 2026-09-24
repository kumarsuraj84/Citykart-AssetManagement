import { Boxes } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";

interface AssetRow {
  id: number;
  asset_code: string;
  description: string;
  status: string;
  category_id: number;
}

interface Option {
  id: number;
  name: string;
}

function asOptionArray(data: unknown): Option[] {
  return Array.isArray(data) ? (data as Option[]) : [];
}

export function MyAssets() {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["assets", "mine"],
    queryFn: () => apiClient.get<{ items: AssetRow[]; total: number }>("/assets"),
  });
  const items = data?.items ?? [];

  const { data: categoriesData } = useQuery({
    queryKey: ["masters", "categories"],
    queryFn: () => apiClient.get<Option[]>("/masters/categories"),
  });
  const categories = asOptionArray(categoriesData);
  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? String(id);

  const columns: DataTableColumn<AssetRow>[] = [
    {
      key: "code",
      header: "Code",
      cellClassName: "font-mono text-sm",
      // A real, independently keyboard-focusable link, not the hardcoded
      // text-blue-600 the pre-AM-06 version used -- same unstyled/inherited
      // link treatment AssetRegister's own Code column already uses.
      cell: (a) => <Link to="/assets/$id" params={{ id: String(a.id) }}>{a.asset_code}</Link>,
    },
    { key: "description", header: "Description", cell: (a) => a.description },
    { key: "category", header: "Category", cell: (a) => categoryName(a.category_id) },
    { key: "status", header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="My Assets" description="Assets currently in your custody." />

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(a) => a.id}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
        emptyState={
          <EmptyState
            icon={Boxes}
            title="No assets in your custody"
            description="Assets allotted or installed to you will appear here."
          />
        }
      />
    </div>
  );
}
