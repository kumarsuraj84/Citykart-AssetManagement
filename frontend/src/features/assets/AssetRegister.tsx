import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface AssetRow {
  id: number;
  asset_code: string;
  description: string;
  status: string;
}

interface Option {
  id: number;
  name: string;
}

// Fixed list, matches backend/app/assets/models.py ASSET_STATUSES -- this is a closed set
// of lifecycle states, not master data, so there's nothing to fetch.
const ASSET_STATUSES = ["IN_STOCK", "ALLOTTED", "INSTALLED", "UNDER_REPAIR", "DISPOSED", "SOLD", "SCRAPPED", "LOST"];

// Radix Select doesn't allow an empty-string item value, so "an unfiltered dimension" is
// represented by this sentinel rather than by the empty string the query param logic uses.
const ALL = "ALL";

// A shared mock (as AssetRegister.test.tsx's first test uses) resolves every apiClient.get
// call the same way, including these masters/holders lookups -- guard against that shape
// mismatch (and against any other unexpected response) rather than letting `.map` throw.
function asOptionArray(data: unknown): Option[] {
  return Array.isArray(data) ? (data as Option[]) : [];
}

export function AssetRegister() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [holderId, setHolderId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveHolderId, setMoveHolderId] = useState("");
  // A snapshot of the selected rows taken when the Move dialog opens, so that if the
  // register's own list changes shape after a partial move (an asset that moved may drop
  // out of the current filter/status view on refetch) the dialog can still show which
  // asset codes the failures below belong to.
  const [moveTargets, setMoveTargets] = useState<AssetRow[]>([]);

  const queryString = new URLSearchParams({
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(categoryId ? { category_id: categoryId } : {}),
    ...(holderId ? { holder_id: holderId } : {}),
    ...(companyId ? { company_id: companyId } : {}),
  }).toString();

  const { data, isLoading } = useQuery({
    queryKey: ["assets", "register", q, status, categoryId, holderId, companyId],
    queryFn: () => apiClient.get<{ items: AssetRow[]; total: number }>(`/assets?${queryString}`),
  });
  const items = data?.items ?? [];

  const { data: categoriesData } = useQuery({
    queryKey: ["masters", "categories"],
    queryFn: () => apiClient.get<Option[]>("/masters/categories"),
  });
  const categories = asOptionArray(categoriesData);

  const { data: companiesData } = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<Option[]>("/masters/companies"),
  });
  const companies = asOptionArray(companiesData);

  // Every holder, for both the filter bar's "Holder" dimension and the bulk-move "Move to"
  // picker -- the register spans companies for an ADMIN, so unlike AssetDetail.tsx's
  // single-asset action dialog there's no one company to scope this list to.
  const { data: holdersData } = useQuery({
    queryKey: ["holders"],
    queryFn: () => apiClient.get<Option[]>("/holders"),
  });
  const holders = asOptionArray(holdersData);

  const allSelected = items.length > 0 && items.every((a) => selected.includes(a.id));

  function toggleAll(checked: boolean) {
    setSelected(checked ? items.map((a) => a.id) : []);
  }

  function toggleOne(id: number, checked: boolean) {
    setSelected((s) => (checked ? [...s, id] : s.filter((existing) => existing !== id)));
  }

  function openMove() {
    bulkMoveMutation.reset();
    setMoveTargets(items.filter((a) => selected.includes(a.id)));
    setMoveHolderId("");
    setMoveOpen(true);
  }

  function closeMove() {
    setMoveOpen(false);
    bulkMoveMutation.reset();
  }

  const bulkMoveMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ moved: number; failed: { asset_id: number; reason: string }[] }>("/assets/bulk-move", {
        asset_ids: selected,
        to_holder_id: Number(moveHolderId),
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["assets", "register"] });
      if (result.failed.length === 0) {
        // Full success -- nothing left needing the user's attention, so close up.
        setSelected([]);
        setMoveOpen(false);
        setMoveHolderId("");
      } else {
        // Partial failure: keep the dialog open with the failure detail visible, and
        // narrow the selection down to just the assets that still need attention (the
        // ones that did move are done; re-selecting them would just re-attempt a move
        // that already succeeded).
        setSelected(result.failed.map((f) => f.asset_id));
      }
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Asset Register</h1>
        <p className="text-sm text-muted-foreground">Search, filter and bulk-move assets.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="search">Search</Label>
          <Input
            id="search"
            aria-label="Search"
            placeholder="Asset code, serial, PO, invoice…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-64"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-status">Status</Label>
          <Select value={status || ALL} onValueChange={(v) => setStatus(v === ALL ? "" : v)}>
            <SelectTrigger id="filter-status" aria-label="Status" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {ASSET_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-category">Category</Label>
          <Select value={categoryId || ALL} onValueChange={(v) => setCategoryId(v === ALL ? "" : v)}>
            <SelectTrigger id="filter-category" aria-label="Category" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-holder">Holder</Label>
          <Select value={holderId || ALL} onValueChange={(v) => setHolderId(v === ALL ? "" : v)}>
            <SelectTrigger id="filter-holder" aria-label="Holder" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All holders</SelectItem>
              {holders.map((h) => (
                <SelectItem key={h.id} value={String(h.id)}>
                  {h.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-company">Company</Label>
          <Select value={companyId || ALL} onValueChange={(v) => setCompanyId(v === ALL ? "" : v)}>
            <SelectTrigger id="filter-company" aria-label="Company" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All companies</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm">{selected.length} selected</span>
          <Button size="sm" onClick={openMove}>
            Move
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label="Select all"
                checked={allSelected}
                onCheckedChange={(checked) => toggleAll(checked === true)}
              />
            </TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((a) => (
            <TableRow key={a.id} className="cursor-pointer" onClick={() => (window.location.href = `/assets/${a.id}`)}>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  aria-label={`Select ${a.asset_code}`}
                  checked={selected.includes(a.id)}
                  onCheckedChange={(checked) => toggleOne(a.id, checked === true)}
                />
              </TableCell>
              <TableCell className="font-mono text-sm">
                <a href={`/assets/${a.id}`} onClick={(e) => e.stopPropagation()}>
                  {a.asset_code}
                </a>
              </TableCell>
              <TableCell>{a.description}</TableCell>
              <TableCell>
                <Badge variant="secondary">{a.status.replace(/_/g, " ")}</Badge>
              </TableCell>
            </TableRow>
          ))}
          {!isLoading && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                No assets found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={moveOpen} onOpenChange={(open) => !open && closeMove()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {selected.length} asset{selected.length === 1 ? "" : "s"}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="move-holder">Move to</Label>
            <Select value={moveHolderId || undefined} onValueChange={setMoveHolderId}>
              <SelectTrigger id="move-holder" aria-label="Move to">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {holders.map((h) => (
                  <SelectItem key={h.id} value={String(h.id)}>
                    {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {bulkMoveMutation.isError && (
            <p className="text-sm text-destructive">
              {bulkMoveMutation.error instanceof Error ? bulkMoveMutation.error.message : "Failed to move assets."}
            </p>
          )}
          {bulkMoveMutation.isSuccess && bulkMoveMutation.data.failed.length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-destructive">
                {bulkMoveMutation.data.moved} moved, {bulkMoveMutation.data.failed.length} failed:
              </p>
              <ul className="list-disc pl-5 text-destructive">
                {bulkMoveMutation.data.failed.map((f) => {
                  const target = moveTargets.find((t) => t.id === f.asset_id);
                  return (
                    <li key={f.asset_id}>
                      {target?.asset_code ?? `Asset #${f.asset_id}`}: {f.reason}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeMove}>
              {bulkMoveMutation.isSuccess && bulkMoveMutation.data.failed.length > 0 ? "Done" : "Cancel"}
            </Button>
            <Button
              onClick={() => bulkMoveMutation.mutate()}
              disabled={!moveHolderId || bulkMoveMutation.isPending}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
