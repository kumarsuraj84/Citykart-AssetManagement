import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import "@/lib/zod-config";
import { z } from "zod";
import { UserRound, Lock, Eye, EyeOff, ArrowRight, AlertCircle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { ApiError } from "@/lib/api-client";
import { LOGIN_NOTICE_KEY, SESSION_ENDED_NOTICE } from "@/lib/auth-fetch";

const schema = z.object({
  loginId: z.string().min(1, "User ID is required"),
  password: z.string().min(1, "Password is required"),
});
type FormValues = z.infer<typeof schema>;

export const WRONG_CREDENTIALS_MESSAGE = "The User ID or password is not correct.";
export const ACCOUNT_LOCKED_MESSAGE = "This account is locked for now. Try again later, or ask the administrator to unlock it.";
export const TOO_MANY_ATTEMPTS_MESSAGE = "Too many sign-in attempts. Wait a minute and try again.";

/**
 * The one sentence for a refused sign-in, by the server's status: 401 is the same words whether the User ID
 * is unknown or the password is wrong (nothing tells an outsider which one), 423 a locked account, 429 the
 * server's own "too many attempts" sentence. Anything else (no answer, a server fault) keeps its message.
 */
export function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return WRONG_CREDENTIALS_MESSAGE;
    if (err.status === 423) return ACCOUNT_LOCKED_MESSAGE;
    if (err.status === 429) {
      const detail = (err.body as { detail?: unknown } | null)?.detail;
      return typeof detail === "string" && detail.trim() ? detail.trim() : TOO_MANY_ATTEMPTS_MESSAGE;
    }
  }
  return err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.";
}

/** The one-line notice left by a session that ended on its own (lib/auth-fetch.ts redirectToLogin), read once. */
export function useLoginNotice(): string | null {
  const [notice] = useState<string | null>(() => {
    try {
      return window.sessionStorage.getItem(LOGIN_NOTICE_KEY) === "expired" ? SESSION_ENDED_NOTICE : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.removeItem(LOGIN_NOTICE_KEY);
    } catch {
      // nothing to forget
    }
  }, []);
  return notice;
}

export function LoginForm({
  onSubmit,
  notice = null,
}: {
  onSubmit: (values: FormValues) => Promise<void>;
  /** A one-line, non-error notice above the form (e.g. "Your session has ended."). */
  notice?: string | null;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });
  const [showPassword, setShowPassword] = useState(false);
  // Set when the backend rejects the login itself (wrong credentials, locked
  // account, ...) -- distinct from the per-field zod errors above, which catch
  // an empty field before a request is ever sent.
  const [formError, setFormError] = useState<string | null>(null);

  const submit = handleSubmit(async (data) => {
    setFormError(null);
    try {
      await onSubmit(data);
    } catch (err) {
      setFormError(loginErrorMessage(err));
    }
  });

  return (
    <Card className="w-full max-w-[420px] rounded-xl border shadow-md">
      <CardContent className="px-8 py-8">
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          {notice && !formError && (
            <Alert data-testid="login-notice">
              <Info className="h-4 w-4" />
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          {formError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription><ErrorMessage as="span" announce={false} message={formError} /></AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-code">User ID</Label>
            <div className="relative">
              <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              {/* Placeholder kept OUTSIDE the visible label text so the accessible
                  name stays exactly "User ID" -- E2E and unit tests look it up by
                  that exact label; the placeholder just clarifies either identifier works. */}
              <Input
                id="emp-code"
                autoComplete="username"
                placeholder="Employee Code or Email"
                className="h-11 pl-10"
                {...register("loginId")}
              />
            </div>
            {errors.loginId && <span role="alert" className="text-sm text-destructive">{errors.loginId.message}</span>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="h-11 pl-10 pr-10"
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && <span role="alert" className="text-sm text-destructive">{errors.password.message}</span>}
          </div>

          <Button type="submit" disabled={isSubmitting} className="mt-2 h-11 w-full gap-2 text-base">
            Sign in
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
