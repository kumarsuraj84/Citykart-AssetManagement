import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useKeyedMutation } from "@/lib/submit-key";
import { Link } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAccess } from "@/lib/access";
import { itemOptions } from "@/lib/option-labels";
import { useCategoryLookups } from "@/lib/lookups";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { useDebounced } from "../purchase-orders/po-list";
import { problemsFrom } from "../receive/receive-model";
import type { Item } from "./types";

/** Why an Item is suggested (server reason codes) in plain words. */
export const REASON_WORDS: Record<string, string> = {
  ERP_CODE: "same ERP code",
  DESCRIPTION: "similar description",
  GROUP: "same group",
};

export interface Suggestion {
  item_id: number;
  item_name: string;
  score: number;
  reason: string;
}

export interface UnlinkedAsset {
  asset_id: number;
  asset_code: string;
  description: string;
  model?: string | null;
  serial_number: string | null;
  erp_item_code?: string | null;
  status?: string;
  company_code?: string | null;
  category_id: number | null;
  category_name: string | null;
  subcategory_id: number | null;
  subcategory_name: string | null;
  holder_name?: string | null;
  holder_kind_label?: string | null;
  suggestions: Suggestion[];
}

interface LinkProblem {
  entry_index?: number;
  asset_id?: number;
  item_id?: number;
  message: string;
}

interface Staged {
  asset_id: number;
  asset_code: string;
  item_id: number;
  item_name: string;
}

const PAGE = 50;
const SHOWN_IN_CONFIRM = 10;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
const groupOf = (a: Pick<UnlinkedAsset, "category_name" | "subcategory_name">) =>
  [a.category_name, a.subcategory_name].filter(Boolean).join(" › ") || "No group";

/** "Laptop — same ERP code" */
export function suggestionText(s: Suggestion): string {
  return `${s.item_name} — ${REASON_WORDS[s.reason] ?? "suggested"}`;
}

/** Items an asset may be linked to: those of its own asset group (the server checks this too). */
export function itemsOfGroup(items: Item[], rows: Pick<UnlinkedAsset, "category_id" | "subcategory_id">[]): Item[] {
  return items.filter((i) =>
    i.is_active !== false &&
    rows.every((r) => r.category_id == null || (i.category_id === r.category_id && (r.subcategory_id == null || i.subcategory_id === r.subcategory_id))),
  );
}

/**
 * Settings › Catalogue › Link existing assets to Items (S5b-1). Assets made
 * before Items existed have none; the server suggests one (same ERP code /
 * similar description / the only Item of its group) but never applies it.
 * Pick per row or for many at once; everything is confirmed first, and the
 * link changes only the Item -- never the group, status or place.
 */
export function LinkAssetsScreen() {
  const qc = useQueryClient();
  // The Items screen is in Settings (head-office admin); an ordinary admin gets no dead link.
  const canOpenItems = useAccess().can("settings");
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const [pageState, setPageState] = useState({ q: "", page: 0 });
  const page = pageState.q === q ? pageState.page : 0;
  const [selected, setSelected] = useState<number[]>([]);
  const [staged, setStaged] = useState<Map<number, Staged>>(new Map());
  const [refusals, setRefusals] = useState<Record<number, string>>({});
  const [summary, setSummary] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [choosing, setChoosing] = useState<UnlinkedAsset[] | null>(null);

  const params = new URLSearchParams({ ...(q ? { q } : {}), limit: String(PAGE), offset: String(page * PAGE) }).toString();
  const listQ = useQuery({
    queryKey: ["assets", "unlinked-items", q, page],
    queryFn: () => apiClient.getPage<UnlinkedAsset[]>(`/assets/unlinked-items?${params}`),
  });
  const rows = Array.isArray(listQ.data?.data) ? listQ.data.data : [];
  const total = listQ.data?.total ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE));
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items"), enabled: choosing !== null });
  const categoryLookups = useCategoryLookups(choosing !== null);

  function stage(entries: Staged[]) {
    setStaged((m) => {
      const next = new Map(m);
      for (const e of entries) next.set(e.asset_id, e);
      return next;
    });
    setRefusals((r) => {
      const next = { ...r };
      for (const e of entries) delete next[e.asset_id];
      return next;
    });
    setSummary(null);
  }
  function unstage(assetId: number) {
    setStaged((m) => {
      const next = new Map(m);
      next.delete(assetId);
      return next;
    });
    setRefusals((r) => {
      const next = { ...r };
      delete next[assetId];
      return next;
    });
  }

  const selectedRows = rows.filter((r) => selected.includes(r.asset_id));
  const withSuggestion = selectedRows.filter((r) => r.suggestions.length > 0);

  function linkSelectedToSuggestions() {
    stage(withSuggestion.map((r) => ({ asset_id: r.asset_id, asset_code: r.asset_code, item_id: r.suggestions[0].item_id, item_name: r.suggestions[0].item_name })));
    setSelected([]);
    setConfirming(true);
  }

  // S7 (P1-2): one "Link" = one Idempotency-Key; a double activation links (and audits) once.
  const linkMutation = useKeyedMutation({
    mutationFn: (entries: Staged[], keyed) => {
      const body = entries.map((e) => ({ asset_id: e.asset_id, item_id: e.item_id }));
      return keyed(body, () => apiClient.post<{ linked: number; unchanged: number }>("/assets/link-items", body));
    },
    onSuccess: (r, entries) => {
      setConfirming(false);
      setStaged(new Map());
      setRefusals({});
      setSelected([]);
      const linked = typeof r?.linked === "number" ? r.linked : entries.length;
      const same = typeof r?.unchanged === "number" ? r.unchanged : 0;
      setSummary({
        tone: "ok",
        text: `Linked ${plural(linked, "asset")} to ${linked === 1 ? "its Item" : "their Items"}.` + (same > 0 ? ` ${plural(same, "was", "were")} already linked to that Item.` : ""),
      });
      qc.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (err, entries) => {
      setConfirming(false);
      const problems = problemsFrom<LinkProblem>(err);
      if (problems && problems.length > 0) {
        const byAsset: Record<number, string> = {};
        for (const p of problems) {
          const id = p.asset_id ?? (p.entry_index != null ? entries[p.entry_index]?.asset_id : undefined);
          if (id != null) byAsset[id] = p.message;
        }
        setRefusals(byAsset);
        setSummary({ tone: "bad", text: `Nothing was linked: ${plural(problems.length, "problem needs", "problems need")} fixing, marked on the rows below.` });
      } else {
        setSummary({ tone: "bad", text: err instanceof Error ? err.message : "Nothing was linked. Please try again." });
      }
    },
  });

  const stagedList = [...staged.values()];
  const refusedElsewhere = Object.entries(refusals)
    .map(([id, message]) => ({ id: Number(id), message }))
    .filter((r) => !rows.some((row) => row.asset_id === r.id));

  return (
    <div className="flex flex-col gap-4 pb-16">
      <PageHeader
        title="Link existing assets to Items"
        description="Assets added before Items existed have no Item yet. Pick each one's Item (suggestions help); nothing is linked until you confirm, and linking never changes an asset's group, status or place."
        actions={canOpenItems ? <Button asChild variant="outline" size="sm"><Link to="/settings/catalogue/items">Items</Link></Button> : undefined}
      />

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search" aria-label="Search unlinked assets" placeholder="Asset code, description or serial…"
          className="pl-8" value={text} onChange={(e) => setText(e.target.value)}
        />
      </div>

      {summary && (
        <p className={cn("text-sm", summary.tone === "ok" ? "text-on-success-soft" : "font-medium text-destructive")} role={summary.tone === "ok" ? "status" : "alert"}>
          {summary.text}
        </p>
      )}
      {refusedElsewhere.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-destructive" aria-label="Refused on other pages">
          {refusedElsewhere.map((r) => <li key={r.id}>{staged.get(r.id)?.asset_code ?? `Asset ${r.id}`}: {r.message}</li>)}
        </ul>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2" aria-label="Selected assets">
          <span className="text-sm">{selected.length} selected</span>
          <Button size="sm" disabled={withSuggestion.length === 0} onClick={linkSelectedToSuggestions}>
            Link {withSuggestion.length} to their suggested Item
          </Button>
          <Button size="sm" variant="outline" onClick={() => setChoosing(selectedRows)}>
            Link {selected.length} to one Item…
          </Button>
          {withSuggestion.length < selectedRows.length && (
            <span className="text-xs text-muted-foreground">
              {plural(selectedRows.length - withSuggestion.length, "has", "have")} no suggestion; choose their Item yourself.
            </span>
          )}
        </div>
      )}

      {listQ.isError ? (
        <ErrorState message="Couldn't load the assets without an Item." onRetry={() => listQ.refetch()} />
      ) : listQ.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState title={q ? `No asset without an Item matches “${q}”.` : "Every asset is linked to an Item."} />
      ) : (
        <div className="flex flex-col rounded-md border">
          <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Checkbox
              aria-label="Select all"
              checked={rows.every((r) => selected.includes(r.asset_id))}
              onCheckedChange={(c) => setSelected(c === true ? rows.map((r) => r.asset_id) : [])}
            />
            <span>{plural(total, "asset")} without an Item</span>
          </div>
          <ul className="divide-y" aria-label="Assets without an Item">
            {rows.map((r) => {
              const chosen = staged.get(r.asset_id);
              const refusal = refusals[r.asset_id];
              const top = r.suggestions[0];
              return (
                <li key={r.asset_id} className={cn("flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-start", refusal && "bg-destructive/5")} aria-label={r.asset_code}>
                  <div className="flex min-w-0 flex-1 gap-2">
                    <Checkbox
                      className="mt-0.5"
                      aria-label={`Select ${r.asset_code}`}
                      checked={selected.includes(r.asset_id)}
                      onCheckedChange={(c) => setSelected((s) => (c === true ? [...s, r.asset_id] : s.filter((x) => x !== r.asset_id)))}
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <Link to="/assets/$id" params={{ id: String(r.asset_id) }} className="font-mono text-sm underline-offset-2 hover:underline">{r.asset_code}</Link>
                        {r.serial_number && <span className="font-mono text-xs text-muted-foreground">{r.serial_number}</span>}
                      </div>
                      <span className="truncate text-sm text-muted-foreground">{r.description}</span>
                      <span className="text-xs text-muted-foreground">Group: {groupOf(r)}</span>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5 md:w-[26rem] md:shrink-0">
                    {chosen ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span>→ <span className="font-medium">{chosen.item_name}</span></span>
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => unstage(r.asset_id)} aria-label={`Undo ${r.asset_code}`}>
                          <X className="h-3.5 w-3.5" aria-hidden="true" /> Undo
                        </Button>
                      </div>
                    ) : (
                      <>
                        {r.suggestions.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5" aria-label={`Suggestions for ${r.asset_code}`}>
                            {r.suggestions.map((s) => (
                              <button
                                key={s.item_id}
                                type="button"
                                title={`How sure: ${Math.round(s.score * 100)}%`}
                                onClick={() => stage([{ asset_id: r.asset_id, asset_code: r.asset_code, item_id: s.item_id, item_name: s.item_name }])}
                                className="rounded-full border bg-background px-2.5 py-0.5 text-xs hover:bg-muted"
                              >
                                {suggestionText(s)} <span className="text-muted-foreground">· {Math.round(s.score * 100)}%</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No suggestion.</span>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {top && (
                            <Button size="sm" className="h-7" onClick={() => stage([{ asset_id: r.asset_id, asset_code: r.asset_code, item_id: top.item_id, item_name: top.item_name }])}>
                              Use {top.item_name}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="h-7" onClick={() => setChoosing([r])}>
                            Choose another Item…
                          </Button>
                        </div>
                      </>
                    )}
                    {refusal && <p className="text-xs text-destructive" role="alert">{refusal}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          {pageCount > 1 && (
            <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
              <span>Page {page + 1} of {pageCount}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => { setPageState({ q, page: page - 1 }); setSelected([]); }}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page + 1 >= pageCount} onClick={() => { setPageState({ q, page: page + 1 }); setSelected([]); }}>Next</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {stagedList.length > 0 && (
        <div className="sticky bottom-0 z-20 -mx-4 -mb-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-2.5 backdrop-blur sm:flex-row sm:items-center sm:justify-between md:-mx-6 md:-mb-6 md:px-6">
          <p className="text-sm" role="status">{plural(stagedList.length, "link")} ready to confirm.</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setStaged(new Map()); setRefusals({}); }}>Clear</Button>
            <Button size="sm" onClick={() => setConfirming(true)}>Review and link {stagedList.length}</Button>
          </div>
        </div>
      )}

      <ConfirmLinkDialog
        open={confirming && stagedList.length > 0}
        entries={stagedList}
        pending={linkMutation.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => linkMutation.mutate(stagedList)}
      />

      <ChooseItemDialog
        rows={choosing}
        items={itemsQ.data ?? []}
        loading={itemsQ.isLoading}
        categoryLookups={categoryLookups}
        onClose={() => setChoosing(null)}
        onChosen={(item) => {
          const forRows = choosing ?? [];
          stage(forRows.map((r) => ({ asset_id: r.asset_id, asset_code: r.asset_code, item_id: item.id, item_name: item.name })));
          setChoosing(null);
          if (forRows.length > 1) {
            setSelected([]);
            setConfirming(true);
          }
        }}
      />
    </div>
  );
}

function ConfirmLinkDialog({ open, entries, pending, onCancel, onConfirm }: {
  open: boolean;
  entries: Staged[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const n = entries.length;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link {plural(n, "asset")} to Items?</DialogTitle>
          <DialogDescription>
            Link {plural(n, "asset")} to Items. This does not change their group, status or place.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto text-sm" aria-label="Links to make">
          {entries.slice(0, SHOWN_IN_CONFIRM).map((e) => (
            <li key={e.asset_id}><span className="font-mono text-xs">{e.asset_code}</span> → {e.item_name}</li>
          ))}
        </ul>
        {n > SHOWN_IN_CONFIRM && <p className="text-xs text-muted-foreground">and {n - SHOWN_IN_CONFIRM} more</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <AsyncButton onClick={onConfirm} pending={pending} pendingLabel="Linking…">Link {n}</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChooseItemDialog({ rows, items, loading, categoryLookups, onClose, onChosen }: {
  rows: UnlinkedAsset[] | null;
  items: Item[];
  loading: boolean;
  categoryLookups: ReturnType<typeof useCategoryLookups>;
  onClose: () => void;
  onChosen: (item: Item) => void;
}) {
  const [itemId, setItemId] = useState("");
  const list = Array.isArray(items) ? items : [];
  const fitting = useMemo(() => (rows ? itemsOfGroup(list, rows) : []), [rows, list]);
  const groups = rows ? [...new Set(rows.map(groupOf))] : [];
  const chosen = fitting.find((i) => String(i.id) === itemId);
  const n = rows?.length ?? 0;
  return (
    <Dialog open={rows !== null} onOpenChange={(o) => { if (!o) { setItemId(""); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{n === 1 ? `Choose the Item for ${rows?.[0].asset_code}` : `Link ${n} assets to one Item`}</DialogTitle>
          <DialogDescription>
            Only Items of the same asset group are offered ({groups.join("; ")}).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="link-item">Item</Label>
          <SearchableSelect
            id="link-item" aria-label="Item" value={itemId || undefined} onValueChange={setItemId}
            options={itemOptions(fitting, categoryLookups)} placeholder={loading ? "Loading…" : "Choose the Item"} searchPlaceholder="Search Items…"
            emptyText="No Item of this group."
          />
          {!loading && fitting.length === 0 && (
            <p className="text-xs text-muted-foreground" role="note">
              {groups.length > 1
                ? "These assets are in different groups, so no single Item fits them all. Select assets of one group."
                : "This group has no Item yet. Add one under Settings › Catalogue › Items first."}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setItemId(""); onClose(); }}>Cancel</Button>
          <Button disabled={!chosen} onClick={() => { if (chosen) { setItemId(""); onChosen(chosen); } }}>
            {n === 1 ? "Use this Item" : `Use for ${n} assets`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
