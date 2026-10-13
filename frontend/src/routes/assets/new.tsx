import { AddAssetsScreen } from "../../features/assets/AddAssetsForm";
import { useAuthStore } from "../../lib/auth-store";

export default function NewAssetRoute() {
  // null for the head-office admin (a company-less account): the form then
  // starts with the first of the person's companies once they have loaded.
  const companyId = useAuthStore((s) => s.companyId);
  return <AddAssetsScreen companyId={companyId} />;
}
