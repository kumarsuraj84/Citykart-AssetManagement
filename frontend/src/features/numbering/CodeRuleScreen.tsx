import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useAccess } from "../../lib/access";
import { useAuthStore } from "../../lib/auth-store";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

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

/** How long typing must pause before the server is asked for the example. */
export const PREVIEW_DEBOUNCE_MS = 350;

export const OWNER_ONLY_NOTE = "Only the head-office admin can change the asset code format.";

/** Quick offline example, shown until (or instead of) the server's own. */
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
  /** Server-rendered example code (additive field, S0). */
  example?: string | null;
}

interface RuleBody {
  company_id: number | null;
  prefix_template: string;
  suffix_template: string;
  start_number: number;
  pad_width: number;
}

export function CodeRuleScreen({ embedded = false, exampleCompany = null }: {
  embedded?: boolean;
  /** S7 (P2-3): show the example for this company (the set-up guide's company), from the server's preview. */
  exampleCompany?: { id: number; code?: string | null; name?: string | null } | null;
} = {}) {
  const qc = useQueryClient();
  const { role, isPrimaryOwner } = useAccess();
  // UX only: the server refuses anyone but the head-office admin (403).
  const canEdit = role === "ADMIN" && isPrimaryOwner;
  const [form, setForm] = useState({ prefixTemplate: "", suffixTemplate: "", startNumber: 1, padWidth: 0 });
  // S7 fix 2 (N4): the example is shown in ONE company's own values (its code, location and cost centre):
  // the set-up guide's company, else the company the person works in; none = the server's generic sample.
  const homeCompanyId = useAuthStore((s) => s.companyId);
  const exampleCompanyId = exampleCompany?.id ?? homeCompanyId ?? null;
  const forCompany = exampleCompanyId != null ? `?company_id=${exampleCompanyId}` : "";

  // This screen edits the global rule (company_id null). The API keeps exactly one
  // active rule per scope, so the global entry in the active list IS the rule to edit.
  const {
    data: rules,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["code-rules", exampleCompanyId],
    queryFn: () => apiClient.get<CodeRule[]>(`/code-rules${forCompany}`),
  });
  const activeRule = Array.isArray(rules) ? (rules.find((r) => r.company_id === null) ?? null) : null;

  // Prefill the form from the saved rule when it (first) loads, or when a save
  // produced a different active rule -- so what you see is what is in force. Keyed
  // on the rule id only (adjusting state during render, not in an effect): re-syncing
  // on every refetch would clobber edits in progress.
  const [syncedRuleId, setSyncedRuleId] = useState<number | null>(null);
  if (activeRule && activeRule.id !== syncedRuleId) {
    setSyncedRuleId(activeRule.id);
    setForm({
      prefixTemplate: activeRule.prefix_template,
      suffixTemplate: activeRule.suffix_template,
      startNumber: activeRule.start_number,
      padWidth: activeRule.pad_width,
    });
  }

  const body: RuleBody = {
    company_id: null,
    prefix_template: form.prefixTemplate,
    suffix_template: form.suffixTemplate,
    start_number: form.startNumber,
    pad_width: form.padWidth,
  };

  // The server's own example (POST /code-rules/preview, saves nothing), asked
  // for after the owner pauses typing. Its 422 sentences ("the format needs ...")
  // are shown inline. Only the owner can type, so only the owner asks -- and,
  // in the set-up guide, anyone sees the example for the guide's company (S7 P2-3:
  // the rule stays the global one; only the example is that company's).
  const asks = canEdit || exampleCompany != null;
  // The rule itself is the one for every company (company_id null); the company the example is shown for
  // travels as `?company_id=` (S7 fix 2, N4).
  const previewBody: RuleBody = body;
  const [debouncedBody, setDebouncedBody] = useState<RuleBody>(previewBody);
  const bodyKey = JSON.stringify(previewBody);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBody(JSON.parse(bodyKey) as RuleBody), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [bodyKey]);
  const settled = JSON.stringify(debouncedBody) === bodyKey;
  const previewQ = useQuery({
    queryKey: ["code-rule-preview", debouncedBody, exampleCompanyId],
    queryFn: async () => (await apiClient.post<{ example?: string }>(`/code-rules/preview${forCompany}`, debouncedBody)) ?? null,
    enabled: asks && !isLoading && !isError && debouncedBody.prefix_template.trim() !== "",
    retry: false,
    staleTime: 60_000,
  });
  const previewError =
    asks && settled && previewQ.isError && previewQ.error instanceof Error ? previewQ.error.message : null;
  const serverExample =
    asks && settled && !previewQ.isError && typeof previewQ.data?.example === "string" ? previewQ.data.example : null;

  const saveMutation = useMutation({
    mutationFn: () =>
      // Edit the existing rule in place; only the very first save creates one.
      // (Previously every Save POSTed another active rule.)
      activeRule ? apiClient.put(`/code-rules/${activeRule.id}`, body) : apiClient.post("/code-rules", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["code-rules"] }),
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const clientPreview = renderPreview(form.prefixTemplate, form.suffixTemplate, form.startNumber, form.padWidth);
  // Someone who cannot change the format sees the saved rule's example as the server rendered it.
  const shownExample = canEdit
    ? (serverExample ?? clientPreview)
    : (serverExample ?? (activeRule?.example || clientPreview));
  const exampleFor = exampleCompany ? (exampleCompany.code || exampleCompany.name || "") : "";

  const statusText = activeRule
    ? canEdit
      ? "Editing the rule currently used to number new assets."
      : "The rule currently used to number new assets."
    : canEdit
      ? "No code rule yet -- assets can't be added until one is saved."
      : "No code rule yet -- assets can't be added until the head-office admin saves one.";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Asset Code Format"
        as={embedded ? "h2" : "h1"}
        description={
          isLoading
            ? undefined
            : `${statusText} Tokens: ${Object.keys(SAMPLE_TOKENS).map((t) => `{${t}}`).join(" ")}`
        }
      />

      {isError ? (
        <ErrorState message={error instanceof Error ? error.message : undefined} error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="flex max-w-md flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <>
          {!canEdit && (
            <p
              role="note"
              data-testid="code-rule-owner-only"
              className="max-w-md rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            >
              {OWNER_ONLY_NOTE}
            </p>
          )}

          <div className="flex flex-col gap-4 max-w-md">
            <FormField htmlFor="prefix-template" label="Prefix Template">
              <Input
                id="prefix-template"
                aria-label="Prefix Template"
                value={form.prefixTemplate}
                readOnly={!canEdit}
                onChange={(e) => setField("prefixTemplate", e.target.value)}
              />
            </FormField>

            <FormField htmlFor="suffix-template" label="Suffix Template">
              <Input
                id="suffix-template"
                aria-label="Suffix Template"
                value={form.suffixTemplate}
                readOnly={!canEdit}
                onChange={(e) => setField("suffixTemplate", e.target.value)}
              />
            </FormField>

            <FormField htmlFor="start-number" label="Start Number">
              <Input
                id="start-number"
                aria-label="Start Number"
                type="number"
                value={form.startNumber}
                readOnly={!canEdit}
                onChange={(e) => setField("startNumber", Number(e.target.value))}
              />
            </FormField>

            <FormField htmlFor="pad-width" label="Pad Width (0 = no padding)">
              <Input
                id="pad-width"
                aria-label="Pad Width (0 = no padding)"
                type="number"
                value={form.padWidth}
                readOnly={!canEdit}
                onChange={(e) => setField("padWidth", Number(e.target.value))}
              />
            </FormField>
          </div>

          {/* AM-15: this line answers the screen's whole reason for existing --
              "what code will my next asset get" -- so it gets stronger visual
              weight than the technical fields above it, not the same plain
              bordered-box treatment as an ordinary input. The example is the
              server's (so it follows the real numbering rules); until it
              arrives, or if it cannot be had, the offline example shows. */}
          <div className="max-w-md rounded-md border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" data-testid="code-preview-label">
              Next Asset Code{exampleFor ? ` in ${exampleFor}` : ""}
            </p>
            <p data-testid="code-preview" className="font-mono text-lg font-semibold text-foreground">
              {previewError ? "—" : shownExample}
            </p>
            {previewError && (
              <ErrorMessage data-testid="code-preview-error" className="mt-1 text-sm text-destructive" message={previewError} />
            )}
          </div>

          {canEdit && (
            <div className="flex items-center gap-3">
              <AsyncButton
                onClick={() => saveMutation.mutate()}
                disabled={!form.prefixTemplate}
                pending={saveMutation.isPending}
                pendingLabel="Saving…"
              >
                Save
              </AsyncButton>
              {saveMutation.isSuccess && <span className="text-sm text-muted-foreground">Saved.</span>}
              {saveMutation.isError && (
                <ErrorMessage as="span" className="text-sm text-destructive" error={saveMutation.error} message={saveMutation.error instanceof Error ? saveMutation.error.message : "Save failed."} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
