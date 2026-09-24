import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

interface AsyncButtonProps extends ButtonProps {
  pending?: boolean;
  pendingLabel?: string;
}

/** Shared normal/pending/disabled pattern for an action that triggers a
 * mutation (REVIEW_FINDINGS.md #6 -- Imports/Reports each hand-roll their own
 * pending state). Deliberately does not catch or render the operation's
 * error -- that stays page-level feedback (e.g. AssetRegister's bulk-move
 * dialog already shows failure detail beside the button), never hidden
 * inside it. */
export function AsyncButton({ pending, pendingLabel, disabled, children, ...props }: AsyncButtonProps) {
  return (
    <Button disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
