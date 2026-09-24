import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserRound, Lock, Eye, EyeOff, ArrowRight, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  loginId: z.string().min(1, "User ID is required"),
  password: z.string().min(1, "Password is required"),
});
type FormValues = z.infer<typeof schema>;

export function LoginForm({
  onSubmit,
}: {
  onSubmit: (values: FormValues) => Promise<void>;
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
      setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  });

  return (
    <Card className="w-full max-w-[420px] rounded-xl border shadow-md">
      <CardContent className="px-8 py-8">
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          {formError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{formError}</AlertDescription>
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
