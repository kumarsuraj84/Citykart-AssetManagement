import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { costCentreOptions, vendorOptions } from "@/lib/option-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { StockRoomSelect } from "@/components/quick-create/StockRoomSelect";

/** The PO header as GET /purchase-orders/{id} answers it. */
export interface PoHeader {
  id: number;
  company_id: number;
  po_number: string;
  po_date: string;
  vendor_id: number | null;
  cost_center_id: number | null;
  delivery_asset_user_id?: number | null;
  erp_po_code?: number | null;
}

interface Named {
  id: number;
  name: string;
  code?: string | null;
  gstin?: string | null;
}

export const LOCKED_RECEIVED = "Goods have already been received on this purchase order, so this can no longer be changed (the received assets keep what they were received with).";
export const LOCKED_ERP_NUMBER = "This purchase order was made from the ERP, so its PO number and date are the ERP's.";
export const LOCKED_ERP_VENDOR = "This purchase order was made from the ERP, so its vendor follows the ERP supplier (apply it from the ERP changes).";

interface HeaderDraft {
  vendorId: string;
  costCentreId: string;
  deliveryId: string;
  poDate: string;
  poNumber: string;
}

const draftOf = (po: PoHeader): HeaderDraft => ({
  vendorId: po.vendor_id != null ? String(po.vendor_id) : "",
  costCentreId: po.cost_center_id != null ? String(po.cost_center_id) : "",
  deliveryId: po.delivery_asset_user_id != null ? String(po.delivery_asset_user_id) : "",
  poDate: po.po_date ?? "",
  poNumber: po.po_number ?? "",
});

/** Which header fields the server's rules leave editable (S6): after a receipt only the delivery place;
 * on an ERP-made PO not the number, date or vendor. Each lock carries its plain reason (null = editable). */
export function headerLocks(po: PoHeader, receivedUnits: number) {
  const received = receivedUnits > 0;
  const erp = po.erp_po_code != null;
  return {
    vendor: received ? LOCKED_RECEIVED : erp ? LOCKED_ERP_VENDOR : null,
    costCentre: received ? LOCKED_RECEIVED : null,
    deliveryPlace: null as string | null,
    poDate: received ? LOCKED_RECEIVED : erp ? LOCKED_ERP_NUMBER : null,
    poNumber: received ? LOCKED_RECEIVED : erp ? LOCKED_ERP_NUMBER : null,
  };
}

/** The PUT /purchase-orders/{id} body: only what changed (pure; exported for tests). */
export function headerBody(po: PoHeader, d: HeaderDraft): Record<string, unknown> {
  const before = draftOf(po);
  const body: Record<string, unknown> = {};
  if (d.vendorId !== before.vendorId && d.vendorId) body.vendor_id = Number(d.vendorId);
  if (d.costCentreId !== before.costCentreId && d.costCentreId) body.cost_center_id = Number(d.costCentreId);
  if (d.deliveryId !== before.deliveryId && d.deliveryId) body.delivery_asset_user_id = Number(d.deliveryId);
  if (d.poDate !== before.poDate) body.po_date = d.poDate;
  if (d.poNumber.trim() !== before.poNumber) body.po_number = d.poNumber.trim();
  return body;
}

/**
 * Edit details of a purchase order (S6: PUT /purchase-orders/{id}): vendor, cost centre,
 * delivery place, PO date, PO number. Only changed fields are sent. Fields the server's
 * rules lock are shown disabled with the reason; a refusal is shown as the server wrote it.
 */
export function PoHeaderEditDialog({
  po, receivedUnits, deliveryPlaceName, onClose, onSaved,
}: {
  po: PoHeader;
  receivedUnits: number;
  /** The current delivery place's name, kept in the list when it is not a stock room. */
  deliveryPlaceName?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState<HeaderDraft>(() => draftOf(po));
  const set = (patch: Partial<HeaderDraft>) => setD((x) => ({ ...x, ...patch }));
  const locks = headerLocks(po, receivedUnits);
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Named[]>("/masters/vendors") });
  const costQ = useQuery({
    queryKey: ["masters", "cost-centers", po.company_id],
    queryFn: () => apiClient.get<Named[]>(`/masters/cost-centers?company_id=${po.company_id}`),
  });
  const list = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  const body = headerBody(po, d);
  const changed = Object.keys(body).length > 0;
  const today = new Date().toLocaleDateString("en-CA");

  const mutation = useMutation({
    mutationFn: () => apiClient.put<PoHeader>(`/purchase-orders/${po.id}`, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["purchase-order", po.id] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      onSaved("PO details saved.");
      onClose();
    },
  });

  const lockNote = (reason: string | null) => (reason ? <p className="text-xs text-muted-foreground">{reason}</p> : null);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Edit details of {po.po_number}</DialogTitle>
          <DialogDescription>Only what you change is saved. Lines and units are changed on the lines themselves.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (changed && !mutation.isPending) mutation.mutate(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField htmlFor="po-edit-number" label="PO number" required>
              <Input id="po-edit-number" value={d.poNumber} disabled={!!locks.poNumber} onChange={(e) => set({ poNumber: e.target.value })} />
            </FormField>
            <FormField htmlFor="po-edit-date" label="PO date" required>
              <Input id="po-edit-date" type="date" max={today} value={d.poDate} disabled={!!locks.poDate} onChange={(e) => set({ poDate: e.target.value })} />
            </FormField>
          </div>
          {lockNote(locks.poNumber)}
          <FormField htmlFor="po-edit-vendor" label="Vendor">
            <SearchableSelect
              id="po-edit-vendor" aria-label="Vendor" value={d.vendorId || undefined} disabled={!!locks.vendor}
              onValueChange={(v) => set({ vendorId: v })} options={vendorOptions(list<Named>(vendorsQ.data))}
            />
          </FormField>
          {locks.vendor !== locks.poNumber && lockNote(locks.vendor)}
          <FormField htmlFor="po-edit-cost-centre" label="Cost Centre" required>
            <SearchableSelect
              id="po-edit-cost-centre" aria-label="Cost Centre" value={d.costCentreId || undefined} disabled={!!locks.costCentre}
              onValueChange={(v) => set({ costCentreId: v })} options={costCentreOptions(list<Named>(costQ.data))}
            />
          </FormField>
          {locks.costCentre && locks.costCentre !== locks.poNumber && lockNote(locks.costCentre)}
          <FormField htmlFor="po-edit-delivery" label="Delivery place" helperText="The Stock Room the goods are received into.">
            <StockRoomSelect
              id="po-edit-delivery" aria-label="Delivery place" companyId={po.company_id} value={d.deliveryId}
              onValueChange={(v) => set({ deliveryId: v })}
              extraOptions={po.delivery_asset_user_id != null && deliveryPlaceName ? [{ value: String(po.delivery_asset_user_id), label: deliveryPlaceName }] : []}
            />
          </FormField>
          {mutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {mutation.error instanceof Error ? mutation.error.message : "Could not save the PO details."}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <AsyncButton type="submit" disabled={!changed || d.poNumber.trim() === "" || d.poDate === ""} pending={mutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
