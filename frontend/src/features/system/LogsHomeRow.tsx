import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { apiClient, type Page } from "@/lib/api-client";
import { useAccess } from "@/lib/access";
import { queryString } from "./logs-api";
import { LOGS_PATH } from "./LogsScreen";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

function countOf(page: Page<unknown[]> | null | undefined): number {
  if (!page || typeof page !== "object") return 0;
  if (typeof page.total === "number") return page.total;
  return Array.isArray(page.data) ? page.data.length : 0;
}

/**
 * Home, head-office admin only (S8): "N errors / N user reports need a look → Logs" when the last 24 hours
 * had kinds of error or NEW problem reports. Two cheap calls (limit=1, the X-Total-Count); nothing at all
 * on any failure, while loading, or when both are 0.
 */
export function LogsHomeRow() {
  const { can } = useAccess();
  const allowed = can("settings");
  // Rounded to the minute so the query key (and the answer) stays put while Home re-renders.
  const since = new Date(Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 60000) * 60000).toISOString();
  const errorsQ = useQuery({
    queryKey: ["admin-logs", "home", "errors", since],
    // Real errors only (ERROR / CRITICAL). Slow-request WARNINGs (e.g. the ERP copy taking 3 s) are in the Logs
    // screen, but they are not "something is broken" and must not light up Home.
    queryFn: async () => {
      const pages = await Promise.all(
        ["ERROR", "CRITICAL"].map((level) => apiClient.getPage<unknown[]>(`/admin/logs/errors?${queryString({ group: true, level, from: since, limit: 1 })}`)),
      );
      return { total: pages.reduce((n, p) => n + countOf(p), 0), data: [] } as unknown as Page<unknown[]>;
    },
    enabled: allowed,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const reportsQ = useQuery({
    queryKey: ["admin-logs", "home", "reports", since],
    queryFn: async () => (await apiClient.getPage<unknown[]>(`/admin/logs/client-reports?${queryString({ status: "NEW", from: since, limit: 1 })}`)) ?? null,
    enabled: allowed,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  if (!allowed) return null;
  const errors = errorsQ.isSuccess ? countOf(errorsQ.data) : 0;
  const reports = reportsQ.isSuccess ? countOf(reportsQ.data) : 0;
  if (errors <= 0 && reports <= 0) return null;
  const parts = [errors > 0 ? plural(errors, "error") : null, reports > 0 ? plural(reports, "user report") : null].filter(Boolean);
  return (
    <section aria-label="Logs" className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-sm">
      <span>
        {parts.join(" · ")} need{errors + reports === 1 ? "s" : ""} a look{" "}
        <span className="text-muted-foreground">· last 24 hours</span>
      </span>
      <Link
        to={LOGS_PATH}
        search={{ tab: errors > 0 ? "errors" : "reports" } as never}
        className="inline-flex shrink-0 items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
      >
        Logs
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </section>
  );
}
