import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  htmlFor: string;
  label: string;
  required?: boolean;
  helperText?: string;
  errorText?: string;
  children: ReactNode;
  className?: string;
}

/** Standardizes label/required-marker/helper-text/error-text/spacing around a
 * single form control (AM-03 §7.7). Foundation only -- no existing CKAM form
 * is migrated to it in this stage; it exists for the Add Asset / Asset 360
 * data-entry stage that follows AM-03. */
export function FormField({ htmlFor, label, required, helperText, errorText, children, className }: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      {children}
      {errorText ? (
        <p className="text-xs text-destructive">{errorText}</p>
      ) : (
        helperText && <p className="text-xs text-muted-foreground">{helperText}</p>
      )}
    </div>
  );
}
