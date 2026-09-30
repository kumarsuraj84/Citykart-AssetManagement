import { describe, it, expect, vi } from "vitest";
import { bulkDeactivate } from "./bulk-deactivate";
import { apiClient, ApiError } from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

describe("bulkDeactivate", () => {
  it("calls the given path for every id and reports them all as succeeded", async () => {
    (apiClient.delete as any).mockResolvedValue(undefined);

    const result = await bulkDeactivate((id) => `/masters/vendors/${id}`, [1, 2, 3]);

    expect(apiClient.delete).toHaveBeenCalledWith("/masters/vendors/1");
    expect(apiClient.delete).toHaveBeenCalledWith("/masters/vendors/2");
    expect(apiClient.delete).toHaveBeenCalledWith("/masters/vendors/3");
    expect(result.succeededIds).toEqual([1, 2, 3]);
    expect(result.failed).toEqual([]);
  });

  it("never lets one failure block or roll back the others", async () => {
    (apiClient.delete as any).mockImplementation((path: string) =>
      path.endsWith("/2") ? Promise.reject(new ApiError("cannot remove the last Primary Owner", 422)) : Promise.resolve(undefined),
    );

    const result = await bulkDeactivate((id) => `/masters/vendors/${id}`, [1, 2, 3]);

    expect(result.succeededIds).toEqual([1, 3]);
    expect(result.failed).toEqual([{ id: 2, message: "cannot remove the last Primary Owner" }]);
  });

  it("falls back to a generic message for a non-ApiError rejection", async () => {
    (apiClient.delete as any).mockRejectedValue(new Error("network down"));

    const result = await bulkDeactivate((id) => `/masters/vendors/${id}`, [1]);

    expect(result.failed).toEqual([{ id: 1, message: "Could not deactivate this record." }]);
  });
});
