import { useState } from "react";
import { ChevronRight, Inbox, Pencil, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../lib/api-client";
import { bulkDeactivate } from "../../lib/bulk-deactivate";
import { suggestCode } from "../../lib/code-suggest";
import { WORK_AREA_OPTIONS, workAreaLabel } from "../../lib/labels";
import type { Item } from "../items/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { BulkImportExport } from "@/components/shared/BulkImportExport";

export interface Category {
  id: number;
  code: string;
  name: string;
  asset_domain: string;
}

export interface Subcategory {
  id: number;
  category_id: number;
  code: string;
  name: string;
}

const CATEGORIES_KEY = ["masters", "categories"];
const SUBCATEGORIES_KEY = ["masters", "subcategories"];

/** The confirmation shown before a group's work area is changed (the server keeps every recorded asset's own snapshot). */
export const WORK_AREA_CHANGE_TEXT =
  "This changes the work area of the group for future assets. Assets already recorded keep the work area they were recorded with.";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const asList = <T,>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);
const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

type GroupForm = { mode: "add" } | { mode: "edit"; cat: Category };
type SubForm = { mode: "add"; cat: Category } | { mode: "edit"; sub: Subcategory; cat?: Category };
type Target = { kind: "category"; row: Category } | { kind: "subcategory"; row: Subcategory };

/** A Code field that starts as a suggestion from the name, under "More" (Codes become part of asset codes). */
function CodeField({ id, value, onChange, open, onToggle, help }: {
  id: string; value: string; onChange: (v: string) => void; open: boolean; onToggle: () => void; help: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="ghost" size="sm" className="-ml-2 w-fit gap-1 text-muted-foreground" aria-expanded={open} onClick={onToggle}>
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
        More{value ? <span className="font-mono text-xs">(Code {value})</span> : null}
      </Button>
      {open && (
        <FormField htmlFor={id} label="Code" required helperText={help}>
          <Input id={id} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        </FormField>
      )}
    </div>
  );
}

/**
 * Settings › Catalogue › Asset Groups: Categories with their Sub-categories nested underneath, in one screen
 * (it replaced the separate Categories and Sub-categories screens). Uses the same master endpoints and keeps
 * their rules: a Code cannot change after creation, nor a Sub-category's group; nothing is deleted, only deactivated.
 */
export function AssetGroupsScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const categoriesQ = useQuery({ queryKey: CATEGORIES_KEY, queryFn: () => apiClient.get<Category[]>("/masters/categories") });
  const subsQ = useQuery({ queryKey: SUBCATEGORIES_KEY, queryFn: () => apiClient.get<Subcategory[]>("/masters/subcategories") });
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items") });
  const categories = asList<Category>(categoriesQ.data).slice().sort((a, b) => a.name.localeCompare(b.name));
  const subs = asList<Subcategory>(subsQ.data);
  const items = asList<Item>(itemsQ.data);

  const [search, setSearchRaw] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [groupForm, setGroupForm] = useState<GroupForm | null>(null);
  const [subForm, setSubForm] = useState<SubForm | null>(null);
  const [deactivating, setDeactivating] = useState<Target | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFailures, setBulkFailures] = useState<string[] | null>(null);

  // Form state (one dialog open at a time).
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmDomain, setConfirmDomain] = useState(false);

  function setSearch(v: string) {
    setSearchRaw(v);
    setSelected([]);
  }

  const itemsInCategory = (id: number) => items.filter((i) => i.category_id === id).length;
  const itemsInSub = (id: number) => items.filter((i) => i.subcategory_id === id).length;
  const subsOf = (catId: number) => subs.filter((s) => s.category_id === catId).sort((a, b) => a.name.localeCompare(b.name));
  const categoryCodes = categories.map((c) => c.code);
  const subCodesIn = (catId: number) => subs.filter((s) => s.category_id === catId).map((s) => s.code);

  const q = search.trim().toLowerCase();
  const matches = (t: string) => t.toLowerCase().includes(q);
  const visible = categories
    .map((c) => {
      const own = subsOf(c.id);
      if (!q) return { cat: c, subs: own };
      const catHit = matches(c.name) || matches(c.code) || matches(workAreaLabel(c.asset_domain));
      const subHits = own.filter((s) => matches(s.name) || matches(s.code));
      return catHit ? { cat: c, subs: own } : subHits.length > 0 ? { cat: c, subs: subHits } : null;
    })
    .filter((v): v is { cat: Category; subs: Subcategory[] } => v !== null);

  // ---- dialogs ----
  function openAddGroup() {
    groupMutation.reset();
    setName(""); setDomain(""); setCode(""); setCodeTouched(false); setMoreOpen(false);
    setGroupForm({ mode: "add" });
  }
  function openEditGroup(cat: Category) {
    groupMutation.reset();
    setName(cat.name); setDomain(cat.asset_domain); setCode(cat.code); setMoreOpen(false);
    setGroupForm({ mode: "edit", cat });
  }
  function openAddSub(cat: Category) {
    subMutation.reset();
    setName(""); setCode(""); setCodeTouched(false); setMoreOpen(false);
    setSubForm({ mode: "add", cat });
  }
  function openEditSub(sub: Subcategory) {
    subMutation.reset();
    setName(sub.name); setCode(sub.code);
    setSubForm({ mode: "edit", sub, cat: categories.find((c) => c.id === sub.category_id) });
  }
  function changeName(v: string, taken: string[]) {
    setName(v);
    if (!codeTouched) setCode(suggestCode(v, taken));
  }
  function changeCode(v: string) {
    setCodeTouched(true);
    setCode(v);
  }

  const groupMutation = useMutation({
    mutationFn: () => {
      if (groupForm?.mode === "edit") {
        return apiClient.put(`/masters/categories/${groupForm.cat.id}`, { name: name.trim(), asset_domain: domain });
      }
      return apiClient.post("/masters/categories", { code: code.trim(), name: name.trim(), asset_domain: domain });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
      setGroupForm(null);
      setConfirmDomain(false);
    },
    onError: () => setConfirmDomain(false),
  });

  const subMutation = useMutation({
    mutationFn: () => {
      if (subForm?.mode === "edit") return apiClient.put(`/masters/subcategories/${subForm.sub.id}`, { name: name.trim() });
      return apiClient.post("/masters/subcategories", { category_id: subForm!.cat.id, code: code.trim(), name: name.trim() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SUBCATEGORIES_KEY });
      setSubForm(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (t: Target) =>
      apiClient.delete(t.kind === "category" ? `/masters/categories/${t.row.id}` : `/masters/subcategories/${t.row.id}`),
    onSuccess: (_d, t) => {
      qc.invalidateQueries({ queryKey: t.kind === "category" ? CATEGORIES_KEY : SUBCATEGORIES_KEY });
      setDeactivating(null);
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const subIds = selected.filter((k) => k.startsWith("s:")).map((k) => Number(k.slice(2)));
      const catIds = selected.filter((k) => k.startsWith("c:")).map((k) => Number(k.slice(2)));
      // Sub-categories first, then their groups.
      const subResult = await bulkDeactivate((id) => `/masters/subcategories/${id}`, subIds);
      const catResult = await bulkDeactivate((id) => `/masters/categories/${id}`, catIds);
      return { subResult, catResult };
    },
    onSuccess: ({ subResult, catResult }) => {
      qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
      qc.invalidateQueries({ queryKey: SUBCATEGORIES_KEY });
      setBulkOpen(false);
      const failed = [
        ...subResult.failed.map((f) => ({ key: `s:${f.id}`, text: `${subs.find((s) => s.id === f.id)?.name ?? f.id}: ${f.message}` })),
        ...catResult.failed.map((f) => ({ key: `c:${f.id}`, text: `${categories.find((c) => c.id === f.id)?.name ?? f.id}: ${f.message}` })),
      ];
      setSelected(failed.map((f) => f.key));
      setBulkFailures(failed.length > 0 ? failed.map((f) => f.text) : null);
    },
  });

  function saveGroup() {
    if (groupForm?.mode === "edit" && domain !== groupForm.cat.asset_domain) {
      setConfirmDomain(true);
      return;
    }
    groupMutation.mutate();
  }

  const toggle = (key: string, on: boolean) => setSelected((s) => (on ? [...s, key] : s.filter((k) => k !== key)));
  const isLoading = categoriesQ.isLoading || subsQ.isLoading;
  const groupCanSave = name.trim() !== "" && domain !== "" && (groupForm?.mode === "edit" || code.trim() !== "");
  const subCanSave = name.trim() !== "" && (subForm?.mode === "edit" || code.trim() !== "");
  const targetName = deactivating ? deactivating.row.name : "";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Asset Groups"
        as={embedded ? "h2" : "h1"}
        description="What kind of thing an Item is: a group with its Sub-categories. The group's work area says which team looks after its assets. People pick Items, not groups."
        actions={
          <>
            <BulkImportExport
              resource="categories" label="Asset Groups" buttonLabel="Import / Export groups"
              onImported={() => qc.invalidateQueries({ queryKey: CATEGORIES_KEY })}
            />
            <BulkImportExport
              resource="subcategories" label="Sub-categories" buttonLabel="Import / Export sub-categories"
              onImported={() => qc.invalidateQueries({ queryKey: SUBCATEGORIES_KEY })}
            />
            <Button onClick={openAddGroup}>Add Group</Button>
          </>
        }
      />

      <Input
        aria-label="Search asset groups"
        placeholder="Search groups and sub-categories…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {selected.length > 0 && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span>{selected.length} selected</span>
          <Button variant="destructive" size="sm" onClick={() => setBulkOpen(true)}>Deactivate {selected.length} selected</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}
      {bulkFailures && (
        <div role="alert" className="flex flex-col gap-1 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-destructive">Could not deactivate {bulkFailures.length}:</span>
            <Button variant="ghost" size="sm" onClick={() => setBulkFailures(null)}>Dismiss</Button>
          </div>
          <ul className="list-disc pl-5">{bulkFailures.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}

      {categoriesQ.isError || subsQ.isError ? (
        <ErrorState message="Couldn't load the asset groups." onRetry={() => { categoriesQ.refetch(); subsQ.refetch(); }} />
      ) : isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : visible.length === 0 ? (
        q ? (
          <EmptyState icon={Inbox} title="No matches" description="Try a different search." />
        ) : (
          <EmptyState
            icon={Inbox}
            title="No asset groups yet"
            description="Add a group (for example IT Fixed Assets, work area IT Team), then its Sub-categories."
            action={<Button onClick={openAddGroup}>Add Group</Button>}
          />
        )
      ) : (
        <ul aria-label="Asset Groups" className="flex flex-col divide-y rounded-md border">
          {visible.map(({ cat, subs: own }) => (
            <li key={cat.id} data-group={cat.code}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-muted/30 px-3 py-2">
                <Checkbox
                  aria-label={`Select ${cat.name}`}
                  checked={selected.includes(`c:${cat.id}`)}
                  onCheckedChange={(v) => toggle(`c:${cat.id}`, v === true)}
                />
                <span className="font-semibold">{cat.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{cat.code}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {workAreaLabel(cat.asset_domain)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{plural(itemsInCategory(cat.id), "Item")}</span>
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="gap-1" aria-label={`Add Sub-category to ${cat.name}`} onClick={() => openAddSub(cat)}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Sub-category
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${cat.name}`} onClick={() => openEditGroup(cat)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Deactivate ${cat.name}`} onClick={() => { deactivateMutation.reset(); setDeactivating({ kind: "category", row: cat }); }}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {own.length === 0 ? (
                <p className="px-3 py-2 pl-10 text-xs text-muted-foreground">No Sub-category yet: Items need one.</p>
              ) : (
                <ul aria-label={`Sub-categories of ${cat.name}`} className="flex flex-col">
                  {own.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 pl-6 text-sm">
                      <Checkbox
                        aria-label={`Select ${s.name}`}
                        checked={selected.includes(`s:${s.id}`)}
                        onCheckedChange={(v) => toggle(`s:${s.id}`, v === true)}
                      />
                      <span className="text-muted-foreground" aria-hidden="true">›</span>
                      <span>{s.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{plural(itemsInSub(s.id), "Item")}</span>
                      <div className="ml-auto flex items-center gap-1">
                        <Button variant="ghost" size="icon" aria-label={`Edit ${s.name}`} onClick={() => openEditSub(s)}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`Deactivate ${s.name}`} onClick={() => { deactivateMutation.reset(); setDeactivating({ kind: "subcategory", row: s }); }}>
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ---- Add / edit a group (Category) ---- */}
      <Dialog open={groupForm !== null} onOpenChange={(o) => !o && setGroupForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{groupForm?.mode === "edit" ? "Edit Group" : "Add Group"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {groupForm?.mode === "edit" && (
              <div className="flex justify-between gap-4 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Code</span>
                <span className="font-mono font-medium">{groupForm.cat.code}</span>
              </div>
            )}
            <FormField htmlFor="group-name" label="Name" required>
              <Input id="group-name" value={name} placeholder="IT Fixed Assets" onChange={(e) => changeName(e.target.value, categoryCodes)} />
            </FormField>
            <FormField htmlFor="group-work-area" label="Work area" required helperText="Which team looks after assets of this group.">
              <Select value={domain || undefined} onValueChange={setDomain}>
                <SelectTrigger id="group-work-area" aria-label="Work area"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {WORK_AREA_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            {groupForm?.mode === "add" && (
              <CodeField
                id="group-code" value={code} onChange={changeCode} open={moreOpen} onToggle={() => setMoreOpen((o) => !o)}
                help="Suggested from the name. It becomes part of asset codes and cannot be changed later."
              />
            )}
            {groupForm?.mode === "edit" && <p className="text-xs text-muted-foreground">The Code is not editable after creation.</p>}
            {groupMutation.isError && (
              <p className="text-sm text-destructive" role="alert">{errorMessage(groupMutation.error, "Could not save this group.")}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupForm(null)}>Cancel</Button>
            <AsyncButton onClick={saveGroup} disabled={!groupCanSave} pending={groupMutation.isPending} pendingLabel="Saving…">Save</AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDomain} onOpenChange={(o) => !o && setConfirmDomain(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change the work area of {groupForm?.mode === "edit" ? groupForm.cat.name : "this group"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {WORK_AREA_CHANGE_TEXT} New work area: {workAreaLabel(domain)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={groupMutation.isPending} onClick={() => groupMutation.mutate()}>Change work area</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Add / edit a Sub-category ---- */}
      <Dialog open={subForm !== null} onOpenChange={(o) => !o && setSubForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{subForm?.mode === "edit" ? "Edit Sub-category" : "Add Sub-category"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 rounded-md border bg-muted/50 px-3 py-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Group</span>
                <span className="font-medium">{subForm?.mode === "add" ? subForm.cat.name : subForm?.cat?.name ?? ""}</span>
              </div>
              {subForm?.mode === "edit" && (
                <>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Code</span>
                    <span className="font-mono font-medium">{subForm.sub.code}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">The group and the Code are not editable after creation.</p>
                </>
              )}
            </div>
            <FormField htmlFor="sub-name" label="Name" required>
              <Input
                id="sub-name" value={name} placeholder="Laptop"
                onChange={(e) => changeName(e.target.value, subForm?.mode === "add" ? subCodesIn(subForm.cat.id) : [])}
              />
            </FormField>
            {subForm?.mode === "add" && (
              <CodeField
                id="sub-code" value={code} onChange={changeCode} open={moreOpen} onToggle={() => setMoreOpen((o) => !o)}
                help="Suggested from the name; unique within the group. It becomes part of asset codes and cannot be changed later."
              />
            )}
            {subMutation.isError && (
              <p className="text-sm text-destructive" role="alert">{errorMessage(subMutation.error, "Could not save this Sub-category.")}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubForm(null)}>Cancel</Button>
            <AsyncButton onClick={() => subMutation.mutate()} disabled={!subCanSave} pending={subMutation.isPending} pendingLabel="Saving…">Save</AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Deactivate (one) ---- */}
      <AlertDialog open={deactivating !== null} onOpenChange={(o) => !o && setDeactivating(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {targetName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This {deactivating?.kind === "category" ? "group" : "Sub-category"} will no longer appear in lists or be available for
              new Items. It is deactivated, not deleted: its history is kept and nothing that already references it is affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deactivateMutation.isError && (
            <p className="text-sm text-destructive" role="alert">{errorMessage(deactivateMutation.error, "Could not deactivate.")}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deactivateMutation.isPending}
              onClick={(e) => { e.preventDefault(); if (deactivating) deactivateMutation.mutate(deactivating); }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Deactivate (several) ---- */}
      <AlertDialog open={bulkOpen} onOpenChange={(o) => !o && setBulkOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {selected.length} selected?</AlertDialogTitle>
            <AlertDialogDescription>
              They will no longer appear in lists or be available for new Items. They are deactivated, not deleted: their
              history is kept and nothing that already references them is affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkMutation.isPending}
              onClick={() => bulkMutation.mutate()}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
