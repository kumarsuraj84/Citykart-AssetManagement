import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { companyOptions } from "@/lib/option-labels";

interface Company {
  id: number;
  code: string;
  name: string;
}

interface ErpVendorRow {
  company_id: number;
  erp_code: string;
  name: string;
  gstin: string | null;
  is_active: boolean;
  linked_vendor_id: number | null;
  linked_vendor_name: string | null;
  suggested_vendor_id: number | null;
  suggested_vendor_name: string | null;
  suggestion_reason: "gstin" | "name" | null;
}

const MAX_SHOWN = 100;
const REASON: Record<string, string> = { gstin: "same GSTIN", name: "same name" };

/** "Add from ERP": lists one company's ERP suppliers; add one as a CKAM vendor, or tie an existing CKAM
 * vendor to it (the same vendor can be tied to a supplier in each company: each company's ERP numbers its
 * suppliers on its own). POs are matched to vendors through that tie, so only linked vendors' POs are offered. */
export function ErpVendorsDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pickedCompany, setPickedCompany] = useState<string | undefined>();
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
  const changed = () => {
    qc.invalidateQueries({ queryKey: ["erp", "vendors"] });
    qc.invalidateQueries({ queryKey: ["masters", "vendors"] });
    qc.invalidateQueries({ queryKey: ["erp", "pos"] });
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
  const error = [addMutation, linkMutation, unlinkMutation].find((m) => m.isError)?.error;

  const needle = search.trim().toLowerCase();
  const all = (listQ.data ?? []).filter(
    (v) => !needle || v.name.toLowerCase().includes(needle) || v.erp_code.toLowerCase().includes(needle) || (v.gstin ?? "").toLowerCase().includes(needle),
  );
  const shown = all.slice(0, MAX_SHOWN);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Add from ERP</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Vendors in the ERP</DialogTitle>
            <DialogDescription>
              Each company's ERP numbers its suppliers on its own, so pick the company first. Add a supplier as a vendor here, or link a vendor you already have
              (one vendor can be linked in both companies). Only linked vendors' purchase orders can be brought in from the ERP.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            {companies.length > 1 && (
              <div className="w-64">
                <SearchableSelect
                  id="erp-vendor-company" aria-label="Company" value={companyId} onValueChange={(v) => { setPickedCompany(v); setSearch(""); }}
                  options={companyOptions(companies)}
                />
              </div>
            )}
            <Input
              aria-label="Search ERP vendors" placeholder="Search name, ERP code or GSTIN…" className="min-w-48 flex-1"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {listQ.isLoading && <p className="text-sm text-muted-foreground">Reading the ERP…</p>}
          {listQ.isError && (
            <p className="text-sm text-destructive" role="alert">
              {listQ.error instanceof Error ? listQ.error.message : "Could not read the ERP vendors."}
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error instanceof Error ? error.message : "That did not work."}
            </p>
          )}
          {listQ.data && (
            <div className="max-h-96 overflow-y-auto rounded-md border">
              {shown.length === 0 && <p className="p-4 text-sm text-muted-foreground">No ERP vendors match.</p>}
              <ul className="divide-y">
                {shown.map((v) => (
                  <li key={v.erp_code} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{v.name}</p>
                      <p className="text-xs text-muted-foreground">ERP code {v.erp_code}{v.gstin ? ` · GSTIN ${v.gstin}` : ""}{v.is_active ? "" : " · inactive in the ERP"}</p>
                    </div>
                    {v.linked_vendor_id !== null ? (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-success">Linked to {v.linked_vendor_name}</span>
                        <Button
                          size="sm" variant="ghost" aria-label={`Unlink ${v.name}`}
                          onClick={() => unlinkMutation.mutate({ vendorId: v.linked_vendor_id!, erpCode: v.erp_code })}
                        >
                          Unlink
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {v.suggested_vendor_id !== null && (
                          <Button
                            size="sm" variant="outline" aria-label={`Link ${v.name} to ${v.suggested_vendor_name}`}
                            title={v.suggestion_reason ? `Probably the same supplier: ${REASON[v.suggestion_reason]}` : undefined}
                            onClick={() => linkMutation.mutate({ vendorId: v.suggested_vendor_id!, erpCode: v.erp_code })}
                          >
                            Link to {v.suggested_vendor_name}{v.suggestion_reason ? ` (${REASON[v.suggestion_reason]})` : ""}
                          </Button>
                        )}
                        <Button size="sm" aria-label={`Add ${v.name} as a vendor`} onClick={() => addMutation.mutate(v.erp_code)}>Add as vendor</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {all.length > MAX_SHOWN && (
                <p className="border-t p-2 text-xs text-muted-foreground">Showing the first {MAX_SHOWN} of {all.length}. Search to narrow the list.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
