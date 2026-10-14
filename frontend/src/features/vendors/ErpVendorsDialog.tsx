import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { companyOptions, vendorOptions } from "@/lib/option-labels";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

interface Company {
  id: number;
  code: string;
  name: string;
}

interface Vendor {
  id: number;
  name: string;
  gstin?: string | null;
  code?: string | null;
}

export interface ErpVendorRow {
  company_id: number;
  erp_code: string;
  name: string;
  gstin: string | null;
  is_active: boolean;
  linked_vendor_id: number | null;
  linked_vendor_name: string | null;
  suggested_vendor_id: number | null;
  suggested_vendor_name: string | null;
  suggestion_reason: "gstin" | "pan" | "name" | null;
  // S3a-2: registrations of one supplier share the company PAN (chars 3-12 of the GSTIN).
  pan?: string | null;
  group_key?: string | null;
  group_size?: number;
  group_linked_to_vendor_id?: number | null;
}

interface SupplierGroup {
  key: string;
  rows: ErpVendorRow[];
}

/** Groups shown per page; every supplier stays reachable with the page buttons and the search. */
export const GROUPS_PER_PAGE = 25;
const REASON: Record<string, string> = { gstin: "same GSTIN", pan: "same company PAN", name: "same name" };

/** One group per company PAN (a supplier with one registration per state); suppliers without a PAN stand alone. */
export function groupSuppliers(rows: ErpVendorRow[]): SupplierGroup[] {
  const groups = new Map<string, ErpVendorRow[]>();
  for (const r of rows) {
    const key = r.group_key || `${r.company_id}:#${r.erp_code}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([key, members]) => ({ key, rows: members }));
}

/** "Add from ERP": one company's ERP suppliers, grouped by company PAN. Add one vendor for a whole group, link a
 * whole group to a vendor you already have, or work supplier by supplier. Nothing is linked until you choose. */
export function ErpVendorsDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearchRaw] = useState("");
  const [page, setPage] = useState(0);
  const [pickedCompany, setPickedCompany] = useState<string | undefined>();
  const [linkTarget, setLinkTarget] = useState<Record<string, string>>({});
  const setSearch = (v: string) => { setSearchRaw(v); setPage(0); };
  const companiesQ = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<Company[]>("/masters/companies"),
    enabled: open,
  });
  const companies = Array.isArray(companiesQ.data) ? companiesQ.data : [];
  const companyId = pickedCompany ?? (companies[0] ? String(companies[0].id) : undefined);

  const listQ = useQuery({
    queryKey: ["erp", "vendors", companyId],
    queryFn: () => apiClient.get<ErpVendorRow[]>(`/erp/vendors?company_id=${companyId}`),
    enabled: open && companyId !== undefined,
    retry: false,
  });
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Vendor[]>("/masters/vendors"), enabled: open, retry: false });
  const vendors = Array.isArray(vendorsQ.data) ? vendorsQ.data : [];
  const changed = () => {
    qc.invalidateQueries({ queryKey: ["erp", "vendors"] });
    qc.invalidateQueries({ queryKey: ["masters", "vendors"] });
    qc.invalidateQueries({ queryKey: ["erp", "pos"] });
    qc.invalidateQueries({ queryKey: ["erp", "inbox"] });
  };
  const addMutation = useMutation({
    mutationFn: (erpCode: string) => apiClient.post("/erp/vendors/import", { company_id: Number(companyId), erp_vendor_code: erpCode }),
    onSuccess: changed,
  });
  const linkMutation = useMutation({
    mutationFn: ({ vendorId, erpCode }: { vendorId: number; erpCode: string }) =>
      apiClient.post(`/erp/vendors/${vendorId}/link`, { company_id: Number(companyId), erp_vendor_code: erpCode }),
    onSuccess: changed,
  });
  const unlinkMutation = useMutation({
    mutationFn: ({ vendorId, erpCode }: { vendorId: number; erpCode: string }) =>
      apiClient.delete(`/erp/vendors/${vendorId}/link?company_id=${companyId}&erp_vendor_code=${encodeURIComponent(erpCode)}`),
    onSuccess: changed,
  });
  // S3a-2: a whole group at once (all or nothing on the server).
  const linkManyMutation = useMutation({
    mutationFn: ({ vendorId, codes }: { vendorId: number; codes: string[] }) =>
      apiClient.post(`/erp/vendors/${vendorId}/link-many`, { company_id: Number(companyId), erp_vendor_codes: codes }),
    onSuccess: changed,
  });
  const importGroupMutation = useMutation({
    mutationFn: (codes: string[]) => apiClient.post("/erp/vendors/import-group", { company_id: Number(companyId), erp_vendor_codes: codes }),
    onSuccess: changed,
  });
  const mutations = [addMutation, linkMutation, unlinkMutation, linkManyMutation, importGroupMutation];
  const error = mutations.find((m) => m.isError)?.error;
  const busy = mutations.some((m) => m.isPending);
  const resetAll = () => mutations.forEach((m) => m.reset());

  const needle = search.trim().toLowerCase();
  const rows = (listQ.data ?? []).filter(
    (v) => !needle || [v.name, v.erp_code, v.gstin ?? "", v.pan ?? ""].some((x) => x.toLowerCase().includes(needle)),
  );
  const groups = groupSuppliers(rows);
  const pages = Math.max(1, Math.ceil(groups.length / GROUPS_PER_PAGE));
  const current = Math.min(page, pages - 1);
  const shown = groups.slice(current * GROUPS_PER_PAGE, (current + 1) * GROUPS_PER_PAGE);

  function supplierRow(v: ErpVendorRow, nested = false) {
    return (
      <li key={v.erp_code} className={`flex flex-wrap items-center justify-between gap-2 p-2 text-sm ${nested ? "pl-6" : ""}`}>
        <div className="min-w-0">
          <p className="truncate font-medium">{v.name}</p>
          <p className="text-xs text-muted-foreground">ERP code {v.erp_code}{v.gstin ? ` · GSTIN ${v.gstin}` : ""}{v.is_active ? "" : " · inactive in the ERP"}</p>
        </div>
        {v.linked_vendor_id !== null ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-success">Linked to {v.linked_vendor_name}</span>
            <Button
              size="sm" variant="ghost" aria-label={`Unlink ${v.name}`} disabled={busy}
              onClick={() => { resetAll(); unlinkMutation.mutate({ vendorId: v.linked_vendor_id!, erpCode: v.erp_code }); }}
            >
              Unlink
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {v.suggested_vendor_id !== null && (
              <Button
                size="sm" variant="outline" aria-label={`Link ${v.name} to ${v.suggested_vendor_name}`} disabled={busy}
                title={v.suggestion_reason ? `Probably the same supplier: ${REASON[v.suggestion_reason]}` : undefined}
                onClick={() => { resetAll(); linkMutation.mutate({ vendorId: v.suggested_vendor_id!, erpCode: v.erp_code }); }}
              >
                Link to {v.suggested_vendor_name}{v.suggestion_reason ? ` (${REASON[v.suggestion_reason] ?? v.suggestion_reason})` : ""}
              </Button>
            )}
            <Button size="sm" aria-label={`Add ${v.name} as a vendor`} disabled={busy} onClick={() => { resetAll(); addMutation.mutate(v.erp_code); }}>
              Add as vendor
            </Button>
          </div>
        )}
      </li>
    );
  }

  function groupBlock(g: SupplierGroup) {
    const first = g.rows[0];
    const unlinked = g.rows.filter((r) => r.linked_vendor_id === null);
    const n = unlinked.length;
    const linkedTo = first.group_linked_to_vendor_id ?? g.rows.find((r) => r.linked_vendor_id !== null)?.linked_vendor_id ?? null;
    const linkedName = linkedTo !== null ? g.rows.find((r) => r.linked_vendor_id === linkedTo)?.linked_vendor_name ?? vendors.find((x) => x.id === linkedTo)?.name : null;
    const suggested = g.rows.find((r) => r.suggested_vendor_id !== null);
    const target = linkedTo ?? suggested?.suggested_vendor_id ?? null;
    const targetName = linkedTo !== null ? linkedName : suggested?.suggested_vendor_name;
    const codes = unlinked.map((r) => r.erp_code);
    const picked = linkTarget[g.key] ?? "";
    return (
      <li key={g.key} className="flex flex-col" aria-label={`${first.name} group`}>
        <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 p-2 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{first.name} — {g.rows.length} registrations</p>
            <p className="text-xs text-muted-foreground">
              {first.pan ? `PAN ${first.pan} · ` : ""}{n === 0 ? "all linked" : `${n} not linked yet`}
            </p>
          </div>
          {n > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {target !== null && targetName && (
                <Button
                  size="sm" variant="outline" disabled={busy}
                  onClick={() => { resetAll(); linkManyMutation.mutate({ vendorId: target, codes }); }}
                >
                  Link all {n} to {targetName}
                </Button>
              )}
              {linkedTo === null && (
                <Button size="sm" disabled={busy} onClick={() => { resetAll(); importGroupMutation.mutate(codes); }}>
                  Add one vendor and link all {n}
                </Button>
              )}
              <div className="w-48">
                <SearchableSelect
                  id={`erp-group-${g.key}`} aria-label={`Link all of ${first.name} to another vendor`} value={picked || undefined}
                  onValueChange={(v) => setLinkTarget((t) => ({ ...t, [g.key]: v }))} options={vendorOptions(vendors)} placeholder="Another vendor…"
                />
              </div>
              {picked && (
                <Button
                  size="sm" variant="outline" disabled={busy} aria-label={`Link all ${n} of ${first.name} to the chosen vendor`}
                  onClick={() => { resetAll(); linkManyMutation.mutate({ vendorId: Number(picked), codes }); }}
                >
                  Link all {n}
                </Button>
              )}
            </div>
          )}
        </div>
        <ul className="divide-y">
          {g.rows.map((v) => supplierRow(v, true))}
        </ul>
      </li>
    );
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Add from ERP</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Vendors in the ERP</DialogTitle>
            <DialogDescription>
              Each company's ERP numbers its suppliers on its own, so pick the company first. Registrations of one supplier (same company PAN)
              are grouped: add one vendor for all of them, or link them all to a vendor you already have. Nothing is linked until you choose.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            {companies.length > 1 && (
              <div className="w-64">
                <SearchableSelect
                  id="erp-vendor-company" aria-label="Company" value={companyId}
                  onValueChange={(v) => { setPickedCompany(v); setSearch(""); resetAll(); }}
                  options={companyOptions(companies)}
                />
              </div>
            )}
            <Input
              aria-label="Search ERP vendors" placeholder="Search name, ERP code, GSTIN or PAN…" className="min-w-48 flex-1"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {listQ.isLoading && <p className="text-sm text-muted-foreground">Reading the ERP…</p>}
          {listQ.isError && (
            <ErrorMessage className="text-sm text-destructive" error={listQ.error} message={listQ.error instanceof Error ? listQ.error.message : "Could not read the ERP vendors."} />
          )}
          {error && (
            <ErrorMessage className="text-sm text-destructive" error={error} message={error instanceof Error ? error.message : "That did not work."} />
          )}
          {listQ.data && (
            <div className="max-h-[28rem] overflow-y-auto rounded-md border">
              {shown.length === 0 && <p className="p-4 text-sm text-muted-foreground">No ERP vendors match.</p>}
              <ul className="divide-y">
                {shown.map((g) => (g.rows.length > 1 ? groupBlock(g) : supplierRow(g.rows[0])))}
              </ul>
            </div>
          )}
          {listQ.data && groups.length > GROUPS_PER_PAGE && (
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground" aria-label="Pages">
              <span>
                {rows.length.toLocaleString("en-IN")} suppliers in {groups.length.toLocaleString("en-IN")} groups · page {current + 1} of {pages}
              </span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
