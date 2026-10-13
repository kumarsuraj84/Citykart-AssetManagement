import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { ArticleCodeRow, ArticleRow, Item } from "./types";
import { CodeDecisionRows, type CodeDecisionRow } from "./CodeDecisionRows";
import { ErpCodesView } from "./ErpCodesView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ItemFormDialog } from "./ItemFormDialog";
import { ErpGroupsDialog } from "./ErpGroupsDialog";
import { useCanCreateMasters } from "@/components/quick-create/masters";
import { companyOptions, itemOptions as buildItemOptions } from "@/lib/option-labels";
import { useCategoryLookups } from "@/lib/lookups";

const units = (n: number) => Math.round(n).toLocaleString("en-IN");

interface Company {
  id: number;
  name: string;
}

type Tab = "unmapped" | "untracked" | "linked" | "all";

/** Settings › ERP › ERP Mapping (formerly "ERP Articles"). Two views of the same decisions. **Codes** (the main one): every ERP barcode on its own row,
 * never bundled, to tick any of them and link them to one Item or mark them not tracked. **Articles**: a shortcut
 * for a whole family at once (every code under an Article, including new vendor codes, follows it). */
export function ArticleMapScreen() {
  const [view, setView] = useState<"codes" | "articles">("codes");
  const [showGroups, setShowGroups] = useState(false);
  // Each company has its own ERP master (same product, different codes and Articles), so decisions are per company.
  const companiesQ = useQuery({ queryKey: ["masters", "companies"], queryFn: () => apiClient.get<Company[]>("/masters/companies") });
  const companies = Array.isArray(companiesQ.data) ? companiesQ.data : [];
  const [pickedCompany, setPickedCompany] = useState<string | undefined>(undefined);
  const companyId = pickedCompany ?? (companies[0] ? String(companies[0].id) : undefined);
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items") });
  const items = itemsQ.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ERP Mapping"
        description="Advanced mapping rules. Decide what CKAM does with every ERP item code (barcode): link it to an Item, or mark it Not tracked (cables, hangers, sensor tags: purchase orders leave those lines out). In Codes, every barcode is its own row: tick the ones you want and link them to one Item. Each company has its own ERP master, so decide per company. Articles is a shortcut for a whole family at once; Groups… clears a whole Department, Section or Division."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowGroups(true)}>Groups…</Button>
            <Button asChild variant="outline"><Link to="/settings/catalogue/items">Items</Link></Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        {companies.length > 1 && (
          <div className="w-64">
            <SearchableSelect
              id="article-company" aria-label="Company" value={companyId} onValueChange={setPickedCompany}
              options={companyOptions(companies)}
            />
          </div>
        )}
        <Button size="sm" variant={view === "codes" ? "default" : "outline"} aria-pressed={view === "codes"} onClick={() => setView("codes")}>Codes</Button>
        <Button size="sm" variant={view === "articles" ? "default" : "outline"} aria-pressed={view === "articles"} onClick={() => setView("articles")}>Articles</Button>
      </div>
      {companiesQ.isFetched && (view === "codes"
        ? <ErpCodesView key={companyId ?? "all"} companyId={companyId} items={items} />
        : <ArticlesView key={companyId ?? "all"} companyId={companyId} items={items} />)}
      {showGroups && <ErpGroupsDialog companyId={companyId} onClose={() => setShowGroups(false)} />}
    </div>
  );
}

/** The Articles view: one row per ERP Article, decided as a family. */
function ArticlesView({ companyId, items }: { companyId?: string; items: Item[] }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Tab>("unmapped");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<ArticleRow | null>(null);
  // Marking a whole Article not tracked reaches every code in it: ask first.
  const [confirmNt, setConfirmNt] = useState<ArticleRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkItem, setBulkItem] = useState<string | undefined>();
  // An Article whose Item does not exist yet gets it created right here, then linked to it.
  const canCreate = useCanCreateMasters();
  const [newItemFor, setNewItemFor] = useState<ArticleRow | null>(null);

  const articlesQ = useQuery({
    queryKey: ["items", "articles", companyId],
    queryFn: async () =>
      (await apiClient.get<ArticleRow[]>(`/items/articles${companyId ? `?company_id=${companyId}` : ""}`)).map((a) => ({
        ...a, decision: a.decision ?? (a.item_id !== null ? ("ITEM" as const) : null), untracked_rules: a.untracked_rules ?? 0,
      })),
    retry: false,
  });
  // "Laptop · IT Fixed Assets": the Category tells two similar Items apart.
  const categoryLookups = useCategoryLookups();
  const itemOptions = buildItemOptions(items, categoryLookups);

  const company = companyId ? { company_id: Number(companyId) } : {};
  const articleRule = (a: ArticleRow) => ({
    match_type: "ARTICLE", article_key: a.article_key, article_name: a.article_name, section: a.section, department: a.department, ...company,
  });
  const done = () => qc.invalidateQueries({ queryKey: ["items"] });
  const linkMutation = useMutation({
    mutationFn: (a: ArticleRow & { itemId: number }) => apiClient.post("/items/maps", { item_id: a.itemId, ...articleRule(a) }),
    onSuccess: done,
  });
  const notTrackedMutation = useMutation({
    mutationFn: (a: ArticleRow) => apiClient.post("/items/maps", { not_tracked: true, ...articleRule(a) }),
    onSuccess: done,
  });
  const undoMutation = useMutation({
    mutationFn: (a: ArticleRow) => apiClient.delete(`/items/maps/${a.decision_map_id}`),
    onSuccess: done,
  });
  const bulkMutation = useMutation({
    mutationFn: ({ rows, itemId }: { rows: ArticleRow[]; itemId: number | null }) =>
      Promise.all(rows.map((a) => apiClient.post("/items/maps", itemId === null ? { not_tracked: true, ...articleRule(a) } : { item_id: itemId, ...articleRule(a) }))),
    onSuccess: () => {
      setSelected(new Set());
      done();
    },
  });
  const failure = [linkMutation, notTrackedMutation, undoMutation, bulkMutation].find((m) => m.isError)?.error;

  const all = articlesQ.data ?? [];
  const count = {
    unmapped: all.filter((a) => a.decision === null).length,
    untracked: all.filter((a) => a.decision === "NOT_TRACKED").length,
    linked: all.filter((a) => a.decision === "ITEM").length,
  };
  const needle = search.trim().toLowerCase();
  const matchedCode = (a: ArticleRow) => (needle ? (a.icodes ?? []).find((c) => c.toLowerCase().includes(needle)) : undefined);
  const rows = all.filter((a) => {
    // A search looks at every Article, whatever its state: the tabs only apply when nothing is typed.
    if (needle) {
      return (
        [a.article_name, a.department, a.section, a.item_name ?? "", ...a.samples, ...(a.names ?? [])].some((v) => v.toLowerCase().includes(needle)) ||
        matchedCode(a) !== undefined
      );
    }
    if (filter === "unmapped") return a.decision === null;
    if (filter === "untracked") return a.decision === "NOT_TRACKED";
    if (filter === "linked") return a.decision === "ITEM";
    return true;
  });
  const chosenRows = all.filter((a) => selected.has(a.article_key));
  const toggle = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });
  const allShownOn = rows.length > 0 && rows.every((a) => selected.has(a.article_key));

  const columns: DataTableColumn<ArticleRow>[] = [
    {
      key: "pick", header: (
        <Checkbox
          aria-label="Select all shown Articles" checked={allShownOn}
          onCheckedChange={(v) => setSelected(v === true ? new Set([...selected, ...rows.map((a) => a.article_key)]) : new Set([...selected].filter((k) => !rows.some((a) => a.article_key === k))))}
        />
      ),
      cell: (a) => <Checkbox aria-label={`Select ${a.article_name}`} checked={selected.has(a.article_key)} onCheckedChange={(v) => toggle(a.article_key, v === true)} />,
    },
    {
      key: "where", header: "Section › Department", cell: (a) => (
        <span className="text-xs text-muted-foreground">{a.section} › {a.department}</span>
      ),
    },
    {
      key: "article", header: "Article", cellClassName: "font-medium", cell: (a) => (
        <div className="min-w-0">
          <p className="truncate">{a.article_name}</p>
          {a.samples.length > 0 && <p className="truncate text-xs font-normal text-muted-foreground">{a.samples.join(", ")}</p>}
          {matchedCode(a) && (
            <p className="text-xs font-normal text-foreground">
              Has code <span className="font-mono">{matchedCode(a)}</span> · decide the code itself above
            </p>
          )}
        </div>
      ),
    },
    { key: "codes", header: "Codes bought", cellClassName: "tabular-nums", cell: (a) => a.codes },
    { key: "units", header: "Units", cellClassName: "tabular-nums", cell: (a) => units(a.units) },
    {
      key: "item", header: "Item", cell: (a) => {
        const value = picked[a.article_key] ?? (a.item_id !== null ? String(a.item_id) : a.suggested_item_id !== null ? String(a.suggested_item_id) : "");
        return (
          <div className="flex min-w-48 flex-col gap-1">
            {a.decision === "NOT_TRACKED" && (
              <span className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs font-medium" title="Purchase orders leave these lines out">
                Not tracked{a.not_tracked_by && a.not_tracked_level !== "ARTICLE" ? ` · ${a.not_tracked_by}` : ""}
              </span>
            )}
            <SearchableSelect
              id={`article-item-${a.article_key}`} aria-label={`Item for ${a.article_name}`} value={value || undefined}
              onValueChange={(v) => setPicked((p) => ({ ...p, [a.article_key]: v }))} options={itemOptions} placeholder="Choose the Item"
              onCreateNew={canCreate ? () => setNewItemFor(a) : undefined} createLabel="New Item…"
            />
            {a.item_id === null && a.decision !== "NOT_TRACKED" && a.suggested_item_name && picked[a.article_key] === undefined && (
              <span className="text-xs text-muted-foreground">Suggested: {a.suggested_item_name}</span>
            )}
            {(a.name_rules > 0 || a.code_rules > 0) && (
              <span className="text-xs text-muted-foreground">
                + {a.name_rules} by name, {a.code_rules} by code{a.untracked_rules > 0 ? ` (${a.untracked_rules} not tracked)` : ""}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "actions", header: "", cell: (a) => {
        const value = picked[a.article_key] ?? (a.item_id !== null ? String(a.item_id) : a.suggested_item_id !== null ? String(a.suggested_item_id) : "");
        const unchanged = a.item_id !== null && value === String(a.item_id);
        const viaArticle = a.decision === "NOT_TRACKED" && a.not_tracked_level === "ARTICLE";
        return (
          <div className="flex justify-end gap-1">
            <Button
              size="sm" aria-label={`Link ${a.article_name}`} disabled={!value || unchanged || linkMutation.isPending}
              onClick={() => linkMutation.mutate({ ...a, itemId: Number(value) })}
            >
              {a.item_id !== null && !unchanged ? "Change" : "Link"}
            </Button>
            {viaArticle ? (
              <Button size="sm" variant="outline" aria-label={`Track ${a.article_name} again`} disabled={undoMutation.isPending} onClick={() => undoMutation.mutate(a)}>
                Track again
              </Button>
            ) : (
              <Button
                size="sm" variant="outline" aria-label={`Not tracked: ${a.article_name}`} title="Mark the whole Article not tracked"
                disabled={a.decision === "NOT_TRACKED" || notTrackedMutation.isPending}
                onClick={() => setConfirmNt(a)}
              >
                Not tracked
              </Button>
            )}
            <Button size="sm" variant="outline" aria-label={`Codes of ${a.article_name}`} onClick={() => setDetail(a)}>Codes…</Button>
          </div>
        );
      },
    },
  ];

  const tabButton = (key: Tab, label: string, n?: number) => (
    <Button key={key} size="sm" variant={filter === key ? "default" : "outline"} onClick={() => setFilter(key)}>
      {label}{n !== undefined ? ` (${n})` : ""}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        An Article groups what was bought together (every code under it, including new vendor codes, follows it), so a cable can sit in the camera Article.
        For a mixed Article use Codes… or the Codes view to decide each barcode by itself.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search ERP Articles" placeholder="Search item code, Article, Department, product…" className="max-w-sm"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        {tabButton("unmapped", "Not decided", articlesQ.data ? count.unmapped : undefined)}
        {tabButton("linked", "Linked", articlesQ.data ? count.linked : undefined)}
        {tabButton("untracked", "Not tracked", articlesQ.data ? count.untracked : undefined)}
        {tabButton("all", "All", articlesQ.data ? all.length : undefined)}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" role="region" aria-label="Selected Articles">
          <span>{selected.size} selected</span>
          <div className="w-56">
            <SearchableSelect id="bulk-item" aria-label="Item for the selected Articles" value={bulkItem} onValueChange={setBulkItem} options={itemOptions} placeholder="Choose the Item" />
          </div>
          <Button size="sm" disabled={!bulkItem || bulkMutation.isPending} onClick={() => bulkMutation.mutate({ rows: chosenRows, itemId: Number(bulkItem) })}>
            Link {selected.size} to this Item
          </Button>
          <Button size="sm" variant="outline" disabled={bulkMutation.isPending} onClick={() => bulkMutation.mutate({ rows: chosenRows, itemId: null })}>
            Mark {selected.size} not tracked
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      {failure && (
        <p className="text-sm text-destructive" role="alert">
          {failure instanceof Error ? failure.message : "That did not work."}
        </p>
      )}

      {articlesQ.isError ? (
        <ErrorState
          message={articlesQ.error instanceof Error ? articlesQ.error.message : "Couldn't read the ERP Articles."}
          onRetry={() => articlesQ.refetch()}
        />
      ) : (
        <DataTable
          columns={columns} rows={rows} rowKey={(a) => a.article_key} isLoading={articlesQ.isLoading}
          emptyState={
            <EmptyState
              title={filter === "unmapped" && !needle ? "Every bought Article has been decided." : "No Articles match."}
              description={items.length === 0 ? "Create some Items first (Settings › Catalogue › Items)." : undefined}
            />
          }
        />
      )}

      {detail && <ArticleCodesDialog article={detail} items={items} companyId={companyId} onClose={() => setDetail(null)} />}
      {confirmNt && (
        <Dialog open onOpenChange={(open) => !open && setConfirmNt(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-base">Mark the whole Article {confirmNt.article_name} as not tracked?</DialogTitle>
              <DialogDescription>
                All {confirmNt.codes} code{confirmNt.codes === 1 ? "" : "s"} in it ({confirmNt.samples.slice(0, 3).join(", ") || "no sample names"}) will be left out of purchase orders.
                If only some of them are not tracked (a cable bought for the cameras), use <b>Codes…</b> instead and mark just those codes.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmNt(null)}>Cancel</Button>
              <Button onClick={() => { notTrackedMutation.mutate(confirmNt); setConfirmNt(null); }}>Yes, the whole Article is not tracked</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <ItemFormDialog
        open={newItemFor !== null}
        onOpenChange={(open) => !open && setNewItemFor(null)}
        initialName={newItemFor?.article_name}
        onSaved={(saved) => newItemFor && setPicked((p) => ({ ...p, [newItemFor.article_key]: String(saved.id) }))}
      />
    </div>
  );
}

function ArticleCodesDialog({ article, items, companyId, onClose }: { article: ArticleRow; items: Item[]; companyId?: string; onClose: () => void }) {
  const codesQ = useQuery({
    queryKey: ["items", "articles", "codes", companyId, article.article_key],
    queryFn: () =>
      apiClient.get<ArticleCodeRow[]>(
        `/items/articles/codes?article_key=${encodeURIComponent(article.article_key)}${companyId ? `&company_id=${companyId}` : ""}`,
      ),
    retry: false,
  });
  const qc = useQueryClient();
  const rows: CodeDecisionRow[] = (codesQ.data ?? []).map((c) => ({
    ...c, not_tracked: c.not_tracked ?? false, not_tracked_by: c.not_tracked_by ?? null, map_id: c.map_id ?? null,
    article_key: article.article_key, article_name: article.article_name, section: article.section, department: article.department,
  }));
  // If the Article itself is marked not tracked, every code follows that: say so, and offer the way back right here.
  const articleOff = article.decision === "NOT_TRACKED";
  const viaArticle = articleOff && article.not_tracked_level === "ARTICLE";
  const trackAgain = useMutation({
    mutationFn: () => apiClient.delete(`/items/maps/${article.decision_map_id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-base">Codes of {article.article_name}</DialogTitle>
          <DialogDescription>
            Decide a single code, or every code with the same product name: link it to an Item, or mark it not tracked (a cable bought for the cameras, for example).
            Tick several to decide them together. Anything else in the Article keeps following the Article's own decision.
          </DialogDescription>
        </DialogHeader>
        {articleOff && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm" role="status">
            <p>
              The whole Article is marked <b>not tracked</b>{viaArticle ? "" : ` (${article.not_tracked_by})`}, so every code below follows that
              unless it is decided by itself.
            </p>
            {viaArticle && (
              <Button size="sm" disabled={trackAgain.isPending} onClick={() => trackAgain.mutate()}>Track the Article again</Button>
            )}
          </div>
        )}
        {codesQ.isLoading && <p className="text-sm text-muted-foreground">Reading the ERP…</p>}
        {codesQ.isError && (
          <p className="text-sm text-destructive" role="alert">
            {codesQ.error instanceof Error ? codesQ.error.message : "Could not read the codes."}
          </p>
        )}
        <CodeDecisionRows rows={rows} items={items} companyId={companyId} />
        <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </DialogContent>
    </Dialog>
  );
}
