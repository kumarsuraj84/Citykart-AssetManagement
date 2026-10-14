import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

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

const lines = (n: number, what: string) => `${n} ${what} PO line${n === 1 ? "" : "s"}`;

/** "Checked just now (6:46 pm): 3 new PO lines, 1 changed PO line." / "... the ERP had nothing newer." (pure; exported for tests) */
export function refreshResultSentence(run: Pick<SyncRun, "status" | "finished_at" | "started_at" | "po_lines_new" | "po_lines_changed" | "po_lines_gone">): string {
  const at = run.finished_at ?? run.started_at;
  const time = at ? new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "";
  const head = `Checked just now${time ? ` (${time})` : ""}`;
  if (run.status === "running") return `${head}: a refresh is already running; the data updates when it ends.`;
  const parts = [
    run.po_lines_new > 0 ? lines(run.po_lines_new, "new") : null,
    run.po_lines_changed > 0 ? lines(run.po_lines_changed, "changed") : null,
    run.po_lines_gone > 0 ? lines(run.po_lines_gone, "removed") : null,
  ].filter(Boolean);
  if (run.status === "skipped" || parts.length === 0) return `${head}: the ERP had nothing newer to copy.`;
  return `${head}: copied ${parts.join(", ")}.`;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : null);

/**
 * "ERP data as of ...": the ERP screens read CKAM's own copy of the ERP data, copied again whenever the ERP's
 * warehouse has loaded newer data. The head-office admin can copy it right now. Says nothing when this server has
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
  // S7 (P3-6): what "Refresh now" just did, in one visible line (it used to change nothing on screen).
  const refreshDone = refresh.data && refresh.data.status !== "failed" ? refreshResultSentence(refresh.data) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="ERP data freshness">
      <span>{asOf ? `ERP data as of ${asOf}.` : "The ERP data has not been copied yet."}</span>
      {(refreshFailed ?? failure) && (
        <span className="text-destructive" role="alert">The last refresh did not work: {(refreshFailed ?? failure)!.message}</span>
      )}
      {refreshDone && <span className="text-foreground" role="status" aria-label="Refresh result">{refreshDone}</span>}
      {refresh.isError && (
        <ErrorMessage as="span" className="text-destructive" error={refresh.error} message={refresh.error instanceof Error ? refresh.error.message : "Could not refresh."} />
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
