import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import { apiClient } from "../../lib/api-client";

export interface ReminderItem {
  item_code: string;
  description: string;
  erp_received: number;
  delivered: number;
  ordered: number;
  to_deliver: number;
  last_received: string | null;
  grc_numbers: string[];
}

export interface Reminder {
  po_id: number;
  po_number: string;
  vendor_name: string | null;
  items: ReminderItem[];
  to_deliver: number;
  last_received: string | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What the reminders call answers, read the same way whatever the server's age. */
export interface RemindersAnswer {
  /** false = the ERP cannot give goods receipts (yet): "no information", never an error on screen. */
  available: boolean;
  message: string | null;
  items: Reminder[];
}

/** `/erp/reminders?…&envelope=true` (S7: the server answers `{available, message, items}`, never a 503). */
export function remindersPath(poId?: number): string {
  return poId ? `/erp/reminders?po_id=${poId}&envelope=true` : "/erp/reminders?envelope=true";
}

/** An envelope, or an older server's bare list; anything else = no information. */
export function asReminders(data: unknown): RemindersAnswer {
  if (Array.isArray(data)) return { available: true, message: null, items: data as Reminder[] };
  if (data && typeof data === "object") {
    const d = data as { available?: unknown; message?: unknown; items?: unknown };
    return {
      available: d.available !== false,
      message: typeof d.message === "string" ? d.message : null,
      items: Array.isArray(d.items) ? (d.items as Reminder[]) : [],
    };
  }
  return { available: false, message: null, items: [] };
}

/**
 * Only runs when the server has an ERP connection (and, for one PO, only for a PO made from the ERP);
 * any ERP trouble is simply "no reminders" here, since this is an extra and must never get in the way.
 */
export function useErpReminders(poId?: number, enabled = true) {
  const statusQ = useQuery({
    queryKey: ["erp", "status"],
    queryFn: () => apiClient.get<{ configured: boolean }>("/erp/status"),
    enabled,
    retry: false,
  });
  return useQuery({
    queryKey: ["erp", "reminders", poId ?? "all"],
    queryFn: async (): Promise<RemindersAnswer> => {
      try {
        return asReminders(await apiClient.get<unknown>(remindersPath(poId)));
      } catch {
        // An older server still answering 503: no information, not an error.
        return { available: false, message: null, items: [] };
      }
    },
    enabled: enabled && statusQ.data?.configured === true,
    retry: false,
  });
}

/** Top of the Purchase Orders list: every PO where the ERP shows goods received
 * that have not been marked delivered here. */
export function DeliveryRemindersCard() {
  const q = useErpReminders();
  const reminders = q.data?.available ? q.data.items : [];
  if (reminders.length === 0) return null;
  // Compact and secondary: one line, the list opens on demand (open by default only when short).
  return (
    <details
      className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2"
      aria-label="Delivery reminders"
      open={reminders.length <= 3}
    >
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <PackageCheck className="h-4 w-4" aria-hidden="true" />
        The ERP shows goods received on {plural(reminders.length, "purchase order")} that are not marked delivered here
      </summary>
      <p className="mb-2 mt-1 text-xs text-muted-foreground">Open the PO and use Receive: serial numbers are needed, so it is never done automatically.</p>
      <ul className="flex flex-col gap-1">
        {reminders.map((r) => (
          <li key={r.po_id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border bg-background px-2 py-1 text-sm">
            <Link to="/purchase-orders/$id" params={{ id: String(r.po_id) }} className="font-medium underline">
              {r.po_number}
            </Link>
            <span className="text-xs text-muted-foreground">
              {r.vendor_name ? `${r.vendor_name} · ` : ""}
              {plural(r.items.length, "item")}, {r.to_deliver} to deliver
              {r.last_received ? ` · last received ${r.last_received}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Top of one PO: what exactly the ERP says was received. */
export function DeliveryReminderBanner({ poId, fromErp }: { poId: number; fromErp: boolean }) {
  const q = useErpReminders(poId, fromErp);
  const reminder = q.data?.available ? q.data.items[0] : undefined;
  if (!fromErp || !reminder) return null;
  return (
    <section className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm" aria-label="Delivery reminder">
      <p className="font-medium">
        The ERP shows goods received that are not marked delivered here ({reminder.to_deliver} to deliver).
      </p>
      <ul className="mt-1 list-disc pl-5 text-xs">
        {reminder.items.map((i) => (
          <li key={i.item_code}>
            {i.description}: ERP received {i.erp_received}, delivered here {i.delivered} of {i.ordered}
            {i.grc_numbers.length > 0 ? ` (${i.grc_numbers.join(", ")}${i.last_received ? `, ${i.last_received}` : ""})` : ""}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">Use Receive on those lines below to enter their serial numbers.</p>
    </section>
  );
}
