import { NewPurchaseOrderForm } from "../../features/purchase-orders/NewPurchaseOrderForm";
import { useAuthStore } from "../../lib/auth-store";

export default function NewPurchaseOrderRoute() {
  const companyId = useAuthStore((s) => s.companyId)!;
  return <NewPurchaseOrderForm companyId={companyId} />;
}
