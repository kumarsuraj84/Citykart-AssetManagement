import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

interface Company {
  id: number;
  name: string;
}

type Group = "READY" | "UPCOMING" | "INACTIVE" | "NOT_A_STORE_CODE";

interface StoreRow {
  site_code: number;
  code: string;
  name: string;
  state: string | null;
  city: string | null;
  store_status: string | null;
  group: Group;
  email: string | null;
  exists: boolean;
  selectable: boolean;
  selected_by_default: boolean;
  reason: string | null;
}

interface StoresResponse {
  company_id: number;
  copied: boolean;
  summary: Record<Group | "ALREADY_CREATED", number>;
  stores: StoreRow[];
}

interface RoomResult {
  code: string;
  stock_room_code?: string | null;
  stock_room_created?: boolean;
  install_point_code?: string | null;
  install_point_created?: boolean;
  problems?: string[];
}

interface CreateResult {
  created: string[];
  skipped: { code: string; reason: string }[];
  /** S5: every store of the request gets its Stock Room and Install Point (made or already there). */
  rooms?: RoomResult[];
  stock_rooms_created?: number;
  install_points_created?: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** "2 stock rooms and 2 install points were added." -- the rooms the stores were given (S5). */
export function roomsSentence(r: CreateResult): string | null {
  if (r.stock_rooms_created === undefined && r.install_points_created === undefined) return null;
  const sr = r.stock_rooms_created ?? 0;
  const ip = r.install_points_created ?? 0;
  if (sr + ip === 0) return "Every store already had its Stock Room and Install Point.";
  return `${plural(sr, "stock room")} and ${plural(ip, "install point")} were added.`;
}

const GROUPS: { key: Group; title: string; hint: string }[] = [
  { key: "READY", title: "Open stores", hint: "Open in the ERP." },
  { key: "UPCOMING", title: "Upcoming stores", hint: "Not open yet, but they can already receive purchase orders." },
  { key: "INACTIVE", title: "Closed or inactive stores", hint: "Closed or inactive in the ERP; they may still hold assets." },
];

/** "Stores from ERP": makes a store user (and its location) for each store the ERP has, with the login email
 * built from the store's code. The user has no password until an admin issues one (Reset Password). */
export function ErpStoresDialog({ triggerLabel = "Stores from ERP", initialCompanyId }: { triggerLabel?: string; initialCompanyId?: number | null } = {}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pickedCompany, setPickedCompany] = useState<string | undefined>();
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const companiesQ = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<Company[]>("/masters/companies"),
    enabled: open,
  });
  const companies = Array.isArray(companiesQ.data) ? companiesQ.data : [];
  const companyId = pickedCompany ?? (initialCompanyId != null ? String(initialCompanyId) : companies[0] ? String(companies[0].id) : undefined);

  const listQ = useQuery({
    queryKey: ["erp", "stores", companyId],
    queryFn: () => apiClient.get<StoresResponse>(`/erp/stores?company_id=${companyId}`),
    enabled: open && companyId !== undefined,
    retry: false,
  });

  // the stores that are ticked to start with: the open ones that do not exist yet
  useEffect(() => {
    if (listQ.data) setChosen(new Set(listQ.data.stores.filter((s) => s.selected_by_default).map((s) => s.code)));
  }, [listQ.data]);

  const createMutation = useMutation({
    mutationFn: () => apiClient.post<CreateResult>("/erp/stores/create", { company_id: Number(companyId), codes: [...chosen] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["erp", "stores"] });
      qc.invalidateQueries({ queryKey: ["erp", "inbox"] });
      qc.invalidateQueries({ queryKey: ["asset_users"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["stock-rooms"] });
      qc.invalidateQueries({ queryKey: ["masters", "locations"] });
    },
  });

  const needle = search.trim().toLowerCase();
  const matches = (s: StoreRow) =>
    !needle || [s.code, s.name, s.city ?? "", s.state ?? ""].some((v) => v.toLowerCase().includes(needle));
  const stores = (listQ.data?.stores ?? []).filter(matches);
  const toggle = (code: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(code); else next.delete(code);
      return next;
    });
  const toggleGroup = (rows: StoreRow[], on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      rows.filter((r) => r.selectable).forEach((r) => (on ? next.add(r.code) : next.delete(r.code)));
      return next;
    });

  const summary = listQ.data?.summary;
  const result = createMutation.data;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>{triggerLabel}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Stores from the ERP</DialogTitle>
            <DialogDescription>
              Adds each store you tick to Stores, with its place, its Stock Room and its Install Point. Its code is the store's code in the ERP, and it signs in with its own email
              (for example sm.lam@citykartstores.com). A new store has no password yet: use Issue login passwords on the Stores list when it is ready to sign in.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            {companies.length > 1 && (
              <div className="w-64">
                <SearchableSelect
                  id="erp-stores-company" aria-label="Company" value={companyId}
                  onValueChange={(v) => { setPickedCompany(v); setSearch(""); createMutation.reset(); }}
                  options={companies.map((c) => ({ value: String(c.id), label: c.name }))}
                />
              </div>
            )}
            <Input aria-label="Search stores" placeholder="Search code, name or city…" className="min-w-48 flex-1" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {listQ.isLoading && <p className="text-sm text-muted-foreground">Reading the stores…</p>}
          {listQ.isError && (
            <p className="text-sm text-destructive" role="alert">
              {listQ.error instanceof Error ? listQ.error.message : "Could not read the stores."}
            </p>
          )}
          {listQ.data && !listQ.data.copied && (
            <p className="text-sm text-muted-foreground">The ERP data has not been copied yet. Use Refresh now on the Purchase Orders page (Work › Purchase Orders) first.</p>
          )}
          {summary && listQ.data?.copied && (
            <p className="text-xs text-muted-foreground" aria-label="Store summary">
              {summary.READY} open · {summary.UPCOMING} upcoming · {summary.INACTIVE} closed or inactive · {summary.ALREADY_CREATED} already created · {summary.NOT_A_STORE_CODE} not store codes
            </p>
          )}

          {listQ.data && listQ.data.copied && (
            <div className="max-h-96 overflow-y-auto rounded-md border">
              {GROUPS.map((g) => {
                const rows = stores.filter((s) => s.group === g.key && !s.exists);
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
                      {rows.map((s) => (
                        <li key={s.code} className="flex items-center gap-3 px-2 py-1.5 text-sm">
                          <Checkbox
                            aria-label={`Select ${s.code}`} checked={chosen.has(s.code)} disabled={!s.selectable}
                            onCheckedChange={(v) => toggle(s.code, v === true)}
                          />
                          <span className="w-16 font-medium">{s.code}</span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {[s.name !== s.code ? s.name : null, s.city, s.state].filter(Boolean).join(" · ")}
                          </span>
                          <span className="hidden text-xs text-muted-foreground sm:inline">{s.email}</span>
                          {!s.selectable && s.reason && <span className="text-xs text-destructive">{s.reason}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              {summary && summary.NOT_A_STORE_CODE > 0 && (
                <p className="border-t p-2 text-xs text-muted-foreground">
                  Not offered, because they are not usual store codes (dummy or test sites):{" "}
                  {stores.filter((s) => s.group === "NOT_A_STORE_CODE").map((s) => s.code).join(", ") || "none match the search"}.
                </p>
              )}
              {stores.length === 0 && <p className="p-4 text-sm text-muted-foreground">No stores match.</p>}
            </div>
          )}

          {createMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {createMutation.error instanceof Error ? createMutation.error.message : "That did not work."}
            </p>
          )}
          {result && (
            <div className="text-sm" role="status">
              <p>Created {result.created.length} store{result.created.length === 1 ? "" : "s"}.{roomsSentence(result) ? ` ${roomsSentence(result)}` : ""}</p>
              {result.skipped.length > 0 && (
                <ul className="mt-1 text-xs text-destructive">
                  {result.skipped.map((s) => <li key={s.code}>{s.code}: {s.reason}</li>)}
                </ul>
              )}
              {(result.rooms ?? []).some((r) => (r.problems ?? []).length > 0) && (
                <ul className="mt-1 text-xs text-destructive" aria-label="Rooms not made">
                  {(result.rooms ?? []).flatMap((r) => (r.problems ?? []).map((p, i) => <li key={`${r.code}-${i}`}>{r.code}: {p}</li>))}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <AsyncButton
              onClick={() => createMutation.mutate()} disabled={chosen.size === 0} pending={createMutation.isPending} pendingLabel="Creating…"
            >
              Create {chosen.size} store{chosen.size === 1 ? "" : "s"}
            </AsyncButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
