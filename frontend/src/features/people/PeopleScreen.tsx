import { useEffect, useState } from "react";
import { Building2, KeyRound, Pencil, Trash2, Users } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { canManage, useCapabilities, useMyCompanies } from "@/lib/capabilities";
import { bulkDeactivate, type BulkDeactivateFailure } from "@/lib/bulk-deactivate";
import { useAccess } from "@/lib/access";
import { companyOptions } from "@/lib/option-labels";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { BulkImportExport } from "@/components/shared/BulkImportExport";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { NewInstallPointDialog, NewStockRoomDialog } from "@/components/quick-create/masters";
import { useDebounced } from "../purchase-orders/po-list";
import { ErpStoresDialog } from "../asset-users/ErpStoresDialog";
import { AddEmployeeDialog } from "./AddEmployeeDialog";
import { AddStoreDialog } from "./AddStoreDialog";
import { EditPersonDialog } from "./EditPersonDialog";
import { EnsureRoomsDialog } from "./EnsureRoomsDialog";
import { IssuePasswordsDialog } from "./IssuePasswordsDialog";
import { KIND_INFO, PEOPLE_PAGE_SIZE, peopleListPath, plural, yesNoWord, type PeopleKind, type PersonRow } from "./people-model";

interface Company {
  id: number;
  name: string;
}

/**
 * UX only (the server answers 403 either way): a head-office admin's account can
 * only be changed by a head-office admin, so for anyone else Edit / Deactivate /
 * Reset password / Company access are not offered on that row.
 */
export function canManageAccount(row: { is_primary_owner: boolean }, viewerIsPrimaryOwner: boolean): boolean {
  return !row.is_primary_owner || viewerIsPrimaryOwner;
}

const ALL = "__all__";

/**
 * People & Places (S5b-2): one list per kind -- Employees, Stores, Stock Rooms,
 * Install Points -- read from `GET /api/people?kind=…` (search and paging by the
 * server). Each kind has its own simple Add form with no type to choose; Edit,
 * Deactivate, Company access and Reset password stay. Employees and Stores can be
 * given login passwords in bulk ("Issue login passwords…").
 */
export function PeopleScreen({ kind, embedded = false }: { kind: PeopleKind; embedded?: boolean }) {
  const qc = useQueryClient();
  const info = KIND_INFO[kind];
  const { isPrimaryOwner } = useAccess();
  const { caps } = useCapabilities();
  const { companies: myCompanies } = useMyCompanies();
  const isHeadOffice = isPrimaryOwner || caps?.is_head_office_admin === true;

  // ---- the list ----
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const [company, setCompany] = useState(ALL);
  const viewKey = `${q}|${company}`;
  const [pageState, setPageState] = useState({ key: "", page: 0 });
  const page = pageState.key === viewKey ? pageState.page : 0;
  const companyId = company === ALL ? null : company;

  const listQ = useQuery({
    queryKey: ["people", kind, q, companyId, page],
    queryFn: () => apiClient.getPage<PersonRow[]>(peopleListPath({ kind, q, companyId, page })),
    placeholderData: (prev) => prev,
  });
  const rows: PersonRow[] = Array.isArray(listQ.data?.data) ? listQ.data.data : [];
  const total = typeof listQ.data?.total === "number" ? listQ.data.total : rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PEOPLE_PAGE_SIZE));
  const showCompany = myCompanies.length > 1 || new Set(rows.map((r) => r.company_id)).size > 1;

  // ---- selection (kept across pages, cleared when the view changes) ----
  const [selection, setSelection] = useState<{ key: string; rows: Map<number, PersonRow> }>({ key: "", rows: new Map() });
  const selected = selection.key === viewKey ? selection.rows : new Map<number, PersonRow>();
  function toggle(row: PersonRow, on: boolean) {
    const next = new Map(selected);
    if (on) next.set(row.id, row); else next.delete(row.id);
    setSelection({ key: viewKey, rows: next });
  }
  function toggleAll(on: boolean) {
    const next = new Map(selected);
    for (const r of rows.filter((x) => canManageAccount(x, isPrimaryOwner))) {
      if (on) next.set(r.id, r); else next.delete(r.id);
    }
    setSelection({ key: viewKey, rows: next });
  }
  const clearSelection = () => setSelection({ key: viewKey, rows: new Map() });

  // ---- dialogs ----
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [deactivateRow, setDeactivateRow] = useState<PersonRow | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkFailures, setBulkFailures] = useState<{ row: PersonRow; message: string }[] | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [ensureOpen, setEnsureOpen] = useState(false);
  const [accessRow, setAccessRow] = useState<PersonRow | null>(null);
  const [accessSelection, setAccessSelection] = useState<number[]>([]);
  // One-time temporary password of a single Reset Password: local state only, cleared on close.
  const [tempPassword, setTempPassword] = useState<{ name: string; password: string } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["people"] });
    qc.invalidateQueries({ queryKey: ["asset_users"] });
  }

  async function resetPassword(row: PersonRow) {
    setResetError(null);
    try {
      const r = await apiClient.post<{ temp_password: string }>(`/asset-users/${row.id}/reset-password`);
      setTempPassword({ name: row.name, password: r.temp_password });
      refresh();
    } catch (e) {
      setResetError(e instanceof Error ? e.message : "Could not reset the password.");
    }
  }

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/asset-users/${id}`),
    onSuccess: () => {
      refresh();
      setDeactivateRow(null);
    },
  });

  const bulkDeactivateMutation = useMutation({
    mutationFn: (ids: number[]) => bulkDeactivate((id) => `/asset-users/${id}`, ids),
    onSuccess: (result) => {
      refresh();
      setBulkConfirmOpen(false);
      if (result.failed.length === 0) {
        clearSelection();
        setBulkFailures(null);
        return;
      }
      // The ones that failed (e.g. "still holds 3 assets") stay ticked, so a retry is one click.
      const failed = result.failed
        .map((f: BulkDeactivateFailure) => {
          const row = selected.get(f.id);
          return row ? { row, message: f.message } : null;
        })
        .filter((f): f is { row: PersonRow; message: string } => f !== null);
      setBulkFailures(failed);
      setSelection({ key: viewKey, rows: new Map(failed.map((f) => [f.row.id, f.row])) });
    },
  });

  const companiesQ = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<Company[]>("/masters/companies"),
    enabled: accessRow !== null,
  });
  const allCompanies = Array.isArray(companiesQ.data) ? companiesQ.data : [];
  const accessQ = useQuery({
    queryKey: ["asset_users", accessRow?.id, "company-access"],
    queryFn: () => apiClient.get<{ company_ids: number[] }>(`/asset-users/${accessRow!.id}/company-access`),
    enabled: accessRow !== null,
  });
  useEffect(() => {
    if (accessQ.data) setAccessSelection(accessQ.data.company_ids);
  }, [accessQ.data]);
  const accessMutation = useMutation({
    mutationFn: () => apiClient.post(`/asset-users/${accessRow!.id}/company-access`, { company_ids: accessSelection }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_users", accessRow?.id, "company-access"] });
      setAccessRow(null);
    },
  });

  // ---- columns ----
  const actions: DataTableColumn<PersonRow> = {
    key: "__actions",
    header: <span className="sr-only">Actions</span>,
    headerClassName: "w-32 text-right",
    cellClassName: "text-right",
    cell: (r) =>
      !canManageAccount(r, isPrimaryOwner) ? (
        <span className="text-xs text-muted-foreground">Head-office admin only</span>
      ) : (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          {info.hasLogins && (
            <Button variant="ghost" size="icon" aria-label={`Company access for ${r.name}`} onClick={() => { setAccessRow(r); setAccessSelection([]); accessMutation.reset(); }}>
              <Building2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          {info.hasLogins && r.login_enabled && (
            <Button variant="ghost" size="icon" aria-label={`Reset password for ${r.name}`} onClick={() => resetPassword(r)}>
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          <Button variant="ghost" size="icon" aria-label={`Deactivate ${r.name}`} onClick={() => { deactivateMutation.reset(); setDeactivateRow(r); }}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ),
  };
  const placeCol: DataTableColumn<PersonRow> = { key: "place", header: "Place", cell: (r) => r.location_name ?? "—" };
  const companyCol: DataTableColumn<PersonRow>[] = showCompany
    ? [{ key: "company", header: "Company", cell: (r) => r.company_code ?? r.company_name ?? "—" }]
    : [];
  const signIn: DataTableColumn<PersonRow>[] = [
    { key: "can_sign_in", header: "Can sign in", cell: (r) => yesNoWord(r.login_enabled) },
    { key: "password", header: "Password set", cell: (r) => (r.login_enabled ? yesNoWord(r.has_password) : "—") },
  ];
  const columns: DataTableColumn<PersonRow>[] =
    kind === "employees"
      ? [
          { key: "code", header: "Employee Code", cellClassName: "font-mono text-xs", cell: (r) => r.code ?? "—" },
          { key: "name", header: "Name", cellClassName: "font-medium", cell: (r) => r.name },
          placeCol,
          { key: "department", header: "Department", cell: (r) => r.department_name ?? "—" },
          { key: "access", header: "Access", cell: (r) => (r.login_enabled ? (r.role_label ?? "—") : "—") },
          { key: "work_area", header: "Work area", cell: (r) => r.work_area_label ?? "—" },
          ...signIn,
          ...companyCol,
          actions,
        ]
      : kind === "stores"
        ? [
            { key: "code", header: "Store Code", cellClassName: "font-mono text-xs", cell: (r) => r.code ?? "—" },
            { key: "name", header: "Name", cellClassName: "font-medium", cell: (r) => r.name },
            placeCol,
            { key: "email", header: "Login email", cellClassName: "text-xs", cell: (r) => r.email ?? "—" },
            ...signIn,
            ...companyCol,
            actions,
          ]
        : [
            { key: "name", header: info.noun, cellClassName: "font-medium", cell: (r) => r.name },
            { key: "code", header: "Code", cellClassName: "font-mono text-xs", cell: (r) => r.code ?? "—" },
            placeCol,
            ...companyCol,
            actions,
          ];

  const firstRow = total === 0 ? 0 : page * PEOPLE_PAGE_SIZE + 1;
  const lastRow = Math.min(total, page * PEOPLE_PAGE_SIZE + rows.length);
  const selectedRows = [...selected.values()];
  const allOnPageSelected = rows.length > 0 && rows.filter((r) => canManageAccount(r, isPrimaryOwner)).every((r) => selected.has(r.id));
  const companyFilterName = companyId ? myCompanies.find((c) => String(c.id) === companyId)?.name ?? null : null;
  const loginKind = kind === "stores" || kind === "employees" ? kind : null;
  const addLabel = `Add ${info.noun}`;

  function added(sentence: string) {
    setNotice(sentence);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={info.plural}
        as={embedded ? "h2" : "h1"}
        description={info.description}
        actions={
          <>
            {/* One import/export file covers every kind of person and place (its Type column says which). */}
            {!embedded && (
              <BulkImportExport resource="asset-users" label="People & Places" basePath="/asset-users" onImported={refresh} />
            )}
            {kind === "stores" && canManage(caps, "erp_setup") && <ErpStoresDialog />}
            {kind === "stores" && isHeadOffice && (
              <Button variant="outline" onClick={() => setEnsureOpen(true)}>Create missing rooms for existing stores</Button>
            )}
            {loginKind && (
              <Button variant="outline" onClick={() => setIssueOpen(true)}>Issue login passwords…</Button>
            )}
            <Button onClick={() => setAdding(true)}>{addLabel}</Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={`Search ${info.plural.toLowerCase()}`}
            placeholder={info.hasLogins ? "Search code, name, email, phone or place…" : "Search name, code or place…"}
            className="max-w-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {myCompanies.length > 1 && (
            <div className="w-56">
              <SearchableSelect
                id={`people-company-${kind}`} aria-label="Company" value={company} onValueChange={setCompany}
                options={[{ value: ALL, label: "All companies" }, ...companyOptions(myCompanies)]}
              />
            </div>
          )}
        </div>
      </PageHeader>

      {notice && (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" role="status">
          <span>{notice}</span>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>Dismiss</Button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span>{selected.size} selected</span>
          {loginKind && (
            <Button variant="outline" size="sm" onClick={() => setIssueOpen(true)}>Issue login passwords…</Button>
          )}
          <Button variant="destructive" size="sm" onClick={() => setBulkConfirmOpen(true)}>Deactivate {selected.size} selected</Button>
          <Button variant="ghost" size="sm" onClick={clearSelection}>Clear</Button>
        </div>
      )}

      {bulkFailures && bulkFailures.length > 0 && (
        <div role="alert" aria-label="Could not deactivate every selected row" className="flex flex-col gap-1 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-destructive">Could not deactivate {bulkFailures.length}:</span>
            <Button variant="ghost" size="sm" onClick={() => setBulkFailures(null)}>Dismiss</Button>
          </div>
          <ul className="list-disc pl-5">
            {bulkFailures.map(({ row, message }) => (
              <li key={row.id}><span className="font-medium">{row.name}</span>: {message}</li>
            ))}
          </ul>
        </div>
      )}

      {resetError && (
        <div role="alert" aria-label="Could not reset the password" className="flex items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{resetError}</span>
          <Button variant="ghost" size="sm" onClick={() => setResetError(null)}>Dismiss</Button>
        </div>
      )}

      <DataTable<PersonRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={listQ.isLoading}
        isError={listQ.isError}
        errorMessage={listQ.error instanceof Error ? listQ.error.message : undefined}
        onRetry={() => listQ.refetch()}
        selection={{
          isSelected: (r) => selected.has(r.id),
          onToggle: (r, checked) => { if (canManageAccount(r, isPrimaryOwner)) toggle(r, checked); },
          isAllSelected: allOnPageSelected,
          onToggleAll: toggleAll,
          rowAriaLabel: (r) => `Select ${r.name}`,
        }}
        emptyState={
          <EmptyState
            icon={Users}
            title={q || companyId ? `No ${info.plural.toLowerCase()} match.` : `No ${info.plural.toLowerCase()} yet`}
            description={q || companyId ? "Try another search or company." : info.description}
            action={q || companyId ? undefined : <Button onClick={() => setAdding(true)}>{addLabel}</Button>}
          />
        }
        pagination={
          total > PEOPLE_PAGE_SIZE
            ? {
                summary: <>Showing {firstRow}–{lastRow} of {total.toLocaleString("en-IN")} {total === 1 ? info.noun.toLowerCase() : info.plural.toLowerCase()}</>,
                pageLabel: <>Page {page + 1} of {pageCount}</>,
                onPrevious: () => setPageState({ key: viewKey, page: page - 1 }),
                onNext: () => setPageState({ key: viewKey, page: page + 1 }),
                previousDisabled: page === 0 || listQ.isFetching,
                nextDisabled: page + 1 >= pageCount || listQ.isFetching,
              }
            : undefined
        }
      />

      {/* ---- Add, one form per kind ---- */}
      {kind === "employees" && (
        <AddEmployeeDialog
          open={adding} onOpenChange={setAdding}
          onAdded={(row) => added(`Employee ${row.code ?? ""} · ${row.name} added.${row.login_enabled ? " They have no password yet: use Issue login passwords when they are ready to sign in." : ""}`)}
        />
      )}
      {kind === "stores" && <AddStoreDialog open={adding} onOpenChange={setAdding} />}
      {kind === "stock-rooms" && (
        <NewStockRoomDialog
          open={adding} onOpenChange={setAdding}
          onCreated={(row) => added(row.created === false ? `${String(row.name)} already existed; nothing new was added.` : `Stock Room ${String(row.name)} added.`)}
        />
      )}
      {kind === "install-points" && (
        <NewInstallPointDialog
          open={adding} onOpenChange={setAdding}
          onCreated={(row) => added(row.created === false ? `${String(row.name)} already existed; nothing new was added.` : `Install Point ${String(row.name)} added.`)}
        />
      )}

      <EditPersonDialog row={editing} kind={kind} onClose={() => setEditing(null)} />

      {loginKind && (
        <IssuePasswordsDialog
          open={issueOpen} onOpenChange={setIssueOpen} kind={loginKind}
          ticked={selectedRows} companyId={companyId ? Number(companyId) : null} companyName={companyFilterName}
        />
      )}
      {kind === "stores" && isHeadOffice && <EnsureRoomsDialog open={ensureOpen} onOpenChange={setEnsureOpen} />}

      <Dialog open={accessRow !== null} onOpenChange={(open) => !open && setAccessRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Company Access {accessRow ? `for ${accessRow.name}` : ""}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {accessRow?.name} always works in their own company ({accessRow?.company_name ?? accessRow?.company_code ?? ""}). Tick any other
            company they should also work in, for example someone who raises POs, receives goods or moves assets for more than one company.
          </p>
          {accessQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {allCompanies.filter((c) => c.id !== accessRow?.company_id).map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    aria-label={c.name}
                    checked={accessSelection.includes(c.id)}
                    onCheckedChange={(v) => setAccessSelection((ids) => (v === true ? [...ids, c.id] : ids.filter((id) => id !== c.id)))}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          )}
          {accessMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {accessMutation.error instanceof Error ? accessMutation.error.message : "Could not save company access."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccessRow(null)}>Cancel</Button>
            <AsyncButton onClick={() => accessMutation.mutate()} pending={accessMutation.isPending} pendingLabel="Saving…">Save</AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time temporary password of a single Reset Password: held only here and cleared on close. */}
      <AlertDialog open={tempPassword !== null} onOpenChange={(open) => !open && setTempPassword(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Temporary Password</AlertDialogTitle>
            <AlertDialogDescription>
              Share this password with {tempPassword?.name} securely. It will not be shown again; they must change it at first sign-in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="font-mono text-lg">{tempPassword?.password}</p>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setTempPassword(null)}>Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deactivateRow !== null} onOpenChange={(open) => { if (!open) { setDeactivateRow(null); deactivateMutation.reset(); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivateRow?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateRow?.name} will no longer {info.hasLogins ? "be able to sign in or " : ""}be given assets. Assets already with
              them stay where they are, and their history is kept. It is deactivated, not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* The server refuses while something is still held ("X still holds 3 assets. Move them ... first, then deactivate."). */}
          {deactivateMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {deactivateMutation.error instanceof Error ? deactivateMutation.error.message : "Could not deactivate this record."}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deactivateMutation.isPending}
              onClick={(e) => { e.preventDefault(); if (deactivateRow) deactivateMutation.mutate(deactivateRow.id); }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkConfirmOpen} onOpenChange={(open) => !open && setBulkConfirmOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {plural(selected.size, info.noun.toLowerCase(), info.plural.toLowerCase())}?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedRows.map((r) => r.name).join(", ")} will no longer {info.hasLogins ? "be able to sign in or " : ""}be given assets.
              Assets already with them stay where they are, and their history is kept. They are deactivated, not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkDeactivateMutation.isPending}
              onClick={() => bulkDeactivateMutation.mutate(selectedRows.map((r) => r.id))}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
