import { useRef, useState } from "react";
import { FileWarning } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { downloadFile } from "../../lib/auth-fetch";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";

type ImportMode = "add" | "edit";

interface AddPreviewRow {
  row: number;
  legacy_asset_code: string | null;
  company: string;
  category: string;
  subcategory: string | null;
  description: string;
  holder: string;
  quantity: number;
}

interface EditPreviewRow {
  row: number;
  asset_code: string;
  fields_changed: string[];
}

interface RowError {
  row: number;
  field?: string;
  message: string;
}

interface PreviewResult<T> {
  valid_rows: T[];
  errors: RowError[];
}

interface CommitResult {
  imported?: number;
  updated?: number;
  errors: RowError[];
}

const ADD_PREVIEW_COLUMNS: DataTableColumn<AddPreviewRow>[] = [
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

const EDIT_PREVIEW_COLUMNS: DataTableColumn<EditPreviewRow>[] = [
  { key: "row", header: "Row", cell: (r) => r.row },
  { key: "asset_code", header: "Asset Code", cell: (r) => r.asset_code },
  { key: "fields_changed", header: "Fields Changed", cell: (r) => r.fields_changed.join(", ") },
];

const ERROR_COLUMNS: DataTableColumn<RowError>[] = [
  { key: "row", header: "Row", cell: (e) => e.row },
  { key: "field", header: "Column", cell: (e) => e.field ?? "—" },
  { key: "message", header: "Error", cellClassName: "text-destructive", cell: (e) => e.message },
];

export function ImportScreen() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setModeRaw] = useState<ImportMode>("add");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult<AddPreviewRow | EditPreviewRow> | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  // Switching modes mid-flow would leave a stale Add-mode file/preview/result
  // sitting under Edit-mode's own column set (or vice versa) -- clear
  // everything downstream of the choice, same as choosing a new file does.
  function setMode(next: ImportMode) {
    setModeRaw(next);
    setFile(null);
    setPreview(null);
    setResult(null);
    setPreviewError(null);
    setCommitError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function doPreview() {
    if (!file) return;
    setIsPreviewing(true);
    setPreviewError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiClient.post<PreviewResult<AddPreviewRow | EditPreviewRow>>(`/imports/assets/preview?mode=${mode}`, form);
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
      const res = await apiClient.post<CommitResult>(`/imports/assets/commit?mode=${mode}`, form);
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
      const filename = mode === "edit" ? "asset_import_edit_template.xlsx" : "asset_import_template.xlsx";
      await downloadFile(`/imports/assets/template?mode=${mode}`, filename, "Template download failed");
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

  const validRows = preview?.valid_rows ?? [];
  const addRows = mode === "add" ? (validRows as AddPreviewRow[]) : [];
  const editRows = mode === "edit" ? (validRows as EditPreviewRow[]) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Import Assets"
        description={
          mode === "edit"
            ? "Bulk-correct existing assets by Asset Code -- download the template, fill in only the fields you want to change, then preview before committing."
            : "Download the template, fill it in, then preview before committing -- nothing is saved until you confirm."
        }
      />

      <Tabs value={mode} onValueChange={(v) => setMode(v as ImportMode)}>
        <TabsList>
          <TabsTrigger value="add">Add New Assets</TabsTrigger>
          <TabsTrigger value="edit">Edit Existing Assets</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-4 rounded-md border p-4">
        <SectionHeading>1. Download Template</SectionHeading>
        <div>
          <AsyncButton variant="secondary" onClick={downloadTemplate} pending={isDownloading} pendingLabel="Preparing…">
            Download Template
          </AsyncButton>
          {templateError && <p className="mt-2 text-sm text-destructive">{templateError}</p>}
        </div>
        {mode === "edit" ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Asset Code</span> is the only required column -- every other column is
            optional, and a blank cell always means "leave this field exactly as it is", never "clear it". Category,
            Sub-Category, and Purchase Date can't be changed this way -- use Asset 360's "Correct Classification"
            for those.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Every asset created this way lands as one new row -- <span className="font-medium">Quantity</span> creates
            several identical units at once (a real Serial Number can't be shared, so use "N/A" for those).
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Custom Fields: add a column named <code className="font-mono">Custom:&lt;field key&gt;</code> (e.g.{" "}
          <code className="font-mono">Custom:warranty_card</code>) -- find each field's key under{" "}
          <span className="font-medium">Setup → Custom Fields</span>.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-md border p-4">
        <SectionHeading>2. Choose File, then Preview</SectionHeading>
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
          <SectionHeading>3. Review</SectionHeading>
          <p className="text-sm text-muted-foreground">
            {preview.valid_rows.length} row{preview.valid_rows.length === 1 ? "" : "s"} ready to {mode === "edit" ? "update" : "import"},{" "}
            {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} with errors.
          </p>

          {preview.valid_rows.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Ready to {mode === "edit" ? "update" : "import"}</h3>
              {mode === "edit" ? (
                <DataTable
                  columns={EDIT_PREVIEW_COLUMNS}
                  rows={editRows}
                  rowKey={(r) => r.row}
                  emptyState={<EmptyState title="No rows ready to update." />}
                />
              ) : (
                <DataTable
                  columns={ADD_PREVIEW_COLUMNS}
                  rows={addRows}
                  rowKey={(r) => r.row}
                  emptyState={<EmptyState title="No rows ready to import." />}
                />
              )}
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
            <AsyncButton onClick={doCommit} disabled={preview.valid_rows.length === 0} pending={isCommitting} pendingLabel={mode === "edit" ? "Updating…" : "Importing…"}>
              Commit {preview.valid_rows.length > 0 ? `${preview.valid_rows.length} Row${preview.valid_rows.length === 1 ? "" : "s"}` : ""}
            </AsyncButton>
          </div>
          {commitError && <p className="text-sm text-destructive">{commitError}</p>}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <SectionHeading>4. Result</SectionHeading>
          <p className="text-sm">
            {mode === "edit"
              ? `Updated ${result.updated ?? 0} asset${(result.updated ?? 0) === 1 ? "" : "s"}.`
              : `Imported ${result.imported ?? 0} asset${(result.imported ?? 0) === 1 ? "" : "s"}.`}
          </p>
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
