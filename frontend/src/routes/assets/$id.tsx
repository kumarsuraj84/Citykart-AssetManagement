import { AssetDetail } from "../../features/assets/AssetDetail";

export default function AssetDetailRoute({ params }: { params: { id: string } }) {
  return <AssetDetail assetId={Number(params.id)} />;
}
