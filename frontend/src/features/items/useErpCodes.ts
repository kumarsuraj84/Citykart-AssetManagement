import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { CodeDecisionRow } from "./CodeDecisionRows";

/** Every ERP item code a company has bought, one row each, with its OWN decision (Item, not tracked, or none). */
export function useErpCodes(companyId?: string) {
  return useQuery({
    queryKey: ["items", "codes", "all", companyId],
    queryFn: async () =>
      (await apiClient.get<CodeDecisionRow[]>(`/items/codes${companyId ? `?company_id=${companyId}` : ""}`)).map((c) => ({
        ...c, not_tracked: c.not_tracked ?? false, not_tracked_by: c.not_tracked_by ?? null, map_id: c.map_id ?? null,
      })),
    retry: false,
  });
}
