import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({
  companyId: z.coerce.number(),
  loginId: z.string().min(1, "User ID is required"),
  password: z.string().min(1, "Password is required"),
});
type FormInput = z.input<typeof schema>;
type FormValues = z.infer<typeof schema>;

export function LoginForm({
  companies,
  onSubmit,
}: {
  companies: { id: number; name: string }[];
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { companyId: companies[0]?.id },
  });

  return (
    <form onSubmit={handleSubmit((data) => onSubmit(data))} className="flex flex-col gap-4 max-w-sm">
      <label htmlFor="company">Company</label>
      <select id="company" {...register("companyId")}>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <label htmlFor="emp-code">User ID</label>
      {/* Hint kept OUTSIDE the <label> so the accessible name stays exactly
          "User ID" (E2E and unit tests both look it up by that exact label
          text) -- the hint just clarifies that either identifier works. */}
      <span className="text-xs text-muted-foreground">(Emp Code or Email)</span>
      <input id="emp-code" {...register("loginId")} />
      {errors.loginId && <span role="alert">{errors.loginId.message}</span>}

      <label htmlFor="password">Password</label>
      <input id="password" type="password" {...register("password")} />
      {errors.password && <span role="alert">{errors.password.message}</span>}

      <button type="submit">Log in</button>
    </form>
  );
}
