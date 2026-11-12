import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useDebounced } from "../purchase-orders/po-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The ERP Barcode typed by hand, checked against the Item chosen: the live message under the box. It asks
 * `GET /api/items/erp-code-check`; the server applies the very same check when the entry is saved
 * (backend app/items/erp_code_check.py), so this is only the early answer.
 *   OK                a code linked to this Item
 *   OTHER_ITEM        a code linked to a different Item                (not allowed)
 *   UNLINKED          a real ERP code no Item is linked to yet          (not allowed: link it first)
 *   NOT_TRACKED       a code CKAM is told not to track                  (not allowed)
 *   NOT_ERP           not an ERP code, or not this company's            (not allowed)
 *   LOCAL             the word LOCAL, for something bought locally
 *   BLANK             nothing typed                                    (not allowed)
 *   UNCHECKED         no ERP data copied yet: nothing to check against
 */
export interface ErpCodeVerdict {
  state: string;
  ok: boolean;
  message: string;
  erp_name?: string | null;
  item_name?: string | null;
}

export const LOCAL_WORD = "LOCAL";
export const OLD_STOCK_WORD = "OLD STOCK";
export const BLANK_VERDICT: ErpCodeVerdict = { state: "BLANK", ok: false, message: "Type the ERP code, or LOCAL if it was bought locally, or OLD STOCK for old stock." };
const LOCAL_VERDICT: ErpCodeVerdict = { state: "LOCAL", ok: true, message: "Bought locally." };
const OLD_STOCK_VERDICT: ErpCodeVerdict = { state: "OLD_STOCK", ok: true, message: "Old stock." };

/** LOCAL or OLD STOCK when that is what was typed (any letter case, extra spaces, a dash or underscore between the words), else null. */
export function acceptedWord(typed: string): typeof LOCAL_WORD | typeof OLD_STOCK_WORD | null {
  const words = typed.toUpperCase().replace(/[-_]/g, " ").split(/\s+/).filter(Boolean).join(" ");
  return words === LOCAL_WORD ? LOCAL_WORD : words === OLD_STOCK_WORD ? OLD_STOCK_WORD : null;
}

export interface ErpCodeCheck {
  /** The answer for what is typed now; null while it is being asked, when there is no Item yet, or when the check could not be reached. */
  verdict: ErpCodeVerdict | null;
  checking: boolean;
  /** Why Add / Save must wait because of this box, in words ("ERP Barcode: ..."); empty when nothing stands in the way. */
  reasons: string[];
}

export function useErpCodeCheck({
  code, itemId, bundleId, companyId,
}: { code: string; itemId?: number | null; bundleId?: number | null; companyId?: number | null }): ErpCodeCheck {
  const typed = code.trim();
  const settled = useDebounced(typed, 350);
  const hasTarget = itemId != null || bundleId != null;
  const word = acceptedWord(typed);
  const ask = hasTarget && companyId != null && settled !== "" && acceptedWord(settled) === null;
  const params = new URLSearchParams({ code: settled });
  if (itemId != null) params.set("item_id", String(itemId));
  if (bundleId != null) params.set("bundle_id", String(bundleId));
  if (companyId != null) params.set("company_id", String(companyId));
  const q = useQuery({
    queryKey: ["items", "erp-code-check", settled, itemId ?? null, bundleId ?? null, companyId ?? null],
    queryFn: () => apiClient.get<ErpCodeVerdict>(`/items/erp-code-check?${params.toString()}`),
    enabled: ask, retry: false, staleTime: 30_000,
  });
  if (!hasTarget) return { verdict: null, checking: false, reasons: [] };
  if (typed === "") return { verdict: BLANK_VERDICT, checking: false, reasons: [`ERP Barcode: ${BLANK_VERDICT.message}`] };
  if (word) return { verdict: word === LOCAL_WORD ? LOCAL_VERDICT : OLD_STOCK_VERDICT, checking: false, reasons: [] };
  if (typed !== settled || (ask && q.isFetching && !q.data)) {
    return { verdict: null, checking: true, reasons: ["Checking the ERP Barcode…"] };
  }
  if (q.data) return { verdict: q.data, checking: false, reasons: q.data.ok ? [] : [`ERP Barcode: ${q.data.message}`] };
  return { verdict: null, checking: false, reasons: [] };      // could not be asked: the server still decides on Add
}

/** The ERP Barcode box with its live message and a "Bought locally" shortcut that types LOCAL. */
export function ErpBarcodeField({
  id, value, onChange, check, disabled, ariaLabel = "ERP Barcode",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  check: ErpCodeCheck;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const v = check.verdict;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Input id={id} aria-label={ariaLabel} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        <Button type="button" variant="outline" size="sm" className="h-10 shrink-0" disabled={disabled} onClick={() => onChange(LOCAL_WORD)}>
          Bought locally
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-10 shrink-0" disabled={disabled} onClick={() => onChange(OLD_STOCK_WORD)}>
          Old stock
        </Button>
      </div>
      <div aria-live="polite" className="min-h-4 text-xs">
        {check.checking && <span className="text-muted-foreground">Checking…</span>}
        {!check.checking && v && v.state !== "BLANK" && (
          v.ok
            ? <span className="inline-flex w-fit rounded-full bg-success-soft px-2 py-0.5 font-medium text-on-success-soft">{v.message}</span>
            : <span className="text-destructive">{v.message}</span>
        )}
      </div>
    </div>
  );
}
