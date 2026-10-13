import { AssetMovement } from "../features/assets/AssetMovement";

export default function AssetMovementRoute({ ids, choice }: { ids?: string; choice?: string }) {
  return <AssetMovement preloadIds={ids} initialChoice={choice} />;
}
