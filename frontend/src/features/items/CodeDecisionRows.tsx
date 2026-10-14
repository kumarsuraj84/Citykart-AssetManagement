import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { ArticleCodeRow, Item, MatchType } from "./types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { ItemFormDialog } from "./ItemFormDialog";
import { useCanCreate } from "@/lib/capabilities";
import { itemOptions as buildItemOptions } from "@/lib/option-labels";
import { useCategoryLookups } from "@/lib/lookups";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

/** An ERP item code with the Article it sits in (an Article is a purchasing group, not a statement of what each code is). */
export interface CodeDecisionRow extends ArticleCodeRow {
  article_key: string;
  article_name: string;
  section: string;
  department: string;
}

type Mode = "CODE" | "NAME";

const units = (n: number) => Math.round(n).toLocaleString("en-IN");

const HOW: Record<MatchType, string> = {
  CODE: "by its code", NAME: "by its product name", ARTICLE: "through its Article",
  DEPARTMENT: "through its Department", SECTION: "through its Section", DIVISION: "through its Division",
};

/** The state of one code, in a few words, with a colour. */
export function CodeStatus({ c }: { c: Pick<CodeDecisionRow, "not_tracked" | "item_name" | "matched_by"> }) {
  const how = c.matched_by ? ` · ${HOW[c.matched_by]}` : "";
  if (c.not_tracked) return <span className="w-fit rounded bg-muted px-2 py-0.5 text-xs font-medium">Not tracked{how}</span>;
  if (c.item_name) return <span className="w-fit rounded bg-success/10 px-2 py-0.5 text-xs font-medium">{c.item_name}{how}</span>;
  return <span className="w-fit rounded bg-warning/20 px-2 py-0.5 text-xs font-medium">Not decided yet</span>;
}

/**
 * The codes of an Article, or the codes a search found. Each code shows its OWN decision (which can differ from its
 * Article's: the CAT-6 cable bought for the cameras) and is decided with two clear choices: **Link** it to an Item, or
 * mark it **Not tracked**. "Decide by" says whether that is this one code or every code with the same product name.
 * Tick several to decide them together.
 */
export function CodeDecisionRows({ rows, items, companyId, showArticle = false }: {
  rows: CodeDecisionRow[]; items: Item[]; companyId?: string; showArticle?: boolean;
}) {
  const qc = useQueryClient();
  const canCreate = useCanCreate("item");
  const [mode, setMode] = useState<Mode>("CODE");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkItem, setBulkItem] = useState<string | undefined>();
  const [newItemFor, setNewItemFor] = useState<CodeDecisionRow | null>(null);
  // "Laptop · IT Fixed Assets": the Category tells two similar Items apart.
  const categoryLookups = useCategoryLookups();
  const options = buildItemOptions(items, categoryLookups);

  const rule = (row: CodeDecisionRow, type: Mode) => ({
    match_type: type, article_key: row.article_key, article_name: row.article_name, section: row.section, department: row.department,
    ...(companyId ? { company_id: Number(companyId) } : {}),
    ...(type === "CODE" ? { erp_item_code: row.icode } : { name_key: row.name_key }),
  });
  const done = () => qc.invalidateQueries({ queryKey: ["items"] });
  const saveMutation = useMutation({
    mutationFn: (v: { row: CodeDecisionRow; itemId: number | null }) =>
      apiClient.post("/items/maps", v.itemId === null ? { not_tracked: true, ...rule(v.row, mode) } : { item_id: v.itemId, ...rule(v.row, mode) }),
    onSuccess: done,
  });
  const undoMutation = useMutation({
    mutationFn: (row: CodeDecisionRow) => apiClient.delete(`/items/maps/${row.map_id}`),
    onSuccess: done,
  });
  const bulkMutation = useMutation({
    mutationFn: ({ chosen, itemId }: { chosen: CodeDecisionRow[]; itemId: number | null }) =>
      Promise.all(chosen.map((r) => apiClient.post("/items/maps", itemId === null ? { not_tracked: true, ...rule(r, mode) } : { item_id: itemId, ...rule(r, mode) }))),
    onSuccess: () => {
      setSelected(new Set());
      done();
    },
  });
  const failure = [saveMutation, undoMutation, bulkMutation].find((m) => m.isError)?.error;
  const chosen = rows.filter((r) => selected.has(r.icode));
  const toggle = (code: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(code); else next.delete(code);
      return next;
    });
  const unit = mode === "CODE" ? "this code" : "this product name";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Decide by:</span>
        <Button size="sm" variant={mode === "CODE" ? "default" : "outline"} aria-pressed={mode === "CODE"} onClick={() => setMode("CODE")}>This code only</Button>
        <Button size="sm" variant={mode === "NAME" ? "default" : "outline"} aria-pressed={mode === "NAME"} onClick={() => setMode("NAME")}>Every code with the same product name</Button>
      </div>
      {failure && (
        <ErrorMessage className="text-sm text-destructive" error={failure} message={failure instanceof Error ? failure.message : "Could not save."} />
      )}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" role="region" aria-label="Selected codes">
          <span>{selected.size} code{selected.size === 1 ? "" : "s"} selected</span>
          <div className="w-56">
            <SearchableSelect id="bulk-code-item" aria-label="Item for the selected codes" value={bulkItem} onValueChange={setBulkItem} options={options} placeholder="Choose the Item" />
          </div>
          <Button size="sm" disabled={!bulkItem || bulkMutation.isPending} onClick={() => bulkMutation.mutate({ chosen, itemId: Number(bulkItem) })}>
            Link {selected.size} to this Item
          </Button>
          <Button size="sm" variant="outline" disabled={bulkMutation.isPending} onClick={() => bulkMutation.mutate({ chosen, itemId: null })}>
            Mark {selected.size} not tracked
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      <ul className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
        {rows.map((c) => {
          const value = picked[c.icode] ?? (c.item_id !== null ? String(c.item_id) : "");
          const own = c.not_tracked && (c.matched_by === "CODE" || c.matched_by === "NAME");
          const noName = mode === "NAME" && !c.name_key;
          return (
            <li key={c.icode} className="flex flex-col gap-3 rounded-md border p-3 text-sm md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 flex-1 gap-3">
                <Checkbox className="mt-1" aria-label={`Select code ${c.icode}`} checked={selected.has(c.icode)} onCheckedChange={(v) => toggle(c.icode, v === true)} />
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="font-medium">
                    <span className="mr-2 font-mono text-xs">{c.icode}</span>{c.name || "(no product name in the ERP)"}
                  </p>
                  <p className="text-xs text-muted-foreground">{c.description} · {units(c.units)} units in {c.lines} lines</p>
                  {showArticle && (
                    <p className="text-xs text-muted-foreground">In the Article {c.article_name} · {c.section} › {c.department}</p>
                  )}
                  <CodeStatus c={c} />
                </div>
              </div>
              <div className="flex flex-col gap-2 md:w-[26rem]">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchableSelect
                      id={`code-item-${c.icode}`} aria-label={`Item for ${c.icode}`} value={value || undefined}
                      onValueChange={(v) => setPicked((p) => ({ ...p, [c.icode]: v }))} options={options} placeholder="Choose the Item"
                      onCreateNew={canCreate ? () => setNewItemFor(c) : undefined} createLabel="New Item…"
                    />
                  </div>
                  <Button size="sm" disabled={!value || noName || saveMutation.isPending} aria-label={`Link ${c.icode}`} title={`Link ${unit} to the Item`}
                    onClick={() => saveMutation.mutate({ row: c, itemId: Number(value) })}>Link</Button>
                </div>
                <div className="flex items-center justify-end gap-2">
                  {own ? (
                    <Button size="sm" variant="outline" disabled={undoMutation.isPending} aria-label={`Track ${c.icode} again`} onClick={() => undoMutation.mutate(c)}>
                      Track again
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={noName || saveMutation.isPending} aria-label={`Not tracked: ${c.icode}`} title={`Mark ${unit} not tracked`}
                      onClick={() => saveMutation.mutate({ row: c, itemId: null })}>Not tracked</Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <ItemFormDialog
        open={newItemFor !== null}
        onOpenChange={(open) => !open && setNewItemFor(null)}
        initialName={newItemFor?.name || undefined}
        onSaved={(saved) => newItemFor && setPicked((p) => ({ ...p, [newItemFor.icode]: String(saved.id) }))}
      />
    </div>
  );
}
