import { PrintLabels } from "../features/assets/PrintLabels";

export default function PrintLabelsRoute({ assets }: { assets?: string }) {
  return <PrintLabels preloadIds={assets} />;
}
