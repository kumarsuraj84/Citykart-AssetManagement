import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Minus, Plus } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useKeyedMutation } from "@/lib/submit-key";
import { useUnsavedChangesWarning } from "@/lib/unsaved-changes";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/shared/ErrorState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { StockRoomSelect, useStockRooms } from "@/components/quick-create/StockRoomSelect";
import { useRemember, useRememberedDefault } from "@/lib/remembered-defaults";
import { serialModeLabel, workAreaLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { useDebounced } from "../purchase-orders/po-list";
import { PrintLabelsAction } from "../labels/PrintLabelsAction";
import { SerialBox } from "./SerialBox";
import { useSerialConflicts } from "./useSerialConflicts";
import {
  type CommonInput, type LineCheck, type LineInput, type ReceiveInfo, type ReceiveInfoLine, type ReceiveProblem,
  type ReceiveResult, type RequiredField, type SerialMode, SERIAL_MODES, asSerialMode, buildReceiveBody, checkReceipt,
  initialLines, lineTitle, problemsFrom, refusalSummary, todayIso, typedSerials, whyNotSentence,
} from "./receive-model";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
/** How long typing in a serial box settles before the box is checked again. */
const CHECK_DELAY_MS = 150;
/** New asset codes listed in the result before "and N more". */
const CODES_SHOWN = 20;
/** The register opens at most this many assets by id (the server's `ids=` limit). */
const OPEN_IDS_MAX = 1000;

/**
 * Receive (S4): one screen per purchase order. The common things -- where the
 * goods are Received Into and the invoice -- are entered ONCE; each line takes
 * a quantity (default: everything waiting; 0 skips it); a serial box appears
 * only for a line whose serial rule is "Has serial number". There are no unit
 * rows and nothing to tick, so 1, 10 or 100 units are the same few actions.
 *
 * The whole receipt is checked by the server first and written all-or-nothing;
 * a refusal (422 `problems`) is mapped back to the exact field, line and serial
 * row, and everything typed stays.
 */
export function ReceiveScreen({ poId, focusLine }: { poId: number; focusLine?: number | null }) {
  const qc = useQueryClient();
  const infoQ = useQuery({
    queryKey: ["purchase-order", poId, "receive-info"],
    queryFn: () => apiClient.get<ReceiveInfo>(`/purchase-orders/${poId}/receive-info`),
  });
  const [result, setResult] = useState<ReceiveResult | null>(null);
  // A fresh form after "Receive more" (the waiting counts have changed).
  const [formKey, setFormKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  async function receiveMore() {
    setRefreshing(true);
    try {
      await qc.invalidateQueries({ queryKey: ["purchase-order", poId, "receive-info"] });
    } finally {
      setRefreshing(false);
      setResult(null);
      setFormKey((k) => k + 1);
    }
  }

  if (infoQ.isError) {
    return (
      <ErrorState
        message={infoQ.error instanceof Error ? infoQ.error.message : "Couldn't load this purchase order for receiving."}
        onRetry={() => infoQ.refetch()}
      />
    );
  }
  const info = infoQ.data && Array.isArray(infoQ.data.lines) ? infoQ.data : undefined;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link to="/receive" className="w-fit text-xs text-muted-foreground hover:text-foreground hover:underline">
          ← Back to Receive
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground">Receive PO {info?.po_number ?? ""}</h1>
            {info && (
              <p className="text-sm text-muted-foreground">
                {[info.vendor_name, info.company_name, info.po_date ? `PO date ${info.po_date}` : null].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/purchase-orders/$id" params={{ id: String(poId) }}>Open PO</Link>
          </Button>
        </div>
      </div>

      {!info ? (
        <p className="text-sm text-muted-foreground" role="status">Loading…</p>
      ) : result ? (
        <ResultPanel result={result} info={info} onReceiveMore={receiveMore} refreshing={refreshing} />
      ) : (
        <ReceiveForm
          key={formKey}
          info={info}
          focusLine={formKey === 0 ? focusLine : null}
          onReceived={(r) => {
            setResult(r);
            qc.invalidateQueries({ queryKey: ["purchase-order", poId] });
            qc.invalidateQueries({ queryKey: ["purchase-orders"] });
            qc.invalidateQueries({ queryKey: ["assets"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
              try { window.scrollTo({ top: 0 }); } catch { /* jsdom */ }
            }
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

function ReceiveForm({ info, focusLine, onReceived }: {
  info: ReceiveInfo;
  focusLine?: number | null;
  onReceived: (r: ReceiveResult) => void;
}) {
  const fields = info.required_custom_fields ?? [];
  const [common, setCommon] = useState<CommonInput>(() => ({
    receivedInto: info.received_into_asset_user_id != null ? String(info.received_into_asset_user_id) : "",
    invoiceNumber: "",
    invoiceDate: todayIso(),
    invoiceAmount: "",
    fieldValues: Object.fromEntries(fields.filter((f) => f.type === "checkbox").map((f) => [f.key, false])),
    perUnit: false,
  }));
  const [inputs, setInputs] = useState<Record<number, LineInput>>(() => initialLines(info, focusLine));
  // The last refused attempt: its problems stay marked until that part is edited.
  const [serverProblems, setServerProblems] = useState<ReceiveProblem[]>([]);
  const [serverSummary, setServerSummary] = useState<string | null>(null);
  const [otherError, setOtherError] = useState<string | null>(null);

  // No delivery place on the PO: start with the stock room this person received into last.
  const rooms = useStockRooms(info.company_id);
  const rememberChoice = useRemember();
  useRememberedDefault({
    kind: "stock_room", companyId: info.company_id, value: common.receivedInto,
    setValue: (id) => setCommon((c) => ({ ...c, receivedInto: id })),
    validIds: rooms.rows.map((r) => r.id), ready: rooms.isSuccess,
  });
  // The PO's own delivery place stays choosable even when it is not a stock room.
  const extraPlace = info.received_into_asset_user_id != null
    ? [{ value: String(info.received_into_asset_user_id), label: info.received_into_name ?? `Place ${info.received_into_asset_user_id}` }]
    : [];

  // Serial boxes are checked once typing settles (a 100-row paste is checked once, not per key).
  const settledInputs = useDebounced(inputs, CHECK_DELAY_MS);
  const serials = useMemo(() => typedSerials(info, settledInputs), [info, settledInputs]);
  const conflicts = useSerialConflicts(serials);
  // Quantity / rule changes count at once; serial text once settled.
  const checkedInputs = useMemo(() => {
    const out: Record<number, LineInput> = {};
    for (const [k, v] of Object.entries(inputs)) out[Number(k)] = { ...v, text: settledInputs[Number(k)]?.text ?? v.text };
    return out;
  }, [inputs, settledInputs]);
  const check = useMemo(
    () => checkReceipt(info, common, checkedInputs, conflicts, serverProblems),
    [info, common, checkedInputs, conflicts, serverProblems],
  );
  const checkByLine = new Map(check.lines.map((c) => [c.lineNo, c]));
  const reasons = check.reasons;
  const why = whyNotSentence(reasons);
  const totalQty = check.totalQty;
  const commonProblems = serverProblems.filter((p) => p.line_no == null);

  function editCommon(patch: Partial<CommonInput>) {
    setCommon((c) => ({ ...c, ...patch }));
    setServerProblems((ps) => (ps.some((p) => p.line_no == null) ? ps.filter((p) => p.line_no != null) : ps));
    setOtherError(null);
  }
  function editLine(lineNo: number, patch: Partial<LineInput>) {
    setInputs((all) => ({ ...all, [lineNo]: { ...all[lineNo], ...patch } }));
    setServerProblems((ps) => (ps.some((p) => p.line_no === lineNo) ? ps.filter((p) => p.line_no !== lineNo) : ps));
    setOtherError(null);
  }

  // S7 (P2-12): typed invoice details or serials are not lost to a reload or a click elsewhere without a question.
  const dirty =
    common.invoiceNumber.trim() !== "" || common.invoiceAmount.trim() !== "" ||
    Object.values(inputs).some((l) => l.text.trim() !== "") ||
    Object.values(common.fieldValues).some((v) => typeof v === "string" && v.trim() !== "");
  const unsaved = useUnsavedChangesWarning(dirty);

  // S7 (P1-2): one Receive = one Idempotency-Key; a second activation while it runs is ignored.
  const receiveMutation = useKeyedMutation({
    mutationFn: (_: void, keyed) => {
      const body = buildReceiveBody(info, common, inputs);
      return keyed(body, () => apiClient.post<ReceiveResult>(`/purchase-orders/${info.po_id}/receive`, body));
    },
    onSuccess: (r) => {
      unsaved.release();
      rememberChoice(info.company_id, "stock_room", common.receivedInto);
      onReceived(r);
    },
    onError: (err) => {
      const problems = problemsFrom<ReceiveProblem>(err);
      if (problems && problems.length > 0) {
        setServerProblems(problems);
        setServerSummary(refusalSummary(problems));
        setOtherError(null);
      } else {
        setServerProblems([]);
        setServerSummary(null);
        setOtherError(err instanceof Error ? err.message : "Nothing was received. Please try again.");
      }
    },
  });

  function submit() {
    if (receiveMutation.isPending) return;
    // Check the very latest text too (the settled check may be a moment behind the typing).
    const fresh = checkReceipt(info, common, inputs, conflicts);
    if (fresh.reasons.length > 0) return;
    setServerSummary(null);
    receiveMutation.mutate();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (reasons.length === 0) submit();
    }
  }

  // Arriving from a PO line's Receive (?line=N): bring that line into view, cursor in its quantity.
  useEffect(() => {
    if (focusLine == null) return;
    const el = document.getElementById(`qty-line-${focusLine}`) as HTMLInputElement | null;
    if (!el) return;
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
    el.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const waitingTotal = info.lines.reduce((n, l) => n + l.waiting, 0);

  return (
    <div className="flex flex-col gap-4" onKeyDown={onKeyDown}>
      {/* --- Common receipt details: entered once for everything received --- */}
      <section className="flex flex-col gap-3 rounded-md border p-3" aria-labelledby="receive-common-heading">
        <div>
          <h2 id="receive-common-heading" className="text-sm font-semibold">Receipt details</h2>
          <p className="text-xs text-muted-foreground">Entered once; they apply to every unit received below.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="received-into" className="text-xs">
              Received Into<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </Label>
            <StockRoomSelect
              id="received-into"
              aria-label="Received Into"
              companyId={info.company_id}
              value={common.receivedInto}
              onValueChange={(v) => editCommon({ receivedInto: v })}
              extraOptions={extraPlace}
            />
            <p className="text-xs text-muted-foreground">The Stock Room the goods go to.</p>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="invoice-number" className="text-xs">
              Invoice No<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input id="invoice-number" autoComplete="off" value={common.invoiceNumber} onChange={(e) => editCommon({ invoiceNumber: e.target.value })} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="invoice-date" className="text-xs">
              Invoice Date<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input id="invoice-date" type="date" max={todayIso()} value={common.invoiceDate} onChange={(e) => editCommon({ invoiceDate: e.target.value })} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="invoice-amount" className="text-xs">
              Invoice Amount<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input
              id="invoice-amount" type="number" inputMode="decimal" min={0} step="0.01"
              value={common.invoiceAmount} onChange={(e) => editCommon({ invoiceAmount: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">The invoice total.</p>
          </div>
        </div>
        {commonProblems.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-sm text-destructive" role="alert" aria-label="Problems with the receipt details">
            {commonProblems.map((p, i) => <li key={i}>{p.message}</li>)}
          </ul>
        )}
      </section>

      {/* --- Lines: a quantity each; serials only where they are needed --- */}
      <section className="flex flex-col gap-2" aria-labelledby="receive-lines-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="receive-lines-heading" className="text-sm font-semibold">Lines ({info.lines.length})</h2>
          <p className="text-xs text-muted-foreground">Receiving now starts at everything waiting; 0 skips a line.</p>
        </div>
        <div
          className="hidden gap-3 px-3 text-xs font-medium text-muted-foreground lg:grid lg:grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_4.5rem_10rem]"
          aria-hidden="true"
        >
          <span>Item</span>
          <span className="text-right">Ordered</span>
          <span className="text-right">Received before</span>
          <span className="text-right">Waiting</span>
          <span className="text-center">Receiving now</span>
        </div>
        {info.lines.map((l) => (
          <LineBlock
            key={l.line_no}
            line={l}
            input={inputs[l.line_no]}
            check={checkByLine.get(l.line_no)!}
            serverMessages={serverProblems.filter((p) => p.line_no === l.line_no).map((p) => p.message)}
            onChange={(patch) => editLine(l.line_no, patch)}
          />
        ))}
      </section>

      {fields.length > 0 && (
        <RequiredFieldsSection
          fields={fields}
          info={info}
          common={common}
          inputs={inputs}
          checks={check.lines}
          onCommon={editCommon}
          onLine={editLine}
        />
      )}

      {/* --- Always-reachable action bar --- */}
      <div className="sticky bottom-0 z-20 -mx-4 -mb-4 flex flex-col gap-1.5 border-t bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:-mb-6 md:px-6">
        {serverSummary && (
          <p className="text-sm font-medium text-destructive" role="alert">{serverSummary}</p>
        )}
        {otherError && (
          <p className="text-sm text-destructive" role="alert">{otherError}</p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p id="receive-why" className={cn("min-w-0 text-xs", reasons.length > 0 ? "text-foreground" : "text-muted-foreground")} role="status">
            {reasons.length > 0
              ? <><span className="font-medium">Why can't I receive? </span>{why}</>
              : `Receiving ${plural(totalQty, "unit")} of ${plural(waitingTotal, "waiting unit")}. Ctrl+Enter also receives.`}
          </p>
          <AsyncButton
            className="w-full shrink-0 sm:w-auto"
            onClick={submit}
            disabled={reasons.length > 0}
            pending={receiveMutation.isPending}
            pendingLabel="Receiving…"
            aria-describedby="receive-why"
            title="Ctrl+Enter"
          >
            Receive {plural(totalQty, "unit")}
          </AsyncButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One line
// ---------------------------------------------------------------------------

function LineBlock({ line, input, check, serverMessages, onChange }: {
  line: ReceiveInfoLine;
  input: LineInput;
  check: LineCheck;
  serverMessages: string[];
  onChange: (patch: Partial<LineInput>) => void;
}) {
  const n = line.line_no;
  const title = lineTitle(line);
  const itemMode = asSerialMode(line.serial_mode);
  const overridden = input.mode !== itemMode;
  const qtyNum = Number(input.qty);
  const step = (delta: number) => {
    const base = Number.isInteger(qtyNum) ? qtyNum : 0;
    onChange({ qty: String(Math.min(line.waiting, Math.max(0, base + delta))) });
  };
  const nothingWaiting = line.waiting === 0;
  const countId = `serials-line-${n}-count`;
  const messages = [...check.serialMessages, ...serverMessages.filter((m) => !check.serialMessages.includes(m)), ...check.fieldMessages];

  return (
    <div
      role="group"
      aria-label={`Line ${n}: ${title}`}
      className={cn("flex flex-col gap-2 rounded-md border p-3", nothingWaiting && "bg-muted/30", check.qty === 0 && !nothingWaiting && "border-dashed")}
    >
      <div className="grid grid-cols-3 items-center gap-x-3 gap-y-2 lg:grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_4.5rem_10rem]">
        <div className="col-span-3 min-w-0 lg:col-span-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs tabular-nums text-muted-foreground">#{n}</span>
            <span className="font-medium">{title}</span>
            {line.bundle_label && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Set: {line.bundle_label}</span>
            )}
            {line.work_area && (
              <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">{workAreaLabel(line.work_area)}</span>
            )}
          </div>
          {line.item_name && line.description !== line.item_name && (
            <p className="truncate text-xs text-muted-foreground">{line.description}</p>
          )}
        </div>
        <Count label="Ordered" value={line.ordered} />
        <Count label="Received before" value={line.received_before} />
        <Count label="Waiting" value={line.waiting} strong />
        <div className="col-span-3 flex flex-col gap-1 lg:col-span-1">
          <Label htmlFor={`qty-line-${n}`} className="text-xs lg:sr-only">Receiving now</Label>
          <div className="flex items-center gap-1">
            <Button
              type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" tabIndex={-1}
              aria-label={`One less on line ${n}`} disabled={nothingWaiting || !(qtyNum > 0)} onClick={() => step(-1)}
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Input
              id={`qty-line-${n}`}
              aria-label={`Receiving now on line ${n}`}
              type="number" inputMode="numeric" min={0} max={line.waiting} step={1}
              className={cn("h-9 text-center tabular-nums", check.qtyProblem && "border-destructive")}
              aria-invalid={!!check.qtyProblem || undefined}
              value={input.qty}
              disabled={nothingWaiting}
              onChange={(e) => onChange({ qty: e.target.value })}
            />
            <Button
              type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" tabIndex={-1}
              aria-label={`One more on line ${n}`} disabled={nothingWaiting || qtyNum >= line.waiting} onClick={() => step(1)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      {check.qtyProblem && <p className="text-xs text-destructive">{check.qtyProblem}</p>}

      {!nothingWaiting && (
        <div className="flex flex-col gap-1">
          <div role="radiogroup" aria-label={`Serial rule for line ${n}`} className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Serial:</span>
            {SERIAL_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={input.mode === m}
                onClick={() => onChange({ mode: m as SerialMode })}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-xs",
                  input.mode === m ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                )}
              >
                {serialModeLabel(m)}
              </button>
            ))}
          </div>
          {overridden && (
            <p className="text-xs text-muted-foreground">Changed for this receipt only; the Item says “{serialModeLabel(itemMode)}”.</p>
          )}
        </div>
      )}

      {check.needsSerials && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`serials-line-${n}`} className="text-xs">
            Serial numbers for line {n} ({title})<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
          </Label>
          <SerialBox
            id={`serials-line-${n}`}
            label={`Serial numbers for line ${n}`}
            text={input.text}
            onChange={(text) => onChange({ text })}
            badRows={check.badRows}
            rows={check.qty}
            describedBy={countId}
            placeholder="One serial per line — paste a list or scan; each scan goes on a new line."
          />
          <p id={countId} className={cn("text-xs", check.countProblem || check.badRows.size > 0 ? "text-destructive" : "text-muted-foreground")}>
            {check.entries.length} of {check.qty} entered
            {check.entries.length > check.qty ? ` — ${check.entries.length - check.qty} too many, remove ${check.entries.length - check.qty === 1 ? "it" : "them"}` : ""}
          </p>
        </div>
      )}
      {check.qty > 0 && input.mode === "NO_SERIAL" && (
        <p className="text-xs text-muted-foreground">No serial number: each asset is saved with N/A.</p>
      )}
      {check.qty > 0 && input.mode === "SERIAL_LATER" && (
        <p className="text-xs text-muted-foreground">Serial numbers will be entered later from Assets &gt; Serial Pending.</p>
      )}

      {nothingWaiting ? (
        <p className="text-xs text-muted-foreground">Nothing on this line is waiting.</p>
      ) : check.qty === 0 && !check.qtyProblem ? (
        <p className="text-xs text-muted-foreground">Skipped: all {line.waiting} stay waiting on this PO.</p>
      ) : check.staysWaiting > 0 && !check.qtyProblem ? (
        <p className="text-xs text-muted-foreground">{plural(check.staysWaiting, "unit")} will stay waiting on this PO.</p>
      ) : null}

      {messages.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-destructive" role="alert" aria-label={`Problems on line ${n}`}>
          {messages.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
    </div>
  );
}

function Count({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex flex-col lg:block lg:text-right">
      <span className="text-[11px] text-muted-foreground lg:sr-only">{label}</span>
      <span className={cn("tabular-nums", strong && "font-semibold")} aria-label={`${label}: ${value}`}>{value.toLocaleString("en-IN")}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Required extra fields
// ---------------------------------------------------------------------------

function RequiredFieldsSection({ fields, info, common, inputs, checks, onCommon, onLine }: {
  fields: RequiredField[];
  info: ReceiveInfo;
  common: CommonInput;
  inputs: Record<number, LineInput>;
  checks: LineCheck[];
  onCommon: (patch: Partial<CommonInput>) => void;
  onLine: (lineNo: number, patch: Partial<LineInput>) => void;
}) {
  const setValue = (key: string, v: string | boolean) => onCommon({ fieldValues: { ...common.fieldValues, [key]: v } });
  const perUnitFields = fields.filter((f) => f.type !== "checkbox");
  const receiving = checks.filter((c) => c.qty > 0);
  return (
    <section className="flex flex-col gap-3 rounded-md border p-3" aria-labelledby="receive-fields-heading">
      <div>
        <h2 id="receive-fields-heading" className="text-sm font-semibold">Needed for every asset received</h2>
        <p className="text-xs text-muted-foreground">
          {info.company_name ?? "This company"} asks for these on every asset, so they are filled in once here and copied onto each asset received.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => {
          const id = `rf-${f.key}`;
          if (f.type === "checkbox") {
            return (
              <label key={f.key} className="flex items-center gap-2 text-sm sm:pt-5">
                <Checkbox id={id} aria-label={f.label} checked={common.fieldValues[f.key] === true} onCheckedChange={(c) => setValue(f.key, c === true)} />
                {f.label}
              </label>
            );
          }
          const value = typeof common.fieldValues[f.key] === "string" ? (common.fieldValues[f.key] as string) : "";
          return (
            <div key={f.key} className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={id} className="text-xs">
                {f.label}<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
              </Label>
              {f.type === "dropdown" ? (
                <Select value={value || undefined} onValueChange={(v) => setValue(f.key, v)}>
                  <SelectTrigger id={id} aria-label={f.label}>
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(f.options?.choices ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={id}
                  aria-label={f.label}
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  value={value}
                  onChange={(e) => setValue(f.key, e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>

      {perUnitFields.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
            aria-expanded={common.perUnit}
            onClick={() => onCommon({ perUnit: !common.perUnit })}
          >
            {common.perUnit ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
            Different values per asset
          </button>
          {common.perUnit && (
            <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-2">
              <p className="text-xs text-muted-foreground">
                One value per row, in the same order as the serial numbers (row 1 = the first asset). Leave a row blank to use the value above.
              </p>
              {receiving.length === 0 && <p className="text-xs text-muted-foreground">Nothing is being received yet.</p>}
              {receiving.map((c) => {
                const line = info.lines.find((l) => l.line_no === c.lineNo)!;
                return perUnitFields.map((f) => {
                  const id = `rf-${f.key}-line-${c.lineNo}`;
                  return (
                    <div key={id} className="flex flex-col gap-1">
                      <Label htmlFor={id} className="text-xs">
                        {f.label} — line {c.lineNo} ({lineTitle(line)}, {plural(c.qty, "asset")})
                      </Label>
                      <Textarea
                        id={id}
                        rows={Math.min(Math.max(c.qty, 2), 6)}
                        wrap="off"
                        className="font-mono text-sm"
                        value={inputs[c.lineNo]?.unitValues[f.key] ?? ""}
                        onChange={(e) => onLine(c.lineNo, { unitValues: { ...inputs[c.lineNo].unitValues, [f.key]: e.target.value } })}
                      />
                    </div>
                  );
                });
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// After receiving
// ---------------------------------------------------------------------------

function ResultPanel({ result, info, onReceiveMore, refreshing }: {
  result: ReceiveResult;
  info: ReceiveInfo;
  onReceiveMore: () => void;
  refreshing: boolean;
}) {
  const navigate = useNavigate();
  const created = result.assets_created ?? result.assets.length;
  const ids = result.label_asset_ids?.length ? result.label_asset_ids : result.assets.map((a) => a.asset_id);
  const codes = result.assets.map((a) => a.asset_code);
  const stillWaiting = (result.waiting_units ?? 0) > 0;
  const openIds = ids.slice(0, OPEN_IDS_MAX);
  return (
    <section className="flex flex-col gap-3 rounded-md border border-success/40 bg-success-soft/40 p-4" aria-label="Received">
      <div className="flex flex-col gap-0.5" role="status">
        <p className="text-base font-semibold">{plural(created, "asset")} created</p>
        {result.serial_pending > 0 && (
          <p className="text-sm">
            {plural(result.serial_pending, "serial number")} pending — enter {result.serial_pending === 1 ? "it" : "them"} later from Assets &gt; Serial Pending.
          </p>
        )}
        <p className="text-sm">Labels ready. Invoice {result.invoice_number}.</p>
        {stillWaiting && (
          <p className="text-sm text-muted-foreground">{plural(result.waiting_units ?? 0, "unit")} still waiting on PO {info.po_number}.</p>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <PrintLabelsAction assetIds={ids} variant="default" size="default">Print labels ({ids.length})</PrintLabelsAction>
        <Button variant="outline" onClick={() => navigate({ to: "/assets", search: { ids: openIds.join(",") } })}>
          Open assets
        </Button>
        <AsyncButton
          variant="outline"
          pending={refreshing}
          pendingLabel="Loading…"
          onClick={() => (stillWaiting ? onReceiveMore() : navigate({ to: "/receive" }))}
        >
          Receive more
        </AsyncButton>
      </div>
      {ids.length > OPEN_IDS_MAX && (
        <p className="text-xs text-muted-foreground">Open assets shows the first {OPEN_IDS_MAX}; all {ids.length} are in the register.</p>
      )}
      {codes.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">New asset codes</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs" aria-label="New asset codes">
            {result.assets.slice(0, CODES_SHOWN).map((a) => (
              <li key={a.asset_id}>
                <Link to="/assets/$id" params={{ id: String(a.asset_id) }} className="underline">{a.asset_code}</Link>
              </li>
            ))}
          </ul>
          {codes.length > CODES_SHOWN && <p className="text-xs text-muted-foreground">and {codes.length - CODES_SHOWN} more</p>}
        </div>
      )}
    </section>
  );
}
