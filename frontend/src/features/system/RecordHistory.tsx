import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/shared/ErrorState";
import { apiClient } from "@/lib/api-client";
import { useAccess } from "@/lib/access";
import { auditActionLabel, entityLabel } from "@/lib/labels";
import { formatTime, personOf, type AuditRow } from "./logs-api";
import { AuditDetail } from "./AuditTab";

/** The audit trail of one record (GET /admin/logs/entity/{entity}/{id}), newest first, each entry opening its details. */
export function RecordHistoryList({ entity, entityId }: { entity: string; entityId: string | number }) {
  const q = useQuery({
    queryKey: ["admin-logs", "entity", entity, String(entityId)],
    queryFn: () => apiClient.get<AuditRow[]>(`/admin/logs/entity/${encodeURIComponent(entity)}/${encodeURIComponent(String(entityId))}`),
    retry: false,
  });
  if (q.isError) return <ErrorState message="Couldn't read the history of this record." error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  const rows = Array.isArray(q.data) ? q.data : [];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing recorded for this record yet.</p>;
  return (
    <ol className="flex flex-col divide-y" aria-label="History">
      {rows.map((r) => (
        <li key={r.id} className="py-2">
          <details>
            <summary className="cursor-pointer list-none text-sm">
              <span className="block">{r.summary || auditActionLabel(r.action)}</span>
              <span className="text-xs text-muted-foreground">{formatTime(r.at)} · {personOf(r)} · {auditActionLabel(r.action)}</span>
            </summary>
            <div className="mt-2 rounded-md border bg-muted/20 p-2">
              <AuditDetail row={r} />
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

/**
 * S8: "History" on a record's screen (Vendor, Item, Employee / Store / Stock Room / Install Point, PO): who changed
 * what and when, from the audit trail. Head-office admin only -- nothing at all for anyone else (the API says 403).
 */
export function RecordHistoryButton({
  entity, entityId, name, className,
}: { entity: string; entityId: string | number | null | undefined; name?: string; className?: string }) {
  const { can } = useAccess();
  const [open, setOpen] = useState(false);
  if (!can("settings") || entityId === null || entityId === undefined || entityId === "") return null;
  return (
    <>
      <Button
        type="button" variant="outline" size="sm" className={className ?? "h-7 gap-1 px-2 text-xs"}
        onClick={() => setOpen(true)} aria-label={`History of ${name || entityLabel(entity).toLowerCase()}`}
      >
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        History
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-xl">
          <SheetHeader className="pr-6 text-left">
            <SheetTitle className="text-base">History{name ? ` of ${name}` : ""}</SheetTitle>
            <SheetDescription>{entityLabel(entity)} · every change and who made it, newest first.</SheetDescription>
          </SheetHeader>
          <div className="mt-3">{open && <RecordHistoryList entity={entity} entityId={entityId} />}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
