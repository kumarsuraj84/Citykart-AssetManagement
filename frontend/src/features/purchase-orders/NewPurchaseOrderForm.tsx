import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { apiClient } from "../../lib/api-client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormField } from "@/components/shared/FormField";
import { AsyncButton } from "@/components/shared/AsyncButton";

interface Option {
  id: number;
  name: string;
}

interface CreatedPurchaseOrder {
  id: number;
}

function selectValue(v: string): string | undefined {
  return v || undefined;
}

export function NewPurchaseOrderForm({ companyId }: { companyId: number }) {
  const navigate = useNavigate();
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendorId, setVendorId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  // AM-24: which company this PO belongs to -- defaults to the caller's own
  // home company, selectable when they have access to more than one (see
  // AddAssetForm's identical pattern).
  const [selectedCompanyId, setSelectedCompanyId] = useState(companyId);
  const myCompaniesQ = useQuery({ queryKey: ["asset_users", "me", "companies"], queryFn: () => apiClient.get<Option[]>("/asset-users/me/companies") });
  const myCompanies = myCompaniesQ.data ?? [];

  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Option[]>("/masters/vendors") });
  const vendors = vendorsQ.data ?? [];
  const costCentersQ = useQuery({
    queryKey: ["masters", "cost-centers", selectedCompanyId],
    queryFn: () => apiClient.get<Option[]>(`/masters/cost-centers?company_id=${selectedCompanyId}`),
  });
  const costCenters = costCentersQ.data ?? [];

  const canSave = poNumber.trim() !== "" && poDate !== "" && costCenterId !== "";

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.post<CreatedPurchaseOrder>("/purchase-orders", {
        company_id: selectedCompanyId,
        po_number: poNumber,
        po_date: poDate,
        vendor_id: vendorId ? Number(vendorId) : null,
        cost_center_id: Number(costCenterId),
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
            <Select
              value={String(selectedCompanyId)}
              onValueChange={(v) => {
                setSelectedCompanyId(Number(v));
                setCostCenterId("");
              }}
            >
              <SelectTrigger id="company">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {myCompanies.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        )}
        <FormField htmlFor="po-number" label="PO No" required>
          <Input id="po-number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
        </FormField>
        <FormField htmlFor="po-date" label="PO Date" required>
          <Input id="po-date" type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
        </FormField>
        <FormField htmlFor="vendor" label="Vendor">
          <Select value={selectValue(vendorId)} onValueChange={setVendorId}>
            <SelectTrigger id="vendor">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={String(v.id)}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField htmlFor="cost-center" label="Cost Centre" required>
          <Select value={selectValue(costCenterId)} onValueChange={setCostCenterId}>
            <SelectTrigger id="cost-center">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {costCenters.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
