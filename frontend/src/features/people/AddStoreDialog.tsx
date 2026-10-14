import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useMyCompanies } from "@/lib/capabilities";
import { isSilentSubmitError, sendKeyed, useSubmitGuard, useSubmitKey } from "@/lib/submit-key";
import { companyOptions } from "@/lib/option-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { EMPTY_PLACE, PlacePicker, placeBody, type PlaceChoice } from "./PlacePicker";
import { storeResultSentence, type PersonRow } from "./people-model";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

/** The server's own rule (and sentence) for a store code: three letters and at most one more letter or digit. */
export const STORE_CODE = /^[A-Z]{3}[A-Z0-9]?$/;
export const STORE_CODE_MESSAGE = "A store code has three letters and at most one more letter or digit (for example LAM or SPR2).";

/** What POST /api/people/stores answers. */
export interface StoreResult {
  store: PersonRow;
  stock_room: PersonRow | null;
  install_point: PersonRow | null;
  created: string[];
  reused: string[];
  problems?: string[];
}

/**
 * Add Store (S5b-2): Code, Name, Company (only for someone in more than one),
 * Place (optional: the store's own place is used or made). ONE action makes the
 * store, its Stock Room (STK-<code>) and its Install Point (INS-<code>); running it
 * again creates nothing new -- the answer says plainly what was created and what
 * already existed. The store can sign in with its store email once a password is issued.
 */
export function AddStoreDialog({
  open, onOpenChange, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the result once the store exists (created or already there). */
  onDone?: (result: StoreResult) => void;
}) {
  const qc = useQueryClient();
  const { companies } = useMyCompanies();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [place, setPlace] = useState<PlaceChoice>(EMPTY_PLACE);
  const [pending, setPending] = useState(false);
  const guard = useSubmitGuard();
  const submitKey = useSubmitKey();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StoreResult | null>(null);
  const onlyCompany = companies.length === 1 ? String(companies[0].id) : "";

  function reset() {
    setCode(""); setName(""); setCompanyId(onlyCompany); setPlace(EMPTY_PLACE); setError(null); setResult(null);
  }
  useEffect(() => {
    if (open) reset();
    // Starts fresh each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (open && onlyCompany && !companyId) setCompanyId(onlyCompany);
  }, [open, onlyCompany, companyId]);

  const upper = code.trim().toUpperCase();
  const codeProblem = upper !== "" && !STORE_CODE.test(upper) ? STORE_CODE_MESSAGE : null;
  const canSave = upper !== "" && !codeProblem && name.trim() !== "" && companyId !== "";

  async function save() {
    // S7 (P1-2): a synchronous guard (set before the first await) and one Idempotency-Key per intent.
    if (!canSave || pending || !guard.begin()) return;
    setPending(true);
    setError(null);
    try {
      const body = { code: upper, name: name.trim(), company_id: Number(companyId), ...placeBody(place) };
      const r = await sendKeyed(submitKey, (keyed) => keyed(body, () => apiClient.post<StoreResult>("/people/stores", body)));
      submitKey.renew();
      setResult(r);
      await qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["asset_users"] });
      qc.invalidateQueries({ queryKey: ["stock-rooms"] });
      qc.invalidateQueries({ queryKey: ["masters", "locations"] });
      qc.invalidateQueries({ queryKey: ["setup", "status"] });
      onDone?.(r);
    } catch (e) {
      if (!isSilentSubmitError(e)) setError(e instanceof Error ? e.message : "Could not add the store.");
    } finally {
      setPending(false);
      guard.end();
    }
  }

  const records = result
    ? [
        { what: "Store", row: result.store },
        { what: "Stock Room", row: result.stock_room },
        { what: "Install Point", row: result.install_point },
      ].filter((r): r is { what: string; row: PersonRow } => r.row !== null)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Add Store</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="flex flex-col gap-3" data-testid="store-result">
            <p className="text-sm font-medium" role="status">
              {storeResultSentence(result.store.code ?? upper, result.created, result.reused)}
            </p>
            <ul className="flex flex-col divide-y rounded-md border text-sm" aria-label="The store's records">
              {records.map(({ what, row }) => (
                <li key={what} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                  <span><span className="text-muted-foreground">{what}</span> · <span className="font-mono text-xs">{row.code}</span> · {row.name}</span>
                  {row.location_name && <span className="text-xs text-muted-foreground">{row.location_name}</span>}
                </li>
              ))}
            </ul>
            {result.store.email && (
              <p className="text-xs text-muted-foreground">
                The store signs in as {result.store.email}
                {result.store.has_password ? "." : ". It has no password yet: use “Issue login passwords” on the Stores list when it is ready."}
              </p>
            )}
            {(result.problems ?? []).length > 0 && (
              <ul className="text-xs text-destructive" role="alert">{result.problems!.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>Add another store</Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <p className="text-xs text-muted-foreground">
              One step makes the store, its Stock Room and its Install Point. If any of them already exists it is used, never made twice.
            </p>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <FormField htmlFor="store-code" label="Code" required errorText={codeProblem ?? undefined} helperText="3 letters (+1)">
                <Input
                  id="store-code" value={code} maxLength={4} placeholder="LAM" className="font-mono uppercase"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </FormField>
              <FormField htmlFor="store-name" label="Name" required>
                <Input id="store-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lucknow Aminabad" />
              </FormField>
            </div>
            {companies.length > 1 && (
              <FormField htmlFor="store-company" label="Company" required>
                <SearchableSelect
                  id="store-company" aria-label="Company" value={companyId || undefined}
                  onValueChange={(v) => { setCompanyId(v); setPlace(EMPTY_PLACE); }}
                  options={companyOptions(companies)} placeholder="Choose the company"
                />
              </FormField>
            )}
            <PlacePicker
              id="store-place" companyId={companyId ? Number(companyId) : null} value={place} onChange={setPlace}
              optionalLabel="The store's own place (made for you)"
              helperText="Leave it to make (or reuse) the store's own place, or pick another place."
            />
            {error && <ErrorMessage className="text-sm text-destructive" message={error} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <AsyncButton type="submit" disabled={!canSave} pending={pending} pendingLabel="Saving…">Add Store</AsyncButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
