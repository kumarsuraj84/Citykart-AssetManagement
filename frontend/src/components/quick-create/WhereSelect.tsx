import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { ASK_TO_ADD, canCreate, useCapabilities } from "../../lib/capabilities";
import { placeOption, spansCompanies, stockRoomOption, type PlaceLike } from "../../lib/option-labels";
import { storeOwnedRoomIds } from "../../features/assets/storeRooms";
import { SearchableSelect, type SearchableSelectOption } from "@/components/shared/SearchableSelect";
import { NewStockRoomDialog } from "./masters";
import { useStockRooms, type StockRoomRow } from "./StockRoomSelect";

/*
 * "Where do they go": the one place picker of Add Assets. Three groups in one searchable list:
 *   Stores        pick the store; the assets are "With Store" (the same as Give to Store in Move)
 *   Sites         a head-office / warehouse site's Install Point; the assets are "Installed" there
 *   Stock rooms   spare stock; the assets are "In Stock"
 * A store's own Stock Room and Install Point (STK-<code> / INS-<code>) are not listed, as in Move: the store itself is
 * the place. The server already accepts all three (the asset's status follows the place); only the choice was missing.
 */

interface PersonRow extends PlaceLike {
  kind?: string | null;
}

const asArray = <T,>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);

export const WHERE_GROUPS = {
  store: "Stores · the store uses them (With Store)",
  site: "Head office and warehouse sites · installed there",
  room: "Stock rooms · spare stock (In Stock)",
} as const;

/** What the picker lists for one company's person: stores, sites and stock rooms of every company they work in,
 * their own company's first. `ids` and `isSuccess` feed the "remember the last choice" default. */
export function useWherePlaces(companyId: number | null | undefined) {
  const enabled = companyId != null;
  const storesQ = useQuery({
    queryKey: ["people", "stores", "places"], enabled,
    queryFn: () => apiClient.get<PersonRow[]>("/people?kind=stores&limit=1000"),
  });
  const sitesQ = useQuery({
    queryKey: ["people", "install-points", "places"], enabled,
    queryFn: () => apiClient.get<PersonRow[]>("/people?kind=install-points&limit=1000"),
  });
  const rooms = useStockRooms(enabled ? "all" : null);

  const stores = asArray<PersonRow>(storesQ.data);
  const sites = asArray<PersonRow>(sitesQ.data);
  const stockRooms = rooms.rows;

  const options = ((): SearchableSelectOption[] => {
    // A store's own rooms are found by their codes next to the stores' codes (same company).
    const everyone = [
      ...stores.map((p) => ({ id: p.id, code: p.code, asset_user_type: "STORE", company_id: p.company_id })),
      ...sites.map((p) => ({ id: p.id, code: p.code, asset_user_type: "INSTALLED", company_id: p.company_id })),
      ...stockRooms.map((p: StockRoomRow) => ({ id: p.id, code: p.code, asset_user_type: "STOCK_POINT", company_id: p.company_id })),
    ];
    const storeOwned = storeOwnedRoomIds(everyone);
    const ownFirst = <T extends { company_id?: number | null }>(rows: T[]) => [
      ...rows.filter((r) => r.company_id === companyId), ...rows.filter((r) => r.company_id !== companyId),
    ];
    const showCompany = spansCompanies([...stores, ...sites, ...stockRooms]);
    return [
      ...ownFirst(stores).map((p) => ({ ...placeOption({ ...p, asset_user_type: "STORE" }, {}, showCompany), group: WHERE_GROUPS.store })),
      ...ownFirst(sites.filter((p) => !storeOwned.has(p.id))).map((p) => ({ ...placeOption({ ...p, asset_user_type: "INSTALLED" }, {}, showCompany), group: WHERE_GROUPS.site })),
      ...ownFirst(stockRooms.filter((p) => !storeOwned.has(p.id))).map((p) => ({ ...stockRoomOption(p, {}, showCompany), group: WHERE_GROUPS.room })),
    ];
  })();

  return {
    options,
    ids: options.map((o) => o.value),
    isSuccess: storesQ.isSuccess && sitesQ.isSuccess && rooms.isSuccess,
  };
}

/** The "Where do they go" picker. "+ New Stock Room…" stays for whoever may add one. */
export function WhereSelect({
  id, companyId, value, onValueChange, disabled, "aria-label": ariaLabel, placeholder,
}: {
  id: string;
  companyId: number | null | undefined;
  value: string;
  onValueChange: (id: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
  placeholder?: string;
}) {
  const places = useWherePlaces(companyId);
  const { caps, settled } = useCapabilities();
  const mayCreate = canCreate(caps, "stock_room");
  const [creating, setCreating] = useState(false);
  const [typedName, setTypedName] = useState("");
  const none = settled && places.isSuccess && places.options.length === 0;
  return (
    <>
      <SearchableSelect
        id={id}
        aria-label={ariaLabel}
        value={value || undefined}
        onValueChange={onValueChange}
        disabled={disabled}
        options={places.options}
        placeholder={placeholder ?? "Choose the store, site or stock room"}
        searchPlaceholder="Search a store, site or stock room…"
        onCreateNew={mayCreate && companyId != null ? (typed) => { setTypedName(typed); setCreating(true); } : undefined}
        createLabel="New Stock Room…"
      />
      {none && (
        <p className="text-xs text-muted-foreground" role="note">
          {mayCreate
            ? "There is no store, site or stock room yet. Add a stock room with “New Stock Room…” in the list."
            : `There is no store, site or stock room yet. ${ASK_TO_ADD.stock_room}`}
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
