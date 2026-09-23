import { Badge } from "@/components/ui/badge";

export interface AssetEvent {
  id: number;
  event_type: string;
  event_date: string;
  status_after: string;
  remarks: string | null;
  reference_no: string | null;
}

const ICONS: Record<string, string> = {
  PROCURED: "📦",
  IMPORTED: "📥",
  MOVED: "🔁",
  SENT_FOR_REPAIR: "🔧",
  RECEIVED_FROM_REPAIR: "✅",
  DISPOSED: "🗑️",
  SOLD: "💰",
  SCRAPPED: "♻️",
  LOST: "❓",
  FOUND: "🔎",
  CORRECTION: "✏️",
};

export function Timeline({ events }: { events: AssetEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No history yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-3">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-3 border-b pb-3 last:border-b-0">
          <span aria-hidden className="text-lg leading-none">
            {ICONS[e.event_type] ?? "•"}
          </span>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{e.event_type.replace(/_/g, " ")}</span>
              <Badge variant="outline">{e.status_after}</Badge>
              <span className="text-sm text-muted-foreground">
                {new Date(e.event_date).toLocaleString()}
              </span>
            </div>
            {e.reference_no && (
              <span className="text-sm text-muted-foreground">Ref: {e.reference_no}</span>
            )}
            {e.remarks && <p className="text-sm">{e.remarks}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
