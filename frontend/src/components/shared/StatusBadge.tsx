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

interface StatusBadgeProps {
  status: string;
  className?: string;
}

/** Centralizes CKAM's asset-status color/label mapping (REVIEW_FINDINGS.md #3
 * "status not used consistently"). The status name itself is always shown as
 * text, never color alone, so tone communicates urgency without being the
 * sole signal. Never invents a status or renames a backend value -- an
 * unmapped string still renders, just with the neutral tone. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const tone = ASSET_STATUS_TONE[status] ?? "neutral";
  return (
    <Badge variant="outline" className={cn(TONE_CLASSES[tone], "font-medium", className)}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
