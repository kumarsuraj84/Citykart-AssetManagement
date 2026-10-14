import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, TriangleAlert } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AsyncButton } from "@/components/shared/AsyncButton";
import {
  passwordsCsv, passwordsText, peopleListPath, plural, type IssuedPassword, type PersonRow,
} from "./people-model";
import { ErrorMessage } from "@/components/shared/ErrorMessage";

type Who = "ticked" | "all";

/** The confirmation sentence the brief asks for. */
export function issueConfirmSentence(n: number): string {
  return `This sets a temporary password for ${plural(n, "account")}; each person must change it at first sign-in.`;
}

/** Saves the CSV through the browser (never kept anywhere else). */
function saveCsv(rows: IssuedPassword[]) {
  const blob = new Blob([passwordsCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ckam-login-passwords-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Issue login passwords (S5b-2, ADMIN): for the ticked accounts, or for every
 * store / employee that can sign in and has no password yet -- ONE request
 * (POST /asset-users/issue-passwords) instead of Reset Password per store.
 *
 * The answer is shown ONCE: code · name · email · temporary password, with Copy
 * all and Download CSV. The passwords live only in this dialog's own state --
 * never in the React Query cache, browser storage, the address bar or the
 * console -- and are cleared the moment the dialog closes.
 */
export function IssuePasswordsDialog({
  open, onOpenChange, kind, ticked, companyId, companyName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "stores" | "employees";
  /** The rows ticked on the list (any page shown). */
  ticked: PersonRow[];
  /** The list's company filter, when one is chosen. */
  companyId?: number | null;
  companyName?: string | null;
}) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.assetUserId);
  const noun = kind === "stores" ? "store" : "employee";
  const eligibleTicked = ticked.filter((r) => r.login_enabled && !r.is_primary_owner && r.id !== myId);
  const [who, setWho] = useState<Who>(eligibleTicked.length > 0 ? "ticked" : "all");
  const [step, setStep] = useState<"choose" | "confirm" | "result">("choose");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedPassword[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setWho(eligibleTicked.length > 0 ? "ticked" : "all");
      setStep("choose");
      setError(null);
      setIssued(null);
      setCopied(false);
    }
    // Starts fresh each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // "Everyone without a password": counted from the list itself, so the confirmation can say how many.
  const allQ = useQuery({
    queryKey: ["people", kind, "issue-count", companyId ?? null],
    queryFn: () => apiClient.getPage<PersonRow[]>(peopleListPath({ kind, companyId, pageSize: 1000 })),
    enabled: open,
  });
  const allRows = Array.isArray(allQ.data?.data) ? allQ.data.data : [];
  const withoutPassword = allRows.filter((r) => r.login_enabled && !r.has_password && !r.is_primary_owner && r.id !== myId);
  const moreThanListed = (allQ.data?.total ?? 0) > allRows.length;

  const count = who === "ticked" ? eligibleTicked.length : withoutPassword.length;
  const replacing = who === "ticked" ? eligibleTicked.filter((r) => r.has_password).length : 0;
  const where = companyName ? ` in ${companyName}` : "";

  function close() {
    // Clear, not merely hide: nothing of the list survives the dialog.
    setIssued(null);
    setCopied(false);
    setStep("choose");
    onOpenChange(false);
  }

  async function issue() {
    setPending(true);
    setError(null);
    try {
      const body = who === "ticked"
        ? { asset_user_ids: eligibleTicked.map((r) => r.id), only_without_password: false }
        : { kind, only_without_password: true, ...(companyId ? { company_id: companyId } : {}) };
      const rows = await apiClient.post<IssuedPassword[]>("/asset-users/issue-passwords", body);
      setIssued(Array.isArray(rows) ? rows : []);
      setStep("result");
      // The lists show "Password set": ask for them again (they never hold a password).
      qc.invalidateQueries({ queryKey: ["people"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No password was issued. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function copyAll() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(passwordsText(issued));
      setCopied(true);
    } catch {
      setCopied(false);
      setError("Could not copy. Use Download CSV instead.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Issue login passwords</DialogTitle>
          {step !== "result" && (
            <DialogDescription>
              Each account gets a temporary password; the person must change it at first sign-in. Head-office admin accounts and your own are never included.
            </DialogDescription>
          )}
        </DialogHeader>

        {step === "choose" && (
          <div className="flex flex-col gap-3">
            <RadioGroup value={who} onValueChange={(v) => setWho(v as Who)} aria-label="Whose passwords" className="flex flex-col gap-2">
              <label className="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5">
                <RadioGroupItem value="ticked" aria-label="The ticked accounts" disabled={eligibleTicked.length === 0} className="mt-0.5" />
                <span className="flex flex-col">
                  <span className="font-medium">The ticked {kind} ({eligibleTicked.length})</span>
                  <span className="text-xs text-muted-foreground">
                    {eligibleTicked.length === 0
                      ? `Tick ${kind} on the list first (only those that can sign in get a password).`
                      : "A password they already have is replaced."}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5">
                <RadioGroupItem value="all" aria-label={`Every ${noun} without a password`} className="mt-0.5" />
                <span className="flex flex-col">
                  <span className="font-medium">Every {noun} without a password{where} ({allQ.isLoading ? "…" : `${withoutPassword.length}${moreThanListed ? "+" : ""}`})</span>
                  <span className="text-xs text-muted-foreground">Only {kind} that can sign in and have no password yet.</span>
                </span>
              </label>
            </RadioGroup>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button disabled={count === 0 || (allQ.isLoading && who === "all")} onClick={() => { setError(null); setStep("confirm"); }}>Continue</Button>
            </DialogFooter>
          </div>
        )}

        {step === "confirm" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm" data-testid="issue-confirm">{issueConfirmSentence(count)}</p>
            {replacing > 0 && (
              <p className="text-xs text-muted-foreground">{plural(replacing, "of them already has a password", "of them already have a password")}; it is replaced.</p>
            )}
            {error && <ErrorMessage className="text-sm text-destructive" message={error} />}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("choose")}>Back</Button>
              <AsyncButton onClick={issue} pending={pending} pendingLabel="Issuing…">
                Issue {plural(count, "password")}
              </AsyncButton>
            </DialogFooter>
          </div>
        )}

        {step === "result" && issued && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm" role="note">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <span>
                This list is shown only once and is not kept anywhere. Copy it or download it now, and hand each password over securely
                (in person or by a private message). Everyone must change it at first sign-in.
              </span>
            </div>
            <p className="text-sm font-medium" role="status">
              {issued.length === 0 ? "No account was given a password: none of the chosen accounts could take one." : `${plural(issued.length, "password")} issued.`}
            </p>
            {issued.length > 0 && (
              <>
                <div className="max-h-80 overflow-auto rounded-md border">
                  <table className="w-full text-sm" aria-label="Temporary passwords">
                    <thead className="sticky top-0 bg-muted/60 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">Code</th>
                        <th className="px-2 py-1 text-left font-medium">Name</th>
                        <th className="px-2 py-1 text-left font-medium">Email</th>
                        <th className="px-2 py-1 text-left font-medium">Temporary password</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issued.map((r) => (
                        <tr key={r.asset_user_id} className="border-t">
                          <td className="px-2 py-1 font-mono text-xs">{r.code ?? "—"}</td>
                          <td className="px-2 py-1">{r.name}</td>
                          <td className="px-2 py-1 text-xs">{r.email ?? "—"}</td>
                          <td className="px-2 py-1 font-mono">{r.temp_password}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={copyAll}><Copy className="h-4 w-4" aria-hidden="true" />Copy all</Button>
                  <Button variant="outline" size="sm" onClick={() => saveCsv(issued)}><Download className="h-4 w-4" aria-hidden="true" />Download CSV</Button>
                  {copied && <span className="text-xs text-muted-foreground" role="status">Copied.</span>}
                </div>
              </>
            )}
            {error && <ErrorMessage className="text-sm text-destructive" message={error} />}
            <DialogFooter>
              <Button onClick={close}>Close</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
