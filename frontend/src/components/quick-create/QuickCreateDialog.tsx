import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useKeyedMutation } from "../../lib/submit-key";
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
  onCreateNew?: (typed: string) => void;
  createLabel?: string;
  /** Fills this field from another one while the person has not typed in it
   * themselves (a Code suggested from the Name). `from` is the source field's key. */
  suggest?: { from: string; make: (source: string) => string };
  /** Shown under "More" (closed at first): details most people never need. */
  more?: boolean;
  /** Shown only while this is true for the current values. */
  visible?: (values: Record<string, string>) => boolean;
}

/** Props every quick-create wrapper (New Category, New Brand, ...) shares. */
export interface QuickCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the record is saved and the lists that show it have refreshed. */
  onCreated: (row: CreatedRecord) => void;
  /** S7 (P2-1): the name typed in the picker's search box -- the dialog starts with it. */
  initialName?: string;
}

/**
 * A small "create it right here" dialog for a record that a screen needs but does not
 * have yet (a vendor while adding an asset, a Sub-category while adding an Item, ...),
 * so nobody has to leave the screen they started on. It posts to the same endpoint the
 * Settings screen uses, so the same server rules and permissions apply.
 *
 * On success it closes and hands the new record back (the caller picks it). On a
 * refusal it stays open with the server's own sentence; when the server says the
 * name is already taken and that record is in the list, it offers to use it instead.
 */
export function QuickCreateDialog({
  open, onOpenChange, onCreated, title, endpoint, fields, initial, toBody, refresh, submitLabel = "Save",
  values: controlledValues, onValuesChange, idPrefix = "qc", canSave: canSaveFn, findExisting, note, initialName,
}: QuickCreateProps & {
  /** Prefix of the field ids (qc-name, qc-code...); a dialog opened from another one needs its own. */
  idPrefix?: string;
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
  /** Replaces the "every required field is filled" rule. */
  canSave?: (values: Record<string, string>) => boolean;
  /** The existing record with the same name, offered when the server refuses a duplicate. */
  findExisting?: (values: Record<string, string>) => CreatedRecord | undefined;
  /** A short line under the fields. */
  note?: string;
}) {
  const qc = useQueryClient();
  const [ownValues, setOwnValues] = useState<Record<string, string>>({});
  const values = controlledValues ?? ownValues;
  const setValues = onValuesChange ?? setOwnValues;
  // Fields the person typed in themselves: a suggestion never overwrites those.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [moreOpen, setMoreOpen] = useState(false);

  function changeField(key: string, value: string) {
    const next = new Set(touched).add(key);
    setTouched(next);
    setValues((s) => {
      const out = { ...s, [key]: value };
      for (const f of fields) {
        if (f.suggest && f.suggest.from === key && !next.has(f.key)) out[f.key] = f.suggest.make(value);
      }
      return out;
    });
  }

  useEffect(() => {
    if (open) {
      setTouched(new Set());
      setMoreOpen(false);
      const start: Record<string, string> = { ...(initial ?? {}) };
      // The name typed in the picker (S7 P2-1), with what is suggested from it (a Code).
      const typedName = (initialName ?? "").trim();
      if (typedName && fields.some((f) => f.key === "name")) {
        start.name = typedName;
        for (const f of fields) {
          if (f.suggest && f.suggest.from === "name" && !start[f.key]) start[f.key] = f.suggest.make(typedName);
        }
      }
      setValues(() => start);
    }
    // Starts fresh each time it opens, with the values the caller knows already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = fields.filter((f) => !f.visible || f.visible(values));

  // S7 (P1-2): one Save = one Idempotency-Key; a double activation sends one request.
  const mutation = useKeyedMutation({
    mutationFn: (_: void, keyed) => {
      const body = toBody
        ? toBody(values)
        : Object.fromEntries(shown.map((f) => [f.key, (values[f.key] ?? "").trim()]));
      return keyed(body, () => apiClient.post<CreatedRecord>(endpoint, body));
    },
    onSuccess: async (row) => {
      await Promise.all(refresh.map((queryKey) => qc.invalidateQueries({ queryKey })));
      onOpenChange(false);
      onCreated(row);
    },
  });

  const filled = (f: QuickField) => (values[f.key] ?? "").trim() !== "";
  const canSave = canSaveFn ? canSaveFn(values) : shown.every((f) => !f.required || filled(f));
  const mainFields = shown.filter((f) => !f.more);
  const moreFields = shown.filter((f) => f.more);
  // A required detail under More that is still empty (e.g. no Code could be suggested): show it.
  const showMore = moreOpen || moreFields.some((f) => f.required && !filled(f) && (values.name ?? "").trim() !== "");

  const errorText = mutation.isError ? (mutation.error instanceof Error ? mutation.error.message : "Could not save.") : null;
  const existing = errorText && /already exists/i.test(errorText) && findExisting ? findExisting(values) : undefined;

  function pickExisting(row: CreatedRecord) {
    mutation.reset();
    onOpenChange(false);
    onCreated(row);
  }

  function renderField(f: QuickField) {
    return (
      <FormField key={f.key} htmlFor={`${idPrefix}-${f.key}`} label={f.label} required={f.required} helperText={f.helperText}>
        {f.kind === "select" ? (
          <SearchableSelect
            id={`${idPrefix}-${f.key}`}
            value={values[f.key] || undefined}
            onValueChange={(v) => changeField(f.key, v)}
            options={f.options ?? []}
            placeholder={f.placeholder}
            onCreateNew={f.onCreateNew}
            createLabel={f.createLabel}
          />
        ) : (
          <Input
            id={`${idPrefix}-${f.key}`}
            value={values[f.key] ?? ""}
            placeholder={f.placeholder}
            onChange={(e) => changeField(f.key, e.target.value)}
          />
        )}
      </FormField>
    );
  }

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
          {mainFields.map(renderField)}
          {moreFields.length > 0 && (
            <div className="border-t pt-1">
              <Button
                type="button" variant="ghost" size="sm" className="-ml-2 gap-1 text-muted-foreground"
                aria-expanded={showMore} onClick={() => setMoreOpen((o) => !o)}
              >
                <ChevronRight className={`h-4 w-4 transition-transform ${showMore ? "rotate-90" : ""}`} aria-hidden="true" />
                More
              </Button>
              {showMore && <div className="mt-2 flex flex-col gap-3">{moreFields.map(renderField)}</div>}
            </div>
          )}
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          {errorText && (
            <div className="flex flex-col gap-1.5" role="alert">
              <p className="text-sm text-destructive">{errorText}</p>
              {existing && (
                <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => pickExisting(existing)}>
                  Use the existing “{String(existing.name ?? "")}”
                </Button>
              )}
            </div>
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
