import { useEffect, useMemo, useState } from "react";
import { Users, Pencil, Trash2, KeyRound, Building2, Check, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { BulkImportExport } from "@/components/shared/BulkImportExport";

const HOLDER_TYPES = ["EMPLOYEE", "STORE", "INSTALLED", "IT_STOCK"] as const;
const ROLES = ["ADMIN", "IT_TEAM", "VIEWER", "HOLDER"] as const;

// IT_STOCK/INSTALLED holders aren't people -- they're a location's own
// stock/install bucket (one per physical location a company has), which
// made the ordinary "Emp Code"/Name fields confusing to fill in (there's
// no employee). This config drives dynamic labels, an auto-suggested
// code/name derived from the chosen Location so nobody has to invent one,
// and the coverage checklist below ("which locations still need a stock
// point") -- see the product discussion that prompted this.
const TYPE_POINT_CONFIG: Partial<Record<(typeof HOLDER_TYPES)[number], { prefix: string; noun: string }>> = {
  IT_STOCK: { prefix: "STK", noun: "Stock Point" },
  INSTALLED: { prefix: "INS", noun: "Install Point" },
};

function pointConfigFor(holderType: string) {
  return TYPE_POINT_CONFIG[holderType as (typeof HOLDER_TYPES)[number]];
}

// Alphanumeric-only, uppercased -- matches how every master's own Code
// column is conventionally written; a location code/name can contain
// spaces or punctuation a holder's emp_code shouldn't carry verbatim.
function slug(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

interface HolderRow {
  id: number;
  company_id: number;
  emp_code: string;
  name: string;
  holder_type: string;
  location_id: number;
  department_id: number | null;
  email: string | null;
  phone: string | null;
  role: string;
  is_active: boolean;
}

interface Company {
  id: number;
  name: string;
}

interface Location {
  id: number;
  company_id: number;
  code: string;
  name: string;
}

interface Department {
  id: number;
  name: string;
}

interface HolderDraft {
  company_id: string;
  emp_code: string;
  name: string;
  holder_type: string;
  location_id: string;
  department_id: string;
  email: string;
  phone: string;
  role: string;
}

const emptyDraft: HolderDraft = {
  company_id: "",
  emp_code: "",
  name: "",
  holder_type: "",
  location_id: "",
  department_id: "",
  email: "",
  phone: "",
  role: "HOLDER",
};

function buildPayload(draft: HolderDraft) {
  return {
    company_id: Number(draft.company_id),
    emp_code: draft.emp_code,
    name: draft.name,
    holder_type: draft.holder_type,
    location_id: Number(draft.location_id),
    department_id: draft.department_id ? Number(draft.department_id) : null,
    email: draft.email || null,
    phone: draft.phone || null,
    role: draft.role,
  };
}

export function HoldersScreen() {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [originalRole, setOriginalRole] = useState<string | null>(null);
  const [draft, setDraft] = useState<HolderDraft>(emptyDraft);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [deactivateRow, setDeactivateRow] = useState<HolderRow | null>(null);
  // AM-24: which OTHER companies (beyond this holder's own home company)
  // they're granted access to -- e.g. the one PO/PI person, the one
  // labeling person, the one movement person who all need to work across
  // more than one company, without making them ADMIN.
  const [accessRow, setAccessRow] = useState<HolderRow | null>(null);
  const [accessSelection, setAccessSelection] = useState<number[]>([]);

  const {
    data: holders = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["holders"],
    queryFn: () => apiClient.get<HolderRow[]>("/holders"),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<Company[]>("/masters/companies"),
  });

  // Locations are company-scoped now (like Cost Centres already were) -- only
  // fetch/show the picked company's own locations, not everyone's mixed
  // together (the exact confusion the coverage checklist below exposed).
  const { data: locations = [] } = useQuery({
    queryKey: ["masters", "locations", draft.company_id],
    queryFn: () => apiClient.get<Location[]>(`/masters/locations?company_id=${draft.company_id}`),
    enabled: draft.company_id !== "",
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["masters", "departments"],
    queryFn: () => apiClient.get<Department[]>("/masters/departments"),
  });

  const companyName = (id: number) => companies.find((c) => c.id === id)?.name ?? String(id);

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post("/holders", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holders"] });
      closeForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      apiClient.put(`/holders/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holders"] });
      closeForm();
    },
  });

  const resetMutation = useMutation({
    mutationFn: (id: number) => apiClient.post<{ temp_password: string }>(`/holders/${id}/reset-password`),
    onSuccess: (data) => {
      setTempPassword(data.temp_password);
      qc.invalidateQueries({ queryKey: ["holders"] });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/holders/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holders"] });
      setDeactivateRow(null);
    },
  });

  const accessQ = useQuery({
    queryKey: ["holders", accessRow?.id, "company-access"],
    queryFn: () => apiClient.get<{ company_ids: number[] }>(`/holders/${accessRow!.id}/company-access`),
    enabled: accessRow !== null,
  });

  const accessMutation = useMutation({
    mutationFn: () => apiClient.post(`/holders/${accessRow!.id}/company-access`, { company_ids: accessSelection }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holders", accessRow?.id, "company-access"] });
      setAccessRow(null);
    },
  });

  function openAccess(h: HolderRow) {
    setAccessRow(h);
    setAccessSelection([]);
  }

  // Seeds the checkbox selection from the holder's current grants once
  // they've loaded -- can't do this inline in openAccess since the fetch
  // is async and keyed off accessRow itself.
  useEffect(() => {
    if (accessQ.data) setAccessSelection(accessQ.data.company_ids);
  }, [accessQ.data]);

  function toggleAccessCompany(companyId: number, checked: boolean) {
    setAccessSelection((ids) => (checked ? [...ids, companyId] : ids.filter((id) => id !== companyId)));
  }

  function setField(key: keyof HolderDraft, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  // A blank Code/Name is auto-suggested from the chosen Location once both
  // Type (IT_STOCK/INSTALLED) and Location are known -- never overwrites
  // something already typed (a manual edit always wins), so this only ever
  // fires on a fresh Add before the admin has touched either field.
  function suggestPointFields(d: HolderDraft, holderType: string, locationId: string): Partial<HolderDraft> {
    const config = pointConfigFor(holderType);
    if (!config || d.emp_code.trim() !== "" || d.name.trim() !== "") return {};
    const location = locations.find((l) => l.id === Number(locationId));
    if (!location) return {};
    return { emp_code: `${config.prefix}-${slug(location.code)}`, name: `${config.noun} - ${location.name}` };
  }

  // Location is company-scoped now -- a location picked under a previous
  // Company selection may not even belong to the new one, so it's cleared
  // (along with any auto-suggested Code/Name, which only made sense paired
  // with that location) rather than silently left pointing at the wrong company.
  function handleCompanyChange(value: string) {
    setDraft((d) => ({ ...d, company_id: value, location_id: "" }));
  }

  function handleTypeChange(value: string) {
    setDraft((d) => ({ ...d, holder_type: value, ...suggestPointFields(d, value, d.location_id) }));
  }

  function handleLocationChange(value: string) {
    setDraft((d) => ({ ...d, location_id: value, ...suggestPointFields(d, d.holder_type, value) }));
  }

  function openAdd() {
    setEditingId(null);
    setOriginalRole(null);
    setDraft(emptyDraft);
    setFormOpen(true);
  }

  function openEdit(h: HolderRow) {
    setEditingId(h.id);
    setOriginalRole(h.role);
    setDraft({
      company_id: String(h.company_id),
      emp_code: h.emp_code,
      name: h.name,
      holder_type: h.holder_type,
      location_id: String(h.location_id),
      department_id: h.department_id ? String(h.department_id) : "",
      email: h.email ?? "",
      phone: h.phone ?? "",
      role: h.role,
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setOriginalRole(null);
    setDraft(emptyDraft);
  }

  function handleSave() {
    if (!canSave) return;
    const payload = buildPayload(draft);
    if (editingId != null) {
      updateMutation.mutate({ id: editingId, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const roleChanged = originalRole !== null && draft.role !== originalRole;
  const savePending = createMutation.isPending || updateMutation.isPending;
  const saveError = createMutation.error ?? updateMutation.error;
  // AM-08: `location_id` is a required (NOT NULL) foreign key on Holder --
  // it was never actually optional (see DECISIONS.md) -- so Save must be
  // blocked, not merely default a blank Select to the `0` sentinel that used
  // to reach the backend as an unhandled 500. Company/Emp Code/Name/Type are
  // likewise required by HolderIn; Department stays genuinely optional.
  const canSave =
    draft.company_id !== "" &&
    draft.emp_code.trim().length > 0 &&
    draft.name.trim().length > 0 &&
    draft.holder_type !== "" &&
    draft.location_id !== "";

  const activePointConfig = pointConfigFor(draft.holder_type);
  const codeLabel = activePointConfig ? `${activePointConfig.noun} Code` : "Emp Code";
  const nameLabel = activePointConfig ? `${activePointConfig.noun} Name` : "Name";

  // "Which of this company's locations already have an IT_STOCK/INSTALLED
  // point, and which still need one" -- the confusion this whole feature
  // addresses (see TYPE_POINT_CONFIG's own comment). Only shown once both
  // Type and Company are picked, since coverage is scoped per company.
  const pointCoverage = useMemo(() => {
    if (!activePointConfig || draft.company_id === "") return null;
    const companyId = Number(draft.company_id);
    const coveredIds = new Set(
      holders
        .filter((h) => h.company_id === companyId && h.holder_type === draft.holder_type && h.is_active)
        .map((h) => h.location_id),
    );
    return locations.map((l) => ({ location: l, covered: coveredIds.has(l.id) }));
  }, [activePointConfig, draft.holder_type, draft.company_id, holders, locations]);

  const columns: DataTableColumn<HolderRow>[] = [
    { key: "emp_code", header: "Emp Code", cell: (h) => h.emp_code },
    { key: "name", header: "Name", cell: (h) => h.name },
    { key: "holder_type", header: "Type", cell: (h) => h.holder_type },
    { key: "role", header: "Role", cell: (h) => h.role },
    { key: "company", header: "Company", cell: (h) => companyName(h.company_id) },
    {
      key: "__actions",
      header: <span className="sr-only">Actions</span>,
      headerClassName: "w-32 text-right",
      cellClassName: "text-right",
      cell: (h) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={`Edit ${h.name}`} onClick={() => openEdit(h)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Company access for ${h.name}`} onClick={() => openAccess(h)}>
            <Building2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Reset password for ${h.name}`}
            onClick={() => resetMutation.mutate(h.id)}
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Deactivate ${h.name}`}
            onClick={() => setDeactivateRow(h)}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Holders"
        actions={
          <>
            <BulkImportExport
              resource="holders"
              label="Holders"
              basePath="/holders"
              onImported={() => qc.invalidateQueries({ queryKey: ["holders"] })}
            />
            <Button onClick={openAdd}>Add</Button>
          </>
        }
      />

      <DataTable<HolderRow>
        columns={columns}
        rows={holders}
        rowKey={(h) => h.id}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
        emptyState={
          <EmptyState
            icon={Users}
            title="No holders yet"
            description="Add employees, stores, or stock locations that can hold assets."
            action={<Button onClick={openAdd}>Add</Button>}
          />
        }
      />

      <Dialog open={formOpen} onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId != null ? "Edit User" : "Add User"}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <FormField htmlFor="company_id" label="Company" required>
              <Select value={draft.company_id || undefined} onValueChange={handleCompanyChange}>
                <SelectTrigger id="company_id" aria-label="Company">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField htmlFor="holder_type" label="Type" required>
              <Select value={draft.holder_type || undefined} onValueChange={handleTypeChange}>
                <SelectTrigger id="holder_type" aria-label="Type">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {HOLDER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activePointConfig && (
                <p className="text-xs text-muted-foreground">
                  {activePointConfig.noun} isn't a person -- it's the place assets sit at one Location. Pick a
                  Location below and its Code/Name will be filled in for you.
                </p>
              )}
            </FormField>

            {pointCoverage && pointCoverage.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-md border bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {activePointConfig?.noun} coverage for this company
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {pointCoverage.map(({ location, covered }) => (
                    <span
                      key={location.id}
                      className={
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium " +
                        (covered ? "bg-success-soft text-on-success-soft" : "bg-muted text-muted-foreground")
                      }
                    >
                      {covered ? <Check className="h-3 w-3" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
                      {location.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <FormField htmlFor="location_id" label="Location" required>
              <Select value={draft.location_id || undefined} onValueChange={handleLocationChange}>
                <SelectTrigger id="location_id" aria-label="Location">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField htmlFor="emp_code" label={codeLabel} required>
              <Input
                id="emp_code"
                aria-label={codeLabel}
                value={draft.emp_code}
                onChange={(e) => setField("emp_code", e.target.value)}
              />
            </FormField>

            <FormField htmlFor="name" label={nameLabel} required>
              <Input
                id="name"
                aria-label={nameLabel}
                value={draft.name}
                onChange={(e) => setField("name", e.target.value)}
              />
            </FormField>

            <FormField htmlFor="department_id" label="Department">
              <Select value={draft.department_id || undefined} onValueChange={(v) => setField("department_id", v)}>
                <SelectTrigger id="department_id" aria-label="Department">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField htmlFor="email" label="Email">
              <Input
                id="email"
                aria-label="Email"
                value={draft.email}
                onChange={(e) => setField("email", e.target.value)}
              />
            </FormField>

            <FormField htmlFor="phone" label="Phone">
              <Input
                id="phone"
                aria-label="Phone"
                value={draft.phone}
                onChange={(e) => setField("phone", e.target.value)}
              />
            </FormField>

            <FormField
              htmlFor="role"
              label="Role"
              helperText={
                editingId != null
                  ? `Current role: ${originalRole}. Controls what this person can see and do in CKAM.`
                  : "Controls what this person can see and do in CKAM."
              }
            >
              <Select value={draft.role || undefined} onValueChange={(v) => setField("role", v)}>
                <SelectTrigger id="role" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {roleChanged && (
                <p className="text-xs font-medium text-warning" role="alert">
                  Changing role from {originalRole} to {draft.role} will immediately change this person's access.
                </p>
              )}
            </FormField>

            {saveError && (
              <p className="text-sm text-destructive" role="alert">
                {saveError instanceof Error ? saveError.message : "Failed to save this user."}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>
              Cancel
            </Button>
            <AsyncButton onClick={handleSave} disabled={!canSave} pending={savePending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={accessRow !== null} onOpenChange={(open) => !open && setAccessRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Company Access {accessRow ? `for ${accessRow.name}` : ""}</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            {accessRow?.name} always has access to their own company ({accessRow ? companyName(accessRow.company_id) : ""}).
            Check any other companies they should also be able to work in -- e.g. someone who raises POs, records
            deliveries, prints labels, or moves assets across more than one company.
          </p>

          {accessQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {companies
                .filter((c) => c.id !== accessRow?.company_id)
                .map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      aria-label={c.name}
                      checked={accessSelection.includes(c.id)}
                      onCheckedChange={(checked) => toggleAccessCompany(c.id, checked === true)}
                    />
                    {c.name}
                  </label>
                ))}
            </div>
          )}

          {accessMutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {accessMutation.error instanceof Error ? accessMutation.error.message : "Failed to save company access."}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAccessRow(null)}>
              Cancel
            </Button>
            <AsyncButton onClick={() => accessMutation.mutate()} pending={accessMutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        One-time temp-password reveal. `tempPassword` is held only in this
        component's local state -- it is never logged, never written to the
        holders list/cache, and is cleared (not merely hidden) the moment the
        dialog closes so it cannot be read back afterwards.
      */}
      <AlertDialog open={tempPassword !== null} onOpenChange={(open) => !open && setTempPassword(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Temporary Password</AlertDialogTitle>
            <AlertDialogDescription>
              Share this password with the user. It will not be shown again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="font-mono text-lg">{tempPassword}</p>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setTempPassword(null)}>Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deactivateRow !== null} onOpenChange={(open) => !open && setDeactivateRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivateRow?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateRow?.name} will no longer be able to sign in or be assigned assets. Assets already in
              their custody and their history are not affected. This can be reversed later by an administrator.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deactivateMutation.isPending}
              onClick={() => deactivateRow && deactivateMutation.mutate(deactivateRow.id)}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
