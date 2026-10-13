import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect, type SearchableSelectOption } from "@/components/shared/SearchableSelect";

/** What every quick-create dialog hands back once the record exists. */
export interface CreatedRecord {
  id: number;
  [key: string]: unknown;
}

export interface QuickField {
  key: string;
  label: string;
  kind?: "text" | "select";
  options?: SearchableSelectOption[];
  required?: boolean;
  placeholder?: string;
  helperText?: string;
  /** A select can offer its own "+ New ..." (for example the Category inside a new Sub-category). */
  onCreateNew?: () => void;
  createLabel?: string;
}

/** Props every quick-create wrapper (New Category, New Brand, ...) shares. */
export interface QuickCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the record is saved and the lists that show it have refreshed. */
  onCreated: (row: CreatedRecord) => void;
}

/**
 * A small "create it right here" dialog for a record that a screen needs but does not
 * have yet (a Category while adding a Sub-category, a Sub-category while adding an
 * Item, ...), so nobody has to leave the screen they started on. It posts to the same
 * endpoint the Settings screen uses, so the same server rules and permissions apply.
 */
export function QuickCreateDialog({
  open, onOpenChange, onCreated, title, endpoint, fields, initial, toBody, refresh, submitLabel = "Save",
  values: controlledValues, onValuesChange,
}: QuickCreateProps & {
  title: string;
  endpoint: string;
  fields: QuickField[];
  /** Starting values (for example the Category already chosen on the screen behind). */
  initial?: Record<string, string>;
  toBody?: (values: Record<string, string>) => Record<string, unknown>;
  /** Query-key prefixes to refresh after saving. */
  refresh: unknown[][];
  submitLabel?: string;
  /** Let the caller hold the values, so a nested "create" (the new Category chosen
   * inside a new Sub-category) can fill a field from outside. */
  values?: Record<string, string>;
  onValuesChange?: (updater: (v: Record<string, string>) => Record<string, string>) => void;
}) {
  const qc = useQueryClient();
  const [ownValues, setOwnValues] = useState<Record<string, string>>({});
  const values = controlledValues ?? ownValues;
  const setValues = onValuesChange ?? setOwnValues;

  useEffect(() => {
    if (open) setValues(() => ({ ...(initial ?? {}) }));
    // Starts fresh each time it opens, with the values the caller knows already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = toBody
        ? toBody(values)
        : Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? "").trim()]));
      return apiClient.post<CreatedRecord>(endpoint, body);
    },
    onSuccess: async (row) => {
      await Promise.all(refresh.map((queryKey) => qc.invalidateQueries({ queryKey })));
      onOpenChange(false);
      onCreated(row);
    },
  });

  const canSave = fields.every((f) => !f.required || (values[f.key] ?? "").trim() !== "");

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) mutation.reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => { e.preventDefault(); if (canSave && !mutation.isPending) mutation.mutate(); }}
        >
          {fields.map((f) => (
            <FormField key={f.key} htmlFor={`qc-${f.key}`} label={f.label} required={f.required} helperText={f.helperText}>
              {f.kind === "select" ? (
                <SearchableSelect
                  id={`qc-${f.key}`}
                  value={values[f.key] || undefined}
                  onValueChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                  options={f.options ?? []}
                  placeholder={f.placeholder}
                  onCreateNew={f.onCreateNew}
                  createLabel={f.createLabel}
                />
              ) : (
                <Input
                  id={`qc-${f.key}`}
                  value={values[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              )}
            </FormField>
          ))}
          {mutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {mutation.error instanceof Error ? mutation.error.message : "Could not save."}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <AsyncButton type="submit" disabled={!canSave} pending={mutation.isPending} pendingLabel="Saving…">
              {submitLabel}
            </AsyncButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
