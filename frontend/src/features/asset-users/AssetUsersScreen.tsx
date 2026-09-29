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

const ASSET_USER_TYPES = ["EMPLOYEE", "STORE", "INSTALLED", "STOCK_POINT"] as const;
// The Primary Owner is deliberately excluded -- it's fixed, not selectable
// here (see require_primary_owner on the backend); this list is what
// ordinary ADMIN-managed accounts may be set to.
const ROLES = ["ADMIN", "OPERATOR", "VIEWER", "SELF_SERVICE"] as const;

// STOCK_POINT/INSTALLED asset_users aren't people -- they're a location's own
// stock/install bucket (one per physical location a company has), which
// made the ordinary "Code"/Name fields confusing to fill in (there's
// no employee). This config drives dynamic labels, an auto-suggested
// code/name derived from the chosen Location so nobody has to invent one,
// and the coverage checklist below ("which locations still need a stock
// point") -- see the product discussion that prompted this.
const TYPE_POINT_CONFIG: Partial<Record<(typeof ASSET_USER_TYPES)[number], { prefix: string; noun: string }>> = {
  STOCK_POINT: { prefix: "STK", noun: "Stock Point" },
  INSTALLED: { prefix: "INS", noun: "Install Point" },
};

function pointConfigFor(assetUserType: string) {
  return TYPE_POINT_CONFIG[assetUserType as (typeof ASSET_USER_TYPES)[number]];
}

// Alphanumeric-only, uppercased -- matches how every master's own Code
// column is conventionally written; a location code/name can contain
// spaces or punctuation a asset_user's code shouldn't carry verbatim.
function slug(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

interface AssetUserRow {
  id: number;
  company_id: number | null;
  code: string | null;
  name: string;
  asset_user_type: string | null;
  location_id: number | null;
  department_id: number | null;
  email: string | null;
  phone: string | null;
  role: string;
  is_primary_owner: boolean;
  login_enabled: boolean;
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

interface AssetUserDraft {
  company_id: string;
  code: string;
  name: string;
  asset_user_type: string;
  location_id: string;
  department_id: string;
  email: string;
  phone: string;
  role: string;
  loginEnabled: boolean;
}

const emptyDraft: AssetUserDraft = {
  company_id: "",
  code: "",
  name: "",
  asset_user_type: "",
  location_id: "",
  department_id: "",
  email: "",
  phone: "",
  role: "SELF_SERVICE",
  loginEnabled: false,
};

function buildPayload(draft: AssetUserDraft) {
  return {
    company_id: Number(draft.company_id),
    code: draft.code,
    name: draft.name,
    asset_user_type: draft.asset_user_type,
    location_id: Number(draft.location_id),
    department_id: draft.department_id ? Number(draft.department_id) : null,
    // Email/Role are only meaningful for a login-capable asset_user (spec
    // §10/§24/§51) -- a STORE/INSTALLED/STOCK_POINT point-record, or an
    // EMPLOYEE not yet activated for login, gets neither.
    email: draft.loginEnabled ? draft.email || null : null,
    phone: draft.phone || null,
    role: draft.loginEnabled ? draft.role : "SELF_SERVICE",
    login_enabled: draft.loginEnabled,
  };
}

export function AssetUsersScreen() {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [originalRole, setOriginalRole] = useState<string | null>(null);
  const [draft, setDraft] = useState<AssetUserDraft>(emptyDraft);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [deactivateRow, setDeactivateRow] = useState<AssetUserRow | null>(null);
  // AM-24: which OTHER companies (beyond this asset_user's own home company)
  // they're granted access to -- e.g. the one PO/PI person, the one
  // labeling person, the one movement person who all need to work across
  // more than one company, without making them ADMIN.
  const [accessRow, setAccessRow] = useState<AssetUserRow | null>(null);
  const [accessSelection, setAccessSelection] = useState<number[]>([]);

  const {
    data: asset_users = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["asset_users"],
    queryFn: () => apiClient.get<AssetUserRow[]>("/asset-users"),
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

  const companyName = (id: number | null) => (id === null ? "—" : companies.find((c) => c.id === id)?.name ?? String(id));

  // The Primary Owner is a fixed, company-less bootstrap account managed
  // through its own protected grant/revoke flow, not this ordinary
  // Add/Edit/Deactivate CRUD screen (see app.core.deps.require_primary_owner).
  // It's excluded from this list entirely rather than half-rendered with
  // blank Company/Location/Code cells.
  const visibleAssetUsers = asset_users.filter((h) => !h.is_primary_owner);

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post("/asset-users", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_users"] });
      closeForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      apiClient.put(`/asset-users/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_users"] });
      closeForm();
    },
  });

  const resetMutation = useMutation({
    mutationFn: (id: number) => apiClient.post<{ temp_password: string }>(`/asset-users/${id}/reset-password`),
    onSuccess: (data) => {
      setTempPassword(data.temp_password);
      qc.invalidateQueries({ queryKey: ["asset_users"] });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/asset-users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_users"] });
      setDeactivateRow(null);
    },
  });

  const accessQ = useQuery({
    queryKey: ["asset_users", accessRow?.id, "company-access"],
    queryFn: () => apiClient.get<{ company_ids: number[] }>(`/asset-users/${accessRow!.id}/company-access`),
    enabled: accessRow !== null,
  });

  const accessMutation = useMutation({
    mutationFn: () => apiClient.post(`/asset-users/${accessRow!.id}/company-access`, { company_ids: accessSelection }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset_users", accessRow?.id, "company-access"] });
      setAccessRow(null);
    },
  });

  function openAccess(h: AssetUserRow) {
    setAccessRow(h);
    setAccessSelection([]);
  }

  // Seeds the checkbox selection from the asset_user's current grants once
  // they've loaded -- can't do this inline in openAccess since the fetch
  // is async and keyed off accessRow itself.
  useEffect(() => {
    if (accessQ.data) setAccessSelection(accessQ.data.company_ids);
  }, [accessQ.data]);

  function toggleAccessCompany(companyId: number, checked: boolean) {
    setAccessSelection((ids) => (checked ? [...ids, companyId] : ids.filter((id) => id !== companyId)));
  }

  function setField(key: keyof AssetUserDraft, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  // A blank Code/Name is auto-suggested from the chosen Location once both
  // Type (STOCK_POINT/INSTALLED) and Location are known -- never overwrites
  // something already typed (a manual edit always wins), so this only ever
  // fires on a fresh Add before the admin has touched either field.
  function suggestPointFields(d: AssetUserDraft, assetUserType: string, locationId: string): Partial<AssetUserDraft> {
    const config = pointConfigFor(assetUserType);
    if (!config || d.code.trim() !== "" || d.name.trim() !== "") return {};
    const location = locations.find((l) => l.id === Number(locationId));
    if (!location) return {};
    return { code: `${config.prefix}-${slug(location.code)}`, name: `${config.noun} - ${location.name}` };
  }

  // Location is company-scoped now -- a location picked under a previous
  // Company selection may not even belong to the new one, so it's cleared
  // (along with any auto-suggested Code/Name, which only made sense paired
  // with that location) rather than silently left pointing at the wrong company.
  function handleCompanyChange(value: string) {
    setDraft((d) => ({ ...d, company_id: value, location_id: "" }));
  }

  function handleTypeChange(value: string) {
    setDraft((d) => ({ ...d, asset_user_type: value, ...suggestPointFields(d, value, d.location_id) }));
  }

  function handleLocationChange(value: string) {
    setDraft((d) => ({ ...d, location_id: value, ...suggestPointFields(d, d.asset_user_type, value) }));
  }

  function openAdd() {
    setEditingId(null);
    setOriginalRole(null);
    setDraft(emptyDraft);
    setFormOpen(true);
  }

  function openEdit(h: AssetUserRow) {
    setEditingId(h.id);
    setOriginalRole(h.role);
    setDraft({
      company_id: String(h.company_id ?? ""),
      code: h.code ?? "",
      name: h.name,
      asset_user_type: h.asset_user_type ?? "",
      location_id: String(h.location_id ?? ""),
      department_id: h.department_id ? String(h.department_id) : "",
      email: h.email ?? "",
      phone: h.phone ?? "",
      role: h.role,
      loginEnabled: h.login_enabled,
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
  // AM-08: `location_id` is a required (NOT NULL) foreign key on AssetUser --
  // it was never actually optional (see DECISIONS.md) -- so Save must be
  // blocked, not merely default a blank Select to the `0` sentinel that used
  // to reach the backend as an unhandled 500. Company/Code/Name/Type are
  // likewise required by AssetUserIn; Department stays genuinely optional.
  const canSave =
    draft.company_id !== "" &&
    draft.code.trim().length > 0 &&
    draft.name.trim().length > 0 &&
    draft.asset_user_type !== "" &&
    draft.location_id !== "";

  const activePointConfig = pointConfigFor(draft.asset_user_type);
  const codeLabel = activePointConfig ? `${activePointConfig.noun} Code` : "Code";
  const nameLabel = activePointConfig ? `${activePointConfig.noun} Name` : "Name";

  // "Which of this company's locations already have a STOCK_POINT/INSTALLED
  // point, and which still need one" -- the confusion this whole feature
  // addresses (see TYPE_POINT_CONFIG's own comment). Only shown once both
  // Type and Company are picked, since coverage is scoped per company.
  const pointCoverage = useMemo(() => {
    if (!activePointConfig || draft.company_id === "") return null;
    const companyId = Number(draft.company_id);
    const coveredIds = new Set(
      asset_users
        .filter((h) => h.company_id === companyId && h.asset_user_type === draft.asset_user_type && h.is_active)
        .map((h) => h.location_id),
    );
    return locations.map((l) => ({ location: l, covered: coveredIds.has(l.id) }));
  }, [activePointConfig, draft.asset_user_type, draft.company_id, asset_users, locations]);

  const columns: DataTableColumn<AssetUserRow>[] = [
    { key: "code", header: "Code", cell: (h) => h.code },
    { key: "name", header: "Name", cell: (h) => h.name },
    { key: "asset_user_type", header: "Type", cell: (h) => h.asset_user_type },
    { key: "role", header: "Role", cell: (h) => (h.login_enabled ? h.role : "—") },
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
          {h.login_enabled && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Reset password for ${h.name}`}
              onClick={() => resetMutation.mutate(h.id)}
            >
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
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
        title="Asset Users"
        actions={
          <>
            <BulkImportExport
              resource="asset-users"
              label="Asset Users"
              basePath="/asset-users"
              onImported={() => qc.invalidateQueries({ queryKey: ["asset_users"] })}
            />
            <Button onClick={openAdd}>Add</Button>
          </>
        }
      />

      <DataTable<AssetUserRow>
        columns={columns}
        rows={visibleAssetUsers}
        rowKey={(h) => h.id}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
        emptyState={
          <EmptyState
            icon={Users}
            title="No asset users yet"
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

            <FormField htmlFor="asset_user_type" label="Type" required>
              <Select value={draft.asset_user_type || undefined} onValueChange={handleTypeChange}>
                <SelectTrigger id="asset_user_type" aria-label="Type">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_USER_TYPES.map((t) => (
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

            <FormField htmlFor="code" label={codeLabel} required>
              <Input
                id="code"
                aria-label={codeLabel}
                value={draft.code}
                onChange={(e) => setField("code", e.target.value)}
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

            <FormField htmlFor="phone" label="Phone">
              <Input
                id="phone"
                aria-label="Phone"
                value={draft.phone}
                onChange={(e) => setField("phone", e.target.value)}
              />
            </FormField>

            <FormField
              htmlFor="login_enabled"
              label="Login Enabled"
              helperText="Only a login-enabled person can sign in and needs an Access Role. A Store/Install Point/Stock Point normally stays off."
            >
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="login_enabled"
                  aria-label="Login Enabled"
                  checked={draft.loginEnabled}
                  onCheckedChange={(checked) => setDraft((d) => ({ ...d, loginEnabled: checked === true }))}
                />
                Can this person sign in to CKAM?
              </label>
            </FormField>

            {draft.loginEnabled && (
              <>
                <FormField htmlFor="email" label="Email">
                  <Input
                    id="email"
                    aria-label="Email"
                    value={draft.email}
                    onChange={(e) => setField("email", e.target.value)}
                  />
                </FormField>

                <FormField
                  htmlFor="role"
                  label="Access Role"
                  helperText={
                    editingId != null
                      ? `Current role: ${originalRole}. Controls what this person can see and do in CKAM.`
                      : "Controls what this person can see and do in CKAM."
                  }
                >
                  <Select value={draft.role || undefined} onValueChange={(v) => setField("role", v)}>
                    <SelectTrigger id="role" aria-label="Access Role">
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
              </>
            )}

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
        asset_users list/cache, and is cleared (not merely hidden) the moment the
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
