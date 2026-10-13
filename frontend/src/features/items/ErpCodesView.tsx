import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Item } from "./types";
import { CodeStatus, type CodeDecisionRow } from "./CodeDecisionRows";
import { useErpCodes } from "./useErpCodes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ItemFormDialog } from "./ItemFormDialog";
import { useCanCreate } from "@/lib/capabilities";
import { itemOptions as buildItemOptions } from "@/lib/option-labels";
import { useCategoryLookups } from "@/lib/lookups";

type Tab = "undecided" | "linked" | "untracked" | "all";

const SHOWN = 300;
const BATCH = 20;
const units = (n: number) => Math.round(n).toLocaleString("en-IN");
const ALL_DEPARTMENTS = "__all__";

/**
 * Every ERP item code (barcode) bought by one company, ONE ROW EACH, never bundled by Article. Filter, tick any codes
 * (from any Article or Department) and link them to one Item, or mark them not tracked. Each decision is made for the
 * code itself; "also for new codes of these Articles" is an explicit extra, off unless ticked.
 */
export function ErpCodesView({ companyId, items, fixedItem }: { companyId?: string; items: Item[]; fixedItem?: Item }) {
  const qc = useQueryClient();
  const canCreate = useCanCreate("item");
  const [tab, setTab] = useState<Tab>("undecided");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState<string>(ALL_DEPARTMENTS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickedItem, setBulkItem] = useState<string | undefined>();
  // Opened from an Item ("Add codes"): every ticked code goes to that Item, so there is nothing to choose.
  const bulkItem = fixedItem ? String(fixedItem.id) : pickedItem;
  const [alsoArticles, setAlsoArticles] = useState(false);
  const [newItem, setNewItem] = useState(false);

  const codesQ = useErpCodes(companyId);
  const all = codesQ.data ?? [];
  // "Laptop · IT Fixed Assets": the Category tells two similar Items apart.
  const categoryLookups = useCategoryLookups();
  const itemOptions = buildItemOptions(items, categoryLookups);

  const state = (c: CodeDecisionRow): Tab => (c.not_tracked ? "untracked" : c.item_id !== null ? "linked" : "undecided");
  const count = {
    undecided: all.filter((c) => state(c) === "undecided").length,
    linked: all.filter((c) => state(c) === "linked").length,
    untracked: all.filter((c) => state(c) === "untracked").length,
  };
  const departments = useMemo(() => {
    const n = new Map<string, number>();
    all.forEach((c) => n.set(c.department, (n.get(c.department) ?? 0) + 1));
    return [...n.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [all]);

  const needle = search.trim().toLowerCase();
  const filtered = all.filter((c) => {
    if (department !== ALL_DEPARTMENTS && c.department !== department) return false;
    if (needle) {
      return [c.icode, c.name, c.description, c.article_name, c.department, c.item_name ?? ""].some((v) => v.toLowerCase().includes(needle));
    }
    return tab === "all" || state(c) === tab;
  });
  const shown = filtered.slice(0, SHOWN);
  const chosen = all.filter((c) => selected.has(c.icode));
  const allOn = filtered.length > 0 && filtered.every((c) => selected.has(c.icode));
  const toggle = (code: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(code); else next.delete(code);
      return next;
    });

  const company = companyId ? { company_id: Number(companyId) } : {};
  const codeRule = (c: CodeDecisionRow) => ({
    match_type: "CODE", erp_item_code: c.icode, article_key: c.article_key, article_name: c.article_name, section: c.section, department: c.department, ...company,
  });
  const articleRule = (c: CodeDecisionRow) => ({
    match_type: "ARTICLE", article_key: c.article_key, article_name: c.article_name, section: c.section, department: c.department, ...company,
  });
  const done = () => qc.invalidateQueries({ queryKey: ["items"] });
  const decide = useMutation({
    mutationFn: async ({ rows, itemId, withArticles }: { rows: CodeDecisionRow[]; itemId: number | null; withArticles: boolean }) => {
      const body = (rule: object) => (itemId === null ? { not_tracked: true, ...rule } : { item_id: itemId, ...rule });
      const bodies = rows.map((c) => body(codeRule(c)));
      if (withArticles) {
        const seen = new Set<string>();
        rows.forEach((c) => {
          if (!seen.has(c.article_key)) { seen.add(c.article_key); bodies.push(body(articleRule(c))); }
        });
      }
      for (let i = 0; i < bodies.length; i += BATCH) {
        await Promise.all(bodies.slice(i, i + BATCH).map((b) => apiClient.post("/items/maps", b)));
      }
    },
    onSuccess: () => {
      setSelected(new Set());
      done();
    },
  });
  const undo = useMutation({
    mutationFn: (c: CodeDecisionRow) => apiClient.delete(`/items/maps/${c.map_id}`),
    onSuccess: done,
  });
  const failure = [decide, undo].find((m) => m.isError)?.error;

  const tabButton = (key: Tab, label: string, n: number) => (
    <Button key={key} size="sm" variant={tab === key ? "default" : "outline"} onClick={() => setTab(key)}>{label} ({n})</Button>
  );

  const columns: DataTableColumn<CodeDecisionRow>[] = [
    {
      key: "pick", header: (
        <Checkbox
          aria-label="Select all shown codes" checked={allOn}
          onCheckedChange={(v) => setSelected(v === true ? new Set([...selected, ...filtered.map((c) => c.icode)]) : new Set([...selected].filter((k) => !filtered.some((c) => c.icode === k))))}
        />
      ),
      cell: (c) => <Checkbox aria-label={`Select code ${c.icode}`} checked={selected.has(c.icode)} onCheckedChange={(v) => toggle(c.icode, v === true)} />,
    },
    { key: "code", header: "Code", cellClassName: "font-mono text-xs", cell: (c) => c.icode },
    {
      key: "product", header: "Product", cell: (c) => (
        <div className="min-w-0 max-w-md">
          <p className="truncate font-medium">{c.name || "(no product name)"}</p>
          <p className="truncate text-xs text-muted-foreground">{c.description}</p>
        </div>
      ),
    },
    {
      key: "article", header: "Article", cell: (c) => (
        <div className="min-w-0">
          <p className="truncate text-xs">{c.article_name}</p>
          <p className="truncate text-xs text-muted-foreground">{c.department}</p>
        </div>
      ),
    },
    { key: "units", header: "Units", cellClassName: "tabular-nums", cell: (c) => units(c.units) },
    { key: "status", header: "Now", cell: (c) => <CodeStatus c={c} /> },
    {
      key: "undo", header: "", cell: (c) =>
        c.matched_by === "CODE" ? (
          <Button size="sm" variant="ghost" aria-label={`Undo ${c.icode}`} disabled={undo.isPending} onClick={() => undo.mutate(c)}>Undo</Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search codes" placeholder="Search code, product, Article, Department, Item…" className="max-w-sm"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <div className="w-60">
          <SearchableSelect
            id="codes-department" aria-label="Department" value={department} onValueChange={setDepartment}
            options={[{ value: ALL_DEPARTMENTS, label: `All departments (${all.length})` }, ...departments.map(([d, n]) => ({ value: d, label: `${d} (${n})` }))]}
          />
        </div>
        {tabButton("undecided", "Not decided", count.undecided)}
        {tabButton("linked", "Linked", count.linked)}
        {tabButton("untracked", "Not tracked", count.untracked)}
        {tabButton("all", "All", all.length)}
      </div>
      <p className="text-xs text-muted-foreground">
        Every barcode is its own row. Tick the ones that are the same thing (from any Article or Department), choose the Item, and link them together.
        A search looks at every code, whatever its state.
      </p>

      {selected.size > 0 && (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" role="region" aria-label="Selected codes">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{selected.size} code{selected.size === 1 ? "" : "s"} selected</span>
            {!fixedItem && (
              <div className="w-60">
                <SearchableSelect
                  id="codes-bulk-item" aria-label="Item for the selected codes" value={bulkItem} onValueChange={setBulkItem} options={itemOptions} placeholder="Choose the Item"
                  onCreateNew={canCreate ? () => setNewItem(true) : undefined} createLabel="New Item…"
                />
              </div>
            )}
            <Button size="sm" disabled={!bulkItem || decide.isPending} onClick={() => decide.mutate({ rows: chosen, itemId: Number(bulkItem), withArticles: alsoArticles })}>
              {fixedItem ? `Link ${selected.size} to ${fixedItem.name}` : `Link ${selected.size} to this Item`}
            </Button>
            {!fixedItem && (
              <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ rows: chosen, itemId: null, withArticles: alsoArticles })}>
                Mark {selected.size} not tracked
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox aria-label="Also for new codes of these Articles" checked={alsoArticles} onCheckedChange={(v) => setAlsoArticles(v === true)} />
            Also for every other and future code of the Articles these codes belong to (leave unticked to decide only the codes you ticked)
          </label>
        </div>
      )}
      {failure && (
        <p className="text-sm text-destructive" role="alert">{failure instanceof Error ? failure.message : "That did not work."}</p>
      )}

      {codesQ.isError ? (
        <ErrorState message={codesQ.error instanceof Error ? codesQ.error.message : "Couldn't read the ERP codes."} onRetry={() => codesQ.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns} rows={shown} rowKey={(c) => c.icode} isLoading={codesQ.isLoading}
            emptyState={
              <EmptyState
                title={tab === "undecided" && !needle && department === ALL_DEPARTMENTS ? "Every bought code has been decided." : "No codes match."}
                description={items.length === 0 ? "Create some Items first (Settings › Catalogue › Items)." : undefined}
              />
            }
          />
          {filtered.length > SHOWN && (
            <p className="text-xs text-muted-foreground">
              Showing the first {SHOWN} of {filtered.length} codes. Narrow it with the search, the Department or a tab; the tick box in the header selects all {filtered.length}.
            </p>
          )}
        </>
      )}

      <ItemFormDialog open={newItem} onOpenChange={setNewItem} onSaved={(saved) => setBulkItem(String(saved.id))} />
    </div>
  );
}
