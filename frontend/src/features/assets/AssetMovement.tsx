import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { actionsFor } from "./actionRules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormField } from "@/components/shared/FormField";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { EmptyState } from "@/components/shared/EmptyState";
import { useTableSort } from "@/components/shared/useTableSort";
import { ScanBarcode, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";

interface Option {
  id: number;
  code?: string;
  email?: string;
  name: string;
}

// Lets someone find an Asset User by typing their code or email, not just
// their name -- the same fields AssetUsersScreen's own Code/Email columns
// show, so the search matches what's actually on their record.
function assetUserKeywords(h: Option): string[] {
  return [h.code, h.email].filter((v): v is string => Boolean(v));
}

interface AssetSearchResult {
  id: number;
  asset_code: string;
  serial_number: string | null;
  description: string;
  status: string;
  current_asset_user_name: string | null;
  current_asset_user_location_name: string | null;
  current_asset_user_type: string | null;
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
const BULK_ACTIONS: { eventType: string; label: string; needsAssetUser: boolean }[] = [
  { eventType: "MOVED", label: "Move / Allot / Transfer", needsAssetUser: true },
  { eventType: "SENT_FOR_REPAIR", label: "Send for Repair", needsAssetUser: false },
  { eventType: "RECEIVED_FROM_REPAIR", label: "Receive from Repair", needsAssetUser: true },
  { eventType: "LOST", label: "Report Lost", needsAssetUser: false },
  { eventType: "FOUND", label: "Mark Found", needsAssetUser: true },
  { eventType: "DISPOSED", label: "Dispose", needsAssetUser: false },
  { eventType: "SOLD", label: "Sell", needsAssetUser: false },
  { eventType: "SCRAPPED", label: "Scrap", needsAssetUser: false },
];

function isEligible(status: string, eventType: string): boolean {
  return actionsFor(status).some((a) => a.eventType === eventType);
}

// An operator scanning a batch should be able to tell at a glance that an
// asset is currently with a real person/store/install, not sitting in an
// STOCK_POINT warehouse bin -- moving it means pulling it out of someone's
// hands, worth a second look before it's bundled into a bulk action.
function isNotInItStock(assetUserType: string | null): boolean {
  return assetUserType !== null && assetUserType !== "STOCK_POINT";
}

function selectValue(v: string): string | undefined {
  return v || undefined;
}

export function AssetMovement() {
  const [eventType, setEventType] = useState(BULK_ACTIONS[0].eventType);
  const [toAssetUserId, setToAssetUserId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<AssetSearchResult[] | null>(null);
  const [queue, setQueue] = useState<QueuedAsset[]>([]);
  const [queueSearch, setQueueSearch] = useState("");

  const action = BULK_ACTIONS.find((a) => a.eventType === eventType)!;

  const asset_usersQ = useQuery({ queryKey: ["asset_users"], queryFn: () => apiClient.get<Option[]>("/asset-users") });
  const asset_users = asset_usersQ.data ?? [];

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

  // Apply always acts on the FULL queue's eligible assets, never the
  // filtered/sorted view below -- searching/sorting the queue only changes
  // what's displayed while scanning, never what gets submitted.
  const eligibleQueue = queue.filter((a) => a.eligible);

  const queueSearchLower = queueSearch.trim().toLowerCase();
  const filteredQueue = queueSearchLower
    ? queue.filter((a) =>
        [a.asset_code, a.description, a.current_asset_user_name, a.status]
          .some((v) => (v ?? "").toLowerCase().includes(queueSearchLower)),
      )
    : queue;
  const { sortedRows: sortedQueue, sort: queueSort, toggleSort: toggleQueueSort } = useTableSort<QueuedAsset>(filteredQueue, {
    asset_code: (a) => a.asset_code,
    description: (a) => a.description,
    asset_user: (a) => a.current_asset_user_name,
    status: (a) => a.status,
  });

  function QueueSortButton({ label, sortKey }: { label: string; sortKey: string }) {
    const Icon = queueSort?.key !== sortKey ? ChevronsUpDown : queueSort.direction === "asc" ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => toggleQueueSort(sortKey)}
        aria-label={`Sort queue by ${label}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${queueSort?.key === sortKey ? "" : "opacity-40"}`} aria-hidden="true" />
      </button>
    );
  }
  const canApply =
    eligibleQueue.length > 0 &&
    (!action.needsAssetUser || toAssetUserId !== "");

  const applyMutation = useMutation({
    mutationFn: () =>
      apiClient.post<BulkActionResult>("/assets/bulk-action", {
        asset_ids: eligibleQueue.map((a) => a.id),
        event_type: eventType,
        to_asset_user_id: action.needsAssetUser ? Number(toAssetUserId) : null,
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
    setToAssetUserId("");
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

        {action.needsAssetUser && (
          <FormField htmlFor="movement-asset-user" label="Destination Asset User" required>
            <SearchableSelect
              id="movement-asset-user"
              aria-label="Destination Asset User"
              value={selectValue(toAssetUserId)}
              onValueChange={setToAssetUserId}
              options={asset_users.map((h) => ({ value: String(h.id), label: h.name, keywords: assetUserKeywords(h) }))}
            />
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
                <Button type="button" variant="ghost" size="sm" className="w-full flex-col items-start" onClick={() => addToQueue(a)}>
                  <span className="flex items-center gap-1.5">
                    {a.asset_code} — {a.description} ({a.serial_number ?? "no serial"})
                    {isNotInItStock(a.current_asset_user_type) && (
                      <Badge variant="outline" className="border-transparent bg-warning-soft text-on-warning-soft px-1.5 py-0 text-[10px] font-medium">
                        Not in IT Stock
                      </Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    AssetUser: {a.current_asset_user_name ?? "—"} ({a.current_asset_user_location_name ?? "—"}) · Status: {a.status}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Queued ({queue.length}){eligibleQueue.length !== queue.length && ` — ${eligibleQueue.length} eligible`}
          </h2>
          {queue.length > 1 && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Sort:</span>
              <QueueSortButton label="Code" sortKey="asset_code" />
              <QueueSortButton label="Description" sortKey="description" />
              <QueueSortButton label="Asset User" sortKey="SELF_SERVICE" />
              <QueueSortButton label="Status" sortKey="status" />
            </div>
          )}
        </div>
        {queue.length > 1 && (
          <Input
            aria-label="Search queued assets"
            placeholder="Search queued assets…"
            value={queueSearch}
            onChange={(e) => setQueueSearch(e.target.value)}
            className="mb-2 max-w-sm"
          />
        )}
        {queue.length === 0 ? (
          <EmptyState title="Nothing scanned yet." description="Scan or type a Serial Number/Asset Code above to add assets here." />
        ) : sortedQueue.length === 0 ? (
          <EmptyState title="No matches" description="Try a different search." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sortedQueue.map((a) => {
              const notInStock = isNotInItStock(a.current_asset_user_type);
              return (
              <li
                key={a.id}
                className={`flex items-center justify-between gap-2 rounded-sm border px-2 py-1.5 text-sm ${
                  !a.eligible
                    ? "border-destructive/50 bg-destructive/5"
                    : notInStock
                      ? "border-warning/50 bg-warning-soft"
                      : "bg-muted/40"
                }`}
              >
                <div className="flex flex-col">
                  <span className="flex items-center gap-1.5 font-medium">
                    {a.asset_code} — {a.description} ({a.serial_number ?? "no serial"})
                    {notInStock && (
                      <Badge variant="outline" className="border-transparent bg-warning-soft text-on-warning-soft px-1.5 py-0 text-[10px] font-medium">
                        Not in IT Stock
                      </Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    AssetUser: {a.current_asset_user_name ?? "—"} ({a.current_asset_user_location_name ?? "—"}) · Status: {a.status}
                    {!a.eligible && ` · not eligible for "${action.label}" from this status`}
                  </span>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeFromQueue(a.id)}>
                  Remove
                </Button>
              </li>
              );
            })}
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
