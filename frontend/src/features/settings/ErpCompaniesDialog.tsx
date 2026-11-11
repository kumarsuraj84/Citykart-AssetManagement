import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { SETUP_STATUS_KEY } from "./setup-progress";

interface ErpCompany {
  code: string;
  erp_name: string | null;
  suggested_name: string;
  exists: boolean;
  company_id: number | null;
  is_active: boolean | null;
  ckam_name: string | null;
  name_differs: boolean;
  selectable: boolean;
  reason: string | null;
}

interface CompaniesResponse {
  copied: boolean;
  names_known: boolean;
  note: string | null;
  companies: ErpCompany[];
}

interface CreateResult {
  created: string[];
  skipped: { code: string; reason: string }[];
  cost_centres_created: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/**
 * Settings › Organisation › Companies › "Add from the ERP": the ERP's companies with their code and name, so nobody has
 * to type them (or the "ERP company code": the code IS the ERP's). A company CKAM already has is shown with the ERP's
 * name beside its own and is never changed. Head-office admin only (the server checks).
 */
export function ErpCompaniesDialog({ triggerLabel = "Add from the ERP" }: { triggerLabel?: string } = {}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [costCentres, setCostCentres] = useState(true);

  const listQ = useQuery({
    queryKey: ["erp", "companies"],
    queryFn: () => apiClient.get<CompaniesResponse>("/erp/companies"),
    enabled: open,
    retry: false,
  });
  const rows = Array.isArray(listQ.data?.companies) ? listQ.data!.companies : [];

  // the companies CKAM does not have yet are ticked to start with, with the ERP's name (tidied) ready to change
  useEffect(() => {
    if (!listQ.data) return;
    const list = Array.isArray(listQ.data.companies) ? listQ.data.companies : [];
    setTicked(new Set(list.filter((c) => c.selectable).map((c) => c.code)));
    setNames(Object.fromEntries(list.map((c) => [c.code, c.suggested_name])));
  }, [listQ.data]);

  const createMutation = useMutation({
    mutationFn: () => apiClient.post<CreateResult>("/erp/companies/create", {
      companies: rows.filter((c) => ticked.has(c.code)).map((c) => ({ code: c.code, name: (names[c.code] ?? "").trim() || null, with_cost_centre: costCentres })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["erp", "companies"] });
      qc.invalidateQueries({ queryKey: ["masters", "companies"] });        // also the switched-off list (same prefix)
      qc.invalidateQueries({ queryKey: ["masters", "cost-centers"] });
      qc.invalidateQueries({ queryKey: ["asset_users", "me", "companies"] });
      qc.invalidateQueries({ queryKey: ["auth", "capabilities"] });
      qc.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
    },
  });

  const toggle = (code: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(code); else next.delete(code);
      return next;
    });
  const count = rows.filter((c) => ticked.has(c.code)).length;
  const result = createMutation.data;

  return (
    <>
      <Button variant="outline" onClick={() => { createMutation.reset(); setOpen(true); }}>{triggerLabel}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add companies from the ERP</DialogTitle>
            <DialogDescription>
              The ERP's own code becomes the company's Code (it goes into every asset code and cannot change later), so there is no ERP company code to type.
              You can change the name before adding. Nothing that is already here is changed.
            </DialogDescription>
          </DialogHeader>

          {listQ.isLoading && <p className="text-sm text-muted-foreground">Reading the ERP's companies…</p>}
          {listQ.isError && (
            <ErrorMessage className="text-sm text-destructive" error={listQ.error} message={listQ.error instanceof Error ? listQ.error.message : "Could not read the ERP's companies."} />
          )}
          {listQ.data?.note && <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" role="note">{listQ.data.note}</p>}

          {listQ.data && (
            <ul className="divide-y rounded-md border" aria-label="ERP companies">
              {rows.length === 0 && <li className="p-4 text-sm text-muted-foreground">The ERP has no companies to show.</li>}
              {rows.map((c) => (
                <li key={c.code} className="flex flex-col gap-1 px-3 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <Checkbox aria-label={`Select ${c.code}`} checked={ticked.has(c.code)} disabled={!c.selectable} onCheckedChange={(v) => toggle(c.code, v === true)} />
                    <span className="w-20 font-medium">{c.code}</span>
                    {c.selectable ? (
                      <Input
                        aria-label={`Name for ${c.code}`} className="h-8 min-w-0 flex-1" value={names[c.code] ?? ""}
                        onChange={(e) => setNames((prev) => ({ ...prev, [c.code]: e.target.value }))}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.ckam_name ?? c.erp_name}</span>
                    )}
                  </div>
                  {!c.selectable && c.reason && <p className="ml-9 text-xs text-muted-foreground">{c.reason}</p>}
                  {c.exists && c.name_differs && (
                    <p className="ml-9 rounded bg-warning-soft px-2 py-1 text-xs text-on-warning-soft" role="note" aria-label={`Name differs for ${c.code}`}>
                      The ERP calls it {c.suggested_name}; CKAM calls it {c.ckam_name}. Nothing was changed: rename it under Companies if the ERP's name is the right one.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <label className="flex items-start gap-2 text-sm">
            <Checkbox aria-label="Also make a cost centre for each company" checked={costCentres} onCheckedChange={(v) => setCostCentres(v === true)} />
            <span>
              Also make one cost centre for each company, with the company's code and name
              <span className="block text-xs text-muted-foreground">Purchases and assets need a cost centre; you can add more under Cost Centres.</span>
            </span>
          </label>

          {createMutation.isError && (
            <ErrorMessage className="text-sm text-destructive" error={createMutation.error} message={createMutation.error instanceof Error ? createMutation.error.message : "That did not work."} />
          )}
          {result && (
            <div className="text-sm" role="status">
              <p>
                Added {plural(result.created.length, "company", "companies")}
                {result.cost_centres_created > 0 ? ` and ${plural(result.cost_centres_created, "cost centre")}` : ""}.
              </p>
              {result.skipped.length > 0 && (
                <ul className="mt-1 text-xs text-destructive">
                  {result.skipped.map((s) => <li key={s.code}>{s.code}: {s.reason}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <AsyncButton onClick={() => createMutation.mutate()} disabled={count === 0} pending={createMutation.isPending} pendingLabel="Adding…">
              Add {plural(count, "company", "companies")}
            </AsyncButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
