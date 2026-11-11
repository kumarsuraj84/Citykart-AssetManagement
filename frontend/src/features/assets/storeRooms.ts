// A store always comes with its own Stock Room (code STK-<store code>) and Install Point (INS-<store code>)
// (backend: asset_users/store_rooms.py). They are not real places to send things to: a store is GIVEN assets
// ("Give to Store"). The Move pickers for Stock Points and Install Points therefore leave them out, so people
// only see the real HO / warehouse stock points and sites. A stock room or install point made by hand, even one
// with the "STK-" / "INS-" look, stays in the list unless a store with that code exists in the same company.

interface PlaceRef {
  id: number;
  code?: string | null;
  asset_user_type?: string | null;
  company_id?: number | null;
}

const OWN_ROOM = /^(STK|INS)-(.+)$/i;

/** The ids of every store's own Stock Room and Install Point. */
export function storeOwnedRoomIds(places: PlaceRef[]): Set<number> {
  const storeCodes = new Set(
    places.filter((p) => p.asset_user_type === "STORE" && p.code).map((p) => `${p.company_id ?? ""}:${p.code!.toUpperCase()}`),
  );
  const owned = new Set<number>();
  for (const p of places) {
    const m = OWN_ROOM.exec(p.code ?? "");
    if (!m) continue;
    const kind = m[1].toUpperCase() === "STK" ? "STOCK_POINT" : "INSTALLED";
    if (p.asset_user_type === kind && storeCodes.has(`${p.company_id ?? ""}:${m[2].toUpperCase()}`)) owned.add(p.id);
  }
  return owned;
}

/** "3 from WH Stock, 2 from Ramesh": where the assets in a batch are now (the largest group first). */
export function fromSummary(places: (string | null | undefined)[]): string {
  const counts = new Map<string, number>();
  for (const name of places) {
    const key = (name ?? "").trim() || "an unknown place";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => `${n} from ${name}`)
    .join(", ");
}
