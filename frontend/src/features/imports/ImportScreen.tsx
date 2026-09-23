import { useRef, useState } from "react";
import { apiClient } from "../../lib/api-client";
import { downloadFile } from "../../lib/auth-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface PreviewResult {
  valid_rows: { row: number; legacy_asset_code: string; description: string }[];
  errors: { row: number; message: string }[];
}

interface CommitResult {
  imported: number;
  errors?: { row: number; message: string }[];
}

export function ImportScreen() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
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
    try {
      await downloadFile("/imports/assets/template", "asset_import_template.xlsx", "Template download failed");
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "Template download failed.");
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
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Import Assets</h1>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-file">File</Label>
            <Input
              id="import-file"
              aria-label="File"
              type="file"
              accept=".xlsx"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
          </div>

          <Button onClick={doPreview} disabled={!file || isPreviewing}>
            Preview
          </Button>

          <Button variant="secondary" onClick={downloadTemplate}>
            Download Template
          </Button>

          {templateError && <p className="w-full text-sm text-destructive">{templateError}</p>}
          {previewError && <p className="w-full text-sm text-destructive">{previewError}</p>}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <p className="text-sm text-muted-foreground">
              {preview.valid_rows.length} valid row{preview.valid_rows.length === 1 ? "" : "s"},{" "}
              {preview.errors.length} error{preview.errors.length === 1 ? "" : "s"}
            </p>

            {preview.errors.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.errors.map((e) => (
                    <TableRow key={e.row}>
                      <TableCell>{e.row}</TableCell>
                      <TableCell>{e.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div>
              <Button onClick={doCommit} disabled={preview.valid_rows.length === 0 || isCommitting}>
                Commit
              </Button>
            </div>

            {commitError && <p className="text-sm text-destructive">{commitError}</p>}
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm">Imported {result.imported} assets.</p>
            {result.errors && result.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-destructive">
                {result.errors.map((e) => (
                  <li key={`${e.row}-${e.message}`}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
