/**
 * Small, shared name lookups that the dropdown builders in option-labels.ts
 * need for context (Category names for Items; Place and Company for people
 * and places). They reuse the same React Query keys the screens already use,
 * so a screen that already fetched a list pays nothing extra. All of these
 * are short master lists (no asset or ERP-sized list is loaded here).
 *
 * Every hook tolerates an unexpected response shape (tests often mock every
 * GET the same way) and simply returns empty maps then.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./api-client";
import { codesById, namesById } from "./option-labels";

interface Named {
  id: number;
  name: string;
  code?: string | null;
}

const asArray = <T,>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);

/** Category and Sub-category names, for Item options ("Laptop · IT Fixed Assets"). */
export function useCategoryLookups(enabled = true) {
  const categoriesQ = useQuery({
    queryKey: ["masters", "categories"],
    queryFn: () => apiClient.get<Named[]>("/masters/categories"),
    enabled,
  });
  const subcategoriesQ = useQuery({
    queryKey: ["masters", "subcategories"],
    queryFn: () => apiClient.get<Named[]>("/masters/subcategories"),
    enabled,
  });
  return {
    categories: namesById(asArray<Named>(categoriesQ.data)),
    subcategories: namesById(asArray<Named>(subcategoriesQ.data)),
  };
}

/** Place (location) names and company codes, for people/place options. */
export function usePlaceLookups(enabled = true) {
  const locationsQ = useQuery({
    queryKey: ["masters", "locations", "all"],
    queryFn: () => apiClient.get<Named[]>("/masters/locations"),
    enabled,
  });
  const companiesQ = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<Named[]>("/masters/companies"),
    enabled,
  });
  return {
    locations: namesById(asArray<Named>(locationsQ.data)),
    companies: codesById(asArray<Named>(companiesQ.data)),
  };
}
