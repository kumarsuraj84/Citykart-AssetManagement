import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useKeyedMutation } from "@/lib/submit-key";
import { canManage, useCapabilities, useMyCompanies } from "@/lib/capabilities";
import { ROLES, roleLabel, workAreaLabel } from "@/lib/labels";
import { companyOptions } from "@/lib/option-labels";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { NewDepartmentDialog } from "@/components/quick-create/masters";
import { EMPTY_PLACE, PlacePicker, placeBody, placeGiven, type PlaceChoice } from "./PlacePicker";
import type { PersonRow } from "./people-model";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

interface Named {
  id: number;
  name: string;
}

/** Work area choices on a login (IT Team / Admin / Non-IT Team / Both). */
export const WORK_AREA_CHOICES = [
  { value: "IT", label: workAreaLabel("IT") },
  { value: "NON_IT", label: workAreaLabel("NON_IT") },
  { value: "BOTH", label: workAreaLabel("BOTH") },
];

/** Access levels limited by work area (a self-service login only sees what it holds). */
export const WORK_AREA_ROLES = ["ADMIN", "OPERATOR", "VIEWER"];

interface Draft {
  code: string;
  name: string;
  companyId: string;
  place: PlaceChoice;
  departmentId: string;
  phone: string;
  canSignIn: boolean;
  email: string;
  role: string;
  workArea: string;
  extraCompanies: number[];
}

const BLANK: Draft = {
  code: "", name: "", companyId: "", place: EMPTY_PLACE, departmentId: "", phone: "",
  canSignIn: false, email: "", role: "SELF_SERVICE", workArea: "BOTH", extraCompanies: [],
};

/** The POST /api/people/employees body for this draft (pure; exported for tests). */
export function employeeBody(d: Draft) {
  const staff = WORK_AREA_ROLES.includes(d.role);
  return {
    code: d.code.trim(),
    name: d.name.trim(),
    company_id: Number(d.companyId),
    ...placeBody(d.place),
    ...(d.departmentId ? { department_id: Number(d.departmentId) } : {}),
    ...(d.phone.trim() ? { phone: d.phone.trim() } : {}),
    ...(d.canSignIn
      ? {
          email: d.email.trim(),
          login: {
            enabled: true,
            role: d.role,
            ...(staff ? { work_area: d.workArea } : {}),
            extra_company_ids: d.extraCompanies.filter((id) => id !== Number(d.companyId)),
          },
        }
      : {}),
  };
}

/**
 * Add Employee (S5b-2): Employee Code, Name, Company (only for someone in more
 * than one), Place (an existing one or a new name), Department, Phone, and --
 * only when the person can sign in -- Email, Access level, Work area and extra
 * companies, sent as one `login` object. No type to choose; no password is set
 * here (issue one afterwards). The server's refusals are shown as written.
 */
export function AddEmployeeDialog({
  open, onOpenChange, onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (row: PersonRow) => void;
}) {
  const qc = useQueryClient();
  const { caps } = useCapabilities();
  const { companies } = useMyCompanies();
  const [d, setD] = useState<Draft>(BLANK);
  const [newDepartment, setNewDepartment] = useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const onlyCompany = companies.length === 1 ? String(companies[0].id) : "";
  // One work area of my own: that is the sensible start (a wider one would be refused).
  const myAreas = caps?.work_areas ?? [];
  const startArea = myAreas.length === 1 ? myAreas[0] : "BOTH";

  useEffect(() => {
    if (open) {
      setD({ ...BLANK, companyId: onlyCompany, workArea: startArea });
      mutation.reset();
    }
    // Starts fresh each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (open && onlyCompany && !d.companyId) set({ companyId: onlyCompany });
  }, [open, onlyCompany, d.companyId]);

  const departmentsQ = useQuery({
    queryKey: ["masters", "departments"],
    queryFn: () => apiClient.get<Named[]>("/masters/departments"),
    enabled: open,
  });
  const departments = Array.isArray(departmentsQ.data) ? departmentsQ.data : [];

  // S7 (P1-2): one Add = one Idempotency-Key; a double activation adds one employee.
  const mutation = useKeyedMutation({
    mutationFn: (_: void, keyed) => {
      const body = employeeBody(d);
      return keyed(body, () => apiClient.post<PersonRow>("/people/employees", body));
    },
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["asset_users"] });
      qc.invalidateQueries({ queryKey: ["masters", "locations"] });
      onOpenChange(false);
      onAdded(row);
    },
  });

  const companyId = d.companyId ? Number(d.companyId) : null;
  const missing: string[] = [];
  if (!d.code.trim()) missing.push("the Employee Code");
  if (!d.name.trim()) missing.push("the name");
  if (!d.companyId) missing.push("the company");
  if (!placeGiven(d.place)) missing.push("the place");
  if (d.canSignIn && !d.email.trim()) missing.push("the email they sign in with");
  const canSave = missing.length === 0;
  const others = companies.filter((c) => String(c.id) !== d.companyId);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) mutation.reset(); onOpenChange(o); }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Add Employee</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => { e.preventDefault(); if (canSave && !mutation.isPending) mutation.mutate(); }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField htmlFor="emp-code" label="Employee Code" required>
                <Input id="emp-code" value={d.code} onChange={(e) => set({ code: e.target.value })} placeholder="E200" />
              </FormField>
              <FormField htmlFor="emp-name" label="Name" required>
                <Input id="emp-name" value={d.name} onChange={(e) => set({ name: e.target.value })} />
              </FormField>
            </div>
            {companies.length > 1 && (
              <FormField htmlFor="emp-company" label="Company" required>
                <SearchableSelect
                  id="emp-company" aria-label="Company" value={d.companyId || undefined}
                  onValueChange={(v) => set({ companyId: v, place: EMPTY_PLACE, extraCompanies: d.extraCompanies.filter((id) => String(id) !== v) })}
                  options={companyOptions(companies)} placeholder="Choose the company"
                />
              </FormField>
            )}
            <PlacePicker id="emp-place" companyId={companyId} value={d.place} onChange={(place) => set({ place })} required
              helperText="Where the employee sits. Pick the place, or choose “A new place” and type its name." />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField htmlFor="emp-department" label="Department">
                <SearchableSelect
                  id="emp-department" aria-label="Department" value={d.departmentId || undefined}
                  onValueChange={(v) => set({ departmentId: v })}
                  options={[{ value: "", label: "None" }, ...departments.map((x) => ({ value: String(x.id), label: x.name }))]}
                  placeholder="None"
                  onCreateNew={canManage(caps, "department") ? () => setNewDepartment(true) : undefined}
                  createLabel="New Department…"
                />
              </FormField>
              <FormField htmlFor="emp-phone" label="Phone">
                <Input id="emp-phone" value={d.phone} onChange={(e) => set({ phone: e.target.value })} />
              </FormField>
            </div>

            <div className="flex flex-col gap-3 rounded-md border p-2.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="emp-sign-in" className="flex flex-col gap-0.5">
                  <span>Can sign in to CKAM</span>
                  <span className="text-xs font-normal text-muted-foreground">No password is set here: issue one afterwards with “Issue login passwords”.</span>
                </Label>
                <Switch id="emp-sign-in" aria-label="Can sign in to CKAM" checked={d.canSignIn} onCheckedChange={(on) => set({ canSignIn: on })} />
              </div>
              {d.canSignIn && (
                <>
                  <FormField htmlFor="emp-email" label="Email" required helperText="They sign in with this email.">
                    <Input id="emp-email" type="email" value={d.email} onChange={(e) => set({ email: e.target.value })} />
                  </FormField>
                  <FormField htmlFor="emp-role" label="Access level" helperText="What this person can see and do in CKAM.">
                    <Select value={d.role} onValueChange={(v) => set({ role: v })}>
                      <SelectTrigger id="emp-role" aria-label="Access level"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormField>
                  {WORK_AREA_ROLES.includes(d.role) && (
                    <FormField htmlFor="emp-work-area" label="Work Area" helperText="Which assets this person works with. If you handle only one area yourself, you can only give yours.">
                      <Select value={d.workArea} onValueChange={(v) => set({ workArea: v })}>
                        <SelectTrigger id="emp-work-area" aria-label="Work Area"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {WORK_AREA_CHOICES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                  {others.length > 0 && d.companyId && (
                    <fieldset className="flex flex-col gap-1.5">
                      <legend className="mb-1 text-sm font-medium">Extra companies</legend>
                      <p className="text-xs text-muted-foreground">Their own company is always included. Tick any other company they also work for.</p>
                      {others.map((c) => (
                        <label key={c.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            aria-label={c.name}
                            checked={d.extraCompanies.includes(c.id)}
                            onCheckedChange={(v) => set({
                              extraCompanies: v === true ? [...d.extraCompanies, c.id] : d.extraCompanies.filter((x) => x !== c.id),
                            })}
                          />
                          {c.name}
                        </label>
                      ))}
                    </fieldset>
                  )}
                </>
              )}
            </div>

            {mutation.isError && (
              <ErrorMessage className="text-sm text-destructive" error={mutation.error} message={mutation.error instanceof Error ? mutation.error.message : "Could not add the employee."} />
            )}
            {!canSave && (d.code.trim() !== "" || d.name.trim() !== "") && (
              <p className="text-xs text-muted-foreground">Still needed: {missing.join(", ")}.</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <AsyncButton type="submit" disabled={!canSave} pending={mutation.isPending} pendingLabel="Saving…">Add Employee</AsyncButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <NewDepartmentDialog open={newDepartment} onOpenChange={setNewDepartment} onCreated={(row) => set({ departmentId: String(row.id) })} />
    </>
  );
}
