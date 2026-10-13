import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { ASK_TO_ADD, canCreate, useCapabilities } from "../../lib/capabilities";
import { stockRoomOptions, type PlaceLike } from "../../lib/option-labels";
import { SearchableSelect, type SearchableSelectOption } from "@/components/shared/SearchableSelect";
import { NewStockRoomDialog } from "./masters";

export interface StockRoomRow extends PlaceLike {
  company_id?: number | null;
}

const asArray = <T,>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);

/**
 * The stock rooms of one company (or of every company the person works in when
 * `companyId` is "all"), from `GET /api/stock-rooms` -- rows carry their place
 * and company code, so no extra lookups are needed.
 */
export function useStockRooms(companyId: number | null | undefined | "all", enabled = true) {
  const q = useQuery({
    queryKey: ["stock-rooms", companyId ?? null],
    queryFn: () => apiClient.get<StockRoomRow[]>(companyId === "all" ? "/stock-rooms" : `/stock-rooms?company_id=${companyId}`),
    enabled: enabled && companyId != null,
  });
  return { rows: asArray<StockRoomRow>(q.data), isLoading: q.isLoading, isSuccess: q.isSuccess, isError: q.isError, refetch: q.refetch };
}

/** "HO Stock · Head Office · CKSPL" -- name, place and company code. */
export function stockRoomPickerOptions(rows: StockRoomRow[]): SearchableSelectOption[] {
  return stockRoomOptions(rows, { showCompany: true });
}

/**
 * The one "Received Into" stock-room picker: the company's stock rooms, a
 * "+ New Stock Room…" entry for whoever may add one (the new room is picked at
 * once and the person stays on their task), and a calm line when the company
 * has none yet.
 */
export function StockRoomSelect({
  id, companyId, value, onValueChange, disabled, "aria-label": ariaLabel, placeholder, extraOptions = [],
}: {
  id: string;
  companyId: number | null | undefined;
  value: string;
  onValueChange: (id: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
  placeholder?: string;
  /** Kept in the list even though they are not stock rooms (a PO's older delivery place). */
  extraOptions?: SearchableSelectOption[];
}) {
  const { rows, isSuccess } = useStockRooms(companyId);
  const { caps, settled } = useCapabilities();
  const mayCreate = canCreate(caps, "stock_room");
  const [creating, setCreating] = useState(false);
  const [typedName, setTypedName] = useState("");
  const own = stockRoomPickerOptions(rows);
  const options = [...extraOptions.filter((x) => !own.some((o) => o.value === x.value)), ...own];
  const none = settled && isSuccess && rows.length === 0 && extraOptions.length === 0;
  return (
    <>
      <SearchableSelect
        id={id}
        aria-label={ariaLabel}
        value={value || undefined}
        onValueChange={onValueChange}
        disabled={disabled}
        options={options}
        placeholder={placeholder ?? "Choose the Stock Room"}
        onCreateNew={mayCreate && companyId != null ? (typed) => { setTypedName(typed); setCreating(true); } : undefined}
        createLabel="New Stock Room…"
      />
      {none && (
        <p className="text-xs text-muted-foreground" role="note">
          {mayCreate
            ? "This company has no stock room yet. Add one with “New Stock Room…” in the list."
            : `This company has no stock room yet. ${ASK_TO_ADD.stock_room}`}
        </p>
      )}
      {companyId != null && (
        <NewStockRoomDialog
          companyId={companyId}
          open={creating}
          initialName={typedName}
          onOpenChange={setCreating}
          onCreated={(row) => onValueChange(String(row.id))}
        />
      )}
    </>
  );
}
