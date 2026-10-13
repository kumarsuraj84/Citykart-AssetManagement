import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { NewCostCenterDialog, NewVendorDialog } from "@/components/quick-create/masters";
import { StockRoomSelect, useStockRooms } from "@/components/quick-create/StockRoomSelect";
import { companyOptions, costCentreOptions, vendorOptions } from "@/lib/option-labels";
import { ASK_TO_ADD, canCreate as may, useCapabilities } from "@/lib/capabilities";
import { useRemember, useRememberedDefault } from "@/lib/remembered-defaults";

interface Option {
  id: number;
  name: string;
  code?: string | null;
  gstin?: string | null;
  asset_user_type?: string;
  company_id?: number | null;
  location_id?: number | null;
}

interface CreatedPurchaseOrder {
  id: number;
}

function selectValue(v: string): string | undefined {
  return v || undefined;
}

export function NewPurchaseOrderForm({ companyId }: { companyId: number | null }) {
  const navigate = useNavigate();
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendorId, setVendorId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  // AM-24: which company this PO belongs to -- defaults to the caller's own
  // home company, selectable when they have access to more than one (see
  // AddAssetForm's identical pattern). `companyId` is null for the Primary
  // Owner (a company-less bootstrap account) -- it picks the first of
  // `myCompanies` once that loads instead (see the effect below).
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(companyId);
  const myCompaniesQ = useQuery({ queryKey: ["asset_users", "me", "companies"], queryFn: () => apiClient.get<Option[]>("/asset-users/me/companies") });
  const myCompanies = myCompaniesQ.data ?? [];

  if (selectedCompanyId === null && myCompanies.length > 0) {
    setSelectedCompanyId(myCompanies[0].id);
  }

  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Option[]>("/masters/vendors") });
  const vendors = vendorsQ.data ?? [];
  const costCentersQ = useQuery({
    queryKey: ["masters", "cost-centers", selectedCompanyId],
    queryFn: () => apiClient.get<Option[]>(`/masters/cost-centers?company_id=${selectedCompanyId}`),
    enabled: selectedCompanyId != null,
  });
  const costCenters = costCentersQ.data ?? [];
  // Where the goods arrive (a Stock Room of this company). Optional: Mark
  // Delivery Done then starts with it as the place it is Received Into.
  const [deliveryId, setDeliveryId] = useState("");
  const stockRoomsQ = useStockRooms(selectedCompanyId);

  // What this person may add right here (nothing while the answer loads).
  const { caps, settled: capsSettled } = useCapabilities();
  const [newVendor, setNewVendor] = useState(false);
  const [newCostCenter, setNewCostCenter] = useState(false);

  // Smart defaults: the Cost Centre and stock room this person used last for this company.
  const rememberChoice = useRemember();
  useRememberedDefault({
    kind: "cost_centre", companyId: selectedCompanyId, value: costCenterId, setValue: setCostCenterId,
    validIds: costCenters.map((c) => c.id), ready: costCentersQ.isSuccess,
  });
  useRememberedDefault({
    kind: "stock_room", companyId: selectedCompanyId, value: deliveryId, setValue: setDeliveryId,
    validIds: stockRoomsQ.rows.map((r) => r.id), ready: stockRoomsQ.isSuccess,
  });

  const canSave = selectedCompanyId != null && poNumber.trim() !== "" && poDate !== "" && costCenterId !== "";

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.post<CreatedPurchaseOrder>("/purchase-orders", {
        company_id: selectedCompanyId,
        po_number: poNumber,
        po_date: poDate,
        vendor_id: vendorId ? Number(vendorId) : null,
        cost_center_id: Number(costCenterId),
        ...(deliveryId ? { delivery_asset_user_id: Number(deliveryId) } : {}),
      }),
    onSuccess: (created) => {
      rememberChoice(selectedCompanyId, "cost_centre", costCenterId);
      rememberChoice(selectedCompanyId, "stock_room", deliveryId);
      navigate({ to: "/purchase-orders/$id", params: { id: String(created.id) } });
    },
  });

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader title="New Purchase Order" description="Raise a PO, then add the assets expected on it." />

      <div className="grid grid-cols-2 gap-4">
        {myCompanies.length > 1 && (
          <FormField htmlFor="company" label="Company" required className="col-span-2">
            <SearchableSelect
              id="company"
              value={selectedCompanyId != null ? String(selectedCompanyId) : undefined}
              onValueChange={(v) => {
                setSelectedCompanyId(Number(v));
                setCostCenterId("");
                setDeliveryId("");
              }}
              options={companyOptions(myCompanies)}
            />
          </FormField>
        )}
        <FormField htmlFor="po-number" label="PO No" required>
          <Input id="po-number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
        </FormField>
        <FormField htmlFor="po-date" label="PO Date" required>
          <Input id="po-date" type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
        </FormField>
        <FormField htmlFor="vendor" label="Vendor">
          <SearchableSelect
            id="vendor"
            value={selectValue(vendorId)}
            onValueChange={setVendorId}
            options={vendorOptions(vendors)}
            onCreateNew={may(caps, "vendor") ? () => setNewVendor(true) : undefined}
            createLabel="New Vendor…"
          />
          {capsSettled && vendorsQ.isSuccess && vendors.length === 0 && !may(caps, "vendor") && (
            <p className="text-xs text-muted-foreground" role="note">{ASK_TO_ADD.vendor}</p>
          )}
        </FormField>
        <FormField htmlFor="cost-center" label="Cost Centre" required>
          <SearchableSelect
            id="cost-center"
            value={selectValue(costCenterId)}
            onValueChange={setCostCenterId}
            options={costCentreOptions(costCenters)}
            onCreateNew={may(caps, "cost_centre") && selectedCompanyId != null ? () => setNewCostCenter(true) : undefined}
            createLabel="New Cost Centre…"
          />
          {capsSettled && costCentersQ.isSuccess && costCenters.length === 0 && (
            <p className="text-xs text-muted-foreground" role="note">
              {may(caps, "cost_centre")
                ? "This company has no cost centre yet. Add one with “New Cost Centre…” in the list."
                : `This company has no cost centre yet. ${ASK_TO_ADD.cost_centre}`}
            </p>
          )}
        </FormField>
        <FormField
          htmlFor="delivery-location" label="Received Into" className="col-span-2"
          helperText="Optional. The Stock Room the goods arrive at; receiving starts with it."
        >
          <StockRoomSelect
            id="delivery-location"
            companyId={selectedCompanyId}
            value={deliveryId}
            onValueChange={setDeliveryId}
          />
        </FormField>
      </div>

      {saveMutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {saveMutation.error instanceof Error ? saveMutation.error.message : "Failed to create purchase order."}
        </p>
      )}

      <div>
        <AsyncButton onClick={() => saveMutation.mutate()} disabled={!canSave} pending={saveMutation.isPending} pendingLabel="Creating…">
          Create Purchase Order
        </AsyncButton>
      </div>

      <NewVendorDialog open={newVendor} onOpenChange={setNewVendor} onCreated={(row) => setVendorId(String(row.id))} />
      {selectedCompanyId != null && (
        <NewCostCenterDialog
          companyId={selectedCompanyId} open={newCostCenter} onOpenChange={setNewCostCenter}
          onCreated={(row) => setCostCenterId(String(row.id))}
        />
      )}
    </div>
  );
}
