import { NewPurchaseOrderForm } from "../../features/purchase-orders/NewPurchaseOrderForm";
import { useAuthStore } from "../../lib/auth-store";

export default function NewPurchaseOrderRoute() {
  // null for the Primary Owner -- a company-less bootstrap account (see
  // NewPurchaseOrderForm, which picks the first of the caller's companies
  // once loaded rather than assuming a home company).
  const companyId = useAuthStore((s) => s.companyId);
  return <NewPurchaseOrderForm companyId={companyId} />;
}
