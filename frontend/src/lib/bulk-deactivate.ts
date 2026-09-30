import { apiClient, ApiError } from "./api-client";

export interface BulkDeactivateFailure {
  id: number;
  message: string;
}

export interface BulkDeactivateResult {
  succeededIds: number[];
  failed: BulkDeactivateFailure[];
}

/**
 * Fires the same per-row DELETE (soft-deactivate) endpoint once per id, in
 * parallel -- there is no dedicated bulk endpoint, and none is needed: every
 * row still goes through its own full server-side authorization/business
 * check exactly as it would from a single-row click, so N parallel calls are
 * exactly as safe as N sequential ones, just faster. A failure on one row
 * (e.g. the "last Primary Owner" guard) never blocks or rolls back the rest.
 */
export async function bulkDeactivate(pathFor: (id: number) => string, ids: number[]): Promise<BulkDeactivateResult> {
  const results = await Promise.allSettled(ids.map((id) => apiClient.delete(pathFor(id))));
  const succeededIds: number[] = [];
  const failed: BulkDeactivateFailure[] = [];
  results.forEach((result, i) => {
    const id = ids[i];
    if (result.status === "fulfilled") {
      succeededIds.push(id);
    } else {
      const reason = result.reason;
      failed.push({ id, message: reason instanceof ApiError ? reason.message : "Could not deactivate this record." });
    }
  });
  return { succeededIds, failed };
}
