import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SAMPLE_TOKENS: Record<string, string> = {
  "cost_center.code": "HO01",
  "category.code": "IT",
  "subcategory.code": "LAP",
  "company.code": "CKS",
  "location.code": "HO",
  yyyy: "2026",
  yy: "26",
  mm: "09",
};

export function renderPreview(template: string, suffix: string, startNumber: number, padWidth: number): string {
  const prefix = template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key) => SAMPLE_TOKENS[key] ?? `{${key}}`);
  const num = padWidth ? String(startNumber).padStart(padWidth, "0") : String(startNumber);
  return `${prefix}${num}${suffix}`;
}

interface CodeRule {
  id: number;
  company_id: number | null;
  prefix_template: string;
  suffix_template: string;
  start_number: number;
  pad_width: number;
}

export function CodeRuleScreen() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ prefixTemplate: "", suffixTemplate: "", startNumber: 1, padWidth: 0 });

  useQuery({ queryKey: ["code-rules"], queryFn: () => apiClient.get<CodeRule[]>("/code-rules") });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.post("/code-rules", {
        company_id: null,
        prefix_template: form.prefixTemplate,
        suffix_template: form.suffixTemplate,
        start_number: form.startNumber,
        pad_width: form.padWidth,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["code-rules"] }),
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const preview = renderPreview(form.prefixTemplate, form.suffixTemplate, form.startNumber, form.padWidth);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Asset Code Rule</h1>

      <div className="flex flex-col gap-4 max-w-md">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="prefix-template">Prefix Template</Label>
          <Input
            id="prefix-template"
            aria-label="Prefix Template"
            value={form.prefixTemplate}
            onChange={(e) => setField("prefixTemplate", e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="suffix-template">Suffix Template</Label>
          <Input
            id="suffix-template"
            aria-label="Suffix Template"
            value={form.suffixTemplate}
            onChange={(e) => setField("suffixTemplate", e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="start-number">Start Number</Label>
          <Input
            id="start-number"
            aria-label="Start Number"
            type="number"
            value={form.startNumber}
            onChange={(e) => setField("startNumber", Number(e.target.value))}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pad-width">Pad Width (0 = no padding)</Label>
          <Input
            id="pad-width"
            aria-label="Pad Width (0 = no padding)"
            type="number"
            value={form.padWidth}
            onChange={(e) => setField("padWidth", Number(e.target.value))}
          />
        </div>
      </div>

      <div className="rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
        Preview: <span data-testid="code-preview" className="font-mono">{preview}</span>
      </div>

      <div>
        <Button onClick={() => saveMutation.mutate()}>Save</Button>
      </div>
    </div>
  );
}
