import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";

interface PendingRow {
  id: number;
  asset_code: string;
  description: string;
  item_name: string | null;
  category_name: string | null;
  subcategory_name: string | null;
  current_asset_user_name: string | null;
  current_asset_user_location_name: string | null;
  purchase_date: string;
  status: string;
}

const daysSince = (isoDate: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000));

/**
 * Assets whose serial is still to be read and filled in (an amplifier shows none on
 * the box; it is read in the store once opened). The IT person who got the serial from
 * the store types it here. Nothing is blocked while it waits: the asset can be moved,
 * allotted and installed as usual.
 */
export function SerialPendingScreen() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});

  const listQ = useQuery({
    queryKey: ["assets", "serial-pending"],
    queryFn: () => apiClient.get<{ items: PendingRow[]; total: number }>("/assets?serial_pending=true&limit=200"),
  });

  const fillMutation = useMutation({
    mutationFn: (v: { id: number; serial: string | null }) =>
      apiClient.put(`/assets/${v.id}/serial`, v.serial === null ? { no_serial: true } : { serial_number: v.serial }),
    onSuccess: (_r, v) => {
      setErrors((e) => { const { [v.id]: _drop, ...rest } = e; return rest; });
      setTyped((t) => { const { [v.id]: _drop, ...rest } = t; return rest; });
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err, v) => setErrors((e) => ({ ...e, [v.id]: err instanceof Error ? err.message : "Could not save the serial." })),
  });

  const needle = search.trim().toLowerCase();
  const rows = (listQ.data?.items ?? [])
    .filter((r) =>
      !needle ||
      [r.asset_code, r.description, r.item_name ?? "", r.current_asset_user_name ?? "", r.current_asset_user_location_name ?? ""]
        .some((v) => v.toLowerCase().includes(needle)),
    )
    .sort((a, b) => a.purchase_date.localeCompare(b.purchase_date));    // oldest first: those waiting longest

  const columns: DataTableColumn<PendingRow>[] = [
    {
      key: "code", header: "Asset", cell: (r) => (
        <div className="min-w-0">
          <Link to="/assets/$id" params={{ id: String(r.id) }} className="font-mono text-xs underline">{r.asset_code}</Link>
          <p className="truncate">{r.item_name ?? r.description}</p>
          {r.item_name && <p className="truncate text-xs text-muted-foreground">{r.description}</p>}
        </div>
      ),
    },
    { key: "class", header: "Category › Sub-Category", cell: (r) => [r.category_name, r.subcategory_name].filter(Boolean).join(" › ") },
    {
      key: "holder", header: "Now with", cell: (r) => (
        <div className="min-w-0">
          <p className="truncate">{r.current_asset_user_name ?? "—"}</p>
          {r.current_asset_user_location_name && <p className="truncate text-xs text-muted-foreground">{r.current_asset_user_location_name}</p>}
        </div>
      ),
    },
    { key: "waiting", header: "Waiting", cellClassName: "tabular-nums", cell: (r) => `${daysSince(r.purchase_date)} days` },
    {
      key: "serial", header: "Serial number", cell: (r) => (
        <div className="flex min-w-64 flex-col gap-1">
          <div className="flex items-center gap-1">
            <Input
              aria-label={`Serial for ${r.asset_code}`} value={typed[r.id] ?? ""}
              onChange={(e) => setTyped((t) => ({ ...t, [r.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (typed[r.id] ?? "").trim() && !fillMutation.isPending) fillMutation.mutate({ id: r.id, serial: typed[r.id].trim() });
              }}
            />
            <Button
              size="sm" aria-label={`Save serial for ${r.asset_code}`}
              disabled={!(typed[r.id] ?? "").trim() || fillMutation.isPending}
              onClick={() => fillMutation.mutate({ id: r.id, serial: typed[r.id].trim() })}
            >
              Save
            </Button>
            <Button
              size="sm" variant="outline" aria-label={`No serial for ${r.asset_code}`}
              title="It turns out to have no serial number (saved as N/A)" disabled={fillMutation.isPending}
              onClick={() => fillMutation.mutate({ id: r.id, serial: null })}
            >
              No serial
            </Button>
          </div>
          {errors[r.id] && <p className="text-xs text-destructive" role="alert">{errors[r.id]}</p>}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Serial Pending"
        description="Assets whose serial number is still to be added, for example an amplifier whose serial is only seen once the box is opened in the store. Get the serial from the store and enter it here. Nothing is held up while it waits: the asset can be moved, allotted and installed as usual."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search pending serials" placeholder="Search asset, item, store…" className="max-w-sm"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        {listQ.data && <span className="text-sm text-muted-foreground" role="status">{listQ.data.total} waiting</span>}
      </div>
      {listQ.isError ? (
        <ErrorState message="Couldn't load the list." onRetry={() => listQ.refetch()} />
      ) : (
        <DataTable
          columns={columns} rows={rows} rowKey={(r) => r.id} isLoading={listQ.isLoading}
          emptyState={<EmptyState title={needle ? "No matches." : "No serial numbers are waiting."} description={needle ? undefined : "Every asset has its serial."} />}
        />
      )}
    </div>
  );
}
