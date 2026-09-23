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

interface HolderOption {
  id: number;
  name: string;
}

export function AssetRegister() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveHolderId, setMoveHolderId] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["assets", "register", q],
    queryFn: () => apiClient.get<{ items: AssetRow[]; total: number }>(`/assets?q=${encodeURIComponent(q)}`),
  });
  const items = data?.items ?? [];

  // Every holder the moved-to picker offers, so a bulk move isn't limited to a single
  // asset's company the way AssetDetail.tsx's per-asset holder select is -- the register
  // can hold assets across companies (ADMIN) so there's no single company to scope by.
  const { data: holders = [] } = useQuery({
    queryKey: ["holders"],
    queryFn: () => apiClient.get<HolderOption[]>("/holders"),
    enabled: moveOpen,
  });

  const allSelected = items.length > 0 && items.every((a) => selected.includes(a.id));

  function toggleAll(checked: boolean) {
    setSelected(checked ? items.map((a) => a.id) : []);
  }

  function toggleOne(id: number, checked: boolean) {
    setSelected((s) => (checked ? [...s, id] : s.filter((existing) => existing !== id)));
  }

  const bulkMoveMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ moved: number; failed: { asset_id: number; reason: string }[] }>("/assets/bulk-move", {
        asset_ids: selected,
        to_holder_id: Number(moveHolderId),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets", "register"] });
      setSelected([]);
      setMoveOpen(false);
      setMoveHolderId("");
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Asset Register</h1>
          <p className="text-sm text-muted-foreground">Search, filter and bulk-move assets.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="search">Search</Label>
          <Input
            id="search"
            aria-label="Search"
            placeholder="Asset code, serial, PO, invoice…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-72"
          />
        </div>
      </div>

      {selected.length > 0 && (
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm">{selected.length} selected</span>
          <Button size="sm" onClick={() => setMoveOpen(true)}>
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

      <Dialog open={moveOpen} onOpenChange={(open) => !open && setMoveOpen(false)}>
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
            <p className="text-sm text-destructive">
              {bulkMoveMutation.data.moved} moved, {bulkMoveMutation.data.failed.length} failed.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>
              Cancel
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
