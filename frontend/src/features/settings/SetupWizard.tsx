import { useEffect, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
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
import { SETUP_TOTAL, useSetupProgress, type SetupStep, type SetupStepKey } from "./setup-progress";

/** Each step opens the normal Settings screen(s) inline: the same forms, rules and permissions. */
function StepContent({ stepKey }: { stepKey: SetupStepKey }): ReactNode {
  switch (stepKey) {
    case "company":
      return <CompaniesSetup embedded />;
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
      return <CodeRuleScreen embedded />;
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
  const progress = useSetupProgress();
  const { steps, doneCount } = progress;
  const opening = progress.isLoading || progress.isError ? null : firstOpenStep(steps);

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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Set up CKAM"
        description="Seven short steps, in the order that avoids surprises later. Each opens the normal Settings screen. Skip any step and come back whenever you like: progress is read from what already exists."
        actions={
          <div className="flex min-w-48 flex-col gap-1 text-right">
            <span className="text-sm font-medium tabular-nums" data-testid="setup-done-count">
              {progress.isLoading ? "…" : `${doneCount} of ${SETUP_TOTAL} done`}
            </span>
            <Progress value={(doneCount / SETUP_TOTAL) * 100} className="h-1.5" aria-label="Set-up progress" />
          </div>
        }
      />

      {allDone && !progress.isLoading && (
        <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm" role="status">
          CKAM is set up. Everything stays available under <Link to={SETTINGS_HOME} className="font-medium underline-offset-2 hover:underline">Settings</Link>.
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
                      {progress.isLoading ? "…" : s.done ? `Done · ${s.status}` : `To do · ${s.status}`}
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
              {progress.isLoading ? "Checking…" : current.done ? "Done" : "To do"}
            </span>
          </div>

          {progress.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-2/3" />
            </div>
          ) : (
            <StepContent stepKey={current.key} />
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
              <Button asChild size="sm">
                <Link to={SETTINGS_HOME}>Finish</Link>
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
