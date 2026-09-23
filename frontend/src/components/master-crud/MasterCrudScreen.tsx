import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { MasterConfig, FormField } from "./types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

export function MasterCrudScreen<T extends object>({
  config,
}: {
  config: MasterConfig<T>;
}) {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  // Every master record carries an `id` even though T itself is not
  // constrained to `{ id: number }` — constraining T directly on the
  // generic breaks TypeScript's inference of T from `config.columns`
  // (a `keyof T` position) at call sites that don't pass an explicit
  // type argument, such as MasterCrudScreen.test.tsx.
  type Row = T & { id: number };

  const { data: items = [] } = useQuery({
    queryKey: ["masters", config.resource],
    queryFn: () => apiClient.get<Row[]>(`/masters/${config.resource}`),
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiClient.post(`/masters/${config.resource}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters", config.resource] });
      setFormOpen(false);
      setDraft({});
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/masters/${config.resource}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["masters", config.resource] }),
  });

  function setField(key: string, value: unknown) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handleSave() {
    createMutation.mutate(buildPayload(config.formFields, draft));
  }

  function handleOpenChange(open: boolean) {
    setFormOpen(open);
    if (!open) setDraft({});
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{config.title}</h1>
        <Button onClick={() => setFormOpen(true)}>Add</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {config.columns.map((c) => (
              <TableHead key={String(c.key)}>{c.label}</TableHead>
            ))}
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              {config.columns.map((c) => (
                <TableCell key={String(c.key)}>{String(item[c.key] ?? "")}</TableCell>
              ))}
              <TableCell className="text-right">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deactivateMutation.mutate(item.id)}
                >
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={formOpen} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {config.title}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {config.formFields.map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                {f.type === "select" ? (
                  <Select
                    value={draft[f.key] !== undefined ? String(draft[f.key]) : undefined}
                    onValueChange={(value) => setField(f.key, value)}
                  >
                    <SelectTrigger id={f.key} aria-label={f.label}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(f.options ?? []).map((opt) => (
                        <SelectItem key={String(opt.value)} value={String(opt.value)}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : f.type === "checkbox" ? (
                  <Checkbox
                    id={f.key}
                    aria-label={f.label}
                    checked={Boolean(draft[f.key])}
                    onCheckedChange={(checked) => setField(f.key, checked === true)}
                  />
                ) : (
                  <Input
                    id={f.key}
                    aria-label={f.label}
                    type={f.type === "number" ? "number" : "text"}
                    value={(draft[f.key] as string) ?? ""}
                    onChange={(e) => setField(f.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
