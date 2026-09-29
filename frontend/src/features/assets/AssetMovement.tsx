import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { actionsFor } from "./actionRules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormField } from "@/components/shared/FormField";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ScanBarcode } from "lucide-react";

interface Option {
  id: number;
  name: string;
}

interface AssetSearchResult {
  id: number;
  asset_code: string;
  serial_number: string | null;
  description: string;
  status: string;
  current_holder_name: string | null;
}

interface QueuedAsset extends AssetSearchResult {
  eligible: boolean;
}

interface BulkActionResult {
  done: number;
  failed: { asset_id: number; reason: string }[];
}

// AM-20: every lifecycle action the single-asset Asset 360 screen already
// offers (actionRules.ts), reused here as a flat list -- this screen isn't
// status-scoped like that one (a batch can mix assets starting in several
// different statuses), so eligibility is checked per scanned asset instead
// (via the same actionsFor() rule, not a duplicated one).
const BULK_ACTIONS: { eventType: string; label: string; needsHolder: boolean }[] = [
  { eventType: "MOVED", label: "Move / Allot / Transfer", needsHolder: true },
  { eventType: "SENT_FOR_REPAIR", label: "Send for Repair", needsHolder: false },
  { eventType: "RECEIVED_FROM_REPAIR", label: "Receive from Repair", needsHolder: true },
  { eventType: "LOST", label: "Report Lost", needsHolder: false },
  { eventType: "FOUND", label: "Mark Found", needsHolder: true },
  { eventType: "DISPOSED", label: "Dispose", needsHolder: false },
  { eventType: "SOLD", label: "Sell", needsHolder: false },
  { eventType: "SCRAPPED", label: "Scrap", needsHolder: false },
];

function isEligible(status: string, eventType: string): boolean {
  return actionsFor(status).some((a) => a.eventType === eventType);
}

function selectValue(v: string): string | undefined {
  return v || undefined;
}

export function AssetMovement() {
  const [eventType, setEventType] = useState(BULK_ACTIONS[0].eventType);
  const [toHolderId, setToHolderId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<AssetSearchResult[] | null>(null);
  const [queue, setQueue] = useState<QueuedAsset[]>([]);

  const action = BULK_ACTIONS.find((a) => a.eventType === eventType)!;

  const holdersQ = useQuery({ queryKey: ["holders"], queryFn: () => apiClient.get<Option[]>("/holders") });
  const holders = holdersQ.data ?? [];

  function addToQueue(asset: AssetSearchResult) {
    setQueue((q) => {
      if (q.some((existing) => existing.id === asset.id)) return q; // already scanned, ignore a repeat scan
      return [...q, { ...asset, eligible: isEligible(asset.status, eventType) }];
    });
    setScanValue("");
    setScanError(null);
    setCandidates(null);
  }

  function removeFromQueue(id: number) {
    setQueue((q) => q.filter((a) => a.id !== id));
  }

  const searchMutation = useMutation({
    mutationFn: (value: string) =>
      apiClient.get<{ items: AssetSearchResult[]; total: number }>(`/assets?q=${encodeURIComponent(value)}&limit=5`),
    onSuccess: (result, value) => {
      if (result.items.length === 0) {
        setScanError(`No asset found matching "${value}".`);
        setCandidates(null);
        return;
      }
      if (result.items.length === 1) {
        addToQueue(result.items[0]);
        return;
      }
      // More than one match (a partial scan/typed fragment) -- let the
      // operator pick which one, rather than guessing.
      setScanError(null);
      setCandidates(result.items);
    },
    onError: () => setScanError("Search failed -- try again."),
  });

  function handleScanSubmit() {
    const value = scanValue.trim();
    if (!value) return;
    setCandidates(null);
    searchMutation.mutate(value);
  }

  // Re-checks every already-queued asset's eligibility whenever the chosen
  // action changes, instead of leaving a stale eligible/ineligible flag from
  // a different action on screen.
  function handleActionChange(next: string) {
    setEventType(next);
    setQueue((q) => q.map((a) => ({ ...a, eligible: isEligible(a.status, next) })));
  }

  const eligibleQueue = queue.filter((a) => a.eligible);
  const canApply =
    eligibleQueue.length > 0 &&
    (!action.needsHolder || toHolderId !== "");

  const applyMutation = useMutation({
    mutationFn: () =>
      apiClient.post<BulkActionResult>("/assets/bulk-action", {
        asset_ids: eligibleQueue.map((a) => a.id),
        event_type: eventType,
        to_holder_id: action.needsHolder ? Number(toHolderId) : null,
        remarks: remarks || null,
      }),
    onSuccess: (result) => {
      const failedIds = new Set(result.failed.map((f) => f.asset_id));
      // Successful ones fall off the queue; a failure stays, so the operator
      // can see exactly which ones still need attention and why.
      setQueue((q) => q.filter((a) => failedIds.has(a.id)));
    },
  });

  function resetAfterApply() {
    applyMutation.reset();
    setQueue([]);
    setRemarks("");
    setToHolderId("");
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Asset Movement"
        description="Scan or type a Serial Number/Asset Code to queue assets, then apply one action to the whole batch."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField htmlFor="movement-action" label="Action" required>
          <Select value={eventType} onValueChange={handleActionChange}>
            <SelectTrigger id="movement-action" aria-label="Action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BULK_ACTIONS.map((a) => (
                <SelectItem key={a.eventType} value={a.eventType}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        {action.needsHolder && (
          <FormField htmlFor="movement-holder" label="Destination Holder" required>
            <Select value={selectValue(toHolderId)} onValueChange={setToHolderId}>
              <SelectTrigger id="movement-holder" aria-label="Destination Holder">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {holders.map((h) => (
                  <SelectItem key={h.id} value={String(h.id)}>{h.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        )}
      </div>

      <FormField htmlFor="movement-remarks" label="Remarks" helperText="Optional. Applied to every asset in this batch.">
        <Textarea id="movement-remarks" aria-label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
      </FormField>

      <FormField
        htmlFor="movement-scan"
        label="Scan or type Serial Number / Asset Code"
        helperText="Press Enter after each one -- a barcode scanner does this automatically."
      >
        <div className="flex gap-2">
          <Input
            id="movement-scan" aria-label="Scan or type Serial Number / Asset Code" value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleScanSubmit();
              }
            }}
            autoFocus
          />
          <Button type="button" variant="outline" onClick={handleScanSubmit} disabled={searchMutation.isPending}>
            <ScanBarcode className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      </FormField>
      {scanError && <p className="text-sm text-destructive" role="alert">{scanError}</p>}
      {candidates && (
        <div className="rounded-md border p-2">
          <p className="mb-1 text-xs text-muted-foreground">More than one match -- pick the right one:</p>
          <ul className="flex flex-col gap-1">
            {candidates.map((a) => (
              <li key={a.id}>
                <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => addToQueue(a)}>
                  {a.asset_code} — {a.description} ({a.serial_number ?? "no serial"})
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border p-3">
        <h2 className="mb-2 text-sm font-semibold">
          Queued ({queue.length}){eligibleQueue.length !== queue.length && ` — ${eligibleQueue.length} eligible`}
        </h2>
        {queue.length === 0 ? (
          <EmptyState title="Nothing scanned yet." description="Scan or type a Serial Number/Asset Code above to add assets here." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {queue.map((a) => (
              <li
                key={a.id}
                className={`flex items-center justify-between gap-2 rounded-sm border px-2 py-1.5 text-sm ${a.eligible ? "bg-muted/40" : "border-destructive/50 bg-destructive/5"}`}
              >
                <div className="flex flex-col">
                  <span className="font-medium">{a.asset_code} — {a.description}</span>
                  <span className="text-xs text-muted-foreground">
                    Holder: {a.current_holder_name ?? "—"} · Status: {a.status}
                    {!a.eligible && ` · not eligible for "${action.label}" from this status`}
                  </span>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeFromQueue(a.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {applyMutation.isSuccess && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p>
            <span className="font-semibold tabular-nums" data-testid="bulk-action-done-count">{applyMutation.data.done}</span> asset(s) updated.
          </p>
          {applyMutation.data.failed.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5 text-destructive">
              {applyMutation.data.failed.map((f) => (
                <li key={f.asset_id}>Asset #{f.asset_id}: {f.reason}</li>
              ))}
            </ul>
          )}
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={resetAfterApply}>
            Start a new batch
          </Button>
        </div>
      )}
      {applyMutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {applyMutation.error instanceof Error ? applyMutation.error.message : "Failed to apply the action."}
        </p>
      )}

      <div>
        <AsyncButton onClick={() => applyMutation.mutate()} disabled={!canApply} pending={applyMutation.isPending} pendingLabel="Applying…">
          Apply "{action.label}" to {eligibleQueue.length} asset{eligibleQueue.length === 1 ? "" : "s"}
        </AsyncButton>
      </div>
    </div>
  );
}
