import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useMyCompanies } from "@/lib/capabilities";
import { companyOptions } from "@/lib/option-labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { plural } from "./people-model";

/** What POST /api/people/stores/ensure-rooms answers. */
export interface EnsureRoomsResult {
  stores_checked: number;
  stores_completed: number;
  already_complete: number;
  stock_rooms_created: number;
  install_points_created: number;
  problems: { store_code: string | null; company_code: string | null; message: string }[];
}

const ALL = "__all__";

/** "212 stores checked: 200 given their missing rooms, 12 already complete. 200 stock rooms and 199 install points created." */
export function ensureRoomsSentence(r: EnsureRoomsResult): string {
  const first = `${plural(r.stores_checked, "store")} checked: ${r.stores_completed.toLocaleString("en-IN")} given their missing rooms, ${r.already_complete.toLocaleString("en-IN")} already complete.`;
  const made = r.stock_rooms_created + r.install_points_created === 0
    ? "Nothing new was created."
    : `${plural(r.stock_rooms_created, "stock room")} and ${plural(r.install_points_created, "install point")} created.`;
  return `${first} ${made}`;
}

/**
 * Head-office admin, Stores list: "Create missing rooms for existing stores" -- every
 * store gets the Stock Room and Install Point it lacks (one request, idempotent;
 * nothing that exists is changed). A store whose room code is taken by something
 * else is listed with the server's sentence and the rest go ahead.
 */
export function EnsureRoomsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const { companies } = useMyCompanies();
  const [companyId, setCompanyId] = useState(ALL);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnsureRoomsResult | null>(null);

  function close() {
    setResult(null);
    setError(null);
    setCompanyId(ALL);
    onOpenChange(false);
  }

  async function run() {
    setPending(true);
    setError(null);
    try {
      const path = companyId === ALL ? "/people/stores/ensure-rooms" : `/people/stores/ensure-rooms?company_id=${companyId}`;
      setResult(await apiClient.post<EnsureRoomsResult>(path));
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["asset_users"] });
      qc.invalidateQueries({ queryKey: ["stock-rooms"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Create missing rooms for existing stores</DialogTitle>
          <DialogDescription>
            Every store gets the Stock Room (STK-code) and Install Point (INS-code) it does not have yet. Nothing that already exists is changed, and running it again creates nothing new.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm" role="status">{ensureRoomsSentence(result)}</p>
            {result.problems.length > 0 && (
              <div className="flex flex-col gap-1" role="alert">
                <p className="text-sm font-medium text-destructive">{plural(result.problems.length, "store needs", "stores need")} a look:</p>
                <ul className="max-h-48 list-disc overflow-auto pl-5 text-xs text-destructive">
                  {result.problems.map((p, i) => (
                    <li key={`${p.store_code}-${i}`}>{[p.store_code, p.company_code].filter(Boolean).join(" · ")}: {p.message}</li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button onClick={close}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {companies.length > 1 && (
              <FormField htmlFor="ensure-rooms-company" label="Company">
                <SearchableSelect
                  id="ensure-rooms-company" aria-label="Company" value={companyId} onValueChange={setCompanyId}
                  options={[{ value: ALL, label: "All companies" }, ...companyOptions(companies)]}
                />
              </FormField>
            )}
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancel</Button>
              <AsyncButton onClick={run} pending={pending} pendingLabel="Working…">Create missing rooms</AsyncButton>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
