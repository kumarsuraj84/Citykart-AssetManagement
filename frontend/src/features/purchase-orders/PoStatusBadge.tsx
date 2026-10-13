import { cn } from "@/lib/utils";
import { poStatusLabel } from "@/lib/labels";

// A PO's (or one PO line's) status as a small dot + plain word, the compact
// style dense tables already use for asset status (AM-16). Never a raw code.
const DOT: Record<string, string> = {
  WAITING: "bg-warning",
  PARTLY_RECEIVED: "bg-info",
  RECEIVED: "bg-success",
  CANCELLED: "bg-secondary-foreground",
};

export function PoStatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-foreground", className)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[status] ?? "bg-secondary-foreground")} aria-hidden="true" />
      {poStatusLabel(status)}
    </span>
  );
}
