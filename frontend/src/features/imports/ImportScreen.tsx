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

type ImportMode = "add" | "edit" | "po" | "movement";

interface AddPreviewRow {
  row: number;
  legacy_asset_code: string | null;
  company: string;
  category: string;
  subcategory: string | null;
  description: string;
  asset_user: string;
  quantity: number;
}

interface EditPreviewRow {
  row: number;
  asset_code: string;
  fields_changed: string[];
}

interface PoPreviewRow {
  row: number;
  po_number: string;
  po_date: string;
  company: string;
  cost_center: string;
  description: string;
  barcode: string;
  category: string;
  quantity: number;
}

interface MovementPreviewRow {
  row: number;
  asset_code: string;
  description: string;
  action: string;
  destination: string;
}

type PreviewRow = AddPreviewRow | EditPreviewRow | PoPreviewRow | MovementPreviewRow;

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
  pos_created?: number;
  lines_created?: number;
  moved?: number;
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
  { key: "asset_user", header: "Goes Into", cell: (r) => r.asset_user },
  { key: "quantity", header: "Qty", cell: (r) => r.quantity },
];

const EDIT_PREVIEW_COLUMNS: DataTableColumn<EditPreviewRow>[] = [
  { key: "row", header: "Row", cell: (r) => r.row },
  { key: "asset_code", header: "Asset Code", cell: (r) => r.asset_code },
  { key: "fields_changed", header: "Fields Changed", cell: (r) => r.fields_changed.join(", ") },
];

const PO_PREVIEW_COLUMNS: DataTableColumn<PoPreviewRow>[] = [
  { key: "row", header: "Row", cell: (r) => r.row },
  { key: "po_number", header: "PO Number", cell: (r) => r.po_number },
  { key: "po_date", header: "PO Date", cell: (r) => r.po_date },
  { key: "company", header: "Company", cell: (r) => r.company },
  { key: "cost_center", header: "Cost Centre", cell: (r) => r.cost_center },
  { key: "description", header: "Description", cell: (r) => r.description },
  { key: "barcode", header: "Barcode", cell: (r) => r.barcode },
  { key: "category", header: "Category", cell: (r) => r.category },
  { key: "quantity", header: "Qty", cell: (r) => r.quantity },
];

const MOVEMENT_PREVIEW_COLUMNS: DataTableColumn<MovementPreviewRow>[] = [
  { key: "row", header: "Row", cell: (r) => r.row },
  { key: "asset_code", header: "Asset Code", cell: (r) => r.asset_code },
  { key: "description", header: "Description", cell: (r) => r.description },
  { key: "action", header: "Action", cell: (r) => r.action },
  { key: "destination", header: "Destination", cell: (r) => r.destination },
];

const ERROR_COLUMNS: DataTableColumn<RowError>[] = [
  { key: "row", header: "Row", cell: (e) => e.row },
  { key: "field", header: "Column", cell: (e) => e.field ?? "—" },
  { key: "message", header: "Error", cellClassName: "text-destructive", cell: (e) => e.message },
];

// Every import type reduces to the same three requests (template/preview/
// commit) against its own endpoint prefix -- "add"/"edit" share one prefix
// (dispatched by `?mode=`), "po"/"movement" each have their own.
function endpointPath(mode: ImportMode, action: "template" | "preview" | "commit"): string {
  if (mode === "po") return `/imports/purchase-orders/${action}`;
  if (mode === "movement") return `/imports/movements/${action}`;
  return `/imports/assets/${action}?mode=${mode}`;
}

const TEMPLATE_FILENAMES: Record<ImportMode, string> = {
  add: "asset_import_template.xlsx",
  edit: "asset_import_edit_template.xlsx",
  po: "po_import_template.xlsx",
  movement: "movement_import_template.xlsx",
};

export function ImportScreen() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setModeRaw] = useState<ImportMode>("add");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult<PreviewRow> | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  // Switching modes mid-flow would leave a stale file/preview/result sitting
  // under a different mode's own column set -- clear everything downstream
  // of the choice, same as choosing a new file does.
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
      const res = await apiClient.post<PreviewResult<PreviewRow>>(endpointPath(mode, "preview"), form);
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
      const res = await apiClient.post<CommitResult>(endpointPath(mode, "commit"), form);
      setResult(res);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : "Commit failed.");
    } finally {
      setIsCommitting(false);
    }
  }

  // A bare <a href="/api/imports/..."> is requested by the browser without
  // the bearer token and 401s -- same fix as DocumentsTab/ReportsScreen.
  async function downloadTemplate() {
    setTemplateError(null);
    setIsDownloading(true);
    try {
      await downloadFile(endpointPath(mode, "template"), TEMPLATE_FILENAMES[mode], "Template download failed");
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
  const poRows = mode === "po" ? (validRows as PoPreviewRow[]) : [];
  const movementRows = mode === "movement" ? (validRows as MovementPreviewRow[]) : [];

  const noun =
    mode === "edit" ? "update" : mode === "po" ? "import" : mode === "movement" ? "apply" : "import";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Import"
        description={
          mode === "edit"
            ? "Bulk-correct existing assets by Asset Code -- download the template, fill in only the fields you want to change, then preview before committing."
            : mode === "po"
              ? "Import a Purchase Order and its line items -- download the template, fill it in, then preview before committing. Nothing is delivered automatically; mark delivery done afterward, same as a PO entered by hand."
              : mode === "movement"
                ? "Import a batch of asset movements -- one row per asset, each with its own action and destination. Every row runs through the same eligibility rule a manual move does."
                : "Download the template, fill it in, then preview before committing -- nothing is saved until you confirm."
        }
      />

      <Tabs value={mode} onValueChange={(v) => setMode(v as ImportMode)}>
        <TabsList>
          <TabsTrigger value="add">Add New Assets</TabsTrigger>
          <TabsTrigger value="edit">Edit Existing Assets</TabsTrigger>
          <TabsTrigger value="po">Purchase Orders</TabsTrigger>
          <TabsTrigger value="movement">Asset Movements</TabsTrigger>
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
        {mode === "edit" && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Asset Code</span> is the only required column -- every other column is
            optional, and a blank cell always means "leave this field exactly as it is", never "clear it". Category,
            Sub-Category, and Purchase Date can't be changed this way -- use Asset 360's "Correct Classification"
            for those.
          </p>
        )}
        {mode === "add" && (
          <p className="text-xs text-muted-foreground">
            Every asset created this way lands as one new row -- <span className="font-medium">Quantity</span> creates
            several identical units at once (a real Serial Number can't be shared, so use "N/A" for those).
          </p>
        )}
        {mode === "po" && (
          <p className="text-xs text-muted-foreground">
            One row per line item -- repeat the same <span className="font-medium">PO Number</span> (and its PO
            Date/Vendor Code/Cost Centre Code) on every row that belongs to that PO; every row sharing a PO Number
            becomes one Purchase Order with that many lines. A PO Number that already exists is refused, so use a
            fresh one per import.
          </p>
        )}
        {mode === "movement" && (
          <p className="text-xs text-muted-foreground">
            One row per asset -- identify it by <span className="font-medium">Serial Number or Asset Code</span>,
            pick an <span className="font-medium">Action</span> (Move/Send for Repair/Report Lost/etc.), and a{" "}
            <span className="font-medium">Destination AssetUser Code</span> when that action needs one.
          </p>
        )}
        {(mode === "add" || mode === "edit") && (
          <p className="text-xs text-muted-foreground">
            Custom Fields: add a column named <code className="font-mono">Custom:&lt;field key&gt;</code> (e.g.{" "}
            <code className="font-mono">Custom:warranty_card</code>) -- find each field's key under{" "}
            <span className="font-medium">Setup → Custom Fields</span>.
          </p>
        )}
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
            {preview.valid_rows.length} row{preview.valid_rows.length === 1 ? "" : "s"} ready to {noun},{" "}
            {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} with errors.
          </p>

          {preview.valid_rows.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Ready to {noun}</h3>
              {mode === "edit" && (
                <DataTable columns={EDIT_PREVIEW_COLUMNS} rows={editRows} rowKey={(r) => r.row} emptyState={<EmptyState title="No rows ready to update." />} />
              )}
              {mode === "add" && (
                <DataTable columns={ADD_PREVIEW_COLUMNS} rows={addRows} rowKey={(r) => r.row} emptyState={<EmptyState title="No rows ready to import." />} />
              )}
              {mode === "po" && (
                <DataTable columns={PO_PREVIEW_COLUMNS} rows={poRows} rowKey={(r) => r.row} emptyState={<EmptyState title="No rows ready to import." />} />
              )}
              {mode === "movement" && (
                <DataTable columns={MOVEMENT_PREVIEW_COLUMNS} rows={movementRows} rowKey={(r) => r.row} emptyState={<EmptyState title="No rows ready to apply." />} />
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
            <AsyncButton
              onClick={doCommit}
              disabled={preview.valid_rows.length === 0}
              pending={isCommitting}
              pendingLabel={mode === "edit" ? "Updating…" : mode === "movement" ? "Applying…" : "Importing…"}
            >
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
            {mode === "edit" && `Updated ${result.updated ?? 0} asset${(result.updated ?? 0) === 1 ? "" : "s"}.`}
            {mode === "add" && `Imported ${result.imported ?? 0} asset${(result.imported ?? 0) === 1 ? "" : "s"}.`}
            {mode === "po" &&
              `Created ${result.pos_created ?? 0} purchase order${(result.pos_created ?? 0) === 1 ? "" : "s"} with ${result.lines_created ?? 0} line${(result.lines_created ?? 0) === 1 ? "" : "s"}.`}
            {mode === "movement" && `Applied ${result.moved ?? 0} movement${(result.moved ?? 0) === 1 ? "" : "s"}.`}
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
