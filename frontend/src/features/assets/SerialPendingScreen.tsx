import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { cn } from "@/lib/utils";
import { useDebounced } from "../purchase-orders/po-list";
import { serialConflictSentence } from "../purchase-orders/serial-conflict";
import { SerialBox } from "../receive/SerialBox";
import { useSerialConflicts } from "../receive/useSerialConflicts";
import { andNumbers, problemsFrom, serialEntries } from "../receive/receive-model";

interface PendingRow {
  id: number;
  asset_code: string;
  description: string;
  item_id?: number | null;
  item_name: string | null;
  category_name: string | null;
  subcategory_name: string | null;
  current_asset_user_name: string | null;
  current_asset_user_location_name: string | null;
  po_number?: string | null;
  purchase_date: string;
  status: string;
}

/** One refused entry of PUT /assets/serials (entry_index is 1-based). */
interface BulkProblem {
  entry_index: number;
  asset_id: number;
  serial?: string;
  message: string;
}

const ALL = "__all__";
const daysSince = (isoDate: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000));
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/**
 * Assets whose serial is still to be read and filled in (an amplifier shows none on
 * the box; it is read in the store once opened). The IT person who got the serial from
 * the store types it here -- one row at a time, or (S4) for many at once: tick the
 * rows, paste the serials in the same order, check the preview, save all together
 * (PUT /assets/serials: every one is saved, or none). Nothing is blocked while it
 * waits: the asset can be moved, allotted and installed as usual.
 */
export function SerialPendingScreen() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [itemFilter, setItemFilter] = useState(ALL);
  const [poFilter, setPoFilter] = useState(ALL);
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<number[]>([]);
  const [paste, setPaste] = useState("");
  const [confirmNoSerial, setConfirmNoSerial] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["assets", "serial-pending"],
    queryFn: () => apiClient.get<{ items: PendingRow[]; total: number }>("/assets?serial_pending=true&limit=200"),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["assets"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }

  const fillMutation = useMutation({
    mutationFn: (v: { id: number; serial: string | null }) =>
      apiClient.put(`/assets/${v.id}/serial`, v.serial === null ? { no_serial: true } : { serial_number: v.serial }),
    onSuccess: (_r, v) => {
      setErrors((e) => { const { [v.id]: _drop, ...rest } = e; return rest; });
      setTyped((t) => { const { [v.id]: _drop, ...rest } = t; return rest; });
      setSelected((s) => s.filter((id) => id !== v.id));
      refresh();
    },
    onError: (err, v) => setErrors((e) => ({ ...e, [v.id]: err instanceof Error ? err.message : "Could not save the serial." })),
  });

  const allRows = useMemo(
    () => (listQ.data?.items ?? []).slice().sort((a, b) => a.purchase_date.localeCompare(b.purchase_date)), // oldest first: waiting longest
    [listQ.data],
  );
  const itemChoices = [...new Set(allRows.map((r) => r.item_name).filter((v): v is string => !!v))].sort();
  const poChoices = [...new Set(allRows.map((r) => r.po_number).filter((v): v is string => !!v))].sort();

  const needle = search.trim().toLowerCase();
  const rows = allRows.filter((r) =>
    (itemFilter === ALL || r.item_name === itemFilter) &&
    (poFilter === ALL || r.po_number === poFilter) &&
    (!needle ||
      [r.asset_code, r.description, r.item_name ?? "", r.current_asset_user_name ?? "", r.current_asset_user_location_name ?? "", r.po_number ?? ""]
        .some((v) => v.toLowerCase().includes(needle))),
  );
  // Selection follows the filters: a hidden row is never filled by the paste.
  function filterChange<T>(set: (v: T) => void) {
    return (v: T) => { set(v); setSelected([]); setConfirmNoSerial(false); };
  }

  // The ticked assets, in list order: serial row i goes to the i-th of these.
  const targets = rows.filter((r) => selected.includes(r.id));
  const settledPaste = useDebounced(paste, 150);
  const entries = useMemo(() => serialEntries(settledPaste), [settledPaste]);
  const conflicts = useSerialConflicts(useMemo(() => [...new Set(entries.map((e) => e.value))].filter((v) => v.toLowerCase() !== "n/a"), [entries]), targets.length > 0);

  // Rows typed twice in the paste (any letter case), and serials CKAM already has.
  const { badRows, messages } = useMemo(() => {
    const bad = new Map<number, string>();
    const msgs: string[] = [];
    const byKey = new Map<string, number[]>();
    for (const e of entries) {
      const k = e.value.toLowerCase();
      if (k === "n/a") continue;
      byKey.set(k, [...(byKey.get(k) ?? []), e.row]);
    }
    for (const [k, rowsOf] of byKey) {
      if (rowsOf.length < 2) continue;
      const value = entries.find((e) => e.value.toLowerCase() === k)!.value;
      const m = `${value} is typed more than once (rows ${andNumbers(rowsOf)}).`;
      msgs.push(m);
      for (const r of rowsOf) bad.set(r, m);
    }
    for (const e of entries) {
      const code = conflicts[e.value.toLowerCase()];
      if (code === undefined) continue;
      const m = `Row ${e.row}: ${serialConflictSentence(e.value, code)}`;
      msgs.push(m);
      bad.set(e.row, m);
    }
    // A refused save: the row of each refused asset.
    targets.forEach((t, i) => {
      if (errors[t.id] && entries[i]) bad.set(entries[i].row, errors[t.id]);
    });
    return { badRows: bad, messages: msgs };
  }, [entries, conflicts, targets, errors]);

  const countProblem = targets.length > 0 && entries.length !== targets.length
    ? entries.length > targets.length
      ? `${plural(entries.length - targets.length, "serial")} too many: ${targets.length} selected, ${entries.length} pasted.`
      : `${plural(targets.length, "serial")} needed, ${entries.length} pasted.`
    : null;
  const canSaveBulk = targets.length > 0 && entries.length === targets.length && messages.length === 0;

  const bulkMutation = useMutation({
    mutationFn: (body: { entries: ({ asset_id: number; serial_number: string } | { asset_id: number; no_serial: true })[] }) =>
      apiClient.put<{ updated: number }>("/assets/serials", body),
    onSuccess: (r, body) => {
      const n = typeof r?.updated === "number" ? r.updated : body.entries.length;
      const noSerial = body.entries.every((e) => "no_serial" in e);
      setNotice(noSerial ? `${plural(n, "asset")} marked as having no serial number.` : `${plural(n, "serial number")} saved.`);
      const done = new Set(body.entries.map((e) => e.asset_id));
      setErrors((e) => Object.fromEntries(Object.entries(e).filter(([id]) => !done.has(Number(id)))));
      setSelected([]);
      setPaste("");
      setConfirmNoSerial(false);
      setBulkError(null);
      refresh();
    },
    onError: (err) => {
      const problems = problemsFrom<BulkProblem>(err);
      if (problems && problems.length > 0) {
        setErrors((e) => ({ ...e, ...Object.fromEntries(problems.map((p) => [p.asset_id, p.message])) }));
        setBulkError(`Nothing was saved: ${plural(problems.length, "problem needs", "problems need")} fixing, marked below.`);
      } else {
        setBulkError(err instanceof Error ? err.message : "Nothing was saved. Please try again.");
      }
      setConfirmNoSerial(false);
    },
  });

  function saveBulk() {
    const fresh = serialEntries(paste);
    if (!canSaveBulk || fresh.length !== targets.length) return;
    setNotice(null);
    setErrors({});
    bulkMutation.mutate({ entries: targets.map((t, i) => ({ asset_id: t.id, serial_number: fresh[i].value })) });
  }
  function markNoSerial() {
    setNotice(null);
    setErrors({});
    bulkMutation.mutate({ entries: targets.map((t) => ({ asset_id: t.id, no_serial: true as const })) });
  }

  const columns: DataTableColumn<PendingRow>[] = [
    {
      key: "code", header: "Asset", cell: (r) => (
        <div className="min-w-0">
          <Link to="/assets/$id" params={{ id: String(r.id) }} className="font-mono text-xs underline" onClick={(e) => e.stopPropagation()}>{r.asset_code}</Link>
          <p className="truncate">{r.item_name ?? r.description}</p>
          {r.item_name && <p className="truncate text-xs text-muted-foreground">{r.description}</p>}
        </div>
      ),
    },
    { key: "class", header: "Category › Sub-category", cell: (r) => [r.category_name, r.subcategory_name].filter(Boolean).join(" › ") },
    { key: "po", header: "PO", cell: (r) => r.po_number ?? "—" },
    {
      key: "holder", header: "Now with", cell: (r) => (
        <div className="min-w-0">
          <p className="truncate">{r.current_asset_user_name ?? "—"}</p>
          {r.current_asset_user_location_name && <p className="truncate text-xs text-muted-foreground">{r.current_asset_user_location_name}</p>}
        </div>
      ),
    },
    { key: "waiting", header: "Waiting", cellClassName: "tabular-nums", cell: (r) => `${daysSince(r.purchase_date)} days` },
    {
      key: "serial", header: "Serial number", cell: (r) => (
        <div className="flex min-w-64 flex-col gap-1">
          <div className="flex items-center gap-1">
            <Input
              aria-label={`Serial for ${r.asset_code}`} value={typed[r.id] ?? ""}
              onChange={(e) => setTyped((t) => ({ ...t, [r.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (typed[r.id] ?? "").trim() && !fillMutation.isPending) fillMutation.mutate({ id: r.id, serial: typed[r.id].trim() });
              }}
            />
            <Button
              size="sm" aria-label={`Save serial for ${r.asset_code}`}
              disabled={!(typed[r.id] ?? "").trim() || fillMutation.isPending}
              onClick={() => fillMutation.mutate({ id: r.id, serial: typed[r.id].trim() })}
            >
              Save
            </Button>
            <Button
              size="sm" variant="outline" aria-label={`No serial for ${r.asset_code}`}
              title="It turns out to have no serial number (saved as N/A)" disabled={fillMutation.isPending}
              onClick={() => fillMutation.mutate({ id: r.id, serial: null })}
            >
              No serial
            </Button>
          </div>
          {errors[r.id] && <p className="text-xs text-destructive" role="alert">{errors[r.id]}</p>}
        </div>
      ),
    },
  ];

  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Serial Pending"
        description="Assets whose serial number is still to be added, for example an amplifier whose serial is only seen once the box is opened in the store. Get the serial from the store and enter it here, one at a time or many at once (tick the rows, then paste). Nothing is held up while it waits: the asset can be moved, allotted and installed as usual."
      />
      <div className="flex flex-wrap items-end gap-3">
        <Input
          aria-label="Search pending serials" placeholder="Search asset, item, PO, store…" className="max-w-sm"
          value={search} onChange={(e) => filterChange(setSearch)(e.target.value)}
        />
        {itemChoices.length > 1 && (
          <SearchableSelect
            id="serial-pending-item" aria-label="Item" className="w-48"
            value={itemFilter} onValueChange={filterChange(setItemFilter)}
            options={[{ value: ALL, label: "All Items" }, ...itemChoices.map((v) => ({ value: v, label: v }))]}
          />
        )}
        {poChoices.length > 1 && (
          <SearchableSelect
            id="serial-pending-po" aria-label="PO" className="w-48"
            value={poFilter} onValueChange={filterChange(setPoFilter)}
            options={[{ value: ALL, label: "All POs" }, ...poChoices.map((v) => ({ value: v, label: v }))]}
          />
        )}
        {listQ.data && <span className="text-sm text-muted-foreground" role="status">{listQ.data.total} waiting</span>}
      </div>

      {notice && <p className="rounded-md border bg-success-soft/50 px-2 py-1.5 text-sm" role="status">{notice}</p>}

      {targets.length > 0 && (
        <section className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3" aria-label="Serials for the selected assets">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="bulk-serials" className="text-sm font-semibold">Paste serials for {plural(targets.length, "selected asset")}</Label>
            <Button size="sm" variant="ghost" onClick={() => { setSelected([]); setConfirmNoSerial(false); }}>Clear selection</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            One serial per line, in the same order as the ticked rows below (row 1 = the first ticked asset). Check the preview, then save them all at once.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-1">
              <SerialBox
                id="bulk-serials"
                label={`Serials for ${plural(targets.length, "selected asset")}`}
                text={paste}
                onChange={(t) => { setPaste(t); setBulkError(null); }}
                badRows={badRows}
                rows={targets.length}
                describedBy="bulk-serials-count"
                placeholder="One serial per line — paste a list or scan."
              />
              <p id="bulk-serials-count" className={cn("text-xs", countProblem || messages.length ? "text-destructive" : "text-muted-foreground")}>
                {entries.length} of {targets.length} entered{countProblem && entries.length > targets.length ? ` — ${entries.length - targets.length} too many` : ""}
              </p>
              {messages.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-xs text-destructive" role="alert" aria-label="Problems with the pasted serials">
                  {messages.map((m) => <li key={m}>{m}</li>)}
                </ul>
              )}
            </div>
            <div className="max-h-72 overflow-auto rounded-md border bg-background">
              <table className="w-full text-sm" aria-label="Preview: which asset gets which serial">
                <thead className="sticky top-0 bg-muted/60 text-xs text-muted-foreground">
                  <tr><th className="px-2 py-1 text-left font-medium">#</th><th className="px-2 py-1 text-left font-medium">Asset</th><th className="px-2 py-1 text-left font-medium">Serial</th></tr>
                </thead>
                <tbody>
                  {targets.map((t, i) => {
                    const e = entries[i];
                    const bad = !!errors[t.id] || (e && badRows.has(e.row));
                    return (
                      <tr key={t.id} className={cn("border-t", bad && "bg-destructive/10 text-destructive")}>
                        <td className="px-2 py-1 tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1 font-mono text-xs">{t.asset_code}</td>
                        <td className="px-2 py-1 font-mono text-xs">{e ? e.value : <span className="text-muted-foreground">—</span>}</td>
                      </tr>
                    );
                  })}
                  {entries.slice(targets.length).map((e) => (
                    <tr key={`extra-${e.row}`} className="border-t bg-destructive/10 text-destructive">
                      <td className="px-2 py-1" />
                      <td className="px-2 py-1 text-xs">No asset for this one</td>
                      <td className="px-2 py-1 font-mono text-xs">{e.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {bulkError && <p className="text-sm font-medium text-destructive" role="alert">{bulkError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <AsyncButton onClick={saveBulk} disabled={!canSaveBulk} pending={bulkMutation.isPending && !confirmNoSerial} pendingLabel="Saving…">
              Save {plural(targets.length, "serial")}
            </AsyncButton>
            {!canSaveBulk && (countProblem || messages.length > 0) && (
              <span className="text-xs text-muted-foreground">{countProblem ?? "Fix the rows marked in red first."}</span>
            )}
            {!confirmNoSerial ? (
              <Button variant="outline" onClick={() => setConfirmNoSerial(true)} disabled={bulkMutation.isPending}>
                Mark {targets.length} as no serial
              </Button>
            ) : (
              <span className="flex flex-wrap items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-2 py-1 text-sm">
                Save {plural(targets.length, "asset")} as having no serial number (N/A)?
                <AsyncButton size="sm" onClick={markNoSerial} pending={bulkMutation.isPending} pendingLabel="Saving…">Yes, mark them</AsyncButton>
                <Button size="sm" variant="ghost" onClick={() => setConfirmNoSerial(false)}>Cancel</Button>
              </span>
            )}
          </div>
        </section>
      )}

      {listQ.isError ? (
        <ErrorState message="Couldn't load the list." onRetry={() => listQ.refetch()} />
      ) : (
        <DataTable
          columns={columns} rows={rows} rowKey={(r) => r.id} isLoading={listQ.isLoading}
          emptyState={<EmptyState title={needle || itemFilter !== ALL || poFilter !== ALL ? "No matches." : "No serial numbers are waiting."} description={needle ? undefined : "Every asset has its serial."} />}
          selection={{
            isSelected: (r) => selected.includes(r.id),
            onToggle: (r, checked) => setSelected((s) => (checked ? [...s, r.id] : s.filter((id) => id !== r.id))),
            isAllSelected: allSelected,
            onToggleAll: (checked) => setSelected(checked ? rows.map((r) => r.id) : []),
            rowAriaLabel: (r) => `Select ${r.asset_code}`,
          }}
        />
      )}
    </div>
  );
}
