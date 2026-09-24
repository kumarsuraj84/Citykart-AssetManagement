import { useRef, useState } from "react";
import { FileWarning } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { downloadFile } from "../../lib/auth-fetch";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";

interface PreviewRow {
  row: number;
  legacy_asset_code: string | null;
  company: string;
  category: string;
  subcategory: string | null;
  description: string;
  holder: string;
  quantity: number;
}

interface RowError {
  row: number;
  field?: string;
  message: string;
}

interface PreviewResult {
  valid_rows: PreviewRow[];
  errors: RowError[];
}

interface CommitResult {
  imported: number;
  errors: RowError[];
}

const PREVIEW_COLUMNS: DataTableColumn<PreviewRow>[] = [
  { key: "row", header: "Row", cell: (r) => r.row },
  { key: "company", header: "Company", cell: (r) => r.company },
  {
    key: "class",
    header: "Category / Sub-Category",
    cell: (r) => (r.subcategory ? `${r.category} / ${r.subcategory}` : r.category),
  },
  { key: "description", header: "Description", cell: (r) => r.description },
  { key: "holder", header: "Goes Into", cell: (r) => r.holder },
  { key: "quantity", header: "Qty", cell: (r) => r.quantity },
];

const ERROR_COLUMNS: DataTableColumn<RowError>[] = [
  { key: "row", header: "Row", cell: (e) => e.row },
  { key: "field", header: "Column", cell: (e) => e.field ?? "—" },
  { key: "message", header: "Error", cellClassName: "text-destructive", cell: (e) => e.message },
];

export function ImportScreen() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  async function doPreview() {
    if (!file) return;
    setIsPreviewing(true);
    setPreviewError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiClient.post<PreviewResult>("/imports/assets/preview", form);
      setPreview(res);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview failed.");
      setPreview(null);
    } finally {
      setIsPreviewing(false);
    }
  }

  async function doCommit() {
    if (!file) return;
    setIsCommitting(true);
    setCommitError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiClient.post<CommitResult>("/imports/assets/commit", form);
      setResult(res);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : "Commit failed.");
    } finally {
      setIsCommitting(false);
    }
  }

  // A bare <a href="/api/imports/assets/template"> is requested by the browser
  // without the bearer token and 401s -- same fix as DocumentsTab/ReportsScreen.
  async function downloadTemplate() {
    setTemplateError(null);
    setIsDownloading(true);
    try {
      await downloadFile("/imports/assets/template", "asset_import_template.xlsx", "Template download failed");
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "Template download failed.");
    } finally {
      setIsDownloading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setPreview(null);
    setResult(null);
    setPreviewError(null);
    setCommitError(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Import Assets"
        description="Download the template, fill it in, then preview before committing -- nothing is saved until you confirm."
      />

      <div className="flex flex-col gap-4 rounded-md border p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">1. Download Template</h2>
        <div>
          <AsyncButton variant="secondary" onClick={downloadTemplate} pending={isDownloading} pendingLabel="Preparing…">
            Download Template
          </AsyncButton>
          {templateError && <p className="mt-2 text-sm text-destructive">{templateError}</p>}
        </div>
        <p className="text-xs text-muted-foreground">
          Custom Fields: add a column named <code className="font-mono">Custom:&lt;field key&gt;</code> (e.g.{" "}
          <code className="font-mono">Custom:warranty_card</code>) -- find each field's key under{" "}
          <span className="font-medium">Setup → Custom Fields</span>.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-md border p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">2. Choose File, then Preview</h2>
        <div className="flex flex-wrap items-end gap-3">
          <FormField htmlFor="import-file" label="File" className="w-64">
            <Input id="import-file" aria-label="File" type="file" accept=".xlsx" ref={fileInputRef} onChange={handleFileChange} />
          </FormField>
          <AsyncButton onClick={doPreview} disabled={!file} pending={isPreviewing} pendingLabel="Checking…">
            Preview
          </AsyncButton>
        </div>
        {previewError && <p className="text-sm text-destructive">{previewError}</p>}
      </div>

      {preview && (
        <div className="flex flex-col gap-4 rounded-md border p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">3. Review</h2>
          <p className="text-sm text-muted-foreground">
            {preview.valid_rows.length} row{preview.valid_rows.length === 1 ? "" : "s"} ready to import,{" "}
            {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} with errors.
          </p>

          {preview.valid_rows.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Ready to import</h3>
              <DataTable
                columns={PREVIEW_COLUMNS}
                rows={preview.valid_rows}
                rowKey={(r) => r.row}
                emptyState={<EmptyState title="No rows ready to import." />}
              />
            </div>
          )}

          {preview.errors.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Needs attention</h3>
              <DataTable
                columns={ERROR_COLUMNS}
                rows={preview.errors}
                rowKey={(e) => `${e.row}-${e.field ?? ""}-${e.message}`}
                emptyState={<EmptyState title="No errors." />}
              />
            </div>
          )}

          {preview.valid_rows.length === 0 && preview.errors.length === 0 && (
            <EmptyState icon={FileWarning} title="No rows found in this file." description="Check the file has data below its header row." />
          )}

          <div>
            <AsyncButton onClick={doCommit} disabled={preview.valid_rows.length === 0} pending={isCommitting} pendingLabel="Importing…">
              Commit {preview.valid_rows.length > 0 ? `${preview.valid_rows.length} Row${preview.valid_rows.length === 1 ? "" : "s"}` : ""}
            </AsyncButton>
          </div>
          {commitError && <p className="text-sm text-destructive">{commitError}</p>}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">4. Result</h2>
          <p className="text-sm">Imported {result.imported} asset{result.imported === 1 ? "" : "s"}.</p>
          {result.errors.length > 0 && (
            <DataTable
              columns={ERROR_COLUMNS}
              rows={result.errors}
              rowKey={(e) => `${e.row}-${e.field ?? ""}-${e.message}`}
              emptyState={<EmptyState title="No errors." />}
            />
          )}
        </div>
      )}
    </div>
  );
}
