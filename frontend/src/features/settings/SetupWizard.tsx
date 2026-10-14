import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { cn } from "@/lib/utils";
import CompaniesSetup from "../../routes/setup/companies";
import LocationsSetup from "../../routes/setup/locations";
import CostCentersSetup from "../../routes/setup/cost-centers";
import VendorsSetup from "../../routes/setup/vendors";
import { PeopleScreen } from "../people/PeopleScreen";
import { AssetGroupsScreen } from "../asset-groups/AssetGroupsScreen";
import { ItemsScreen } from "../items/ItemsScreen";
import { CodeRuleScreen } from "../numbering/CodeRuleScreen";
import { SETTINGS_HOME } from "./settings-structure";
import { SETUP_TOTAL, useDefaultSetupCompany, useSetupProgress, type SetupStep, type SetupStepKey } from "./setup-progress";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { companyOptions } from "@/lib/option-labels";
import type { CompanyRef } from "@/lib/capabilities";

/** Each step opens the normal Settings screen(s) inline: the same forms, rules and permissions. */
function StepContent({ stepKey, company, onCompanyCreated }: {
  stepKey: SetupStepKey; company: CompanyRef | null; onCompanyCreated: (c: CompanyRef) => void;
}): ReactNode {
  switch (stepKey) {
    case "company":
      return <CompaniesSetup embedded onCreated={onCompanyCreated} />;
    case "stock-room":
      return (
        <div className="flex flex-col gap-6">
          <LocationsSetup embedded />
          <PeopleScreen kind="stock-rooms" embedded />
        </div>
      );
    case "cost-centre":
      return <CostCentersSetup embedded />;
    case "catalogue":
      return (
        <div className="flex flex-col gap-6">
          <AssetGroupsScreen embedded />
          <ItemsScreen embedded />
        </div>
      );
    case "vendors":
      return <VendorsSetup embedded />;
    case "people":
      return (
        <div className="flex flex-col gap-6">
          <PeopleScreen kind="employees" embedded />
          <PeopleScreen kind="stores" embedded />
        </div>
      );
    case "code-format":
      // S7 (P2-3): the example is the guide's company's (its code in the asset code).
      return <CodeRuleScreen embedded exampleCompany={company} />;
  }
}

/** The step to open when none is chosen: the first one not done yet. */
export function firstOpenStep(steps: SetupStep[]): number {
  return steps.find((s) => !s.done)?.n ?? 1;
}

/**
 * Settings › Set up CKAM: a guided, resumable path through the seven things CKAM needs before the first
 * asset. Nothing is stored about the guide itself: each step is done when its data exists, so leaving and
 * coming back (or doing the work on the normal Settings screens) just works.
 */
export function SetupWizard({
  step, onStepChange,
}: {
  step?: number;
  /** `replace`: pin the opening step without adding a history entry. */
  onStepChange: (n: number, opts?: { replace?: boolean }) => void;
}) {
  // S7 (P2-3): the guide is about ONE company (default: the one the person works in), chosen at the top.
  const defaults = useDefaultSetupCompany();
  const qc = useQueryClient();
  const [chosenCompanyId, setChosenCompanyId] = useState<number | null>(null);
  // S7 fix 2 (N3): a company added in step 1 is in the picker (and chosen) at once, while the lists the picker
  // reads are asked for again; it no longer needs a reload.
  const [added, setAdded] = useState<CompanyRef[]>([]);
  const companies = [...defaults.companies, ...added.filter((a) => !defaults.companies.some((c) => c.id === a.id))];
  const companyId = chosenCompanyId ?? defaults.companyId;
  const company = companies.find((c) => c.id === companyId) ?? (companyId != null ? { id: companyId, code: "", name: "" } : null);
  const companyCreated = (c: CompanyRef) => {
    setAdded((list) => [...list.filter((a) => a.id !== c.id), { id: c.id, code: c.code, name: c.name }]);
    setChosenCompanyId(c.id);
    setFinished(false);
    qc.invalidateQueries({ queryKey: ["auth", "capabilities"] });
    qc.invalidateQueries({ queryKey: ["asset_users", "me", "companies"] });
    qc.invalidateQueries({ queryKey: ["masters", "companies"] });
  };
  const progress = useSetupProgress(defaults.ready, companyId);
  const companyWord = (company ? company.code || company.name : "") || progress.companyLabel;
  const { steps, doneCount } = progress;
  const loading = progress.isLoading || !defaults.ready;
  const opening = loading || progress.isError ? null : firstOpenStep(steps);
  // "Finish": the guide ends on a summary of where this company stands (not on step 7).
  const [finished, setFinished] = useState(false);

  // Opened without a step: settle on the first step not done yet, once, so the page does not jump
  // to the next step by itself while the person is still working on this one.
  useEffect(() => {
    if (step === undefined && opening !== null) onStepChange(opening, { replace: true });
  }, [step, opening, onStepChange]);

  if (progress.isError) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Set up CKAM" />
        <ErrorState message="Couldn't read what is set up yet." />
      </div>
    );
  }

  const current = steps.find((s) => s.n === step) ?? steps.find((s) => s.n === firstOpenStep(steps))!;
  const allDone = doneCount === SETUP_TOTAL;
  const left = steps.filter((s) => !s.done);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Set up CKAM"
        description="Seven short steps, in the order that avoids surprises later. Each opens the normal Settings screen. Skip any step and come back whenever you like: progress is read from what already exists."
        actions={
          <div className="flex min-w-48 flex-col gap-1 text-right">
            <span className="text-sm font-medium tabular-nums" data-testid="setup-done-count">
              {loading ? "…" : `${doneCount} of ${SETUP_TOTAL} done${companyWord ? ` for ${companyWord}` : ""}`}
            </span>
            <Progress value={(doneCount / SETUP_TOTAL) * 100} className="h-1.5" aria-label="Set-up progress" />
          </div>
        }
      />

      {companies.length > 1 && (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <label htmlFor="setup-company" className="text-sm font-medium">Company being set up</label>
          <div className="w-full sm:w-72">
            <SearchableSelect
              id="setup-company" aria-label="Company being set up" value={companyId != null ? String(companyId) : undefined}
              onValueChange={(v) => { setChosenCompanyId(Number(v)); setFinished(false); }}
              options={companyOptions(companies)}
            />
          </div>
          <p className="text-xs text-muted-foreground">Places, stock rooms, cost centres and people are per company; groups, Items and vendors are shared.</p>
        </div>
      )}

      {finished && !loading ? (
        <section aria-label="Set-up summary" className="flex flex-col gap-3 rounded-md border p-4" aria-live="polite">
          {allDone ? (
            <>
              <h2 className="text-base font-semibold">CKAM is set up{companyWord ? ` for ${companyWord}` : ""}.</h2>
              <p className="text-sm text-muted-foreground">
                All seven steps are done. Everything stays available under Settings; the first assets can be added now.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold">
                {doneCount} of {SETUP_TOTAL} steps done{companyWord ? ` for ${companyWord}` : ""}.
              </h2>
              <p className="text-sm text-muted-foreground">Still to do: {left.map((s) => s.title).join(", ")}.</p>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {allDone ? (
              <Button asChild size="sm"><Link to="/assets/new">Add the first assets</Link></Button>
            ) : (
              <Button size="sm" onClick={() => { setFinished(false); onStepChange(left[0].n); }}>Continue with {left[0].title}</Button>
            )}
            <Button asChild size="sm" variant="outline"><Link to={SETTINGS_HOME}>Go to Settings</Link></Button>
            <Button size="sm" variant="ghost" onClick={() => setFinished(false)}>Back to the steps</Button>
          </div>
        </section>
      ) : (
      <>
      {allDone && !loading && (
        <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm" role="status">
          CKAM is set up{companyWord ? ` for ${companyWord}` : ""}. Everything stays available under <Link to={SETTINGS_HOME} className="font-medium underline-offset-2 hover:underline">Settings</Link>.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
        <ol aria-label="Set-up steps" className="flex flex-col gap-1">
          {steps.map((s) => {
            const active = s.n === current.n;
            return (
              <li key={s.key}>
                <button
                  type="button"
                  aria-current={active ? "step" : undefined}
                  onClick={() => onStepChange(s.n)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left text-sm transition-colors",
                    active ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted",
                  )}
                  data-step={s.key}
                  data-done={s.done ? "true" : "false"}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                      s.done ? "bg-primary text-primary-foreground" : "border bg-background text-muted-foreground",
                    )}
                    aria-hidden="true"
                  >
                    {s.done ? <Check className="h-3 w-3" /> : s.n}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{s.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {loading ? "…" : s.done ? `Done · ${s.status}` : `To do · ${s.status}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <section aria-labelledby="setup-step-title" className="flex min-w-0 flex-col gap-4 rounded-md border p-3 md:p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Step {current.n} of {SETUP_TOTAL}
              </p>
              <h2 id="setup-step-title" className="text-base font-semibold">{current.title}</h2>
              <p className="text-sm text-muted-foreground">{current.what}</p>
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                current.done ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {loading ? "Checking…" : current.done ? "Done" : "To do"}
            </span>
          </div>

          {loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-2/3" />
            </div>
          ) : (
            <StepContent stepKey={current.key} company={company} onCompanyCreated={companyCreated} />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <Button variant="outline" size="sm" disabled={current.n === 1} onClick={() => onStepChange(current.n - 1)}>
              Back
            </Button>
            {current.n < SETUP_TOTAL ? (
              <Button size="sm" variant={current.done ? "default" : "outline"} onClick={() => onStepChange(current.n + 1)}>
                {current.done ? "Next" : "Skip for now"}
              </Button>
            ) : (
              <Button size="sm" onClick={() => setFinished(true)}>
                Finish
              </Button>
            )}
          </div>
        </section>
      </div>
      </>
      )}
    </div>
  );
}