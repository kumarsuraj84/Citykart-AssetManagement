import { useState } from "react";
import { ListChecks, Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
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

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "dropdown", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
];

const GLOBAL_SCOPE = "__global__";
const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;

interface CustomFieldRow {
  id: number;
  field_key: string;
  label: string;
  field_type: string;
  options: { choices?: string[] } | null;
  is_required: boolean;
  sort_order: number;
  company_id: number | null;
  is_active: boolean;
}

interface Company {
  id: number;
  name: string;
}

interface CreateDraft {
  field_key: string;
  label: string;
  field_type: string;
  choices: string;
  is_required: boolean;
  sort_order: string;
  scope: string; // GLOBAL_SCOPE or a company id as a string
}

const emptyCreateDraft: CreateDraft = {
  field_key: "",
  label: "",
  field_type: "text",
  choices: "",
  is_required: false,
  sort_order: "0",
  scope: GLOBAL_SCOPE,
};

interface EditDraft {
  label: string;
  choices: string;
  is_required: boolean;
  sort_order: string;
  scope: string;
}

function scopeLabel(companyId: number | null, companies: Company[]): string {
  if (companyId === null) return "Global";
  return companies.find((c) => c.id === companyId)?.name ?? `Company #${companyId}`;
}

function parseChoices(raw: string): { choices: string[] } | null {
  const choices = raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  return choices.length > 0 ? { choices } : null;
}

export function CustomFieldsScreen() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.role);
  const companyId = useAuthStore((s) => s.companyId);
  const canManageGlobal = role === "ADMIN";
  const canCreate = role === "ADMIN" || role === "IT_TEAM";

  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyCreateDraft);
  const [createKeyError, setCreateKeyError] = useState<string | null>(null);

  const [editingField, setEditingField] = useState<CustomFieldRow | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [confirmRequired, setConfirmRequired] = useState(false);

  const [deactivateRow, setDeactivateRow] = useState<CustomFieldRow | null>(null);

  const {
    data: fields = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["masters", "custom-fields"],
    queryFn: () => apiClient.get<CustomFieldRow[]>("/masters/custom-fields"),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<Company[]>("/masters/companies"),
  });

  function canManage(field: CustomFieldRow): boolean {
    if (role === "ADMIN") return true;
    if (role === "IT_TEAM") return field.company_id === companyId;
    return false;
  }

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post("/masters/custom-fields", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters", "custom-fields"] });
      closeCreate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      apiClient.put(`/masters/custom-fields/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters", "custom-fields"] });
      closeEdit();
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/masters/custom-fields/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters", "custom-fields"] });
      setDeactivateRow(null);
    },
  });

  function openCreate() {
    setCreateKeyError(null);
    setCreateDraft({
      ...emptyCreateDraft,
      scope: canManageGlobal ? GLOBAL_SCOPE : String(companyId),
    });
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
    setCreateKeyError(null);
    setCreateDraft(emptyCreateDraft);
  }

  function handleCreateSave() {
    if (!FIELD_KEY_RE.test(createDraft.field_key)) {
      setCreateKeyError("Lowercase letters, numbers, and underscores only; must start with a letter.");
      return;
    }
    setCreateKeyError(null);
    createMutation.mutate({
      field_key: createDraft.field_key,
      label: createDraft.label,
      field_type: createDraft.field_type,
      options: createDraft.field_type === "dropdown" ? parseChoices(createDraft.choices) : null,
      is_required: createDraft.is_required,
      sort_order: Number(createDraft.sort_order) || 0,
      company_id: createDraft.scope === GLOBAL_SCOPE ? null : Number(createDraft.scope),
    });
  }

  function openEdit(field: CustomFieldRow) {
    setEditingField(field);
    setEditDraft({
      label: field.label,
      choices: (field.options?.choices ?? []).join(", "),
      is_required: field.is_required,
      sort_order: String(field.sort_order),
      scope: field.company_id === null ? GLOBAL_SCOPE : String(field.company_id),
    });
  }

  function closeEdit() {
    setEditingField(null);
    setEditDraft(null);
    setConfirmRequired(false);
  }

  function editPayload() {
    if (!editingField || !editDraft) return null;
    return {
      label: editDraft.label,
      options: editingField.field_type === "dropdown" ? parseChoices(editDraft.choices) : null,
      is_required: editDraft.is_required,
      sort_order: Number(editDraft.sort_order) || 0,
      company_id: editDraft.scope === GLOBAL_SCOPE ? null : Number(editDraft.scope),
    };
  }

  function submitEdit() {
    if (!editingField) return;
    const payload = editPayload();
    if (!payload) return;
    updateMutation.mutate({ id: editingField.id, payload });
  }

  function handleEditSave() {
    if (!editingField || !editDraft) return;
    const becomingRequired = !editingField.is_required && editDraft.is_required;
    if (becomingRequired) {
      setConfirmRequired(true);
      return;
    }
    submitEdit();
  }

  const columns: DataTableColumn<CustomFieldRow>[] = [
    { key: "label", header: "Label", cell: (f) => f.label },
    { key: "field_key", header: "Field Key", cell: (f) => <code className="text-xs">{f.field_key}</code> },
    { key: "field_type", header: "Type", cell: (f) => f.field_type },
    { key: "scope", header: "Scope", cell: (f) => scopeLabel(f.company_id, companies) },
    { key: "is_required", header: "Required", cell: (f) => (f.is_required ? "Yes" : "No") },
    { key: "sort_order", header: "Sort Order", cell: (f) => String(f.sort_order) },
    {
      key: "__actions",
      header: <span className="sr-only">Actions</span>,
      headerClassName: "w-24 text-right",
      cellClassName: "text-right",
      cell: (f) =>
        canManage(f) ? (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" aria-label={`Edit ${f.label}`} onClick={() => openEdit(f)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Deactivate ${f.label}`}
              onClick={() => setDeactivateRow(f)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Custom Fields"
        description="Extra fields captured on assets. A field can apply to every company (Global) or just one."
        actions={canCreate ? <Button onClick={openCreate}>Add Custom Field</Button> : undefined}
      />

      <DataTable<CustomFieldRow>
        columns={columns}
        rows={fields}
        rowKey={(f) => f.id}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
        emptyState={
          <EmptyState
            icon={ListChecks}
            title="No custom fields yet"
            description="Add a field to capture extra information on assets, either company-wide or for one company."
            action={canCreate ? <Button onClick={openCreate}>Add Custom Field</Button> : undefined}
          />
        }
      />

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Field</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <FormField htmlFor="cf-label" label="Label" required>
              <Input
                id="cf-label"
                aria-label="Label"
                value={createDraft.label}
                onChange={(e) => setCreateDraft((d) => ({ ...d, label: e.target.value }))}
              />
            </FormField>

            <FormField
              htmlFor="cf-field-key"
              label="Field Key"
              required
              errorText={createKeyError ?? undefined}
              helperText="Lowercase letters, numbers, underscores only. Cannot be changed after creation."
            >
              <Input
                id="cf-field-key"
                aria-label="Field Key"
                value={createDraft.field_key}
                onChange={(e) => setCreateDraft((d) => ({ ...d, field_key: e.target.value }))}
              />
            </FormField>

            <FormField htmlFor="cf-field-type" label="Field Type" required helperText="Cannot be changed after creation.">
              <Select
                value={createDraft.field_type}
                onValueChange={(v) => setCreateDraft((d) => ({ ...d, field_type: v }))}
              >
                <SelectTrigger id="cf-field-type" aria-label="Field Type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            {createDraft.field_type === "dropdown" && (
              <FormField htmlFor="cf-choices" label="Dropdown Options" helperText="Comma-separated list of allowed values.">
                <Input
                  id="cf-choices"
                  aria-label="Dropdown Options"
                  value={createDraft.choices}
                  onChange={(e) => setCreateDraft((d) => ({ ...d, choices: e.target.value }))}
                />
              </FormField>
            )}

            <FormField
              htmlFor="cf-scope"
              label="Scope"
              helperText={
                canManageGlobal
                  ? "Global applies to every company's assets. A specific company applies only to that company's assets."
                  : "You can only create fields for your own company."
              }
            >
              {canManageGlobal ? (
                <Select value={createDraft.scope} onValueChange={(v) => setCreateDraft((d) => ({ ...d, scope: v }))}>
                  <SelectTrigger id="cf-scope" aria-label="Scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GLOBAL_SCOPE}>Global (all companies)</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input id="cf-scope" aria-label="Scope" value={scopeLabel(companyId, companies)} disabled readOnly />
              )}
            </FormField>

            <FormField htmlFor="cf-required" label="Required">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="cf-required"
                  aria-label="Required"
                  checked={createDraft.is_required}
                  onCheckedChange={(checked) => setCreateDraft((d) => ({ ...d, is_required: checked === true }))}
                />
                <span className="text-sm text-muted-foreground">Must be filled in when adding an asset.</span>
              </div>
            </FormField>

            <FormField htmlFor="cf-sort-order" label="Sort Order">
              <Input
                id="cf-sort-order"
                aria-label="Sort Order"
                type="number"
                value={createDraft.sort_order}
                onChange={(e) => setCreateDraft((d) => ({ ...d, sort_order: e.target.value }))}
              />
            </FormField>

            {createMutation.isError && (
              <p className="text-sm text-destructive" role="alert">
                {createMutation.error instanceof ApiError ? createMutation.error.message : "Could not save this field."}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeCreate}>
              Cancel
            </Button>
            <AsyncButton onClick={handleCreateSave} pending={createMutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={editingField !== null} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Custom Field</DialogTitle>
          </DialogHeader>

          {editingField && editDraft && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Field Key</span>
                  <span className="font-medium">
                    <code>{editingField.field_key}</code>
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Field Type</span>
                  <span className="font-medium">{editingField.field_type}</span>
                </div>
                <p className="text-xs text-muted-foreground">Not editable after creation.</p>
              </div>

              <FormField htmlFor="edit-cf-label" label="Label" required>
                <Input
                  id="edit-cf-label"
                  aria-label="Label"
                  value={editDraft.label}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, label: e.target.value } : d))}
                />
              </FormField>

              {editingField.field_type === "dropdown" && (
                <FormField htmlFor="edit-cf-choices" label="Dropdown Options" helperText="Comma-separated list of allowed values.">
                  <Input
                    id="edit-cf-choices"
                    aria-label="Dropdown Options"
                    value={editDraft.choices}
                    onChange={(e) => setEditDraft((d) => (d ? { ...d, choices: e.target.value } : d))}
                  />
                </FormField>
              )}

              <FormField
                htmlFor="edit-cf-scope"
                label="Scope"
                helperText={
                  canManageGlobal
                    ? "Can only be changed while no asset has a value for this field yet."
                    : "You can only manage fields scoped to your own company."
                }
              >
                {canManageGlobal ? (
                  <Select
                    value={editDraft.scope}
                    onValueChange={(v) => setEditDraft((d) => (d ? { ...d, scope: v } : d))}
                  >
                    <SelectTrigger id="edit-cf-scope" aria-label="Scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={GLOBAL_SCOPE}>Global (all companies)</SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="edit-cf-scope"
                    aria-label="Scope"
                    value={scopeLabel(editingField.company_id, companies)}
                    disabled
                    readOnly
                  />
                )}
              </FormField>

              <FormField htmlFor="edit-cf-required" label="Required">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="edit-cf-required"
                    aria-label="Required"
                    checked={editDraft.is_required}
                    onCheckedChange={(checked) =>
                      setEditDraft((d) => (d ? { ...d, is_required: checked === true } : d))
                    }
                  />
                  <span className="text-sm text-muted-foreground">Must be filled in when adding an asset.</span>
                </div>
              </FormField>

              <FormField htmlFor="edit-cf-sort-order" label="Sort Order">
                <Input
                  id="edit-cf-sort-order"
                  aria-label="Sort Order"
                  type="number"
                  value={editDraft.sort_order}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, sort_order: e.target.value } : d))}
                />
              </FormField>

              {updateMutation.isError && (
                <p className="text-sm text-destructive" role="alert">
                  {updateMutation.error instanceof ApiError ? updateMutation.error.message : "Could not save this field."}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeEdit}>
              Cancel
            </Button>
            <AsyncButton onClick={handleEditSave} pending={updateMutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Optional -> required confirmation -- AM-05 §23: a Global field affects
          every company, a company-specific one affects just that company, so
          the confirmation copy names exactly which. */}
      <AlertDialog open={confirmRequired} onOpenChange={(open) => !open && setConfirmRequired(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make "{editDraft?.label}" required?</AlertDialogTitle>
            <AlertDialogDescription>
              {editDraft?.scope === GLOBAL_SCOPE
                ? "This is a Global field. Making it required means EVERY company must fill it in before a new asset can be created, and it will be enforced immediately."
                : `This field applies only to ${scopeLabel(
                    editDraft && editDraft.scope !== GLOBAL_SCOPE ? Number(editDraft.scope) : null,
                    companies,
                  )}. Making it required means that company must fill it in before a new asset can be created, and it will be enforced immediately.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmRequired(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRequired(false);
                submitEdit();
              }}
            >
              Yes, make it required
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deactivate */}
      <AlertDialog open={deactivateRow !== null} onOpenChange={(open) => !open && setDeactivateRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivateRow?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This field will no longer be collected on new assets. Values already stored on existing assets remain
              visible. This can be reversed later by an administrator.
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
