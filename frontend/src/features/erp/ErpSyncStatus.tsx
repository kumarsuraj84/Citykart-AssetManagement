import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { AsyncButton } from "@/components/shared/AsyncButton";

interface SyncRun {
  status: "success" | "failed" | "skipped" | "running";
  trigger: string;
  started_at: string;
  finished_at: string | null;
  source_stamp: string | null;
  message: string | null;
  po_lines_new: number;
  po_lines_changed: number;
  po_lines_gone: number;
}

interface SyncStatus {
  configured: boolean;
  last: SyncRun | null;
  last_success: SyncRun | null;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : null);

/**
 * "ERP data as of ...": the ERP screens read CKAM's own copy of the ERP data, copied again whenever the ERP's
 * warehouse has loaded newer data. The Primary Owner can copy it right now. Says nothing when this server has
 * no ERP connection (or the user may not see it): it is an extra, never in the way.
 */
export function ErpSyncStatus() {
  const qc = useQueryClient();
  const isPrimaryOwner = useAuthStore((s) => s.isPrimaryOwner);
  const q = useQuery({
    queryKey: ["erp", "sync"],
    queryFn: () => apiClient.get<SyncStatus>("/erp/sync"),
    retry: false,
  });
  const refresh = useMutation({
    mutationFn: () => apiClient.post<SyncRun>("/erp/sync", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["erp"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
  const status = q.data;
  if (!status || typeof status !== "object" || !("configured" in status) || !status.configured) return null;

  const good = status.last_success;
  const asOf = good ? when(good.source_stamp ?? good.finished_at) : null;
  const failure = status.last && status.last.status === "failed" ? status.last : null;
  const refreshFailed = refresh.data && refresh.data.status === "failed" ? refresh.data : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="ERP data freshness">
      <span>{asOf ? `ERP data as of ${asOf}.` : "The ERP data has not been copied yet."}</span>
      {(refreshFailed ?? failure) && (
        <span className="text-destructive" role="alert">The last refresh did not work: {(refreshFailed ?? failure)!.message}</span>
      )}
      {refresh.isError && (
        <span className="text-destructive" role="alert">{refresh.error instanceof Error ? refresh.error.message : "Could not refresh."}</span>
      )}
      {isPrimaryOwner && (
        <AsyncButton size="sm" variant="ghost" pending={refresh.isPending} pendingLabel="Refreshing…" onClick={() => refresh.mutate()}>
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
          Refresh now
        </AsyncButton>
      )}
    </div>
  );
}
