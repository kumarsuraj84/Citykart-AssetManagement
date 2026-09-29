import { useRef, useState } from "react";
import { Upload, Download, FileWarning } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { downloadFile } from "../../lib/auth-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";

interface PreviewRow {
  row: number;
  values: Record<string, unknown>;
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

const ERROR_COLUMNS: DataTableColumn<RowError>[] = [
  { key: "row", header: "Row", cell: (e) => e.row },
  { key: "field", header: "Column", cell: (e) => e.field ?? "—" },
  { key: "message", header: "Error", cellClassName: "text-destructive", cell: (e) => e.message },
];

/** AM-25: one shared Import/Export UI for every master (Companies/
 * Locations/Departments/Cost Centres/Categories/Sub-Categories/Vendors --
 * embedded once in MasterCrudScreen, covering all of them) and for AssetUsers
 * (embedded directly in AssetUsersScreen, which doesn't use MasterCrudScreen).
 * `resource` is the same path segment already used for the master's own
 * CRUD endpoint (`/masters/{resource}`) or "asset_users" itself -- the backend
 * (app.masters.bulk_import_export, wired in per-master via
 * build_master_router's `import_fields`) owns every column definition, so
 * nothing about a specific master's fields needs to be known here: the
 * preview table's columns are built from whatever the backend's own
 * template/preview response actually contains. */
/** `basePath` defaults to `/masters/{resource}` (every master) -- AssetUsers
 * doesn't live under /masters at all, so AssetUsersScreen passes an explicit
 * basePath="/asset-users" instead. */
export function BulkImportExport({
  resource, label, onImported, basePath,
}: {
  resource: string;
  label: string;
  onImported?: () => void;
  basePath?: string;
}) {
  const base = basePath ?? `/masters/${resource}`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  function resetDialogState() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setPreviewError(null);
    setCommitError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openDialog() {
    resetDialogState();
    setOpen(true);
  }

  async function doExport() {
    setExportError(null);
    setIsExporting(true);
    try {
      await downloadFile(`${base}/export`, `${resource}_export.xlsx`, "Export failed");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  async function doDownloadTemplate() {
    setTemplateError(null);
    setIsDownloadingTemplate(true);
    try {
      await downloadFile(`${base}/import/template`, `${resource}_import_template.xlsx`, "Template download failed");
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "Template download failed.");
    } finally {
      setIsDownloadingTemplate(false);
    }
  }

  async function doPreview() {
    if (!file) return;
    setIsPreviewing(true);
    setPreviewError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiClient.post<PreviewResult>(`${base}/import/preview`, form);
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
      const res = await apiClient.post<CommitResult>(`${base}/import/commit`, form);
      setResult(res);
      if (res.imported > 0) onImported?.();
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : "Commit failed.");
    } finally {
      setIsCommitting(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setPreview(null);
    setResult(null);
    setPreviewError(null);
    setCommitError(null);
  }

  // Dynamic columns -- built from whatever keys the backend's own
  // FieldSpec headers actually produced, so this never needs updating when
  // a master's import columns change.
  const previewColumns: DataTableColumn<PreviewRow>[] = preview
    ? [
        { key: "row", header: "Row", cell: (r) => r.row },
        ...Object.keys(preview.valid_rows[0]?.values ?? {}).map((key) => ({
          key,
          header: key,
          cell: (r: PreviewRow) => {
            const v = r.values[key];
            return v === null || v === undefined || v === "" ? "—" : String(v);
          },
        })),
      ]
    : [];

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        <Upload className="h-4 w-4" aria-hidden="true" />
        Import / Export
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetDialogState(); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Import / Export {label}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <p className="text-sm font-medium">Export</p>
              <p className="text-xs text-muted-foreground">Download every active {label.toLowerCase()} row as an Excel file.</p>
              <div>
                <AsyncButton variant="secondary" onClick={doExport} pending={isExporting} pendingLabel="Preparing…">
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Export
                </AsyncButton>
                {exportError && <p className="mt-2 text-sm text-destructive">{exportError}</p>}
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-md border p-3">
              <p className="text-sm font-medium">Import</p>
              <p className="text-xs text-muted-foreground">
                Download the template, fill it in, then preview before committing -- nothing is saved until you confirm.
              </p>
              <div>
                <AsyncButton variant="secondary" onClick={doDownloadTemplate} pending={isDownloadingTemplate} pendingLabel="Preparing…">
                  Download Template
                </AsyncButton>
                {templateError && <p className="mt-2 text-sm text-destructive">{templateError}</p>}
              </div>

              <div className="mt-2 flex flex-wrap items-end gap-3">
                <FormField htmlFor="bulk-import-file" label="File" className="w-64">
                  <Input id="bulk-import-file" aria-label="File" type="file" accept=".xlsx" ref={fileInputRef} onChange={handleFileChange} />
                </FormField>
                <AsyncButton onClick={doPreview} disabled={!file} pending={isPreviewing} pendingLabel="Checking…">
                  Preview
                </AsyncButton>
              </div>
              {previewError && <p className="text-sm text-destructive">{previewError}</p>}

              {preview && (
                <div className="mt-2 flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    {preview.valid_rows.length} row{preview.valid_rows.length === 1 ? "" : "s"} ready to import,{" "}
                    {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} with errors.
                  </p>

                  {preview.valid_rows.length > 0 && (
                    <DataTable
                      columns={previewColumns}
                      rows={preview.valid_rows}
                      rowKey={(r) => r.row}
                      emptyState={<EmptyState title="No rows ready to import." />}
                    />
                  )}
                  {preview.errors.length > 0 && (
                    <DataTable
                      columns={ERROR_COLUMNS}
                      rows={preview.errors}
                      rowKey={(e) => `${e.row}-${e.field ?? ""}-${e.message}`}
                      emptyState={<EmptyState title="No errors." />}
                    />
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
                <div className="mt-2 flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
                  <p className="text-sm">Imported {result.imported} {label.toLowerCase()}{result.imported === 1 ? "" : ""}.</p>
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
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
