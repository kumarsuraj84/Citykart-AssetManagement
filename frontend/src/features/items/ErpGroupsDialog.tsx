import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { GroupLevel, GroupRow } from "./types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const LEVELS: { key: GroupLevel; label: string; one: string }[] = [
  { key: "DEPARTMENT", label: "Departments", one: "Department" },
  { key: "SECTION", label: "Sections", one: "Section" },
  { key: "DIVISION", label: "Divisions", one: "Division" },
];

const units = (n: number) => Math.round(n).toLocaleString("en-IN");

/** "Groups…": mark a whole ERP Department, Section or Division as not tracked in CKAM in one click (hangers,
 * sensor tags, cables…). An Article, product name or code linked to an Item still wins over its group. */
export function ErpGroupsDialog({ companyId, onClose }: { companyId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [level, setLevel] = useState<GroupLevel>("DEPARTMENT");
  const [search, setSearch] = useState("");
  const listQ = useQuery({
    queryKey: ["items", "groups", level, companyId],
    queryFn: () => apiClient.get<GroupRow[]>(`/items/articles/groups?level=${level}${companyId ? `&company_id=${companyId}` : ""}`),
    retry: false,
  });
  const changed = () => qc.invalidateQueries({ queryKey: ["items"] });
  const markMutation = useMutation({
    mutationFn: (g: GroupRow) =>
      apiClient.post("/items/maps", {
        match_type: g.level, level_key: g.value, not_tracked: true, ...(companyId ? { company_id: Number(companyId) } : {}),
      }),
    onSuccess: changed,
  });
  const undoMutation = useMutation({
    mutationFn: (g: GroupRow) => apiClient.delete(`/items/maps/${g.map_id}`),
    onSuccess: changed,
  });
  const error = [markMutation, undoMutation].find((m) => m.isError)?.error;
  const label = LEVELS.find((l) => l.key === level)!;
  const needle = search.trim().toLowerCase();
  const rows = (listQ.data ?? []).filter((g) => !needle || g.value.toLowerCase().includes(needle) || g.samples.some((s) => s.toLowerCase().includes(needle)));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">Not tracked, by group</DialogTitle>
          <DialogDescription>
            Mark a whole ERP Department, Section or Division as not tracked in CKAM (hangers, sensor tags, cables…). Purchase orders then leave those lines out.
            An Article, product name or code you link to an Item still counts as tracked.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {LEVELS.map((l) => (
            <Button key={l.key} size="sm" variant={level === l.key ? "default" : "outline"} onClick={() => { setLevel(l.key); setSearch(""); }}>
              {l.label}
            </Button>
          ))}
          <Input aria-label="Search groups" placeholder={`Search ${label.label.toLowerCase()}…`} className="min-w-48 flex-1" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {listQ.isLoading && <p className="text-sm text-muted-foreground">Reading the ERP…</p>}
        {listQ.isError && (
          <p className="text-sm text-destructive" role="alert">{listQ.error instanceof Error ? listQ.error.message : "Could not read the groups."}</p>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error instanceof Error ? error.message : "That did not work."}</p>}
        <ul className="flex max-h-96 flex-col divide-y overflow-y-auto rounded-md border">
          {rows.length === 0 && !listQ.isLoading && <li className="p-3 text-sm text-muted-foreground">Nothing matches.</li>}
          {rows.map((g) => (
            <li key={g.value} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {g.value}
                  {g.not_tracked && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">Not tracked</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {g.articles} Article{g.articles === 1 ? "" : "s"} · {g.codes} code{g.codes === 1 ? "" : "s"} · {units(g.units)} units
                  {g.samples.length > 0 ? ` · ${g.samples.join(", ")}` : ""}
                </p>
              </div>
              {g.not_tracked ? (
                <Button size="sm" variant="outline" aria-label={`Track ${g.value} again`} disabled={undoMutation.isPending} onClick={() => undoMutation.mutate(g)}>
                  Track again
                </Button>
              ) : (
                <Button size="sm" aria-label={`Mark ${label.one} ${g.value} not tracked`} disabled={markMutation.isPending} onClick={() => markMutation.mutate(g)}>
                  Not tracked
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </DialogContent>
    </Dialog>
  );
}
