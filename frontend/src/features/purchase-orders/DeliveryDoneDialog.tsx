import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type SearchableSelectOption } from "@/components/shared/SearchableSelect";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { StockRoomSelect, useStockRooms } from "@/components/quick-create/StockRoomSelect";
import { useRemember, useRememberedDefault } from "@/lib/remembered-defaults";
import { serialConflictSentence } from "./serial-conflict";
import type { PendingAssetRow } from "./po-detail-types";

/**
 * Mark Delivery Done ("Receive"): the existing delivery dialog, unchanged in
 * behaviour and payload (one entry per waiting unit id), now fed with the
 * units of a whole line (or of every line) instead of ticked rows.
 *
 * Mount it with a fresh `key` each time it opens: its state starts from the
 * units it is given.
 */

interface DeliveryGroup {
  key: string;
  lines: PendingAssetRow[];
}

// Units created from one PO line item (qty N) are identical, so they're
// grouped back together for delivery; any difference (line, description,
// barcode, category, brand, model, cost...) keeps two items in separate groups.
function groupUnits(units: PendingAssetRow[]): DeliveryGroup[] {
  const byKey = new Map<string, PendingAssetRow[]>();
  for (const u of units) {
    const key = [
      u.line_no ?? "", u.description, u.barcode ?? "", u.category_id, u.subcategory_id ?? "", u.brand_id ?? "", u.model ?? "",
      u.purchase_cost ?? "",
    ].join("|");
    const list = byKey.get(key);
    if (list) list.push(u);
    else byKey.set(key, [u]);
  }
  return [...byKey].map(([key, lines]) => ({ key, lines }));
}

// One serial per line of pasted/scanned text; blank lines are ignored.
function parseSerials(text: string): string[] {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

type GroupInput = { text: string; noSerial: boolean; later: boolean };

interface Props {
  poId: number;
  /** The waiting units to receive. */
  units: PendingAssetRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The PO's company: its stock rooms are listed (GET /stock-rooms). */
  companyId: number | null;
  /** Where the PO's goods naturally go (its delivery location); still changeable. */
  defaultReceivedIntoId?: number | null;
  /** Kept in the list although not a stock room (the PO's own older delivery place). */
  extraReceivedInto?: SearchableSelectOption[];
  onDelivered: (result: PendingAssetRow[]) => void;
}

export function DeliveryDoneDialog({ poId, units, open, onOpenChange, companyId, defaultReceivedIntoId, extraReceivedInto, onDelivered }: Props) {
  const deliveryGroups = useMemo(() => groupUnits(units), [units]);

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoiceAmount, setInvoiceAmount] = useState("");
  // A PO is delivered to one location only, so where it is Received Into is
  // chosen once for the whole delivery. Serial numbers are entered per
  // product (all identical units of one line item together), not per unit:
  // a pasted/scanned list, one serial per line, is handed to the units in
  // order, or "No serial number" sets N/A for the whole product.
  const [initialAssetUserId, setInitialAssetUserId] = useState(() => (defaultReceivedIntoId ? String(defaultReceivedIntoId) : ""));
  // No delivery place on the PO: start with the stock room this person received into last (if it still exists).
  const stockRoomsQ = useStockRooms(companyId);
  const rememberChoice = useRemember();
  useRememberedDefault({
    kind: "stock_room", companyId, value: initialAssetUserId, setValue: setInitialAssetUserId,
    validIds: stockRoomsQ.rows.map((r) => r.id), ready: stockRoomsQ.isSuccess,
  });
  // Parts that never carry a serial (a set's mouse/keyboard) start with
  // "No serial number" already ticked; it can still be unticked.
  const [groupInput, setGroupInput] = useState<Record<string, GroupInput>>(() =>
    Object.fromEntries(
      deliveryGroups.map((g) => [
        g.key,
        { text: "", noSerial: g.lines[0].serial_required === false, later: g.lines[0].serial_required !== false && g.lines[0].serial_later === true },
      ]),
    ),
  );
  // Deliberate opt-in to receive only the units that have a serial and leave
  // the rest waiting (instead of cancelling and starting again).
  const [leavePending, setLeavePending] = useState(false);
  // lower-cased serial -> asset code of the asset in CKAM that already has it,
  // from the advisory check-serials call below.
  const [existingSerials, setExistingSerials] = useState<Record<string, string>>({});

  function setGroupField(key: string, patch: Partial<GroupInput>) {
    setGroupInput((p) => ({ ...p, [key]: { ...(p[key] ?? { text: "", noSerial: false, later: false }), ...patch } }));
  }
  // A group that types nothing: "No serial number" (N/A) or "add it later" (Pending).
  const skipsTyping = (key: string) => !!(groupInput[key]?.noSerial || groupInput[key]?.later);

  // Serials typed (not "N/A") that appear more than once in THIS delivery,
  // compared case-insensitively like the server does. Lower-cased keys. The
  // server separately checks every serial against the whole system.
  const duplicateSerials = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of deliveryGroups) {
      if (skipsTyping(g.key)) continue;
      for (const s of parseSerials(groupInput[g.key]?.text ?? "")) {
        const k = s.toLowerCase();
        if (k === "n/a") continue;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([s]) => s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryGroups, groupInput]);

  // One serial per unit of a group: N/A for all, or the pasted list in order
  // ("" where the list is shorter than the group).
  function serialsForGroup(g: DeliveryGroup): string[] {
    const inp = groupInput[g.key];
    if (inp?.noSerial) return g.lines.map(() => "N/A");
    if (inp?.later) return g.lines.map(() => "");
    const tokens = parseSerials(inp?.text ?? "");
    return g.lines.map((_, i) => tokens[i] ?? "");
  }
  // A block is broken (not merely unfinished) if it has more serials than
  // units, a serial repeated in this delivery, or one CKAM already has.
  function groupHasProblem(g: DeliveryGroup): boolean {
    const inp = groupInput[g.key];
    if (inp?.noSerial || inp?.later) return false;
    const tokens = parseSerials(inp?.text ?? "");
    return tokens.length > g.lines.length ||
      tokens.some((s) => duplicateSerials.has(s.toLowerCase()) || existingSerials[s.toLowerCase()] !== undefined);
  }
  // Units of a group that would be received: all if "No serial number", else
  // as many as there are serials (never more than the units).
  function deliverCountForGroup(g: DeliveryGroup): number {
    if (skipsTyping(g.key)) return g.lines.length;
    return Math.min(parseSerials(groupInput[g.key]?.text ?? "").length, g.lines.length);
  }
  const deliverUnits = deliveryGroups.reduce((sum, g) => sum + deliverCountForGroup(g), 0);
  const unitsWithoutSerial = units.length - deliverUnits;
  const anyProblem = deliveryGroups.some(groupHasProblem);

  const canDeliver =
    initialAssetUserId !== "" && invoiceNumber.trim() !== "" && invoiceDate !== "" && invoiceAmount !== "" &&
    !anyProblem && deliverUnits > 0 && (unitsWithoutSerial === 0 || leavePending);

  // Advisory, debounced: ask the server which of the serials typed so far
  // CKAM already has, so the user finds out now rather than after Confirm.
  // The delivery itself re-checks everything, so a failed lookup is ignored.
  const typedSerials = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of deliveryGroups) {
      if (skipsTyping(g.key)) continue;
      for (const s of parseSerials(groupInput[g.key]?.text ?? "")) {
        if (s.toLowerCase() !== "n/a" && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
      }
    }
    return [...seen.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryGroups, groupInput]);
  const typedSerialsKey = typedSerials.join("\n");
  useEffect(() => {
    if (!open || typedSerials.length === 0) {
      setExistingSerials((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      apiClient
        .post<{ conflicts: { serial: string; asset_code: string }[] }>("/purchase-orders/check-serials", { serials: typedSerials })
        .then((r) => {
          if (!cancelled) setExistingSerials(Object.fromEntries((r?.conflicts ?? []).map((c) => [c.serial.toLowerCase(), c.asset_code])));
        })
        .catch(() => {
          if (!cancelled) setExistingSerials({});
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, typedSerialsKey]);

  const deliverMutation = useMutation({
    mutationFn: () =>
      apiClient.post<PendingAssetRow[]>(`/purchase-orders/${poId}/deliver`, {
        invoice_number: invoiceNumber, invoice_date: invoiceDate, invoice_amount: Number(invoiceAmount) || 0,
        // Only units that have a serial; the rest (if the user chose to leave
        // them waiting) are simply not sent and stay waiting on the PO.
        lines: deliveryGroups.flatMap((g) => {
          const serials = serialsForGroup(g);
          const later = !!groupInput[g.key]?.later;
          return g.lines
            .map((l, i): { pending_asset_id: number; serial_number?: string; serial_pending?: true; initial_asset_user_id: number } => ({
              pending_asset_id: l.id,
              // "Add it later": no serial is sent, the asset is made as Serial Pending.
              ...(later ? { serial_pending: true as const } : { serial_number: serials[i] }),
              initial_asset_user_id: Number(initialAssetUserId),
            }))
            .filter((line) => later || line.serial_number !== "");
        }),
      }),
    onSuccess: (result) => {
      rememberChoice(companyId, "stock_room", initialAssetUserId);
      onDelivered(Array.isArray(result) ? result : []);
    },
  });

  const n = units.length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      {/* flex flex-col + max-h + overflow-hidden caps the dialog to the
          viewport; only the per-line list below scrolls (flex-1 min-h-0),
          so Cancel/Confirm in the footer stay reachable however many units
          are being received. */}
      <DialogContent className="flex max-h-[85vh] max-w-xl flex-col gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-base">
            Receive {n} unit{n === 1 ? "" : "s"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex shrink-0 flex-col gap-1">
          <Label htmlFor="initial-asset-user" className="text-xs">
            Received Into<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
          </Label>
          <StockRoomSelect
            id="initial-asset-user"
            companyId={companyId}
            value={initialAssetUserId}
            onValueChange={setInitialAssetUserId}
            extraOptions={extraReceivedInto}
          />
          <p className="text-xs text-muted-foreground">The Stock Room this delivery goes to. Applies to every unit below.</p>
        </div>

        <div className="grid shrink-0 grid-cols-3 gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="invoice-number" className="text-xs">
              Invoice No<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input id="invoice-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invoice-date" className="text-xs">
              Invoice Date<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input id="invoice-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invoice-amount" className="text-xs">
              Invoice Amount<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input id="invoice-amount" type="number" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {deliveryGroups.map((g) => {
            const count = g.lines.length;
            const first = g.lines[0];
            const inp = groupInput[g.key] ?? { text: "", noSerial: false, later: false };
            const typing = !inp.noSerial && !inp.later;
            const tokens = parseSerials(inp.text);
            const extra = Math.max(0, tokens.length - count);
            const dups = [...new Set(tokens.filter((s) => duplicateSerials.has(s.toLowerCase())))];
            const taken = [...new Set(tokens.filter((s) => existingSerials[s.toLowerCase()] !== undefined))];
            const problem = typing && (extra > 0 || dups.length > 0 || taken.length > 0);
            return (
              <div key={g.key} className="flex flex-col gap-2 rounded-md border p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-xs font-medium">{first.description}</div>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {count} unit{count === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={count === 1 ? `serial-${first.id}` : `serials-${first.id}`} className="text-xs">
                    {count === 1 ? "Serial Number" : "Serial Numbers"}
                    <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
                  </Label>
                  {count === 1 ? (
                    <Input
                      id={`serial-${first.id}`}
                      value={inp.noSerial ? "N/A" : inp.later ? "" : inp.text}
                      placeholder={inp.later ? "Pending: add it later" : undefined}
                      disabled={!typing}
                      onChange={(e) => setGroupField(g.key, { text: e.target.value })}
                    />
                  ) : (
                    <Textarea
                      id={`serials-${first.id}`}
                      rows={Math.min(Math.max(count, 2), 6)}
                      value={inp.noSerial ? `N/A for all ${count} units` : inp.later ? "" : inp.text}
                      disabled={!typing}
                      placeholder={inp.later ? "Pending: add them later" : "One serial per line. Paste a list or scan; each scan goes on a new line."}
                      onChange={(e) => setGroupField(g.key, { text: e.target.value })}
                    />
                  )}
                  {count > 1 && typing && (
                    <p className={`text-xs ${problem ? "text-destructive" : "text-muted-foreground"}`}>
                      {tokens.length} of {count} entered
                      {extra > 0 && ` -- ${extra} too many, remove ${extra === 1 ? "it" : "them"}`}
                      {dups.length > 0 && ` -- duplicate: ${dups.join(", ")}`}
                      {tokens.length < count && leavePending && ` -- ${count - tokens.length} will stay waiting`}
                    </p>
                  )}
                  {count === 1 && dups.length > 0 && typing && (
                    <p className="text-xs text-destructive">Duplicate serial: {dups.join(", ")}</p>
                  )}
                  {typing && taken.map((s) => (
                    <p key={s} className="text-xs text-destructive" role="alert">
                      {serialConflictSentence(s, existingSerials[s.toLowerCase()])}
                    </p>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    aria-label={`No serial number for ${first.description}`}
                    checked={inp.noSerial}
                    onCheckedChange={(checked) => setGroupField(g.key, checked === true ? { noSerial: true, later: false } : { noSerial: false })}
                  />
                  No serial number{count > 1 ? " (sets N/A for all units)" : ""}
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    aria-label={`Add the serial later for ${first.description}`}
                    checked={inp.later}
                    onCheckedChange={(checked) => setGroupField(g.key, checked === true ? { later: true, noSerial: false } : { later: false })}
                  />
                  It has one, but add it later{count > 1 ? " (for all units)" : ""}: it shows on the Serial Pending list
                </label>
              </div>
            );
          })}
        </div>

        {unitsWithoutSerial > 0 && !anyProblem && (
          <label className="flex shrink-0 items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs">
            <Checkbox
              aria-label="Leave the remaining units waiting"
              checked={leavePending}
              onCheckedChange={(checked) => setLeavePending(checked === true)}
            />
            <span>
              {unitsWithoutSerial} unit{unitsWithoutSerial === 1 ? " has" : "s have"} no serial yet. Tick to receive only the{" "}
              {deliverUnits} with serials and leave {unitsWithoutSerial === 1 ? "it" : "them"} waiting on this PO.
            </span>
          </label>
        )}

        {deliverMutation.isError && (
          <p className="shrink-0 text-sm text-destructive" role="alert">
            {deliverMutation.error instanceof Error ? deliverMutation.error.message : "Failed to receive these units."}
          </p>
        )}

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <AsyncButton onClick={() => deliverMutation.mutate()} disabled={!canDeliver} pending={deliverMutation.isPending} pendingLabel="Saving…">
            Confirm
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
