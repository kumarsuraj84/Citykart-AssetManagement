import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AsyncButton } from "@/components/shared/AsyncButton";

interface Option {
  id: number;
  name: string;
  asset_user_type?: string;
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
  // Where the goods arrive (a stock point of this company). Optional: Mark
  // Delivery Done then starts with it as the Initial Asset User.
  const [deliveryId, setDeliveryId] = useState("");
  const usersQ = useQuery({
    queryKey: ["asset_users", selectedCompanyId],
    queryFn: () => apiClient.get<Option[]>(`/asset-users?company_id=${selectedCompanyId}`),
    enabled: selectedCompanyId != null,
  });
  const stockPoints = (usersQ.data ?? []).filter((u) => !u.asset_user_type || u.asset_user_type === "STOCK_POINT");

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
              options={myCompanies.map((c) => ({ value: String(c.id), label: c.name }))}
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
            options={vendors.map((v) => ({ value: String(v.id), label: v.name }))}
          />
        </FormField>
        <FormField htmlFor="cost-center" label="Cost Centre" required>
          <SearchableSelect
            id="cost-center"
            value={selectValue(costCenterId)}
            onValueChange={setCostCenterId}
            options={costCenters.map((c) => ({ value: String(c.id), label: c.name }))}
          />
        </FormField>
        <FormField
          htmlFor="delivery-location" label="Delivery location" className="col-span-2"
          helperText="Optional. Where the goods arrive; Mark Delivery Done starts with it as the Initial Asset User."
        >
          <SearchableSelect
            id="delivery-location"
            value={selectValue(deliveryId)}
            onValueChange={setDeliveryId}
            options={stockPoints.map((u) => ({ value: String(u.id), label: u.name }))}
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
    </div>
  );
}
