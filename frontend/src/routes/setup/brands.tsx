import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";
import type { FormField } from "../../components/master-crud/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { ApiError, apiClient } from "../../lib/api-client";
import { BRAND_AREA_CHOICES, brandAreaChoiceOf, brandAreasOfChoice, brandAreasText } from "../../lib/brand-areas";

interface Brand {
  id: number;
  code: string;
  name: string;
  work_areas?: string[];
}

/** Where a brand is used: one choice, shown as IT / Non-IT / both. Pickers list a brand only for its work areas. */
const USED_FOR: FormField = {
  key: "work_areas", label: "Used for", type: "select",
  options: BRAND_AREA_CHOICES.map((c) => ({ value: c.value, label: c.label })),
  defaultValue: "BOTH", toDraft: brandAreaChoiceOf, toPayload: brandAreasOfChoice,
  helperText: "Pickers list a brand only for the work areas it is used for. A brand used for both (Samsung) is one brand.",
};

/** The ticked brands' "Used for", set in one go (all or nothing: the server says which Items hold an area in place). */
function SetUsedFor({ rows, clear }: { rows: Brand[]; clear: () => void }) {
  const qc = useQueryClient();
  const [choice, setChoice] = useState("IT");
  const mutation = useMutation({
    mutationFn: () => apiClient.post<{ updated: number }>("/masters/brands/work-areas", { ids: rows.map((r) => r.id), work_areas: brandAreasOfChoice(choice) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters", "brands"] });
      clear();
    },
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={choice} onValueChange={setChoice}>
        <SelectTrigger className="h-8 w-48" aria-label="Used for"><SelectValue /></SelectTrigger>
        <SelectContent>
          {BRAND_AREA_CHOICES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
        Set used for ({rows.length})
      </Button>
      {mutation.isError && <ErrorMessage className="text-sm text-destructive" error={mutation.error} message={mutation.error instanceof ApiError ? mutation.error.message : "Could not change where these brands are used."} />}
    </div>
  );
}

export default function BrandsSetup({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <MasterCrudScreen<Brand>
      embedded={embedded}
      bulkActions={(rows, clear) => <SetUsedFor rows={rows} clear={clear} />}
      config={{
        resource: "brands",
        historyEntity: "brand",
        title: "Brands",
        singular: "Brand",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "work_areas", label: "Used for", format: (v) => brandAreasText(v as string[] | undefined) },
        ],
        formFields: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          USED_FOR,
        ],
        editFields: [{ key: "name", label: "Name" }, USED_FOR],
      }}
    />
  );
}
