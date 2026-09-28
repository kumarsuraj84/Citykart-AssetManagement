import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "info" | "success" | "warning" | "destructive" | "neutral";

// Presentation only -- backend status values (Asset.status, see
// backend/app/assets/models.py ASSET_STATUSES) are never read from or written
// by this mapping. Semantics: IN_STOCK is available-but-idle (info);
// ALLOTTED/INSTALLED are in active productive use (success); UNDER_REPAIR
// needs attention but isn't final (warning); DISPOSED/SOLD/SCRAPPED are
// terminal, no action needed (neutral); LOST needs attention and is not
// resolved (destructive).
const ASSET_STATUS_TONE: Record<string, Tone> = {
  IN_STOCK: "info",
  ALLOTTED: "success",
  INSTALLED: "success",
  UNDER_REPAIR: "warning",
  DISPOSED: "neutral",
  SOLD: "neutral",
  SCRAPPED: "neutral",
  LOST: "destructive",
};

const TONE_CLASSES: Record<Tone, string> = {
  info: "border-transparent bg-info-soft text-on-info-soft",
  success: "border-transparent bg-success-soft text-on-success-soft",
  warning: "border-transparent bg-warning-soft text-on-warning-soft",
  destructive: "border-transparent bg-destructive-soft text-on-destructive-soft",
  neutral: "border-transparent bg-secondary text-secondary-foreground",
};

// AM-16: the dot color for `compact` mode -- the solid tone, not its `-soft`
// pastel fill (which exists specifically to color a whole chip's background,
// too weak on its own at 6px). Neutral has no dedicated `--neutral` token, so
// it reuses the same muted foreground `StatusBadge`'s own neutral chip text
// already uses.
const DOT_CLASSES: Record<Tone, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  neutral: "bg-secondary-foreground",
};

interface StatusBadgeProps {
  status: string;
  className?: string;
  /** AM-16: a dense table/list row (Asset Register, Dashboard's Exceptions,
   * PO lines) reads calmer as a small semantic dot + plain text than a
   * colored pill per row -- live A/B comparison on Asset Register showed a
   * real reduction in visual noise with the status text still fully legible
   * (never color-alone). A single-record context (Asset 360's own header)
   * keeps the existing pill, which has more room to carry emphasis. Default
   * false so every existing call site is unchanged unless it opts in. */
  compact?: boolean;
}

/** Centralizes CKAM's asset-status color/label mapping (REVIEW_FINDINGS.md #3
 * "status not used consistently"). The status name itself is always shown as
 * text, never color alone, so tone communicates urgency without being the
 * sole signal. Never invents a status or renames a backend value -- an
 * unmapped string still renders, just with the neutral tone. */
export function StatusBadge({ status, className, compact }: StatusBadgeProps) {
  const tone = ASSET_STATUS_TONE[status] ?? "neutral";
  const label = status.replace(/_/g, " ");

  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs text-foreground", className)}>
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASSES[tone])} aria-hidden="true" />
        {label}
      </span>
    );
  }

  return (
    <Badge variant="outline" className={cn(TONE_CLASSES[tone], "font-medium", className)}>
      {label}
    </Badge>
  );
}
