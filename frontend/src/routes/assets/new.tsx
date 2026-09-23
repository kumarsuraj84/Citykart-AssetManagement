import { AddAssetForm } from "../../features/assets/AddAssetForm";
import { useAuthStore } from "../../lib/auth-store";

export default function NewAssetRoute() {
  const companyId = useAuthStore((s) => s.companyId)!;
  return <AddAssetForm companyId={companyId} />;
}
