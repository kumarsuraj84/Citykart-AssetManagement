import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErpSyncStatus } from "../erp/ErpSyncStatus";

/**
 * Settings › ERP › ERP Data Sync: when CKAM last copied the ERP data (vendors, POs, receipts, invoices) and a
 * "Refresh now" for the head-office admin. The status line is the same component the PO screens show.
 */
export function ErpSyncScreen() {
  // Same query (and key) as ErpSyncStatus, read here only to explain an unconfigured server.
  const q = useQuery({
    queryKey: ["erp", "sync"],
    queryFn: () => apiClient.get<{ configured: boolean }>("/erp/sync"),
    retry: false,
  });
  const configured = q.data && typeof q.data === "object" && "configured" in q.data ? q.data.configured : false;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ERP Data Sync"
        description="CKAM reads its own copy of the ERP data. It is copied again whenever the ERP warehouse has loaded newer data; Refresh now copies it at once."
      />
      <div className="rounded-md border bg-card px-3 py-2.5">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : q.isError ? (
          <p className="text-sm text-destructive" role="alert">Could not read the ERP status. Try again later.</p>
        ) : configured ? (
          <ErpSyncStatus />
        ) : (
          <p className="text-sm text-muted-foreground">The ERP connection is not set up on this server.</p>
        )}
      </div>
    </div>
  );
}
