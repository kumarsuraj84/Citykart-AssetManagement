import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";

// Release 3 (movement redesign): what is away for repair, by repair vendor, and for how long.
// Read-only: sending and receiving are done on Move (Send for Repair / Receive from Repair).

interface RepairSummary {
  vendors: { vendor_id: number; vendor_name: string; assets: number; oldest_days: number | null }[];
  without_vendor: { assets: number; oldest_days: number | null };
}

interface VendorAsset {
  asset_id: number;
  asset_code: string;
  serial_number: string | null;
  description: string | null;
  days: number | null;
  origin_name: string | null;
  origin_active: boolean | null;
}

function assetsWord(n: number): string {
  return `${n.toLocaleString("en-IN")} asset${n === 1 ? "" : "s"}`;
}

function daysWord(n: number | null | undefined): string {
  if (n == null) return "—";
  return n === 0 ? "today" : `${n} day${n === 1 ? "" : "s"}`;
}

function VendorAssets({ vendorId }: { vendorId: number }) {
  const q = useQuery({
    queryKey: ["repairs", "vendor", String(vendorId)],
    queryFn: () => apiClient.get<VendorAsset[]>(`/repairs/vendors/${vendorId}/assets`),
  });
  if (q.isLoading) return <p className="px-3 py-2 text-sm text-muted-foreground">Loading…</p>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const rows = Array.isArray(q.data) ? q.data : [];
  if (rows.length === 0) return <p className="px-3 py-2 text-sm text-muted-foreground">This vendor holds no assets right now.</p>;
  return (
    <ul className="flex flex-col divide-y border-t text-sm">
      {rows.map((a) => (
        <li key={a.asset_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-1.5">
          <span className="min-w-0">
            <Link to="/assets/$id" params={{ id: String(a.asset_id) }} className="font-mono text-xs underline">{a.asset_code}</Link>{" "}
            <span className="break-words">{a.description}</span>
            {a.serial_number && <span className="text-xs text-muted-foreground"> · Serial {a.serial_number}</span>}
          </span>
          <span className="text-xs text-muted-foreground">
            with the vendor {daysWord(a.days)} · sent from {a.origin_name ?? "an unknown place"}
            {a.origin_name != null && a.origin_active === false ? " (no longer active)" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Repairs: which repair vendor holds how many of our assets, and how long the oldest has been away.
 * "Receive back" opens Move on Receive from Repair, which asks where each asset goes.
 */
export function RepairsScreen() {
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({ queryKey: ["repairs", "summary"], queryFn: () => apiClient.get<RepairSummary>("/repairs") });
  const data = q.data && Array.isArray(q.data.vendors) ? q.data : undefined;   // a malformed answer shows nothing, never crashes
  const vendors = data ? data.vendors : [];
  const noVendor = data?.without_vendor?.assets ?? 0;
  const total = vendors.reduce((n, v) => n + v.assets, 0) + noVendor;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Repairs"
        description="Which repair vendor has which of our assets, and for how long. To send something, use Move > Send for Repair and choose the vendor. When it comes back, use Move > Receive from Repair: CKAM asks where it goes."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/asset-movement" search={{ choice: "from-repair" }}>Receive from Repair</Link>
          </Button>
        }
      />

      {q.isLoading && <p className="text-sm text-muted-foreground" role="status">Loading…</p>}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}

      {data && (
        <p className="text-sm text-muted-foreground" role="status">
          {total === 0 ? "Nothing is away for repair." : `${assetsWord(total)} away for repair.`}
        </p>
      )}

      {data && total === 0 && (
        <EmptyState title="Nothing is away for repair." description="Assets sent for repair appear here under their repair vendor." />
      )}

      {vendors.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Repair vendors">
          {vendors.map((v) => {
            const expanded = open === v.vendor_id;
            return (
              <li key={v.vendor_id} className="rounded-md border">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-left text-sm font-medium"
                    aria-expanded={expanded}
                    aria-label={`${v.vendor_name}: ${assetsWord(v.assets)}`}
                    onClick={() => setOpen(expanded ? null : v.vendor_id)}
                  >
                    {expanded ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                    {v.vendor_name}
                  </button>
                  <span className="text-sm text-muted-foreground">
                    <span className="font-semibold tabular-nums text-foreground">{assetsWord(v.assets)}</span>
                    {v.oldest_days != null && <> · oldest away {daysWord(v.oldest_days)}</>}
                  </span>
                </div>
                {expanded && <VendorAssets vendorId={v.vendor_id} />}
              </li>
            );
          })}
        </ul>
      )}

      {noVendor > 0 && (
        <section className="rounded-md border bg-muted/30 px-3 py-2 text-sm" aria-label="No vendor recorded">
          <p className="font-medium">No vendor recorded: {assetsWord(noVendor)}</p>
          <p className="text-xs text-muted-foreground">
            {noVendor === 1 ? "This asset was" : "These assets were"} sent for repair before CKAM recorded the vendor
            {data?.without_vendor?.oldest_days != null ? ` (the oldest ${daysWord(data.without_vendor.oldest_days)} ago)` : ""}.{" "}
            <Link to="/assets" search={{ status: "UNDER_REPAIR" }} className="font-medium text-primary underline-offset-2 hover:underline">
              See them in Assets
            </Link>
            .
          </p>
        </section>
      )}
    </div>
  );
}
