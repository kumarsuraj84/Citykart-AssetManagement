import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/shared/PageHeader";
import { SETTINGS_SECTIONS, SETUP_WIZARD_PATH } from "./settings-structure";
import { SETUP_TOTAL, useSetupProgress } from "./setup-progress";

/** The "Set up CKAM" line at the top of Settings: progress and the way in. */
function SetupProgressLine() {
  const { doneCount, isLoading, isError } = useSetupProgress();
  if (isError) return null;
  const complete = !isLoading && doneCount === SETUP_TOTAL;
  return (
    <section
      aria-label="Set up CKAM"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium">
          Set up CKAM{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            {isLoading ? "" : complete ? "· all 7 steps done" : `· ${doneCount} of ${SETUP_TOTAL} done`}
          </span>
        </span>
        <Progress value={(doneCount / SETUP_TOTAL) * 100} className="h-1.5 w-56 max-w-full" aria-label="Set-up progress" />
      </div>
      <Link
        to={SETUP_WIZARD_PATH}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline"
      >
        {complete ? "Review the steps" : doneCount === 0 ? "Start" : "Continue"}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </section>
  );
}

/** Settings (head-office admin): one compact card per group, so nothing has to be hunted for. */
export function SettingsLanding() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Settings"
        description="Everything CKAM needs set once, for the head-office admin. Daily work never needs these screens."
      />
      <SetupProgressLine />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SETTINGS_SECTIONS.map((section, i) => (
          <section key={section.label} aria-labelledby={`settings-section-${i}`} className="flex flex-col gap-2 rounded-md border bg-card p-3">
            <div>
              <h2 id={`settings-section-${i}`} className="text-sm font-semibold">{section.label}</h2>
              <p className="text-xs text-muted-foreground">{section.line}</p>
            </div>
            <ul className="flex flex-col gap-1.5">
              {section.links.map((l) => (
                <li key={l.to} className="text-sm">
                  <Link to={l.to} className="font-medium text-primary underline-offset-2 hover:underline">{l.label}</Link>
                  <p className="text-xs text-muted-foreground">{l.line}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
