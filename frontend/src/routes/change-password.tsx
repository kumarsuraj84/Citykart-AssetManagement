import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Mirrors backend app.auth.schemas.ChangePasswordRequest (min 8, must differ).
export const MIN_PASSWORD_LENGTH = 8;

const schema = z
  .object({
    oldPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH, `New password must be at least ${MIN_PASSWORD_LENGTH} characters`),
    confirmPassword: z.string().min(1, "Please confirm the new password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
  .refine((v) => v.newPassword !== v.oldPassword, {
    path: ["newPassword"],
    message: "New password must be different from the current one",
  });

export type ChangePasswordValues = z.infer<typeof schema>;

function PasswordField({
  id,
  label,
  autoComplete,
  register,
  error,
}: {
  id: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  register: ReturnType<typeof useForm<ChangePasswordValues>>["register"];
  error?: string;
}) {
  const [visible, setVisible] = useState(false);
  const fieldName =
    id === "old-password" ? "oldPassword" : id === "new-password" ? "newPassword" : "confirmPassword";
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          className="h-11 pl-10 pr-10"
          {...register(fieldName as "oldPassword" | "newPassword" | "confirmPassword")}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
    </div>
  );
}

export function ChangePasswordForm({
  required,
  onSubmit,
}: {
  /** true when the server flagged must_change_password (first login / admin reset). */
  required: boolean;
  onSubmit: (values: ChangePasswordValues) => Promise<void>;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({ resolver: zodResolver(schema) });

  async function submit(values: ChangePasswordValues) {
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not change the password.");
    }
  }

  return (
    <Card className="w-full max-w-[420px] rounded-xl border shadow-md">
      <CardContent className="px-8 py-8">
        <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-5" noValidate>
          <div className="flex flex-col gap-1.5 text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              {required ? "Set a new password" : "Change password"}
            </h1>
            {required && (
              <p className="text-sm text-muted-foreground">
                You signed in with a temporary password. Choose your own password to continue.
              </p>
            )}
          </div>

          {submitError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          <PasswordField
            id="old-password"
            label="Current password"
            autoComplete="current-password"
            register={register}
            error={errors.oldPassword?.message}
          />
          <PasswordField
            id="new-password"
            label="New password"
            autoComplete="new-password"
            register={register}
            error={errors.newPassword?.message}
          />
          <PasswordField
            id="confirm-password"
            label="Confirm new password"
            autoComplete="new-password"
            register={register}
            error={errors.confirmPassword?.message}
          />

          <Button type="submit" disabled={isSubmitting} className="mt-2 h-11 w-full">
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
