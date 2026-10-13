import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { Item } from "../items/types";
import { ItemFormDialog } from "../items/ItemFormDialog";
import { ErpStoresDialog } from "../asset-users/ErpStoresDialog";
import { reasonWords } from "../purchase-orders/PoDraftCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { canCreate, useCapabilities } from "@/lib/capabilities";
import { useCategoryLookups } from "@/lib/lookups";
import { companyOptions, itemOptions, vendorOptions } from "@/lib/option-labels";

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
          <div className="w-64">
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
          message={inboxQ.error instanceof Error ? inboxQ.error.message : "Could not read the ERP inbox."}
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

function NewItemsSection({ groups, count, onChanged }: { groups: InboxItemGroup[]; count: number; onChanged: () => void }) {
  const { caps } = useCapabilities();
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items") });
  const items = (Array.isArray(itemsQ.data) ? itemsQ.data : []).filter((i) => i.is_active !== false);
  const lookups = useCategoryLookups();
  const options = useMemo(() => itemOptions(items, lookups), [items, lookups]);
  const [scopes, setScopes] = useState<Record<string, InboxScope>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkItem, setBulkItem] = useState("");
  const [newItemFor, setNewItemFor] = useState<InboxItemGroup | null>(null);
  const [results, setResults] = useState<ResultLine[]>([]);

  const scopeOf = (g: InboxItemGroup): InboxScope => {
    const allowed = scopesOf(g);
    const chosen = scopes[groupKey(g)];
    if (chosen && allowed.includes(chosen)) return chosen;
    return g.suggested_scope && allowed.includes(g.suggested_scope) ? g.suggested_scope : allowed[0];
  };

  const resolve = useMutation({
    mutationFn: async (work: { group: InboxItemGroup; decision: ItemDecision }[]) => {
      const entries = work.flatMap((w) => itemEntries(w.group, scopeOf(w.group), w.decision).map((e) => ({ e, label: groupTitle(w.group) })));
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

  const chosenGroups = groups.filter((g) => selected.has(groupKey(g)));
  const withSuggestion = chosenGroups.filter((g) => g.suggested_item_id != null);
  const toggle = (g: InboxItemGroup, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(groupKey(g)); else next.delete(groupKey(g));
      return next;
    });

  return (
    <SectionShell id="inbox-items" title="New items from ERP" count={count}>
      <p className="text-xs text-muted-foreground">
        ERP item codes on open purchase orders that are not linked to an Item yet, by ERP group. Decide once; every PO with these codes follows.
      </p>
      {resolve.isError && (
        <p className="text-sm text-destructive" role="alert">{resolve.error instanceof Error ? resolve.error.message : "That did not work."}</p>
      )}
      <Results lines={results} label="Item decisions" />
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs a decision.</p>
      ) : (
        <>
          {chosenGroups.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-sm" aria-label="Selected groups">
              <span>{plural(chosenGroups.length, "group")} selected</span>
              <AsyncButton
                size="sm" variant="outline" disabled={withSuggestion.length === 0} pending={resolve.isPending}
                onClick={() => resolve.mutate(withSuggestion.map((g) => ({ group: g, decision: { kind: "item", itemId: g.suggested_item_id! } })))}
              >
                Use the suggestions ({withSuggestion.length})
              </AsyncButton>
              <div className="w-56">
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
          <ul className="flex flex-col divide-y rounded-md border">
            {groups.map((g) => {
              const key = groupKey(g);
              const title = groupTitle(g);
              const scope = scopeOf(g);
              const pick = picked[key] ?? "";
              return (
                <li key={key} className="flex flex-col gap-1.5 p-2 text-sm" aria-label={`ERP group ${title}`}>
                  <div className="flex flex-wrap items-start gap-2">
                    <Checkbox aria-label={`Select ${title}`} checked={selected.has(key)} onCheckedChange={(v) => toggle(g, v === true)} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {title} <span className="text-xs font-normal text-muted-foreground">· {g.company_code}</span>
                      </p>
                      {(g.section || g.department) && (
                        <p className="text-xs text-muted-foreground">{[g.division, g.section, g.department].filter(Boolean).join(" › ")}</p>
                      )}
                      <ul className="mt-0.5 flex flex-col text-xs">
                        {g.codes.map((c) => (
                          <li key={c.icode}>
                            <span className="font-mono">{c.icode}</span> {c.name} · {plural(Math.round(c.units), "unit")}
                            {c.po_numbers.length > 0 && <span className="text-muted-foreground"> · on {c.po_numbers.join(", ")}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-6">
                    {g.suggested_item_id != null && (
                      <>
                        <span className="text-xs">
                          Suggested: <span className="font-medium">{g.suggested_item_name}</span>
                          {g.suggestion_score != null && <span className="text-muted-foreground"> ({Math.round(g.suggestion_score * 100)}% match)</span>}
                        </span>
                        <AsyncButton
                          size="sm" variant="outline" pending={resolve.isPending} aria-label={`Use suggestion for ${title}`}
                          onClick={() => resolve.mutate([{ group: g, decision: { kind: "item", itemId: g.suggested_item_id! } }])}
                        >
                          Use suggestion
                        </AsyncButton>
                      </>
                    )}
                    <div className="w-56">
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
                    <div className="w-56">
                      <SearchableSelect
                        id={`inbox-scope-${key}`} aria-label={`How far for ${title}`} value={scope}
                        onValueChange={(v) => setScopes((s) => ({ ...s, [key]: v as InboxScope }))}
                        options={scopesOf(g).map((s) => ({ value: s, label: SCOPE_WORDS[s] }))}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <ItemFormDialog
        open={newItemFor !== null}
        onOpenChange={(open) => !open && setNewItemFor(null)}
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
        <p className="text-sm text-destructive" role="alert">{resolve.error instanceof Error ? resolve.error.message : "That did not work."}</p>
      )}
      <Results lines={results} label="Vendor decisions" />
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs a decision.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {groups.map((g) => {
            const n = g.registrations.length;
            const all = n === 1 ? "" : ` all ${n}`;
            const pick = picked[g.group_key] ?? "";
            return (
              <li key={g.group_key} className="flex flex-col gap-1.5 p-2 text-sm" aria-label={`Supplier ${g.name}`}>
                <p className="font-medium">
                  {g.name}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {g.company_code}{g.pan ? ` · PAN ${g.pan}` : ""} · {plural(n, "registration")}
                  </span>
                </p>
                <ul className="flex flex-col text-xs">
                  {g.registrations.map((r) => (
                    <li key={r.erp_code}>
                      {r.name} · ERP code {r.erp_code}{r.gstin ? ` · GSTIN ${r.gstin}` : ""}
                      <span className="text-muted-foreground"> · {plural(r.open_pos, "open PO")}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-2">
                  {g.suggested_vendor_id != null && (
                    <AsyncButton
                      size="sm" variant="outline" pending={resolve.isPending}
                      onClick={() => resolve.mutate([{ group: g, action: "LINK", vendorId: g.suggested_vendor_id! }])}
                    >
                      Link{all} to {g.suggested_vendor_name}{g.suggestion_reason ? ` (${reasonWords(g.suggestion_reason)})` : ""}
                    </AsyncButton>
                  )}
                  <div className="w-56">
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
                    size="sm" variant="outline" pending={resolve.isPending} aria-label={`Create new vendor for ${g.name}`}
                    onClick={() => resolve.mutate([{ group: g, action: "CREATE" }])}
                  >
                    Create new vendor{n > 1 ? ` (links all ${n})` : ""}
                  </AsyncButton>
                </div>
              </li>
            );
          })}
        </ul>
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
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-xs">
            Open in the ERP, not created here yet: {shown.map((s) => s.code).join(", ")}
            {stores.length > shown.length ? ` and ${(stores.length - shown.length).toLocaleString("en-IN")} more` : ""}.
          </p>
          <ErpStoresDialog triggerLabel="Create stores…" initialCompanyId={firstCompany} />
        </div>
      )}
    </SectionShell>
  );
}
