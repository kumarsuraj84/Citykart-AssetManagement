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
  status_since?: string | null;
  current_asset_user_type?: string | null;
}

/**
 * My Assets: the self-service login's own page (an employee or store login).
 * The server only ever returns the assets currently with the person who is
 * signed in, so this is "what is with you", never the whole register. Staff
 * do not use this page: /my-assets sends them to Assets with "Mine" on.
 */
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
  const total = data?.total ?? items.length;

  const columns: DataTableColumn<AssetRow>[] = [
    {
      key: "code",
      header: "Asset Code",
      cellClassName: "font-mono text-sm",
      cell: (a) => <Link to="/assets/$id" params={{ id: String(a.id) }}>{a.asset_code}</Link>,
    },
    { key: "description", header: "Description", cell: (a) => a.description },
    {
      key: "status",
      header: "Status",
      cell: (a) => <StatusBadge status={a.status} holderType={a.current_asset_user_type} compact />,
    },
    { key: "since", header: "With You Since", cell: (a) => a.status_since ?? "—" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="My Assets"
        description="The assets that are with you right now. Tell your admin if something here is not with you."
      />

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(a) => a.id}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        error={error}
        onRetry={() => refetch()}
        emptyState={
          <EmptyState
            icon={Boxes}
            title="No assets are with you"
            description="Assets given to you will appear here."
          />
        }
      />
      {total > items.length && (
        <p className="text-xs text-muted-foreground">
          Showing the first {items.length} of the {total} assets with you.
        </p>
      )}
    </div>
  );
}
