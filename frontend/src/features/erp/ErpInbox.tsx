import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Item } from "../items/types";
import { ItemFormDialog } from "../items/ItemFormDialog";
import { hasSuggestion, suggestionNeedsConfirm, suggestionQuestion, suggestionWords } from "../items/suggestion-words";
import { ErpStoresDialog } from "../asset-users/ErpStoresDialog";
import { reasonWords } from "../purchase-orders/PoDraftCard";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { canCreate, useCapabilities } from "@/lib/capabilities";
import { useCategoryLookups } from "@/lib/lookups";
import { companyOptions, itemOptions, vendorOptions } from "@/lib/option-labels";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

export type InboxScope = "ARTICLE" | "NAME" | "CODE";
export type InboxSection = "items" | "vendors" | "stores";

export interface InboxCode {
  icode: string;
  name: string;
  units: number;
  po_numbers: string[];
  scopes?: InboxScope[];
}

export interface InboxItemGroup {
  company_id: number;
  company_code: string;
  article_key: string | null;
  article_name: string | null;
  department?: string | null;
  section?: string | null;
  division?: string | null;
  suggested_scope?: InboxScope | null;
  codes: InboxCode[];
  suggested_item_id: number | null;
  suggested_item_name: string | null;
  suggestion_score?: number | null;
  /** S7: "same name" / "similar name", and its code SAME_NAME / SIMILAR_NAME. */
  suggestion_reason?: string | null;
  suggestion_reason_code?: string | null;
  /** S7 fix 2: the reach the server judged the suggestion for (a mixed group: NAME, never ARTICLE). */
  suggestion_scope?: InboxScope | null;
  seen_on_pos?: string[];
  po_count?: number;
}

export interface InboxVendorGroup {
  company_id: number;
  company_code: string;
  group_key: string;
  pan: string | null;
  name: string;
  registrations: { erp_code: string; name: string; gstin: string | null; open_pos: number }[];
  suggested_vendor_id: number | null;
  suggested_vendor_name: string | null;
  suggestion_reason: string | null;
}

export interface InboxStore {
  code: string;
  name: string;
  company_id?: number;
  selectable?: boolean;
}

export interface Inbox {
  counts: { items: number; vendors: number; stores: number; item_codes?: number; vendor_registrations?: number };
  items: InboxItemGroup[];
  vendors: InboxVendorGroup[];
  stores: InboxStore[];
}

interface ResolveResult {
  ok: boolean;
  message: string;
}

interface Named {
  id: number;
  name: string;
  code?: string | null;
  gstin?: string | null;
}

type ItemDecision = { kind: "item"; itemId: number } | { kind: "not_tracked" };
/** One group's decision, at a reach (default: the group's "How far"). */
type Work = { group: InboxItemGroup; decision: ItemDecision; scope?: InboxScope };

/** One line of the results list: which group, and what the server said. */
interface ResultLine {
  label: string;
  ok: boolean;
  message: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

export const INBOX_PATH = "/settings/erp/inbox";

/** The ERP inbox for one company, or for every company ("all"). */
export function inboxPath(companyId: string): string {
  return companyId && companyId !== "all" ? `/erp/inbox?company_id=${companyId}` : "/erp/inbox";
}

const groupKey = (g: InboxItemGroup) => `${g.company_id}:${g.article_key ?? g.codes.map((c) => c.icode).join(",")}`;
const groupTitle = (g: InboxItemGroup) => g.article_name ?? g.article_key ?? (g.codes.length === 1 ? g.codes[0].name : "Codes without an ERP group");

/** The reaches a group can be decided for: the whole ERP group, each product name, each code. */
function scopesOf(g: InboxItemGroup): InboxScope[] {
  const out: InboxScope[] = [];
  if (g.article_key) out.push("ARTICLE");
  if (g.codes.some((c) => !c.scopes || c.scopes.includes("NAME"))) out.push("NAME");
  out.push("CODE");
  return out;
}

const SCOPE_WORDS: Record<InboxScope, string> = {
  ARTICLE: "Every code in this ERP group",
  NAME: "Each product name",
  CODE: "Each code only",
};

/**
 * The resolve entries for one group (S3a-2 `POST /erp/inbox/items/resolve`): one for the whole Article, else one
 * per code (per product name for NAME; a code that has no product name is decided for itself).
 */
export function itemEntries(g: InboxItemGroup, scope: InboxScope, decision: ItemDecision) {
  const what = decision.kind === "item" ? { item_id: decision.itemId } : { not_tracked: true };
  if (scope === "ARTICLE" && g.article_key) return [{ company_id: g.company_id, article_key: g.article_key, scope, ...what }];
  const names = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const c of g.codes) {
    const s: InboxScope = scope === "ARTICLE" || (c.scopes && !c.scopes.includes(scope)) ? "CODE" : scope;
    if (s === "NAME") {
      const k = c.name.trim().toLowerCase();
      if (names.has(k)) continue;
      names.add(k);
    }
    out.push({ company_id: g.company_id, icode: c.icode, scope: s, ...what });
  }
  return out;
}

/**
 * Settings › ERP › ERP Inbox (head-office admin): only what the ERP brought in that needs one decision -- new item
 * codes seen on open POs (by ERP group), new suppliers (by company PAN), and stores not created yet. Each decision
 * is remembered, so it is never asked again. Operators decide the same things inside the PO review.
 */
export function ErpInboxScreen({ section }: { section?: InboxSection } = {}) {
  const qc = useQueryClient();
  const companiesQ = useQuery({ queryKey: ["masters", "companies"], queryFn: () => apiClient.get<Named[]>("/masters/companies") });
  const companies = Array.isArray(companiesQ.data) ? companiesQ.data : [];
  const [companyId, setCompanyId] = useState("all");
  const inboxQ = useQuery({
    queryKey: ["erp", "inbox", companyId],
    queryFn: () => apiClient.get<Inbox>(inboxPath(companyId)),
    retry: false,
  });
  const inbox = inboxQ.data;

  useEffect(() => {
    if (!section || !inbox) return;
    document.getElementById(`inbox-${section}`)?.scrollIntoView?.({ block: "start" });
  }, [section, inbox]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["erp", "inbox"] });
    qc.invalidateQueries({ queryKey: ["erp", "pos"] });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ERP Inbox"
        description="What the ERP brought in that needs one decision: new items on open purchase orders, new suppliers and stores not created yet. Each decision is remembered and never asked again."
        actions={<Button asChild variant="outline"><Link to="/settings/erp/mapping">Advanced mapping rules</Link></Button>}
      />
      <div className="flex flex-wrap items-center gap-3">
        {companies.length > 1 && (
          <div className="w-full sm:w-64">
            <SearchableSelect
              id="inbox-company" aria-label="Company" value={companyId} onValueChange={setCompanyId}
              options={[{ value: "all", label: "All companies" }, ...companyOptions(companies)]}
            />
          </div>
        )}
        {inbox && (
          <p className="text-sm" aria-label="Inbox counts">
            <a className="underline-offset-2 hover:underline" href="#inbox-items">{plural(inbox.counts.items, "new item")}</a>
            {" · "}
            <a className="underline-offset-2 hover:underline" href="#inbox-vendors">{plural(inbox.counts.vendors, "new vendor")}</a>
            {" · "}
            <a className="underline-offset-2 hover:underline" href="#inbox-stores">{plural(inbox.counts.stores, "new store")}</a>
          </p>
        )}
      </div>

      {inboxQ.isLoading && <p className="text-sm text-muted-foreground">Reading the ERP…</p>}
      {inboxQ.isError && (
        <ErrorState
          message={inboxQ.error instanceof Error ? inboxQ.error.message : "Could not read the ERP inbox."} error={inboxQ.error}
          onRetry={() => inboxQ.refetch()}
        />
      )}
      {inbox && (
        <>
          <NewItemsSection groups={inbox.items ?? []} count={inbox.counts.items} onChanged={refresh} />
          <NewVendorsSection groups={inbox.vendors ?? []} count={inbox.counts.vendors} onChanged={refresh} />
          <NewStoresSection stores={inbox.stores ?? []} count={inbox.counts.stores} companyId={companyId} />
        </>
      )}
    </div>
  );
}

function SectionShell({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="flex flex-col gap-2 rounded-md border bg-card p-3">
      <h2 className="text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground tabular-nums">({count.toLocaleString("en-IN")})</span>
      </h2>
      {children}
    </section>
  );
}

function Results({ lines, label }: { lines: ResultLine[]; label: string }) {
  if (lines.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 rounded-md border bg-muted/30 p-2 text-xs" aria-label={label} role="status">
      {lines.map((r, i) => (
        <li key={i} className={r.ok ? "text-on-success-soft" : "text-destructive"}>
          <span className="font-medium">{r.label}:</span> {r.ok ? "" : "Not done. "}{r.message}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// New items from ERP
// ---------------------------------------------------------------------------

/** Groups shown per page (S7 P2-5: the inbox was one 33,000-px page). */
export const INBOX_PAGE_SIZE = 20;
/** PO numbers listed for one code before "and N more". */
export const PO_NUMBERS_SHOWN = 5;
/** Registrations listed for one supplier before "and N more". */
const REGISTRATIONS_SHOWN = 3;

/** "SPO/1, SPO/2, … and 95 more". */
export function poNumbersText(numbers: string[], shown = PO_NUMBERS_SHOWN): string {
  if (numbers.length <= shown) return numbers.join(", ");
  return `${numbers.slice(0, shown).join(", ")} and ${(numbers.length - shown).toLocaleString("en-IN")} more`;
}

/** Every word a group can be found by: its title, codes, product names, PO numbers and the suggestion. */
function itemGroupText(g: InboxItemGroup): string {
  return [
    groupTitle(g), g.company_code, g.department, g.section, g.division, g.suggested_item_name,
    ...g.codes.flatMap((c) => [c.icode, c.name, ...c.po_numbers]),
  ].filter(Boolean).join(" ").toLowerCase();
}

function vendorGroupText(g: InboxVendorGroup): string {
  return [g.name, g.company_code, g.pan, g.suggested_vendor_name, ...g.registrations.flatMap((r) => [r.erp_code, r.name, r.gstin])]
    .filter(Boolean).join(" ").toLowerCase();
}

function matches(text: string, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => text.includes(w));
}

/** Search box + "Showing 21–40 of 131" + Previous / Next, for one inbox section. */
function useInboxPaging<T>(rows: T[], textOf: (row: T) => string) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => (query.trim() ? rows.filter((r) => matches(textOf(r), query)) : rows), [rows, query, textOf]);
  const pages = Math.max(1, Math.ceil(filtered.length / INBOX_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * INBOX_PAGE_SIZE, (current + 1) * INBOX_PAGE_SIZE);
  return {
    query, setQuery: (q: string) => { setQuery(q); setPage(0); },
    page: current, pages, setPage, filtered, shown,
  };
}

function PagingBar({ label, paging, noun }: {
  label: string;
  noun: string;
  paging: { query: string; setQuery: (q: string) => void; page: number; pages: number; setPage: (p: number) => void; filtered: unknown[] };
}) {
  const total = paging.filtered.length;
  const from = total === 0 ? 0 : paging.page * INBOX_PAGE_SIZE + 1;
  const to = Math.min(total, (paging.page + 1) * INBOX_PAGE_SIZE);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <Input
        aria-label={`Search ${label}`} placeholder={`Search ${label}…`} className="h-8 w-full sm:w-72"
        value={paging.query} onChange={(e) => paging.setQuery(e.target.value)}
      />
      <p className="text-xs text-muted-foreground" role="status" aria-label={`${label} shown`}>
        {total === 0 ? `No ${noun}s match.` : `Showing ${from.toLocaleString("en-IN")}–${to.toLocaleString("en-IN")} of ${plural(total, noun)}`}
      </p>
      {paging.pages > 1 && (
        <div className="flex items-center gap-1 sm:ml-auto">
          <Button size="sm" variant="outline" disabled={paging.page === 0} onClick={() => paging.setPage(paging.page - 1)} aria-label={`Previous page of ${label}`}>
            Previous
          </Button>
          <span className="px-1 text-xs tabular-nums text-muted-foreground">Page {paging.page + 1} of {paging.pages}</span>
          <Button size="sm" variant="outline" disabled={paging.page >= paging.pages - 1} onClick={() => paging.setPage(paging.page + 1)} aria-label={`Next page of ${label}`}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function NewItemsSection({ groups, count, onChanged }: { groups: InboxItemGroup[]; count: number; onChanged: () => void }) {
  const { caps } = useCapabilities();
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items") });
  const items = (Array.isArray(itemsQ.data) ? itemsQ.data : []).filter((i) => i.is_active !== false);
  const lookups = useCategoryLookups();
  const options = useMemo(() => itemOptions(items, lookups), [items, lookups]);
  const [scopes, setScopes] = useState<Record<string, InboxScope>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [bulkItem, setBulkItem] = useState("");
  const [newItemFor, setNewItemFor] = useState<InboxItemGroup | null>(null);
  const [results, setResults] = useState<ResultLine[]>([]);
  const paging = useInboxPaging(groups, itemGroupText);

  const scopeOf = (g: InboxItemGroup): InboxScope => {
    const allowed = scopesOf(g);
    const chosen = scopes[groupKey(g)];
    if (chosen && allowed.includes(chosen)) return chosen;
    return g.suggested_scope && allowed.includes(g.suggested_scope) ? g.suggested_scope : allowed[0];
  };

  /**
   * The reach "Use suggestion" saves (S7 fix 2): what the person chose under "How far", else the reach the server
   * judged the suggestion for (a mixed ERP group's Item is suggested per product name, never for the whole group),
   * else the group's default reach.
   */
  const suggestionReach = (g: InboxItemGroup): InboxScope => {
    const allowed = scopesOf(g);
    const chosen = scopes[groupKey(g)];
    if (chosen && allowed.includes(chosen)) return chosen;
    if (g.suggestion_scope && allowed.includes(g.suggestion_scope)) return g.suggestion_scope;
    return scopeOf(g);
  };
  const [askUse, setAskUse] = useState<{ work: Work[]; question: string } | null>(null);

  const resolve = useMutation({
    mutationFn: async (work: Work[]) => {
      const entries = work.flatMap((w) => itemEntries(w.group, w.scope ?? scopeOf(w.group), w.decision).map((e) => ({ e, label: groupTitle(w.group) })));
      const answer = await apiClient.post<ResolveResult[]>("/erp/inbox/items/resolve", entries.map((x) => x.e));
      return entries.map((x, i) => ({
        label: x.label,
        ok: answer?.[i]?.ok === true,
        message: answer?.[i]?.message ?? "No answer for this entry.",
      }));
    },
    onSuccess: (lines) => {
      setResults(lines);
      setSelected(new Set());
      onChanged();
    },
  });

  /** "Use suggestion" (one group): a similar name, or a whole ERP group, is confirmed first (S7 fix 2, N1). */
  const takeSuggestion = (g: InboxItemGroup) => {
    const reach = suggestionReach(g);
    const work: Work[] = [{ group: g, decision: { kind: "item", itemId: g.suggested_item_id! }, scope: reach }];
    if (!suggestionNeedsConfirm(g, reach)) {
      resolve.mutate(work);
      return;
    }
    const names = [...new Set(g.codes.map((c) => c.name.trim()).filter(Boolean))];
    setAskUse({
      work,
      question: suggestionQuestion(g.suggested_item_name ?? "the suggested Item", reach, {
        group: groupTitle(g), name: names.length === 1 ? names[0] : null, code: g.codes.length === 1 ? g.codes[0].icode : null,
      }),
    });
  };
  /** "Use the suggestions (n)": asked once for all of them when any is a similar name or a whole ERP group. */
  const takeSuggestions = (chosen: InboxItemGroup[]) => {
    const work: Work[] = chosen.map((g) => ({ group: g, decision: { kind: "item", itemId: g.suggested_item_id! }, scope: suggestionReach(g) }));
    if (!work.some((w) => suggestionNeedsConfirm(w.group, w.scope))) {
      resolve.mutate(work);
      return;
    }
    setAskUse({
      work,
      question: `Use the suggested Item for each of the ${plural(work.length, "selected group")}? Some names are only similar, or the choice reaches a whole ERP group. This is remembered for everyone.`,
    });
  };

  const chosenGroups = groups.filter((g) => selected.has(groupKey(g)));
  const withSuggestion = chosenGroups.filter((g) => hasSuggestion(g));
  const toggle = (g: InboxItemGroup, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(groupKey(g)); else next.delete(groupKey(g));
      return next;
    });
  const pageKeys = paging.shown.map(groupKey);
  const allOnPage = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k));
  const toggleOpen = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <SectionShell id="inbox-items" title="New items from ERP" count={count}>
      <p className="text-xs text-muted-foreground">
        ERP item codes on open purchase orders that are not linked to an Item yet, by ERP group. Decide once; every PO with these codes follows.
      </p>
      {resolve.isError && (
        <ErrorMessage className="text-sm text-destructive" error={resolve.error} message={resolve.error instanceof Error ? resolve.error.message : "That did not work."} />
      )}
      <Results lines={results} label="Item decisions" />
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs a decision.</p>
      ) : (
        <>
          <PagingBar label="ERP groups" noun="group" paging={paging} />
          {chosenGroups.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-sm sm:flex-row sm:flex-wrap sm:items-center" aria-label="Selected groups">
              <span>{plural(chosenGroups.length, "group")} selected</span>
              <AsyncButton
                size="sm" variant="outline" disabled={withSuggestion.length === 0} pending={resolve.isPending}
                onClick={() => takeSuggestions(withSuggestion)}
              >
                Use the suggestions ({withSuggestion.length})
              </AsyncButton>
              <div className="w-full sm:w-56">
                <SearchableSelect id="inbox-bulk-item" aria-label="Item for the selected groups" value={bulkItem || undefined} onValueChange={setBulkItem} options={options} placeholder="Pick one Item…" />
              </div>
              <AsyncButton
                size="sm" variant="outline" disabled={!bulkItem} pending={resolve.isPending}
                onClick={() => resolve.mutate(chosenGroups.map((g) => ({ group: g, decision: { kind: "item", itemId: Number(bulkItem) } })))}
              >
                Link the selected to this Item
              </AsyncButton>
              <AsyncButton
                size="sm" variant="outline" pending={resolve.isPending}
                onClick={() => resolve.mutate(chosenGroups.map((g) => ({ group: g, decision: { kind: "not_tracked" } })))}
              >
                Not tracked
              </AsyncButton>
            </div>
          )}
          {paging.shown.length > 0 && (
            <label className="flex w-fit items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                aria-label="Select every group on this page" checked={allOnPage}
                onCheckedChange={(v) => setSelected((s) => {
                  const next = new Set(s);
                  for (const k of pageKeys) { if (v === true) next.add(k); else next.delete(k); }
                  return next;
                })}
              />
              Select every group on this page
            </label>
          )}
          <ul className="flex flex-col divide-y rounded-md border">
            {paging.shown.map((g) => {
              const key = groupKey(g);
              const title = groupTitle(g);
              const scope = scopeOf(g);
              const pick = picked[key] ?? "";
              const isOpen = open.has(key);
              const units = g.codes.reduce((n, c) => n + c.units, 0);
              const poCount = g.po_count ?? new Set(g.codes.flatMap((c) => c.po_numbers)).size;
              return (
                <li key={key} className="flex flex-col gap-1.5 p-2 text-sm" aria-label={`ERP group ${title}`}>
                  <div className="flex items-start gap-2">
                    <Checkbox aria-label={`Select ${title}`} checked={selected.has(key)} onCheckedChange={(v) => toggle(g, v === true)} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium break-words">
                        {title} <span className="text-xs font-normal text-muted-foreground">· {g.company_code}</span>
                      </p>
                      <p className="text-xs text-muted-foreground" aria-label={`Counts for ${title}`}>
                        {plural(g.codes.length, "code")} · {plural(Math.round(units), "unit")} · on {plural(poCount, "PO")}
                      </p>
                    </div>
                    <Button
                      size="sm" variant="ghost" className="shrink-0" aria-expanded={isOpen} aria-label={`Details for ${title}`}
                      onClick={() => toggleOpen(key)}
                    >
                      {isOpen ? "Hide" : "Details"}
                    </Button>
                  </div>
                  {hasSuggestion(g) && (
                    <div className="flex flex-col gap-1.5 pl-6 sm:flex-row sm:flex-wrap sm:items-center">
                      <span className="text-xs">
                        Suggested: <span className="font-medium">{g.suggested_item_name}</span>
                        <span className="text-muted-foreground"> · {suggestionWords(g)}</span>
                      </span>
                      <AsyncButton
                        size="sm" variant="outline" className="w-full sm:w-auto" pending={resolve.isPending} aria-label={`Use suggestion for ${title}`}
                        onClick={() => takeSuggestion(g)}
                      >
                        Use suggestion
                      </AsyncButton>
                    </div>
                  )}
                  {isOpen && (
                    <>
                      <div className="pl-6">
                        {(g.section || g.department) && (
                          <p className="text-xs text-muted-foreground">{[g.division, g.section, g.department].filter(Boolean).join(" › ")}</p>
                        )}
                        <ul className="mt-0.5 flex flex-col text-xs">
                          {g.codes.map((c) => (
                            <li key={c.icode} className="break-words">
                              <span className="font-mono">{c.icode}</span> {c.name} · {plural(Math.round(c.units), "unit")}
                              {c.po_numbers.length > 0 && <span className="text-muted-foreground"> · on {poNumbersText(c.po_numbers)}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex flex-col gap-2 pl-6 sm:flex-row sm:flex-wrap sm:items-center">
                        <div className="w-full sm:w-56">
                          <SearchableSelect
                            id={`inbox-pick-${key}`} aria-label={`Pick another Item for ${title}`} value={pick || undefined}
                            onValueChange={(v) => setPicked((p) => ({ ...p, [key]: v }))} options={options} placeholder="Pick another…"
                          />
                        </div>
                        {pick && (
                          <AsyncButton
                            size="sm" variant="outline" pending={resolve.isPending} aria-label={`Link ${title} to the picked Item`}
                            onClick={() => resolve.mutate([{ group: g, decision: { kind: "item", itemId: Number(pick) } }])}
                          >
                            Link
                          </AsyncButton>
                        )}
                        {canCreate(caps, "item") && (
                          <Button size="sm" variant="outline" aria-label={`New Item for ${title}`} onClick={() => setNewItemFor(g)}>+ New Item</Button>
                        )}
                        <AsyncButton
                          size="sm" variant="outline" pending={resolve.isPending} aria-label={`Not tracked: ${title}`}
                          onClick={() => resolve.mutate([{ group: g, decision: { kind: "not_tracked" } }])}
                        >
                          Not tracked
                        </AsyncButton>
                        <div className="w-full sm:w-56">
                          <SearchableSelect
                            id={`inbox-scope-${key}`} aria-label={`How far for ${title}`} value={scope}
                            onValueChange={(v) => setScopes((s) => ({ ...s, [key]: v as InboxScope }))}
                            options={scopesOf(g).map((s) => ({ value: s, label: SCOPE_WORDS[s] }))}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <AlertDialog open={askUse !== null} onOpenChange={(o) => !o && setAskUse(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use the suggestion?</AlertDialogTitle>
            <AlertDialogDescription>{askUse?.question ?? ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (askUse) resolve.mutate(askUse.work);
                setAskUse(null);
              }}
            >
              Use it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ItemFormDialog
        open={newItemFor !== null}
        onOpenChange={(o) => !o && setNewItemFor(null)}
        initialName={newItemFor ? (newItemFor.codes[0]?.name || newItemFor.article_name || undefined) : undefined}
        onSaved={(saved) => {
          if (newItemFor) resolve.mutate([{ group: newItemFor, decision: { kind: "item", itemId: saved.id } }]);
        }}
      />
    </SectionShell>
  );
}

// ---------------------------------------------------------------------------
// New vendors from ERP
// ---------------------------------------------------------------------------

function NewVendorsSection({ groups, count, onChanged }: { groups: InboxVendorGroup[]; count: number; onChanged: () => void }) {
  const qc = useQueryClient();
  const vendorsQ = useQuery({ queryKey: ["masters", "vendors"], queryFn: () => apiClient.get<Named[]>("/masters/vendors") });
  const vendors = Array.isArray(vendorsQ.data) ? vendorsQ.data : [];
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [results, setResults] = useState<ResultLine[]>([]);
  const [allShown, setAllShown] = useState<Set<string>>(new Set());
  const paging = useInboxPaging(groups, vendorGroupText);

  const resolve = useMutation({
    mutationFn: async (work: { group: InboxVendorGroup; action: "LINK" | "CREATE"; vendorId?: number }[]) => {
      const body = work.map((w) => ({
        company_id: w.group.company_id,
        erp_vendor_codes: w.group.registrations.map((r) => r.erp_code),
        action: w.action,
        ...(w.action === "LINK" ? { vendor_id: w.vendorId } : {}),
      }));
      const answer = await apiClient.post<ResolveResult[]>("/erp/inbox/vendors/resolve", body);
      return work.map((w, i) => ({
        label: w.group.name,
        ok: answer?.[i]?.ok === true,
        message: answer?.[i]?.message ?? "No answer for this entry.",
      }));
    },
    onSuccess: (lines) => {
      setResults(lines);
      qc.invalidateQueries({ queryKey: ["masters", "vendors"] });
      qc.invalidateQueries({ queryKey: ["erp", "vendors"] });
      onChanged();
    },
  });

  return (
    <SectionShell id="inbox-vendors" title="New vendors from ERP" count={count}>
      <p className="text-xs text-muted-foreground">
        ERP suppliers not matched to a vendor yet, by company PAN (one supplier often has a registration per state). Nothing is linked until you choose.
      </p>
      {resolve.isError && (
        <ErrorMessage className="text-sm text-destructive" error={resolve.error} message={resolve.error instanceof Error ? resolve.error.message : "That did not work."} />
      )}
      <Results lines={results} label="Vendor decisions" />
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs a decision.</p>
      ) : (
        <>
          <PagingBar label="suppliers" noun="supplier" paging={paging} />
          <ul className="flex flex-col divide-y rounded-md border">
            {paging.shown.map((g) => {
              const n = g.registrations.length;
              const all = n === 1 ? "" : ` all ${n}`;
              const pick = picked[g.group_key] ?? "";
              const everyRegistration = allShown.has(g.group_key);
              const regs = everyRegistration ? g.registrations : g.registrations.slice(0, REGISTRATIONS_SHOWN);
              return (
                <li key={g.group_key} className="flex flex-col gap-1.5 p-2 text-sm" aria-label={`Supplier ${g.name}`}>
                  <p className="font-medium break-words">
                    {g.name}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      · {g.company_code}{g.pan ? ` · PAN ${g.pan}` : ""} · {plural(n, "registration")}
                    </span>
                  </p>
                  <ul className="flex flex-col text-xs">
                    {regs.map((r) => (
                      <li key={r.erp_code} className="break-words">
                        {r.name} · ERP code {r.erp_code}{r.gstin ? ` · GSTIN ${r.gstin}` : ""}
                        <span className="text-muted-foreground"> · {plural(r.open_pos, "open PO")}</span>
                      </li>
                    ))}
                  </ul>
                  {n > REGISTRATIONS_SHOWN && (
                    <Button
                      size="sm" variant="link" className="h-auto w-fit p-0 text-xs"
                      onClick={() => setAllShown((s) => {
                        const next = new Set(s);
                        if (next.has(g.group_key)) next.delete(g.group_key); else next.add(g.group_key);
                        return next;
                      })}
                    >
                      {everyRegistration ? "Show fewer" : `and ${n - REGISTRATIONS_SHOWN} more`}
                    </Button>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    {g.suggested_vendor_id != null && (
                      <AsyncButton
                        size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal text-left" pending={resolve.isPending}
                        onClick={() => resolve.mutate([{ group: g, action: "LINK", vendorId: g.suggested_vendor_id! }])}
                      >
                        Link{all} to {g.suggested_vendor_name}{g.suggestion_reason ? ` (${reasonWords(g.suggestion_reason)})` : ""}
                      </AsyncButton>
                    )}
                    <div className="w-full sm:w-56">
                      <SearchableSelect
                        id={`inbox-vendor-${g.group_key}`} aria-label={`Link ${g.name} to an existing vendor`} value={pick || undefined}
                        onValueChange={(v) => setPicked((p) => ({ ...p, [g.group_key]: v }))} options={vendorOptions(vendors)}
                        placeholder="Link to existing…"
                      />
                    </div>
                    {pick && (
                      <AsyncButton
                        size="sm" variant="outline" pending={resolve.isPending} aria-label={`Link${all} ${g.name} registrations to the picked vendor`}
                        onClick={() => resolve.mutate([{ group: g, action: "LINK", vendorId: Number(pick) }])}
                      >
                        Link{all}
                      </AsyncButton>
                    )}
                    <AsyncButton
                      size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal" pending={resolve.isPending} aria-label={`Create new vendor for ${g.name}`}
                      onClick={() => resolve.mutate([{ group: g, action: "CREATE" }])}
                    >
                      Create new vendor{n > 1 ? ` (links all ${n})` : ""}
                    </AsyncButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </SectionShell>
  );
}

// ---------------------------------------------------------------------------
// New stores
// ---------------------------------------------------------------------------

function NewStoresSection({ stores, count, companyId }: { stores: InboxStore[]; count: number; companyId: string }) {
  const shown = stores.slice(0, 12);
  const firstCompany = companyId !== "all" ? Number(companyId) : stores[0]?.company_id ?? null;
  return (
    <SectionShell id="inbox-stores" title="New stores" count={count}>
      {stores.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs a decision.</p>
      ) : (
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="min-w-0 break-words text-xs">
            Open in the ERP, not created here yet: {shown.map((s) => s.code).join(", ")}
            {stores.length > shown.length ? ` and ${(stores.length - shown.length).toLocaleString("en-IN")} more` : ""}.
          </p>
          <ErpStoresDialog triggerLabel="Create stores…" initialCompanyId={firstCompany} />
        </div>
      )}
    </SectionShell>
  );
}
