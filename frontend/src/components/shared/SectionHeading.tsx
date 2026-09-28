import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  children: string;
  className?: string;
}

/** AM-14: the quiet section-divider pattern -- a small-caps muted label with a
 * hairline rule trailing off to the right, replacing a bare heading (Add
 * Asset) or a bare heading + separate full-width `Separator` (Import). One
 * shared component so every sectioned form/page in the app uses the exact
 * same label styling and rule weight, not a per-page approximation of it. */
export function SectionHeading({ children, className }: SectionHeadingProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
