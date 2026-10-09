import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface ErpVendorRow {
  erp_code: string;
  name: string;
  gstin: string | null;
  is_active: boolean;
  linked_vendor_id: number | null;
  linked_vendor_name: string | null;
  suggested_vendor_id: number | null;
  suggested_vendor_name: string | null;
}

const MAX_SHOWN = 100;

/** "Add from ERP": lists the ERP's suppliers; add one as a CKAM vendor, or tie
 * an existing CKAM vendor (same name/code) to its ERP supplier. POs are matched
 * to vendors through that tie, so only linked vendors' POs are offered. */
export function ErpVendorsDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const listQ = useQuery({
    queryKey: ["erp", "vendors"],
    queryFn: () => apiClient.get<ErpVendorRow[]>("/erp/vendors"),
    enabled: open,
    retry: false,
  });
  const changed = () => {
    qc.invalidateQueries({ queryKey: ["erp", "vendors"] });
    qc.invalidateQueries({ queryKey: ["masters", "vendors"] });
    qc.invalidateQueries({ queryKey: ["erp", "pos"] });
  };
  const addMutation = useMutation({
    mutationFn: (erpCode: string) => apiClient.post("/erp/vendors/import", { erp_vendor_code: erpCode }),
    onSuccess: changed,
  });
  const linkMutation = useMutation({
    mutationFn: ({ vendorId, erpCode }: { vendorId: number; erpCode: string }) =>
      apiClient.post(`/erp/vendors/${vendorId}/link`, { erp_vendor_code: erpCode }),
    onSuccess: changed,
  });
  const unlinkMutation = useMutation({
    mutationFn: (vendorId: number) => apiClient.delete(`/erp/vendors/${vendorId}/link`),
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
              Add a supplier as a vendor here, or link a vendor you already have. Only linked vendors' purchase orders can be brought in from the ERP.
            </DialogDescription>
          </DialogHeader>
          <Input aria-label="Search ERP vendors" placeholder="Search name, ERP code or GSTIN…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                        <Button size="sm" variant="ghost" aria-label={`Unlink ${v.name}`} onClick={() => unlinkMutation.mutate(v.linked_vendor_id!)}>Unlink</Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {v.suggested_vendor_id !== null && (
                          <Button
                            size="sm" variant="outline" aria-label={`Link ${v.name} to ${v.suggested_vendor_name}`}
                            onClick={() => linkMutation.mutate({ vendorId: v.suggested_vendor_id!, erpCode: v.erp_code })}
                          >
                            Link to {v.suggested_vendor_name}
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
