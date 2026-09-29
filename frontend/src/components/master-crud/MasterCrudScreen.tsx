import { useState } from "react";
import { Inbox, Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../lib/api-client";
import type { MasterConfig, FormField } from "./types";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField as FormFieldShell } from "@/components/shared/FormField";
import { useTableSort } from "@/components/shared/useTableSort";

function buildPayload(formFields: FormField[], draft: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  for (const field of formFields) {
    if (!(field.key in draft)) continue;
    const raw = draft[field.key];
    if (field.type === "number") {
      payload[field.key] = raw === "" ? undefined : Number(raw);
    } else if (field.type === "select") {
      const opt = field.options?.find((o) => String(o.value) === String(raw));
      payload[field.key] = opt ? opt.value : raw;
    } else {
      payload[field.key] = raw;
    }
  }
  return payload;
}

function buildDraftFromRow(formFields: FormField[], row: Record<string, unknown>) {
  const draft: Record<string, unknown> = {};
  for (const field of formFields) {
    draft[field.key] = row[field.key] ?? (field.type === "checkbox" ? false : "");
  }
  return draft;
}

/** Best-effort human label for a row in confirmation copy -- every current
 * master has a `name` (Department has nothing else at all); `code` is the
 * fallback for the rare case a future master doesn't. */
function rowLabel(row: Record<string, unknown>): string {
  return String(row.name ?? row.code ?? `#${row.id}`);
}

function MasterFormField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.type === "select") {
    return (
      <Select value={value !== undefined ? String(value) : undefined} onValueChange={onChange}>
        <SelectTrigger id={field.key} aria-label={field.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map((opt) => (
            <SelectItem key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (field.type === "checkbox") {
    return (
      <Checkbox
        id={field.key}
        aria-label={field.label}
        checked={Boolean(value)}
        onCheckedChange={(checked) => onChange(checked === true)}
      />
    );
  }
  return (
    <Input
      id={field.key}
      aria-label={field.label}
      type={field.type === "number" ? "number" : "text"}
      value={(value as string) ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function MasterCrudScreen<T extends object>({
  config,
}: {
  config: MasterConfig<T>;
}) {
  const qc = useQueryClient();
  const singular = config.singular ?? config.title;
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<Record<string, unknown>>({});
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({});
  const [deactivateRow, setDeactivateRow] = useState<Row | null>(null);
  const [search, setSearch] = useState("");

  // Every master record carries an `id` even though T itself is not
  // constrained to `{ id: number }` — constraining T directly on the
  // generic breaks TypeScript's inference of T from `config.columns`
  // (a `keyof T` position) at call sites that don't pass an explicit
  // type argument, such as MasterCrudScreen.test.tsx.
  type Row = T & { id: number };

  const {
    data: items = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["masters", config.resource],
    queryFn: () => apiClient.get<Row[]>(`/masters/${config.resource}`),
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiClient.post(`/masters/${config.resource}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters", config.resource] });
      setCreateOpen(false);
      setCreateDraft({});
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      apiClient.put(`/masters/${config.resource}/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters", config.resource] });
      setEditRow(null);
      setEditDraft({});
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/masters/${config.resource}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters", config.resource] });
      setDeactivateRow(null);
    },
  });

  function openCreate() {
    setCreateDraft({});
    setCreateOpen(true);
  }

  function openEdit(row: Row) {
    setEditDraft(buildDraftFromRow(config.editFields, row as Record<string, unknown>));
    setEditRow(row);
  }

  function handleCreateSave() {
    createMutation.mutate(buildPayload(config.formFields, createDraft));
  }

  function handleEditSave() {
    if (!editRow) return;
    updateMutation.mutate({ id: editRow.id, payload: buildPayload(config.editFields, editDraft) });
  }

  const readOnlyFields = config.formFields.filter(
    (f) => !config.editFields.some((ef) => ef.key === f.key),
  );

  // Every column's rendered (not raw) text -- reuses the same `format`
  // callback the cell itself already uses, so search/sort always match
  // what's actually on screen (a formatted company name, not its raw id).
  function displayValue(row: Row, c: (typeof config.columns)[number]): string {
    return c.format ? c.format(row[c.key], row) : String(row[c.key] ?? "");
  }

  const filteredItems = search.trim()
    ? items.filter((row) =>
        config.columns.some((c) => displayValue(row, c).toLowerCase().includes(search.trim().toLowerCase())),
      )
    : items;

  const sortAccessors = Object.fromEntries(
    config.columns.map((c) => [String(c.key), (row: Row) => displayValue(row, c)]),
  );
  const { sortedRows, sort, toggleSort } = useTableSort(filteredItems, sortAccessors);

  const columns: DataTableColumn<Row>[] = [
    ...config.columns.map((c) => ({
      key: String(c.key),
      header: c.label,
      cell: (row: Row) => displayValue(row, c),
      sortable: true,
    })),
    {
      key: "__actions",
      header: <span className="sr-only">Actions</span>,
      headerClassName: "w-24 text-right",
      cellClassName: "text-right",
      cell: (row: Row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={`Edit ${rowLabel(row as Record<string, unknown>)}`} onClick={() => openEdit(row)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Deactivate ${rowLabel(row as Record<string, unknown>)}`}
            onClick={() => setDeactivateRow(row)}
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
        title={config.title}
        actions={<Button onClick={openCreate}>Add {singular}</Button>}
      />

      <Input
        aria-label={`Search ${config.title}`}
        placeholder={`Search ${config.title.toLowerCase()}…`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <DataTable<Row>
        columns={columns}
        rows={sortedRows}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
        sort={sort}
        onSortToggle={toggleSort}
        emptyState={
          search.trim() ? (
            <EmptyState icon={Inbox} title="No matches" description="Try a different search." />
          ) : (
            <EmptyState
              icon={Inbox}
              title={`No ${config.title.toLowerCase()} yet`}
              description={`Create your first ${singular.toLowerCase()} to get started.`}
              action={<Button onClick={openCreate}>Add {singular}</Button>}
            />
          )
        }
      />

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setCreateDraft({}); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {singular}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {config.formFields.map((f) => (
              <FormFieldShell key={f.key} htmlFor={f.key} label={f.label}>
                <MasterFormField
                  field={f}
                  value={createDraft[f.key]}
                  onChange={(value) => setCreateDraft((d) => ({ ...d, [f.key]: value }))}
                />
              </FormFieldShell>
            ))}

            {createMutation.isError && (
              <p className="text-sm text-destructive" role="alert">
                {createMutation.error instanceof ApiError ? createMutation.error.message : `Could not save this ${singular.toLowerCase()}.`}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <AsyncButton onClick={handleCreateSave} pending={createMutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editRow !== null} onOpenChange={(open) => { if (!open) { setEditRow(null); setEditDraft({}); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {singular}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {readOnlyFields.length > 0 && editRow && (
              <div className="flex flex-col gap-1 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                {readOnlyFields.map((f) => {
                  const row = editRow as Record<string, unknown>;
                  const raw = row[f.key];
                  return (
                    <div key={f.key} className="flex justify-between gap-4">
                      <span className="text-muted-foreground">{f.label}</span>
                      <span className="font-medium">{f.format ? f.format(raw, row) : String(raw ?? "")}</span>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground">Not editable after creation.</p>
              </div>
            )}
            {config.editFields.map((f) => (
              <FormFieldShell key={f.key} htmlFor={`edit-${f.key}`} label={f.label}>
                <MasterFormField
                  field={{ ...f, key: `edit-${f.key}` }}
                  value={editDraft[f.key]}
                  onChange={(value) => setEditDraft((d) => ({ ...d, [f.key]: value }))}
                />
              </FormFieldShell>
            ))}

            {updateMutation.isError && (
              <p className="text-sm text-destructive" role="alert">
                {updateMutation.error instanceof ApiError ? updateMutation.error.message : `Could not save this ${singular.toLowerCase()}.`}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>
              Cancel
            </Button>
            <AsyncButton onClick={handleEditSave} pending={updateMutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deactivateRow !== null} onOpenChange={(open) => { if (!open) setDeactivateRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivateRow ? rowLabel(deactivateRow as Record<string, unknown>) : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This {singular.toLowerCase()} will no longer appear in lists or be available for new records. It can be
              restored later by an administrator; nothing that already references it is affected.
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
