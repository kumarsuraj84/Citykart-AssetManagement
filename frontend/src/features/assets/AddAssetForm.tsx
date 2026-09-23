import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Option {
  id: number;
  code?: string;
  name: string;
}

interface CreatedAsset {
  id: number;
  asset_code: string;
}

interface FormState {
  categoryId: string;
  subcategoryId: string;
  costCenterId: string;
  description: string;
  purchaseCost: string;
  taxPercent: string;
  purchaseDate: string;
  initialHolderId: string;
  quantity: string;
}

const emptyForm: FormState = {
  categoryId: "",
  subcategoryId: "",
  costCenterId: "",
  description: "",
  purchaseCost: "0",
  taxPercent: "0",
  purchaseDate: new Date().toISOString().slice(0, 10),
  initialHolderId: "",
  quantity: "1",
};

export function AddAssetForm({ companyId }: { companyId: number }) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [createdAssets, setCreatedAssets] = useState<CreatedAsset[]>([]);

  const { data: categories = [] } = useQuery({
    queryKey: ["masters", "categories"],
    queryFn: () => apiClient.get<Option[]>("/masters/categories"),
  });
  const { data: subcategories = [] } = useQuery({
    queryKey: ["masters", "subcategories"],
    queryFn: () => apiClient.get<Option[]>("/masters/subcategories"),
  });
  const { data: costCenters = [] } = useQuery({
    queryKey: ["masters", "cost-centers"],
    queryFn: () => apiClient.get<Option[]>("/masters/cost-centers"),
  });
  // Scoped to this company's IT_STOCK holders only -- a company can have
  // more than one (one per location), so the backend deliberately has no
  // server-side default and requires an explicit initial_holder_id.
  const { data: stockHolders = [] } = useQuery({
    queryKey: ["holders", "IT_STOCK", companyId],
    queryFn: () => apiClient.get<Option[]>(`/holders?holder_type=IT_STOCK&company_id=${companyId}`),
  });

  // The Initial Holder select intentionally starts blank (see emptyForm) and
  // is never auto-filled, even when the company has exactly one IT_STOCK
  // holder. `HolderService.list` has no stable ordering, and a company can
  // have more than one IT_STOCK holder (one per location) -- auto-picking
  // "the first one returned" would silently recreate the exact guessing risk
  // that Task 15/16 deliberately removed server-side, just moved up to this
  // screen. The admin must explicitly choose one; `canSave` below blocks
  // submission until they do.

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const purchaseCost = Number(form.purchaseCost) || 0;
  const taxPercent = Number(form.taxPercent) || 0;
  const taxAmount = useMemo(() => (purchaseCost * taxPercent) / 100, [purchaseCost, taxPercent]);
  const totalCost = purchaseCost + taxAmount;

  const hasHolderOption = stockHolders.length > 0;
  const canSave =
    form.description.trim().length > 0 &&
    form.categoryId !== "" &&
    form.costCenterId !== "" &&
    form.initialHolderId !== "" &&
    form.purchaseDate !== "";

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.post<CreatedAsset[]>("/assets", {
        company_id: companyId,
        cost_center_id: form.costCenterId ? Number(form.costCenterId) : undefined,
        category_id: form.categoryId ? Number(form.categoryId) : undefined,
        subcategory_id: form.subcategoryId ? Number(form.subcategoryId) : null,
        description: form.description,
        purchase_cost: purchaseCost,
        tax_percent: taxPercent,
        purchase_date: form.purchaseDate,
        initial_holder_id: Number(form.initialHolderId),
        quantity: Number(form.quantity) || 1,
      }),
    onSuccess: (created) => setCreatedAssets(created),
  });

  function handleSave() {
    if (!canSave) return;
    setCreatedAssets([]);
    saveMutation.mutate();
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <h1 className="text-xl font-semibold">Add Asset</h1>

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category">Category</Label>
            <Select value={form.categoryId || undefined} onValueChange={(v) => setField("categoryId", v)}>
              <SelectTrigger id="category" aria-label="Category">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="subcategory">Sub-Category</Label>
            <Select value={form.subcategoryId || undefined} onValueChange={(v) => setField("subcategoryId", v)}>
              <SelectTrigger id="subcategory" aria-label="Sub-Category">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {subcategories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              aria-label="Description"
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Procurement</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cost-center">Cost Center</Label>
            <Select value={form.costCenterId || undefined} onValueChange={(v) => setField("costCenterId", v)}>
              <SelectTrigger id="cost-center" aria-label="Cost Center">
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
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="purchase-date">Purchase Date</Label>
            <Input
              id="purchase-date"
              aria-label="Purchase Date"
              type="date"
              value={form.purchaseDate}
              onChange={(e) => setField("purchaseDate", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="purchase-cost">Purchase Cost</Label>
            <Input
              id="purchase-cost"
              aria-label="Purchase Cost"
              type="number"
              value={form.purchaseCost}
              onChange={(e) => setField("purchaseCost", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tax-percent">Tax %</Label>
            <Input
              id="tax-percent"
              aria-label="Tax %"
              type="number"
              value={form.taxPercent}
              onChange={(e) => setField("taxPercent", e.target.value)}
            />
          </div>

          <div className="flex justify-between text-sm">
            <span>
              Tax Amount: <span data-testid="tax-amount">{taxAmount}</span>
            </span>
            <span>
              Total Cost: <span data-testid="total-cost">{totalCost}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Initial Holder</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <Label htmlFor="initial-holder">Goes into</Label>
          <Select value={form.initialHolderId || undefined} onValueChange={(v) => setField("initialHolderId", v)}>
            <SelectTrigger id="initial-holder" aria-label="Initial Holder">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {stockHolders.map((h) => (
                <SelectItem key={h.id} value={String(h.id)}>
                  {h.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!hasHolderOption && (
            <p className="text-sm text-destructive">
              No IT Stock holder found for this company. Add one under Setup &gt; Users first.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quantity</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <Label htmlFor="quantity">Quantity</Label>
          <Input
            id="quantity"
            aria-label="Quantity"
            type="number"
            min={1}
            max={100}
            value={form.quantity}
            onChange={(e) => setField("quantity", e.target.value)}
          />
        </CardContent>
      </Card>

      {saveMutation.isError && (
        <p className="text-sm text-destructive">
          {saveMutation.error instanceof Error ? saveMutation.error.message : "Failed to save asset."}
        </p>
      )}

      <div>
        <Button onClick={handleSave} disabled={!canSave || saveMutation.isPending}>
          Save
        </Button>
      </div>

      {createdAssets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Created</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 font-mono text-sm">
              {createdAssets.map((a) => (
                <li key={a.id}>{a.asset_code}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
