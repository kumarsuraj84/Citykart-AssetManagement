import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Item } from "./types";
import type { CodeDecisionRow } from "./CodeDecisionRows";
import { ErpCodesView } from "./ErpCodesView";
import { useErpCodes } from "./useErpCodes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { companyOptions } from "@/lib/option-labels";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

interface Company {
  id: number;
  name: string;
}

type Tab = "linked" | "add";

interface Group {
  mapId: number;
  kind: "ARTICLE" | "NAME" | "CODE" | string;
  rows: CodeDecisionRow[];
}

const KIND_ORDER: Record<string, number> = { ARTICLE: 0, NAME: 1, CODE: 2 };

function describe(g: Group): { title: string; note: string } {
  const first = g.rows[0];
  if (g.kind === "ARTICLE") {
    return { title: `The whole Article ${first.article_name}`, note: "Every code in it, including new vendor codes later." };
  }
  if (g.kind === "NAME") return { title: `Every code named “${first.name}”`, note: `Inside the Article ${first.article_name}.` };
  return { title: `Code ${first.icode}`, note: first.name };
}

/**
 * Opened from an Item: what is linked to it (grouped by the rule that links it, so an Article link is one card, with
 * its codes under it, and can be unlinked in one click) and, on the second tab, a search over every ERP code of the
 * company to link more of them to this Item.
 */
export function ItemLinksDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("linked");
  const companiesQ = useQuery({ queryKey: ["masters", "companies"], queryFn: () => apiClient.get<Company[]>("/masters/companies") });
  const companies = Array.isArray(companiesQ.data) ? companiesQ.data : [];
  const [pickedCompany, setPickedCompany] = useState<string | undefined>();
  const companyId = pickedCompany ?? (companies[0] ? String(companies[0].id) : undefined);
  const codesQ = useErpCodes(companyId);

  const mine = (codesQ.data ?? []).filter((c) => c.item_id === item.id && !c.not_tracked);
  const groups = useMemo(() => {
    const byRule = new Map<number, Group>();
    mine.forEach((c) => {
      if (c.map_id === null) return;
      const g = byRule.get(c.map_id) ?? { mapId: c.map_id, kind: c.matched_by ?? "CODE", rows: [] };
      g.rows.push(c);
      byRule.set(c.map_id, g);
    });
    return [...byRule.values()].sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.rows[0].icode.localeCompare(b.rows[0].icode));
  }, [mine]);

  const unlink = useMutation({
    mutationFn: (g: Group) => apiClient.delete(`/items/maps/${g.mapId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items"] }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-base">ERP codes of {item.name}</DialogTitle>
          <DialogDescription>
            What is linked to this Item, and a way to link more. Each company has its own ERP codes, so look per company.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {companies.length > 1 && (
            <div className="w-64">
              <SearchableSelect
                id="item-links-company" aria-label="Company" value={companyId} onValueChange={setPickedCompany}
                options={companyOptions(companies)}
              />
            </div>
          )}
          <Button size="sm" variant={tab === "linked" ? "default" : "outline"} aria-pressed={tab === "linked"} onClick={() => setTab("linked")}>
            Linked ({mine.length})
          </Button>
          <Button size="sm" variant={tab === "add" ? "default" : "outline"} aria-pressed={tab === "add"} onClick={() => setTab("add")}>Add codes</Button>
        </div>

        {tab === "linked" ? (
          <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
            {codesQ.isLoading && <p className="text-sm text-muted-foreground">Reading the ERP codes…</p>}
            {codesQ.isError && (
              <ErrorMessage className="text-sm text-destructive" error={codesQ.error} message={codesQ.error instanceof Error ? codesQ.error.message : "Could not read the ERP codes."} />
            )}
            {unlink.isError && (
              <ErrorMessage className="text-sm text-destructive" error={unlink.error} message={unlink.error instanceof Error ? unlink.error.message : "Could not unlink."} />
            )}
            {codesQ.data && groups.length === 0 && (
              <div className="rounded-md border p-4 text-sm text-muted-foreground">
                Nothing is linked to {item.name} for this company yet.{" "}
                <button type="button" className="underline" onClick={() => setTab("add")}>Add codes</button>
              </div>
            )}
            {groups.map((g) => {
              const { title, note } = describe(g);
              return (
                <section key={g.mapId} className="flex flex-col gap-1 rounded-md border p-3 text-sm" aria-label={title}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{title}</p>
                      <p className="text-xs text-muted-foreground">{g.rows.length} code{g.rows.length === 1 ? "" : "s"} · {note}</p>
                    </div>
                    <Button size="sm" variant="outline" aria-label={`Unlink ${title}`} disabled={unlink.isPending} onClick={() => unlink.mutate(g)}>
                      Unlink
                    </Button>
                  </div>
                  {(g.kind !== "CODE" || g.rows.length > 1) && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Show the {g.rows.length} code{g.rows.length === 1 ? "" : "s"}</summary>
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {g.rows.map((c) => (
                          <li key={c.icode}><span className="mr-2 font-mono">{c.icode}</span>{c.name}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <ErpCodesView key={companyId ?? "all"} companyId={companyId} items={[item]} fixedItem={item} />
        )}
        <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </DialogContent>
    </Dialog>
  );
}
