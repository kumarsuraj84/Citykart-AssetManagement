import { AssetRegister } from "../../features/assets/AssetRegister";

interface AssetsIndexRouteProps {
  search?: { status?: string };
}

export default function AssetsIndexRoute({ search }: AssetsIndexRouteProps) {
  return <AssetRegister initialStatus={search?.status} />;
}
