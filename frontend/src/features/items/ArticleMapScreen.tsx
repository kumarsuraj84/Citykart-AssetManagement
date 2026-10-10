import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { ArticleCodeRow, ArticleRow, Item, MatchType } from "./types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

const units = (n: number) => Math.round(n).toLocaleString("en-IN");

/** Setup > ERP Articles: every ERP Article that has been bought, and the Item it
 * belongs to. Linking an Article links all its item codes (the normal case); a
 * catch-all Article is linked product name by product name, or code by code. */
export function ArticleMapScreen() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"unmapped" | "all">("unmapped");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<ArticleRow | null>(null);

  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items") });
  const articlesQ = useQuery({
    queryKey: ["items", "articles"], queryFn: () => apiClient.get<ArticleRow[]>("/items/articles"), retry: false,
  });
  const items = itemsQ.data ?? [];
  const itemOptions = items.map((i) => ({ value: String(i.id), label: i.name }));

  const linkMutation = useMutation({
    mutationFn: (a: ArticleRow & { itemId: number }) =>
      apiClient.post("/items/maps", {
        item_id: a.itemId, match_type: "ARTICLE", article_key: a.article_key, article_name: a.article_name,
        section: a.section, department: a.department,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
    },
  });

  const needle = search.trim().toLowerCase();
  const rows = (articlesQ.data ?? []).filter((a) => {
    if (filter === "unmapped" && a.item_id !== null) return false;
    return !needle || [a.article_name, a.department, a.section, a.item_name ?? "", ...a.samples].some((v) => v.toLowerCase().includes(needle));
  });

  const columns: DataTableColumn<ArticleRow>[] = [
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
            <SearchableSelect
              id={`article-item-${a.article_key}`} aria-label={`Item for ${a.article_name}`} value={value || undefined}
              onValueChange={(v) => setPicked((p) => ({ ...p, [a.article_key]: v }))} options={itemOptions} placeholder="Choose the Item"
            />
            {a.item_id === null && a.suggested_item_name && picked[a.article_key] === undefined && (
              <span className="text-xs text-muted-foreground">Suggested: {a.suggested_item_name}</span>
            )}
            {(a.name_rules > 0 || a.code_rules > 0) && (
              <span className="text-xs text-muted-foreground">+ {a.name_rules} by name, {a.code_rules} by code</span>
            )}
          </div>
        );
      },
    },
    {
      key: "actions", header: "", cell: (a) => {
        const value = picked[a.article_key] ?? (a.item_id !== null ? String(a.item_id) : a.suggested_item_id !== null ? String(a.suggested_item_id) : "");
        const unchanged = a.item_id !== null && value === String(a.item_id);
        return (
          <div className="flex justify-end gap-1">
            <Button
              size="sm" aria-label={`Link ${a.article_name}`} disabled={!value || unchanged || linkMutation.isPending}
              onClick={() => linkMutation.mutate({ ...a, itemId: Number(value) })}
            >
              {a.item_id !== null && !unchanged ? "Change" : "Link"}
            </Button>
            <Button size="sm" variant="outline" aria-label={`Codes of ${a.article_name}`} onClick={() => setDetail(a)}>Codes…</Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ERP Articles"
        description="Each ERP Article (a family of item codes, one per vendor or spec) belongs to one Item. Link it once and every code under it, including new vendor codes, follows. For a mixed Article, use Codes… to link by product name or by code."
        actions={<Button asChild variant="outline"><Link to="/setup/items">Items</Link></Button>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search ERP Articles" placeholder="Search Article, Department, product…" className="max-w-sm"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <Button size="sm" variant={filter === "unmapped" ? "default" : "outline"} onClick={() => setFilter("unmapped")}>Not linked</Button>
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All</Button>
        {articlesQ.data && (
          <span className="text-xs text-muted-foreground">
            {articlesQ.data.filter((a) => a.item_id !== null).length} of {articlesQ.data.length} Articles linked
          </span>
        )}
      </div>
      {linkMutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {linkMutation.error instanceof Error ? linkMutation.error.message : "Could not link the Article."}
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
              title={filter === "unmapped" && !needle ? "Every bought Article is linked." : "No Articles match."}
              description={items.length === 0 ? "Create some Items first (Setup > Items)." : undefined}
            />
          }
        />
      )}

      {detail && <ArticleCodesDialog article={detail} items={items} onClose={() => setDetail(null)} />}
    </div>
  );
}

function ArticleCodesDialog({ article, items, onClose }: { article: ArticleRow; items: Item[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const codesQ = useQuery({
    queryKey: ["items", "articles", "codes", article.article_key],
    queryFn: () => apiClient.get<ArticleCodeRow[]>(`/items/articles/codes?article_key=${encodeURIComponent(article.article_key)}`),
    retry: false,
  });
  const saveMutation = useMutation({
    mutationFn: (v: { row: ArticleCodeRow; itemId: number; type: MatchType }) =>
      apiClient.post("/items/maps", {
        item_id: v.itemId, match_type: v.type, article_key: article.article_key, article_name: article.article_name,
        section: article.section, department: article.department,
        ...(v.type === "CODE" ? { erp_item_code: v.row.icode } : { name_key: v.row.name_key }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
    },
  });
  const options = items.map((i) => ({ value: String(i.id), label: i.name }));
  const how: Record<MatchType, string> = { CODE: "by its code", NAME: "by its product name", ARTICLE: "through its Article" };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">Codes of {article.article_name}</DialogTitle>
          <DialogDescription>
            Link a single code, or every code with the same product name. Anything else in the Article keeps following the Article's own Item.
          </DialogDescription>
        </DialogHeader>
        {codesQ.isLoading && <p className="text-sm text-muted-foreground">Reading the ERP…</p>}
        {codesQ.isError && (
          <p className="text-sm text-destructive" role="alert">
            {codesQ.error instanceof Error ? codesQ.error.message : "Could not read the codes."}
          </p>
        )}
        {saveMutation.isError && (
          <p className="text-sm text-destructive" role="alert">
            {saveMutation.error instanceof Error ? saveMutation.error.message : "Could not save."}
          </p>
        )}
        <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {(codesQ.data ?? []).map((c) => {
            const value = picked[c.icode] ?? (c.item_id !== null ? String(c.item_id) : "");
            return (
              <li key={c.icode} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    <span className="font-mono text-xs">{c.icode}</span> {c.name || "(no product name in the ERP)"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.description} · {units(c.units)} units in {c.lines} lines
                  </p>
                  <p className="text-xs">
                    {c.item_name ? <>Now: <b>{c.item_name}</b> {c.matched_by ? how[c.matched_by] : ""}</> : <span className="text-warning-foreground">Not linked to any Item</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <SearchableSelect
                    id={`code-item-${c.icode}`} aria-label={`Item for ${c.icode}`} value={value || undefined}
                    onValueChange={(v) => setPicked((p) => ({ ...p, [c.icode]: v }))} options={options} placeholder="Item"
                  />
                  <Button size="sm" variant="outline" disabled={!value || saveMutation.isPending} aria-label={`Link code ${c.icode}`}
                    onClick={() => saveMutation.mutate({ row: c, itemId: Number(value), type: "CODE" })}>This code</Button>
                  <Button size="sm" variant="outline" disabled={!value || !c.name_key || saveMutation.isPending} aria-label={`Link name of ${c.icode}`}
                    onClick={() => saveMutation.mutate({ row: c, itemId: Number(value), type: "NAME" })}>This name</Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </DialogContent>
    </Dialog>
  );
}
