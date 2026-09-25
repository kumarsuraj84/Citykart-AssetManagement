import { PurchaseOrderDetail } from "../../features/purchase-orders/PurchaseOrderDetail";

export default function PurchaseOrderDetailRoute({ params }: { params: { id: string } }) {
  return <PurchaseOrderDetail poId={Number(params.id)} />;
}
