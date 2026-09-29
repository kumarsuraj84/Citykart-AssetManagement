import { AddAssetForm } from "../../features/assets/AddAssetForm";
import { useAuthStore } from "../../lib/auth-store";

export default function NewAssetRoute() {
  // null for the Primary Owner -- a company-less bootstrap account (see
  // AddAssetForm, which picks the first of the caller's companies once
  // loaded rather than assuming a home company).
  const companyId = useAuthStore((s) => s.companyId);
  return <AddAssetForm companyId={companyId} />;
}
