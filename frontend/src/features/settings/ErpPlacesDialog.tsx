import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { SETUP_STATUS_KEY } from "./setup-progress";

interface Company {
  id: number;
  name: string;
}

interface PlaceRow {
  site_code: number;
  code: string;
  name: string;
  kind: string;
  group: string;
  city: string | null;
  state: string | null;
  active: boolean;
  exists: boolean;
  selectable: boolean;
  selected_by_default: boolean;
  reason: string | null;
  note: string | null;
}

interface PlacesResponse {
  company_id: number;
  copied: boolean;
  summary: Record<string, number>;
  places: PlaceRow[];
  groups: { key: string; title: string; hint: string }[];
}

interface CreateResult {
  created: string[];
  skipped: { code: string; reason: string }[];
  places: { code: string; install_point_created: boolean; stock_point_created: boolean; problems: string[] }[];
  install_points_created: number;
  stock_points_created: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/**
 * Settings › Organisation › Places › "Add from the ERP": the company's head offices and warehouses from the ERP's site list.
 * Each ticked one becomes a Place, an Install Point (the site itself) and, unless unticked, a Stock Point for spare stock.
 * Stores are added from People & Places › Stores (they are people-like: they sign in). Suppliers, customers and virtual
 * sites in the ERP are not places and are never offered. Head-office admin only (the server checks).
 */
export function ErpPlacesDialog({ triggerLabel = "Add from the ERP" }: { triggerLabel?: string } = {}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pickedCompany, setPickedCompany] = useState<string | undefined>();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [stockPoint, setStockPoint] = useState(true);

  const companiesQ = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<Company[]>("/masters/companies"),
    enabled: open,
  });
  const companies = Array.isArray(companiesQ.data) ? companiesQ.data : [];
  const companyId = pickedCompany ?? (companies[0] ? String(companies[0].id) : undefined);

  const listQ = useQuery({
    queryKey: ["erp", "places", companyId],
    queryFn: () => apiClient.get<PlacesResponse>(`/erp/places?company_id=${companyId}`),
    enabled: open && companyId !== undefined,
    retry: false,
  });
  const places = Array.isArray(listQ.data?.places) ? listQ.data!.places : [];
  const groups = Array.isArray(listQ.data?.groups) ? listQ.data!.groups : [];

  // the head offices and warehouses that are not here yet are ticked to start with (not the "other" and old ones)
  useEffect(() => {
    if (listQ.data) setChosen(new Set((Array.isArray(listQ.data.places) ? listQ.data.places : []).filter((p) => p.selected_by_default).map((p) => p.code)));
  }, [listQ.data]);

  const createMutation = useMutation({
    mutationFn: () => apiClient.post<CreateResult>("/erp/places/create", { company_id: Number(companyId), codes: [...chosen], with_stock_point: stockPoint }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["erp", "places"] });
      qc.invalidateQueries({ queryKey: ["masters", "locations"] });
      qc.invalidateQueries({ queryKey: ["asset_users"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["stock-rooms"] });
      qc.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
    },
  });

  const needle = search.trim().toLowerCase();
  const matches = (p: PlaceRow) => !needle || [p.code, p.name, p.city ?? "", p.state ?? ""].some((v) => v.toLowerCase().includes(needle));
  const shown = places.filter(matches);
  const toggle = (code: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(code); else next.delete(code);
      return next;
    });
  const toggleGroup = (rows: PlaceRow[], on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      rows.filter((r) => r.selectable).forEach((r) => (on ? next.add(r.code) : next.delete(r.code)));
      return next;
    });
  const result = createMutation.data;

  return (
    <>
      <Button variant="outline" onClick={() => { createMutation.reset(); setOpen(true); }}>{triggerLabel}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Head offices and warehouses from the ERP</DialogTitle>
            <DialogDescription>
              Each one you tick becomes a Place, an Install Point (things fixed at that site) and, if you leave it ticked below, a Stock Point (spare stock kept there).
              The code is the site's code in the ERP. Stores are added from People &amp; Places › Stores.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            {companies.length > 1 && (
              <div className="w-64">
                <SearchableSelect
                  id="erp-places-company" aria-label="Company" value={companyId}
                  onValueChange={(v) => { setPickedCompany(v); setSearch(""); createMutation.reset(); }}
                  options={companies.map((c) => ({ value: String(c.id), label: c.name }))}
                />
              </div>
            )}
            <Input aria-label="Search places" placeholder="Search code, name or city…" className="min-w-48 flex-1" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {listQ.isLoading && <p className="text-sm text-muted-foreground">Reading the ERP's sites…</p>}
          {listQ.isError && (
            <ErrorMessage className="text-sm text-destructive" error={listQ.error} message={listQ.error instanceof Error ? listQ.error.message : "Could not read the ERP's sites."} />
          )}
          {listQ.data && !listQ.data.copied && (
            <p className="text-sm text-muted-foreground">The ERP data has not been copied yet. Use Refresh now under Settings › ERP Data Sync first.</p>
          )}

          {listQ.data && listQ.data.copied && (
            <div className="max-h-96 overflow-y-auto rounded-md border">
              {groups.map((g) => {
                const rows = shown.filter((p) => p.group === g.key && !p.exists);
                if (rows.length === 0) return null;
                const selectable = rows.filter((r) => r.selectable);
                const allOn = selectable.length > 0 && selectable.every((r) => chosen.has(r.code));
                return (
                  <section key={g.key} aria-label={g.title}>
                    <div className="sticky top-0 flex items-center justify-between gap-2 border-b bg-muted/60 px-2 py-1.5 text-sm">
                      <div>
                        <span className="font-medium">{g.title} ({rows.length})</span>
                        <span className="ml-2 text-xs text-muted-foreground">{g.hint}</span>
                      </div>
                      <Button size="sm" variant="ghost" aria-label={`${allOn ? "Untick" : "Tick"} all ${g.title.toLowerCase()}`} onClick={() => toggleGroup(rows, !allOn)}>
                        {allOn ? "Untick all" : "Tick all"}
                      </Button>
                    </div>
                    <ul className="divide-y">
                      {rows.map((p) => (
                        <li key={p.code} className="flex flex-col gap-0.5 px-2 py-1.5 text-sm">
                          <div className="flex items-center gap-3">
                            <Checkbox aria-label={`Select ${p.code}`} checked={chosen.has(p.code)} disabled={!p.selectable} onCheckedChange={(v) => toggle(p.code, v === true)} />
                            <span className="w-56 truncate font-medium">{p.code}</span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">
                              {[p.name !== p.code ? p.name : null, p.city, p.state].filter(Boolean).join(" · ")}
                            </span>
                            {!p.active && <span className="text-xs text-muted-foreground">switched off in the ERP</span>}
                          </div>
                          {!p.selectable && p.reason && <p className="ml-7 text-xs text-destructive">{p.reason}</p>}
                          {p.note && <p className="ml-7 rounded bg-warning-soft px-2 py-0.5 text-xs text-on-warning-soft" role="note" aria-label={`Check ${p.code}`}>{p.note}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              {places.length === 0 && <p className="p-4 text-sm text-muted-foreground">The ERP has no head offices or warehouses for this company.</p>}
              {places.length > 0 && shown.length === 0 && <p className="p-4 text-sm text-muted-foreground">No sites match.</p>}
              {listQ.data.summary.ALREADY_CREATED > 0 && (
                <p className="border-t p-2 text-xs text-muted-foreground">{plural(listQ.data.summary.ALREADY_CREATED, "site")} already here as a Place (not listed).</p>
              )}
            </div>
          )}

          <label className="flex items-start gap-2 text-sm">
            <Checkbox aria-label="Also make a Stock Point for each" checked={stockPoint} onCheckedChange={(v) => setStockPoint(v === true)} />
            <span>
              Also make a Stock Point for each (spare stock kept there, for example “HO Stock”)
              <span className="block text-xs text-muted-foreground">Recommended. An Install Point is always made.</span>
            </span>
          </label>

          {createMutation.isError && (
            <ErrorMessage className="text-sm text-destructive" error={createMutation.error} message={createMutation.error instanceof Error ? createMutation.error.message : "That did not work."} />
          )}
          {result && (
            <div className="text-sm" role="status">
              <p>
                Added {plural(result.created.length, "place")}: {plural(result.install_points_created, "install point")} and {plural(result.stock_points_created, "stock point")} made.
              </p>
              {result.skipped.length > 0 && (
                <ul className="mt-1 text-xs text-destructive">{result.skipped.map((s) => <li key={s.code}>{s.code}: {s.reason}</li>)}</ul>
              )}
              {result.places.some((p) => p.problems.length > 0) && (
                <ul className="mt-1 text-xs text-destructive" aria-label="Not made">
                  {result.places.flatMap((p) => p.problems.map((m, i) => <li key={`${p.code}-${i}`}>{p.code}: {m}</li>))}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <AsyncButton onClick={() => createMutation.mutate()} disabled={chosen.size === 0} pending={createMutation.isPending} pendingLabel="Adding…">
              Add {plural(chosen.size, "place")}
            </AsyncButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
