import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { DatabaseZap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Bundle } from "../bundles/BundlesScreen";
import { PoDraftCard, type Draft } from "./PoDraftCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";

interface ErpPoRow {
  po_code: number;
  po_number: string;
  po_date: string;
  company_code: string;
  delivery_location: string;
  vendor_id: number;
  vendor_name: string;
  line_count: number;
  net_amount: number;
}

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PoFromErp() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const statusQ = useQuery({
    queryKey: ["erp", "status"],
    queryFn: () => apiClient.get<{ configured: boolean }>("/erp/status"),
  });
  const posQ = useQuery({
    queryKey: ["erp", "pos"],
    queryFn: () => apiClient.get<ErpPoRow[]>("/erp/pos"),
    enabled: statusQ.data?.configured === true,
    retry: false,
  });
  const bundlesQ = useQuery({ queryKey: ["bundles"], queryFn: () => apiClient.get<Bundle[]>("/bundles") });
  const draftQ = useQuery({
    queryKey: ["erp", "draft", selected],
    queryFn: () => apiClient.get<Draft>(`/erp/pos/${selected}/draft`),
    enabled: selected !== null,
    retry: false,
    gcTime: 0,
  });

  const needle = search.trim().toLowerCase();
  const rows = (posQ.data ?? []).filter(
    (p) => !needle || [p.po_number, p.vendor_name, p.delivery_location, p.company_code].some((v) => v.toLowerCase().includes(needle)),
  );

  const columns: DataTableColumn<ErpPoRow>[] = [
    { key: "po_number", header: "PO No", cellClassName: "font-medium", cell: (p) => p.po_number },
    { key: "po_date", header: "PO Date", cell: (p) => p.po_date },
    { key: "vendor", header: "Vendor", cell: (p) => p.vendor_name },
    { key: "delivery", header: "Delivery", cell: (p) => p.delivery_location },
    { key: "lines", header: "Lines", cellClassName: "tabular-nums", cell: (p) => p.line_count },
    { key: "amount", header: "PO Value", cellClassName: "tabular-nums", cell: (p) => money(p.net_amount) },
    {
      key: "open", header: "",
      cell: (p) => (
        <Button size="sm" variant="outline" aria-label={`Review ${p.po_number}`} onClick={() => setSelected(p.po_code)}>
          Review
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Purchase Orders from the ERP"
        description="Open purchase orders of your vendors, read from the ERP. Pick one, check it, then create it here. Nothing is written back to the ERP."
        actions={<Link className="text-sm underline" to="/purchase-orders">Back to Purchase Orders</Link>}
      />

      {statusQ.data && !statusQ.data.configured && (
        <EmptyState
          icon={DatabaseZap} title="The ERP connection is not set up on this server."
          description="Ask the administrator to add the ERP connection settings (PO_SOURCE_*)."
        />
      )}

      {selected === null && statusQ.data?.configured && (
        <>
          <Input
            aria-label="Search ERP purchase orders" placeholder="Search PO No, Vendor, Delivery…" className="max-w-sm"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          {posQ.isError ? (
            <ErrorState
              message={posQ.error instanceof Error ? posQ.error.message : "Couldn't load the ERP purchase orders."}
              onRetry={() => posQ.refetch()}
            />
          ) : (
            <DataTable
              columns={columns} rows={rows} rowKey={(p) => p.po_code} isLoading={posQ.isLoading}
              emptyState={
                <EmptyState
                  title={needle ? "No matches" : "No open purchase orders to bring in."}
                  description={needle ? "Try a different search." : "Only POs of vendors linked to the ERP are shown. Link a vendor in Vendors, or all of them are already here."}
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
            <p className="text-sm text-destructive" role="alert">
              {draftQ.error instanceof Error ? draftQ.error.message : "Could not read this purchase order."}
            </p>
          )}
          {draftQ.data && <PoDraftCard key={draftQ.data.erp_po_code} draft={draftQ.data} bundles={bundlesQ.data ?? []} />}
        </div>
      )}
    </div>
  );
}
