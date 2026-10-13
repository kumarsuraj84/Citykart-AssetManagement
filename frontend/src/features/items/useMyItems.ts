import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Item } from "./types";

export const MY_ITEMS_KEY = ["items", "mine"] as const;

/**
 * The active Items of the signed-in person's own work areas (S7 P2-6):
 * `GET /items?work_area=mine`. Every picker where an Item is chosen for new
 * work (a PO line, Add Assets, Move "Add by Item", the ERP review) lists only
 * these, so nobody picks an Item the server will refuse on Save. The server
 * still checks every save. Refreshed with every other Item list (["items"]).
 */
export function useMyItems(enabled = true) {
  const q = useQuery({
    queryKey: MY_ITEMS_KEY,
    queryFn: () => apiClient.get<Item[]>("/items?work_area=mine"),
    enabled,
  });
  const items = (Array.isArray(q.data) ? q.data : []).filter((i) => i.is_active !== false);
  return { items, query: q };
}
