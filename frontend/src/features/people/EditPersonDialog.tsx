import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useKeyedMutation } from "@/lib/submit-key";
import { apiClient } from "@/lib/api-client";
import { canManage, useCapabilities } from "@/lib/capabilities";
import { ROLES, roleLabel } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { NewDepartmentDialog, NewLocationDialog } from "@/components/quick-create/masters";
import { WORK_AREA_CHOICES, WORK_AREA_ROLES } from "./AddEmployeeDialog";
import { KIND_INFO, isWiderThanMine, type PeopleKind, type PersonRow } from "./people-model";

interface Named {
  id: number;
  name: string;
  code?: string | null;
}

export interface EditDraft {
  code: string;
  name: string;
  locationId: string;
  departmentId: string;
  phone: string;
  email: string;
  loginEnabled: boolean;
  role: string;
  workArea: string;
}

export function draftFrom(row: PersonRow): EditDraft {
  return {
    code: row.code ?? "",
    name: row.name,
    locationId: row.location_id != null ? String(row.location_id) : "",
    departmentId: row.department_id != null ? String(row.department_id) : "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    loginEnabled: row.login_enabled,
    role: row.role || "SELF_SERVICE",
    workArea: row.work_area ?? "BOTH",
  };
}

/**
 * The PUT /asset-users/{id} body: ONLY what changed (S1: a field left out keeps
 * its stored value, so saving never clears a work area nobody touched).
 */
export function editBody(row: PersonRow, d: EditDraft, kind: PeopleKind): Record<string, unknown> {
  const before = draftFrom(row);
  const body: Record<string, unknown> = {};
  const hasLogins = KIND_INFO[kind].hasLogins;
  if (d.name.trim() !== before.name) body.name = d.name.trim();
  if (kind !== "stores" && d.code.trim() !== before.code) body.code = d.code.trim();
  if (d.locationId !== before.locationId && d.locationId) body.location_id = Number(d.locationId);
  if (kind === "employees" && d.departmentId !== before.departmentId) body.department_id = d.departmentId ? Number(d.departmentId) : null;
  if (hasLogins && d.phone.trim() !== before.phone) body.phone = d.phone.trim() || null;
  if (!hasLogins) return body;
  if (d.loginEnabled !== before.loginEnabled) body.login_enabled = d.loginEnabled;
  if (d.loginEnabled && d.email.trim() !== before.email) body.email = d.email.trim() || null;
  if (kind === "employees") {
    if (!d.loginEnabled) {
      if (before.role !== "SELF_SERVICE" && d.loginEnabled !== before.loginEnabled) body.role = "SELF_SERVICE";
    } else {
      if (d.role !== before.role) body.role = d.role;
      if (WORK_AREA_ROLES.includes(d.role) && d.workArea !== before.workArea) body.allowed_asset_domains = d.workArea;
    }
  }
  return body;
}

/**
 * Edit one person or place of a People & Places list. Only changed fields are
 * sent. A one-area admin cannot change the login, access level or work area of
 * someone whose work area is wider than their own (S6, the server answers 403):
 * those controls are shown disabled with the reason. Refusals stay in the form.
 */
export function EditPersonDialog({
  row, kind, onClose, onSaved,
}: {
  row: PersonRow | null;
  kind: PeopleKind;
  onClose: () => void;
  onSaved?: (row: PersonRow) => void;
}) {
  const qc = useQueryClient();
  const { caps } = useCapabilities();
  const info = KIND_INFO[kind];
  const [d, setD] = useState<EditDraft | null>(row ? draftFrom(row) : null);
  const [newLocation, setNewLocation] = useState(false);
  const [newDepartment, setNewDepartment] = useState(false);
  const set = (patch: Partial<EditDraft>) => setD((x) => (x ? { ...x, ...patch } : x));

  useEffect(() => {
    setD(row ? draftFrom(row) : null);
    mutation.reset();
    // A new row to edit starts a new form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id]);

  const companyId = row?.company_id ?? null;
  const placesQ = useQuery({
    queryKey: ["masters", "locations", companyId],
    queryFn: () => apiClient.get<Named[]>(`/masters/locations?company_id=${companyId}`),
    enabled: row !== null && companyId != null,
  });
  const places = Array.isArray(placesQ.data) ? placesQ.data : [];
  const departmentsQ = useQuery({
    queryKey: ["masters", "departments"],
    queryFn: () => apiClient.get<Named[]>("/masters/departments"),
    enabled: row !== null && kind === "employees",
  });
  const departments = Array.isArray(departmentsQ.data) ? departmentsQ.data : [];

  // S7 (P1-2): one Save = one Idempotency-Key; a double activation sends one request.
  const mutation = useKeyedMutation({
    mutationFn: (body: Record<string, unknown>, keyed) => keyed(body, () => apiClient.put<PersonRow>(`/asset-users/${row!.id}`, body)),
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["asset_users"] });
      qc.invalidateQueries({ queryKey: ["stock-rooms"] });
      onSaved?.(saved);
      onClose();
    },
  });

  if (!row || !d) return null;

  const body = editBody(row, d, kind);
  const changed = Object.keys(body).length > 0;
  const canSave = changed && d.name.trim() !== "" && (kind === "stores" || d.code.trim() !== "") && (!d.loginEnabled || kind !== "employees" || d.email.trim() !== "");
  const lockedLogin = !caps?.is_head_office_admin && isWiderThanMine(row.work_area, caps?.work_areas);
  const roleChanged = d.loginEnabled && row.login_enabled && d.role !== row.role;
  const codeLabel = kind === "employees" ? "Employee Code" : kind === "stores" ? "Store Code" : `${info.noun} Code`;

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Edit {info.noun}</DialogTitle>
          </DialogHeader>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (canSave && !mutation.isPending) mutation.mutate(body); }}>
            <div className="flex justify-between gap-4 rounded-md border bg-muted/50 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Company</span>
              <span className="font-medium">{row.company_name ?? row.company_code ?? "—"}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {kind === "stores" ? (
                <FormField htmlFor="edit-code" label={codeLabel} helperText="A store's code cannot change (its rooms are named after it).">
                  <Input id="edit-code" value={d.code} readOnly disabled className="font-mono" />
                </FormField>
              ) : (
                <FormField htmlFor="edit-code" label={codeLabel} required>
                  <Input id="edit-code" value={d.code} onChange={(e) => set({ code: e.target.value })} />
                </FormField>
              )}
              <FormField htmlFor="edit-name" label="Name" required>
                <Input id="edit-name" value={d.name} onChange={(e) => set({ name: e.target.value })} />
              </FormField>
            </div>
            <FormField htmlFor="edit-place" label="Place" required>
              <SearchableSelect
                id="edit-place" aria-label="Place" value={d.locationId || undefined}
                onValueChange={(v) => set({ locationId: v })}
                options={places.map((p) => ({ value: String(p.id), label: p.name, keywords: p.code ? [p.code] : undefined }))}
                onCreateNew={canManage(caps, "location") && companyId != null ? () => setNewLocation(true) : undefined}
                createLabel="New Place…"
              />
            </FormField>
            {kind === "employees" && (
              <FormField htmlFor="edit-department" label="Department">
                <SearchableSelect
                  id="edit-department" aria-label="Department" value={d.departmentId || undefined}
                  onValueChange={(v) => set({ departmentId: v })}
                  options={[{ value: "", label: "None" }, ...departments.map((x) => ({ value: String(x.id), label: x.name }))]}
                  placeholder="None"
                  onCreateNew={canManage(caps, "department") ? () => setNewDepartment(true) : undefined}
                  createLabel="New Department…"
                />
              </FormField>
            )}
            {info.hasLogins && (
              <FormField htmlFor="edit-phone" label="Phone">
                <Input id="edit-phone" value={d.phone} onChange={(e) => set({ phone: e.target.value })} />
              </FormField>
            )}

            {info.hasLogins && (
              <div className="flex flex-col gap-3 rounded-md border p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="edit-sign-in">Can sign in to CKAM</Label>
                  <Switch
                    id="edit-sign-in" aria-label="Can sign in to CKAM" checked={d.loginEnabled} disabled={lockedLogin}
                    onCheckedChange={(on) => set({ loginEnabled: on })}
                  />
                </div>
                {lockedLogin && (
                  <p className="text-xs text-muted-foreground" role="note">
                    {row.name} works in a wider work area than yours, so their login, access level and work area can only be changed by the head-office admin. Other details can still be changed here.
                  </p>
                )}
                {d.loginEnabled && (
                  <>
                    <FormField htmlFor="edit-email" label="Email" required={kind === "employees"}>
                      <Input id="edit-email" type="email" value={d.email} onChange={(e) => set({ email: e.target.value })} />
                    </FormField>
                    {kind === "employees" && (
                      <>
                        <FormField
                          htmlFor="edit-role" label="Access level"
                          helperText={row.login_enabled ? `Current access: ${roleLabel(row.role, row.is_primary_owner)}.` : "What this person can see and do in CKAM."}
                        >
                          <Select value={d.role} onValueChange={(v) => set({ role: v })} disabled={lockedLogin}>
                            <SelectTrigger id="edit-role" aria-label="Access level"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {roleChanged && (
                            <p className="text-xs font-medium text-warning" role="alert">
                              Changing access from {roleLabel(row.role)} to {roleLabel(d.role)} will immediately change what this person can do.
                            </p>
                          )}
                        </FormField>
                        {WORK_AREA_ROLES.includes(d.role) && (
                          <FormField htmlFor="edit-work-area" label="Work Area" helperText="Which assets this person works with. If you handle only one area yourself, you can only give yours.">
                            <Select value={d.workArea} onValueChange={(v) => set({ workArea: v })} disabled={lockedLogin}>
                              <SelectTrigger id="edit-work-area" aria-label="Work Area"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {WORK_AREA_CHOICES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </FormField>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {mutation.isError && (
              <p className="text-sm text-destructive" role="alert">
                {mutation.error instanceof Error ? mutation.error.message : `Could not save this ${info.noun.toLowerCase()}.`}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <AsyncButton type="submit" disabled={!canSave} pending={mutation.isPending} pendingLabel="Saving…">Save</AsyncButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {companyId != null && (
        <NewLocationDialog companyId={companyId} open={newLocation} onOpenChange={setNewLocation} onCreated={(r) => set({ locationId: String(r.id) })} />
      )}
      <NewDepartmentDialog open={newDepartment} onOpenChange={setNewDepartment} onCreated={(r) => set({ departmentId: String(r.id) })} />
    </>
  );
}
