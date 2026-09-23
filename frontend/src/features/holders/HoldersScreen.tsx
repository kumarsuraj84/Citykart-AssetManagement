import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const HOLDER_TYPES = ["EMPLOYEE", "STORE", "INSTALLED", "IT_STOCK"] as const;
const ROLES = ["ADMIN", "IT_TEAM", "VIEWER", "HOLDER"] as const;

interface HolderRow {
  id: number;
  company_id: number;
  emp_code: string;
  name: string;
  holder_type: string;
  location_id: number;
  department_id: number | null;
  email: string | null;
  phone: string | null;
  role: string;
  is_active: boolean;
}

interface Company {
  id: number;
  name: string;
}

interface Location {
  id: number;
  name: string;
}

interface Department {
  id: number;
  name: string;
}

interface HolderDraft {
  company_id: string;
  emp_code: string;
  name: string;
  holder_type: string;
  location_id: string;
  department_id: string;
  email: string;
  phone: string;
  role: string;
}

const emptyDraft: HolderDraft = {
  company_id: "",
  emp_code: "",
  name: "",
  holder_type: "",
  location_id: "",
  department_id: "",
  email: "",
  phone: "",
  role: "HOLDER",
};

function buildPayload(draft: HolderDraft) {
  return {
    company_id: Number(draft.company_id),
    emp_code: draft.emp_code,
    name: draft.name,
    holder_type: draft.holder_type,
    location_id: Number(draft.location_id),
    department_id: draft.department_id ? Number(draft.department_id) : null,
    email: draft.email || null,
    phone: draft.phone || null,
    role: draft.role,
  };
}

export function HoldersScreen() {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<HolderDraft>(emptyDraft);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const { data: holders = [] } = useQuery({
    queryKey: ["holders"],
    queryFn: () => apiClient.get<HolderRow[]>("/holders"),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<Company[]>("/masters/companies"),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["masters", "locations"],
    queryFn: () => apiClient.get<Location[]>("/masters/locations"),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["masters", "departments"],
    queryFn: () => apiClient.get<Department[]>("/masters/departments"),
  });

  const companyName = (id: number) => companies.find((c) => c.id === id)?.name ?? id;

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post("/holders", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holders"] });
      closeForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      apiClient.put(`/holders/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holders"] });
      closeForm();
    },
  });

  const resetMutation = useMutation({
    mutationFn: (id: number) => apiClient.post<{ temp_password: string }>(`/holders/${id}/reset-password`),
    onSuccess: (data) => {
      setTempPassword(data.temp_password);
      qc.invalidateQueries({ queryKey: ["holders"] });
    },
  });

  function setField(key: keyof HolderDraft, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function openAdd() {
    setEditingId(null);
    setDraft(emptyDraft);
    setFormOpen(true);
  }

  function openEdit(h: HolderRow) {
    setEditingId(h.id);
    setDraft({
      company_id: String(h.company_id),
      emp_code: h.emp_code,
      name: h.name,
      holder_type: h.holder_type,
      location_id: String(h.location_id),
      department_id: h.department_id ? String(h.department_id) : "",
      email: h.email ?? "",
      phone: h.phone ?? "",
      role: h.role,
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setDraft(emptyDraft);
  }

  function handleSave() {
    const payload = buildPayload(draft);
    if (editingId != null) {
      updateMutation.mutate({ id: editingId, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Users</h1>
        <Button onClick={openAdd}>Add</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Emp Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Company</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {holders.map((h) => (
            <TableRow key={h.id}>
              <TableCell>{h.emp_code}</TableCell>
              <TableCell>{h.name}</TableCell>
              <TableCell>{h.holder_type}</TableCell>
              <TableCell>{h.role}</TableCell>
              <TableCell>{companyName(h.company_id)}</TableCell>
              <TableCell className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(h)}>
                  Edit
                </Button>
                <Button size="sm" onClick={() => resetMutation.mutate(h.id)}>
                  Reset Password
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={formOpen} onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId != null ? "Edit User" : "Add User"}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="company_id">Company</Label>
              <Select value={draft.company_id || undefined} onValueChange={(v) => setField("company_id", v)}>
                <SelectTrigger id="company_id" aria-label="Company">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="emp_code">Emp Code</Label>
              <Input
                id="emp_code"
                aria-label="Emp Code"
                value={draft.emp_code}
                onChange={(e) => setField("emp_code", e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                aria-label="Name"
                value={draft.name}
                onChange={(e) => setField("name", e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="holder_type">Type</Label>
              <Select value={draft.holder_type || undefined} onValueChange={(v) => setField("holder_type", v)}>
                <SelectTrigger id="holder_type" aria-label="Type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOLDER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="location_id">Location</Label>
              <Select value={draft.location_id || undefined} onValueChange={(v) => setField("location_id", v)}>
                <SelectTrigger id="location_id" aria-label="Location">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="department_id">Department</Label>
              <Select value={draft.department_id || undefined} onValueChange={(v) => setField("department_id", v)}>
                <SelectTrigger id="department_id" aria-label="Department">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                aria-label="Email"
                value={draft.email}
                onChange={(e) => setField("email", e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                aria-label="Phone"
                value={draft.phone}
                onChange={(e) => setField("phone", e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role">Role</Label>
              <Select value={draft.role || undefined} onValueChange={(v) => setField("role", v)}>
                <SelectTrigger id="role" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        One-time temp-password reveal. `tempPassword` is held only in this
        component's local state -- it is never logged, never written to the
        holders list/cache, and is cleared (not merely hidden) the moment the
        dialog closes so it cannot be read back afterwards.
      */}
      <AlertDialog open={tempPassword !== null} onOpenChange={(open) => !open && setTempPassword(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Temporary Password</AlertDialogTitle>
            <AlertDialogDescription>
              Share this password with the user. It will not be shown again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="font-mono text-lg">{tempPassword}</p>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setTempPassword(null)}>Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
