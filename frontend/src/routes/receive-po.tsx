import { ReceiveScreen } from "../features/receive/ReceiveScreen";

/** /receive/$poId -- the Receive screen of one purchase order (`line` = start with only that line's quantity). */
export default function ReceivePoRoute({ poId, line }: { poId: string; line?: number }) {
  return <ReceiveScreen key={poId} poId={Number(poId)} focusLine={line ?? null} />;
}
