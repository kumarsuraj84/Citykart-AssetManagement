import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Primary/secondary action buttons, right-aligned next to the title. */
  actions?: ReactNode;
  /** Search/filter row, rendered below the title. */
  children?: ReactNode;
  /** "h2" when the screen is shown inside another page (a Settings tab, a
   * Set up CKAM step): a smaller heading, so the page keeps one h1. */
  as?: "h1" | "h2";
}

/** Consistent title/description/actions/filters layout -- see DESIGN_SYSTEM.md
 * and REVIEW_FINDINGS.md #2. Deliberately just a thin composition shell, not a
 * configuration object: callers pass real elements for actions/filters rather
 * than describing them through props this component would have to interpret. */
export function PageHeader({ title, description, actions, children, as = "h1" }: PageHeaderProps) {
  const Heading = as;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading className={as === "h1" ? "text-lg font-semibold text-foreground" : "text-base font-semibold text-foreground"}>
            {title}
          </Heading>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
