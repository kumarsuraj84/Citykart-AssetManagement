import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAccess } from "@/lib/access";
import { INBOX_PATH, type Inbox, type InboxSection } from "./ErpInbox";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/**
 * Home, head-office admin only (S3b-2): the ERP decisions waiting in the ERP Inbox, one row per kind with its count
 * and a link to that part of the inbox. Nothing for anyone else, while loading, on any ERP trouble, or when nothing waits.
 */
export function ErpInboxHomeRow() {
  const { can } = useAccess();
  const allowed = can("settings");
  const q = useQuery({
    queryKey: ["erp", "inbox", "all"],
    queryFn: () => apiClient.get<Inbox>("/erp/inbox"),
    enabled: allowed,
    retry: false,
  });
  const counts = q.data && typeof q.data === "object" ? q.data.counts : undefined;
  if (!allowed || !counts) return null;
  const rows: { key: InboxSection; text: string; action: string; n: number }[] = [
    { key: "items", n: counts.items ?? 0, text: `${plural(counts.items ?? 0, "new item")} from the ERP to link to an Item`, action: "Decide" },
    { key: "vendors", n: counts.vendors ?? 0, text: `${plural(counts.vendors ?? 0, "new vendor")} from the ERP to match`, action: "Match" },
    { key: "stores", n: counts.stores ?? 0, text: `${plural(counts.stores ?? 0, "store")} from the ERP not created yet`, action: "Create" },
  ].filter((r) => r.n > 0) as { key: InboxSection; text: string; action: string; n: number }[];
  if (rows.length === 0) return null;
  return (
    <section aria-label="ERP Inbox" className="rounded-md border bg-card px-3 py-2">
      <h2 className="text-sm font-semibold">ERP Inbox <span className="font-normal text-muted-foreground">· Head-office Admin</span></h2>
      <ul className="flex flex-col divide-y" aria-label="ERP decisions waiting">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>{r.text}</span>
            <Link
              to={INBOX_PATH}
              search={{ section: r.key } as never}
              className="inline-flex shrink-0 items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
              data-inbox={r.key}
            >
              {r.action}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
