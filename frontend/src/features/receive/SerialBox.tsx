import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * One multi-line serial box: one serial per row (paste a list, or scan -- each
 * scan ends with Enter, which starts the next row). A row-number gutter beside
 * it marks the exact rows that are wrong (typed twice, already used, refused),
 * so a problem in a list of 100 is found without counting.
 *
 * The box never wraps (a long serial scrolls sideways) so each gutter number
 * stays level with its row; the gutter follows the box's scroll.
 */
export function SerialBox({
  id, label, text, onChange, badRows, rows, describedBy, placeholder, className,
}: {
  id: string;
  /** Accessible name of the box. */
  label: string;
  text: string;
  onChange: (text: string) => void;
  /** Box row (1-based) -> why it is wrong. */
  badRows: Map<number, string>;
  /** How many rows are expected (the gutter shows at least this many). */
  rows: number;
  describedBy?: string;
  placeholder?: string;
  className?: string;
}) {
  const gutter = useRef<HTMLDivElement>(null);
  const typedRows = text === "" ? 0 : text.split("\n").length;
  const shown = Math.max(rows, typedRows, 1);
  const visibleRows = Math.min(Math.max(rows, 3), 10);
  return (
    <div className={cn("flex overflow-hidden rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring", className)}>
      <div
        ref={gutter}
        aria-hidden="true"
        data-testid={`${id}-gutter`}
        className="w-10 shrink-0 select-none overflow-hidden border-r bg-muted/40 py-2 text-right font-mono text-xs leading-5 text-muted-foreground"
        style={{ height: `calc(${visibleRows} * 1.25rem + 1rem)` }}
      >
        {Array.from({ length: shown }, (_, i) => {
          const bad = badRows.has(i + 1);
          return (
            <div key={i} data-row={i + 1} data-problem={bad || undefined} className={cn("pr-1.5", bad && "bg-destructive/15 font-semibold text-destructive")}>
              {bad ? "!" : ""}{i + 1}
            </div>
          );
        })}
      </div>
      <textarea
        id={id}
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={badRows.size > 0 || undefined}
        value={text}
        wrap="off"
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
        className="min-w-0 flex-1 resize-none overflow-auto whitespace-pre bg-transparent px-2 py-2 font-mono text-sm leading-5 outline-none placeholder:font-sans placeholder:text-muted-foreground"
        style={{ height: `calc(${visibleRows} * 1.25rem + 1rem)` }}
      />
    </div>
  );
}
