import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

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
    <form onSubmit={handleSubmit(submit)} className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-lg font-semibold">{required ? "Set a new password" : "Change password"}</h1>
      {required && (
        <p className="text-sm text-muted-foreground">
          You signed in with a temporary password. Choose your own password to continue.
        </p>
      )}

      <label htmlFor="old-password">Current password</label>
      <input id="old-password" type="password" autoComplete="current-password" {...register("oldPassword")} />
      {errors.oldPassword && <span role="alert">{errors.oldPassword.message}</span>}

      <label htmlFor="new-password">New password</label>
      <input id="new-password" type="password" autoComplete="new-password" {...register("newPassword")} />
      {errors.newPassword && <span role="alert">{errors.newPassword.message}</span>}

      <label htmlFor="confirm-password">Confirm new password</label>
      <input id="confirm-password" type="password" autoComplete="new-password" {...register("confirmPassword")} />
      {errors.confirmPassword && <span role="alert">{errors.confirmPassword.message}</span>}

      {submitError && <span role="alert">{submitError}</span>}

      <button type="submit" disabled={isSubmitting}>
        Change password
      </button>
    </form>
  );
}
