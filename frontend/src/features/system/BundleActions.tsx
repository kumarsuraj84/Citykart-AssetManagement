import { useEffect, useRef, useState } from "react";
import { ClipboardCopy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { apiClient } from "@/lib/api-client";
import { copyText, selectContents } from "@/lib/clipboard";
import { cleanReference, queryString, type BundleAnswer } from "./logs-api";
import { Chips } from "./log-ui";

export const BUNDLE_HOURS = ["1", "6", "24", "72"] as const;
type Hours = (typeof BUNDLE_HOURS)[number];

export const BUNDLE_EXPLANATION =
  "Paste this into your chat with Claude together with what the user reported; it contains no passwords.";

function saveJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * "Copy diagnostics for support" + "Download bundle (JSON)" (GET /admin/diagnostics/bundle): the last N hours
 * and, optionally, one request. The copy is the bundle's `markdown`; when the browser cannot copy (plain http),
 * the text is shown selected so Ctrl+C copies it.
 */
export function BundleActions({ requestId: fixedRequestId }: { requestId?: string }) {
  const [hours, setHours] = useState<Hours>("24");
  const [requestDraft, setRequestDraft] = useState("");
  const [busy, setBusy] = useState<"copy" | "download" | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (manual !== null) selectContents(manualRef.current);
  }, [manual]);

  const requestId = fixedRequestId ?? (requestDraft.trim() ? cleanReference(requestDraft) : null);
  const badRequest = !fixedRequestId && requestDraft.trim() !== "" && requestId === null;

  async function load(): Promise<BundleAnswer> {
    return apiClient.get<BundleAnswer>(`/admin/diagnostics/bundle?${queryString({ hours, request_id: requestId })}`);
  }

  async function copy() {
    setBusy("copy");
    setFailure(null);
    setCopied(false);
    setManual(null);
    try {
      const bundle = await load();
      const text = typeof bundle?.markdown === "string" ? bundle.markdown : "";
      if (await copyText(text)) setCopied(true);
      else setManual(text);
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy("download");
    setFailure(null);
    try {
      const bundle = await load();
      const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
      saveJson(bundle, `ckam-diagnostics-${requestId ? `${requestId.slice(0, 12)}-` : ""}${stamp}.json`);
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Last</span>
          <Chips<Hours> label="Hours" value={hours} onChange={setHours} options={BUNDLE_HOURS.map((h) => ({ value: h, label: `${h} h` }))} />
        </div>
        {!fixedRequestId && (
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="bundle-request" className="text-xs text-muted-foreground">Reference (optional)</Label>
            <Input id="bundle-request" className="h-8 w-64 font-mono text-xs" value={requestDraft} onChange={(e) => setRequestDraft(e.target.value)} placeholder="A request id or report reference" />
          </div>
        )}
      </div>
      {badRequest && <p className="text-xs text-destructive" role="alert">That does not look like a reference.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <AsyncButton onClick={() => void copy()} pending={busy === "copy"} pendingLabel="Preparing…" disabled={busy !== null || badRequest} className="gap-1.5">
          <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
          Copy diagnostics for support
        </AsyncButton>
        <Button variant="outline" onClick={() => void download()} disabled={busy !== null || badRequest} className="gap-1.5">
          <Download className="h-4 w-4" aria-hidden="true" />
          Download bundle (JSON)
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{BUNDLE_EXPLANATION}</p>
      {copied && <p className="text-sm font-medium" role="status">Copied. Paste it into the chat.</p>}
      {manual !== null && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="bundle-text" className="text-xs">This browser cannot copy by itself: the text below is selected — press Ctrl+C.</Label>
          <Textarea id="bundle-text" ref={manualRef} readOnly value={manual} rows={10} className="font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
      {failure !== null && <ErrorMessage error={failure} />}
    </div>
  );
}
