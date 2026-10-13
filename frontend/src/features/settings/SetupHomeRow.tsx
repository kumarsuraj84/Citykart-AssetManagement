import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useAccess } from "@/lib/access";
import { SETUP_WIZARD_PATH } from "./settings-structure";
import { SETUP_TOTAL, useDefaultSetupCompany, useSetupProgress } from "./setup-progress";

/**
 * Home, head-office admin only: "Finish setting up CKAM" until all seven set-up steps are done
 * (read from the data; nothing stored). Renders nothing for anyone else, while loading, or once complete.
 */
export function SetupHomeRow() {
  const { can } = useAccess();
  const allowed = can("settings");
  // S7 (P2-3): about the company the person works in (a new company is not "done" because another one is).
  const company = useDefaultSetupCompany();
  const { doneCount, isLoading, isError } = useSetupProgress(allowed && company.ready, company.companyId);
  if (!allowed || !company.ready || isLoading || isError || doneCount >= SETUP_TOTAL) return null;
  const named = company.companies.length > 1 ? company.companies.find((c) => c.id === company.companyId) : undefined;
  return (
    <section
      aria-label="Finish setting up"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm"
    >
      <span>
        <span className="font-medium">Finish setting up CKAM{named ? ` for ${named.code || named.name}` : ""}</span>{" "}
        <span className="text-muted-foreground tabular-nums">· {doneCount} of {SETUP_TOTAL} steps done</span>
      </span>
      <Link
        to={SETUP_WIZARD_PATH}
        className="inline-flex shrink-0 items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
      >
        Continue setup
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </section>
  );
}
