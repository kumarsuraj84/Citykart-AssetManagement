import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { SETUP_STATUS_KEY } from "./setup-progress";

interface Company {
  id: number;
  code: string;
  name: string;
}

/**
 * Settings › Organisation › Companies: the companies that were switched off, each with "Switch on again" (head-office
 * admin only, like switching one off). Only the company itself changes: its places, cost centres, people and assets
 * stay exactly as they were. Opens by itself when no company is switched on, because that is when it is needed.
 */
export function SwitchedOffCompanies() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Company | null>(null);

  const offQ = useQuery({
    queryKey: ["masters", "companies", "switched-off"],
    queryFn: () => apiClient.get<Company[]>("/masters/companies/inactive"),
  });
  // the companies that are on (the same list every other screen uses)
  const onQ = useQuery({ queryKey: ["masters", "companies"], queryFn: () => apiClient.get<Company[]>("/masters/companies") });

  const switchOn = useMutation({
    mutationFn: (id: number) => apiClient.post<Company>(`/masters/companies/${id}/reactivate`),
    onSuccess: () => {
      setTarget(null);
      qc.invalidateQueries({ queryKey: ["masters", "companies"] });          // also the switched-off list (same prefix)
      qc.invalidateQueries({ queryKey: ["asset_users", "me", "companies"] });
      qc.invalidateQueries({ queryKey: ["auth", "capabilities"] });
      qc.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
    },
  });

  const off = Array.isArray(offQ.data) ? offQ.data : [];
  if (off.length === 0) return null;
  const noneOn = onQ.isSuccess && Array.isArray(onQ.data) && onQ.data.length === 0;
  const shown = open || noneOn;

  return (
    <section className="rounded-md border" aria-label="Switched-off companies">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-medium"
        aria-expanded={shown}
        onClick={() => setOpen((o) => !o)}
      >
        {shown ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
        Show switched-off companies ({off.length})
      </button>
      {shown && (
        <ul className="flex flex-col divide-y border-t text-sm">
          {off.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 break-words">
                <span className="font-medium">{c.name}</span> <span className="text-xs text-muted-foreground">({c.code})</span>
              </span>
              <Button type="button" size="sm" variant="outline" aria-label={`Switch on ${c.name} again`} onClick={() => { switchOn.reset(); setTarget(c); }}>
                Switch on again
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{target ? `Switch on ${target.name} again?` : ""}</AlertDialogTitle>
            <AlertDialogDescription>
              {target ? `${target.name} (${target.code}) will be available again in Purchase Orders, Add Assets, Receive and the other screens. Its places, cost centres, people and assets are exactly as you left them.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {switchOn.isError && (
            <ErrorMessage
              className="text-sm text-destructive" error={switchOn.error}
              message={switchOn.error instanceof Error ? switchOn.error.message : "Could not switch this company on."}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AsyncButton
              pending={switchOn.isPending} pendingLabel="Switching on…"
              onClick={() => target && switchOn.mutate(target.id)}
            >
              Switch on
            </AsyncButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
