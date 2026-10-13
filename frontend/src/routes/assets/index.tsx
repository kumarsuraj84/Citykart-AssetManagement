import { AssetRegister } from "../../features/assets/AssetRegister";
import type { RegisterSearch } from "../../features/assets/register-filters";

interface AssetsIndexRouteProps {
  search?: RegisterSearch;
  onSearchChange?: (next: RegisterSearch, opts?: { replace?: boolean }) => void;
}

/** The Assets register: its view (search text and filters) is the address bar's. */
export default function AssetsIndexRoute({ search, onSearchChange }: AssetsIndexRouteProps) {
  return <AssetRegister search={search ?? {}} onSearchChange={onSearchChange} />;
}
