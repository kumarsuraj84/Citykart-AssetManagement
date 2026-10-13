import { AssetRegister } from "../../features/assets/AssetRegister";

interface AssetsIndexRouteProps {
  search?: { status?: string; mine?: boolean; q?: string; find?: boolean };
}

export default function AssetsIndexRoute({ search }: AssetsIndexRouteProps) {
  // The URL only seeds the filters; a new link (Home's "N under repair", the
  // My Assets redirect) must start again from what it asks for.
  const seedKey = `${search?.status ?? ""}|${search?.mine ? 1 : 0}|${search?.q ?? ""}|${search?.find ? 1 : 0}`;
  return (
    <AssetRegister
      key={seedKey}
      initialStatus={search?.status}
      initialMine={search?.mine}
      initialQuery={search?.q}
      focusSearch={search?.find}
    />
  );
}
