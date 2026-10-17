import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { DatabaseZap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Bundle } from "../bundles/BundlesScreen";
import { useMyItems } from "../items/useMyItems";
import { PoDraftCard, type Draft } from "./PoDraftCard";
import { useDebounced } from "./po-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { companyOptions } from "@/lib/option-labels";
import { ErpSyncStatus } from "../erp/ErpSyncStatus";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

export interface ErpPoProblem {
  kind: string;
  message: string;
  count?: number;
}

export interface ErpPoRow {
  po_code: number;
  po_number: string;
  po_date: string;
  company_id: number;
  company_code: string;
  delivery_location: string;
  /** The CKAM vendor linked to the ERP supplier; null while the supplier still needs matching. */
  vendor_id: number | null;
  /** The CKAM vendor's name when linked, else the ERP supplier's. */
  vendor_name: string;
  line_count: number;
  net_amount: number;
  /** Lines CKAM tracks, and lines it does not (cables, hangers…). */
  tracked_lines?: number;
  untracked_lines?: number;
  // S3a-2 (additive)
  erp_vendor_code?: string | null;
  erp_vendor_name?: string | null;
  vendor_linked?: boolean;
  undecided_item_count?: number;
  tracked_line_count?: number;
  untracked_line_count?: number;
  readiness?: "READY" | "NEEDS_INPUT";
  problems?: ErpPoProblem[];
}

export interface ErpFreshness {
  configured?: boolean;
  copied?: boolean;
  available?: boolean;
  data_as_of?: string | null;
  data_as_of_text?: string | null;
  last_attempt_at?: string | null;
  refresh_failed?: boolean;
  message?: string | null;
}

interface ErpPoEnvelope {
  pos: ErpPoRow[];
  counts?: { all: number; ready: number; needs_input: number; other_suppliers?: number };
  freshness?: ErpFreshness;
}

type Readiness = "ALL" | "READY" | "NEEDS_INPUT";

interface Company {
  id: number;
  name: string;
  code?: string | null;
}

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `/erp/pos?envelope=true&…` for the chosen filters. By default only the POs of suppliers already linked to a
 * vendor (`only_linked`); `includeOthers` asks for every open PO, as the screen did before. */
export function erpPosPath(p: { readiness: Readiness; q: string; companyId: string; includeOthers?: boolean }): string {
  const params = new URLSearchParams({ envelope: "true" });
  if (p.readiness !== "ALL") params.set("readiness", p.readiness);
  if (p.q.trim()) params.set("q", p.q.trim());
  if (p.companyId) params.set("company_id", p.companyId);
  if (!p.includeOthers) params.set("only_linked", "true");
  return `/erp/pos?${params.toString()}`;
}

/** An older server answers a bare list: read it as an envelope without counts. */
function asEnvelope(data: unknown): ErpPoEnvelope {
  if (Array.isArray(data)) return { pos: data as ErpPoRow[] };
  if (data && typeof data === "object" && Array.isArray((data as ErpPoEnvelope).pos)) return data as ErpPoEnvelope;
  return { pos: [] };
}

/** "Ready", or "Needs your input" with the server's own sentences. */
function ReadinessChip({ row }: { row: ErpPoRow }) {
  const needs = row.readiness === "NEEDS_INPUT" || (row.readiness === undefined && row.vendor_id === null);
  if (!needs) {
    return <span className="inline-flex rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-on-success-soft">Ready</span>;
  }
  const sentences = (row.problems ?? []).map((p) => p.message).filter(Boolean);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="inline-flex w-fit rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-on-warning-soft">Needs your input</span>
      {sentences.length > 0 && <span className="text-xs text-muted-foreground">{sentences.join(" ")}</span>}
    </div>
  );
}

/**
 * Pick from ERP (S3b-2): the open ERP purchase orders of the person's companies, each with a plain readiness
 * ("Ready" / "Needs your input" and what is needed). By default only the POs of suppliers already linked to a vendor
 * are listed; "Also show other suppliers' POs (N)" brings in the rest. Nothing is lost: a PO of a supplier not matched
 * to a vendor yet opens in the review like any other, where the vendor is matched.
 */
export function PoFromErp() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [readiness, setReadiness] = useState<Readiness>("ALL");
  const [companyId, setCompanyId] = useState("");
  const [includeOthers, setIncludeOthers] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const statusQ = useQuery({
    queryKey: ["erp", "status"],
    queryFn: () => apiClient.get<{ configured: boolean }>("/erp/status"),
  });
  const companiesQ = useQuery({ queryKey: ["asset_users", "me", "companies"], queryFn: () => apiClient.get<Company[]>("/asset-users/me/companies") });
  const companies = Array.isArray(companiesQ.data) ? companiesQ.data : [];
  const path = erpPosPath({ readiness, q, companyId, includeOthers });
  const posQ = useQuery({
    queryKey: ["erp", "pos", path],
    queryFn: async () => asEnvelope(await apiClient.get<unknown>(path)),
    enabled: statusQ.data?.configured === true,
    retry: false,
    placeholderData: (previous) => previous,
  });
  const bundlesQ = useQuery({ queryKey: ["bundles"], queryFn: () => apiClient.get<Bundle[]>("/bundles") });
  // S7 (P2-6): the review's Item pickers list only this person's own work areas.
  const { query: itemsQ } = useMyItems();
  const draftQ = useQuery({
    queryKey: ["erp", "draft", selected],
    queryFn: () => apiClient.get<Draft>(`/erp/pos/${selected}/draft`),
    enabled: selected !== null,
    retry: false,
    gcTime: 0,
  });

  // The same query (and key) as ErpSyncStatus: when that line already says "ERP data as of …",
  // this screen does not say it a second time in another format (S7 P3-1).
  const syncQ = useQuery({
    queryKey: ["erp", "sync"],
    queryFn: () => apiClient.get<{ configured?: boolean }>("/erp/sync"),
    retry: false,
  });
  const syncLineShown = !!syncQ.data && typeof syncQ.data === "object" && (syncQ.data as { configured?: boolean }).configured === true;

  const envelope = posQ.data;
  const rows = envelope?.pos ?? [];
  const counts = envelope?.counts;
  const freshness = envelope?.freshness;
  const freshnessProblem = !!freshness && (freshness.refresh_failed === true || freshness.available === false);
  const filtered = readiness !== "ALL" || q.trim() !== "" || companyId !== "";
  const others = counts?.other_suppliers ?? 0;
  const hiddenOthers = !includeOthers && others > 0;

  const columns: DataTableColumn<ErpPoRow>[] = [
    { key: "po_number", header: "PO No", cellClassName: "font-medium", cell: (p) => p.po_number },
    { key: "company", header: "Company", cell: (p) => p.company_code },
    { key: "po_date", header: "PO Date", cell: (p) => p.po_date },
    {
      key: "vendor", header: "Vendor",
      cell: (p) => (p.vendor_linked === false
        ? <span>{p.erp_vendor_name ?? p.vendor_name} <span className="text-xs text-muted-foreground">(ERP supplier)</span></span>
        : p.vendor_name),
    },
    { key: "delivery", header: "Delivery", cell: (p) => p.delivery_location },
    {
      key: "lines", header: "Lines", cellClassName: "tabular-nums",
      cell: (p) => {
        const tracked = p.tracked_line_count ?? p.tracked_lines;
        const untracked = p.untracked_line_count ?? p.untracked_lines;
        return untracked ? `${tracked ?? 0} (+${untracked} not tracked)` : p.line_count;
      },
    },
    { key: "amount", header: "PO Value", cellClassName: "tabular-nums", cell: (p) => money(p.net_amount) },
    { key: "readiness", header: "Status", cell: (p) => <ReadinessChip row={p} /> },
    {
      key: "open", header: "",
      cell: (p) => (
        <Button size="sm" variant="outline" aria-label={`Review ${p.po_number}`} onClick={() => setSelected(p.po_code)}>
          Review
        </Button>
      ),
    },
  ];

  const chips: { value: Readiness; label: string; count?: number }[] = [
    { value: "ALL", label: "All", count: counts?.all },
    { value: "READY", label: "Ready", count: counts?.ready },
    { value: "NEEDS_INPUT", label: "Needs your input", count: counts?.needs_input },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Purchase Orders from the ERP"
        description="Open purchase orders in the ERP from the vendors you have added. Ready ones need only a check; the others say what is needed, and you decide it in the review. Purchase orders of other suppliers are one click away. Nothing is written back to the ERP."
        actions={<Link className="text-sm underline" to="/purchase-orders">Back to Purchase Orders</Link>}
      />

      <ErpSyncStatus />

      {statusQ.data && !statusQ.data.configured && (
        <EmptyState
          icon={DatabaseZap} title="The ERP connection is not set up on this server."
          description="Ask the head-office admin."
        />
      )}

      {selected === null && statusQ.data?.configured && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Search ERP purchase orders" placeholder="Search PO No or vendor…" className="max-w-sm"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
            {companies.length > 1 && (
              <div className="w-56">
                <SearchableSelect
                  id="erp-po-company" aria-label="Company" value={companyId || "ALL"}
                  onValueChange={(v) => setCompanyId(v === "ALL" ? "" : v)}
                  options={[{ value: "ALL", label: "All companies" }, ...companyOptions(companies)]}
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Show">
              {chips.map((c) => (
                <Button
                  key={c.value} size="sm" variant={readiness === c.value ? "default" : "outline"} aria-pressed={readiness === c.value}
                  onClick={() => setReadiness(c.value)}
                >
                  {c.label}{c.count !== undefined ? ` (${c.count.toLocaleString("en-IN")})` : ""}
                </Button>
              ))}
            </div>
            {(others > 0 || includeOthers) && (
              <Button
                size="sm" variant={includeOthers ? "default" : "outline"} aria-pressed={includeOthers}
                onClick={() => setIncludeOthers((v) => !v)}
              >
                Also show other suppliers' POs{counts?.other_suppliers !== undefined ? ` (${others.toLocaleString("en-IN")})` : ""}
              </Button>
            )}
          </div>

          {freshness && (freshness.data_as_of_text || freshness.message) && (freshnessProblem || !syncLineShown) && (
            <p className="text-xs text-muted-foreground" aria-label={syncLineShown ? "ERP data problem" : "ERP data freshness"}>
              {freshnessProblem
                ? freshness.message ?? `ERP data could not refresh. Using data from ${freshness.data_as_of_text}.`
                : `ERP data as of ${freshness.data_as_of_text}`}
            </p>
          )}

          {posQ.isError ? (
            <ErrorState
              message={posQ.error instanceof Error ? posQ.error.message : "Couldn't load the ERP purchase orders."} error={posQ.error}
              onRetry={() => posQ.refetch()}
            />
          ) : (
            <DataTable
              columns={columns} rows={rows} rowKey={(p) => p.po_code} isLoading={posQ.isLoading}
              emptyState={
                <EmptyState
                  title={filtered ? "No matches" : hiddenOthers ? "No open purchase orders of your vendors." : "No open purchase orders to bring in."}
                  description={
                    filtered
                      ? hiddenOthers ? `Try a different search or filter. ${others.toLocaleString("en-IN")} purchase orders of other suppliers are hidden: use "Also show other suppliers' POs".` : "Try a different search or filter."
                      : hiddenOthers ? `${others.toLocaleString("en-IN")} open purchase orders belong to suppliers that are not vendors yet. Use "Also show other suppliers' POs" to see them.` : "Every open ERP purchase order is already here."
                  }
                />
              }
            />
          )}
        </>
      )}

      {selected !== null && (
        <div className="flex flex-col gap-3">
          <div>
            <Button variant="outline" size="sm" onClick={() => setSelected(null)}>← Back to the list</Button>
          </div>
          {draftQ.isLoading && <p className="text-sm text-muted-foreground">Reading the purchase order from the ERP…</p>}
          {draftQ.isError && (
            <ErrorMessage className="text-sm text-destructive" error={draftQ.error} message={draftQ.error instanceof Error ? draftQ.error.message : "Could not read this purchase order."} />
          )}
          {draftQ.data && itemsQ.data && bundlesQ.data && (
            <PoDraftCard key={draftQ.data.erp_po_code} draft={draftQ.data} bundles={bundlesQ.data} items={itemsQ.data} />
          )}
          {itemsQ.isError && <p className="text-sm text-destructive" role="alert">Could not load the Items.</p>}
        </div>
      )}
    </div>
  );
}
