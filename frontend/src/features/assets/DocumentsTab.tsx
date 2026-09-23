import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Doc {
  id: number;
  doc_type: string;
  file_name: string;
  mime_type?: string;
  size_bytes: number;
  uploaded_at?: string;
}

const DOC_TYPES = [
  { value: "invoice", label: "Invoice" },
  { value: "po", label: "PO Copy" },
  { value: "warranty_card", label: "Warranty Card" },
  { value: "photo", label: "Photo" },
  { value: "other", label: "Other" },
];

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

export function DocumentsTab({ assetId }: { assetId: number }) {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.role);
  const canUpload = role === "ADMIN" || role === "IT_TEAM";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("invoice");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["assets", assetId, "documents"],
    queryFn: () => apiClient.get<Doc[]>(`/assets/${assetId}/documents`),
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("Choose a file first.");
      const token = useAuthStore.getState().accessToken;
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("doc_type", docType);
      const res = await fetch(`${BASE}/assets/${assetId}/documents`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(detail.detail ?? `Upload failed: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets", assetId, "documents"] });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
  });

  async function handleDownload(doc: Doc) {
    setDownloadError(null);
    try {
      const token = useAuthStore.getState().accessToken;
      const res = await fetch(`${BASE}/documents/${doc.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canUpload && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-type-select">Type</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger id="doc-type-select" aria-label="Type" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="doc-file-input">File</Label>
              <Input
                id="doc-file-input"
                aria-label="File"
                type="file"
                ref={fileInputRef}
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={!selectedFile || uploadMutation.isPending}
            >
              Upload
            </Button>

            {uploadMutation.isError && (
              <p className="w-full text-sm text-destructive">
                {uploadMutation.error instanceof Error ? uploadMutation.error.message : "Upload failed."}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents uploaded for this asset.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.file_name}</TableCell>
                    <TableCell className="capitalize">{d.doc_type.replace(/_/g, " ")}</TableCell>
                    <TableCell>{formatSize(d.size_bytes)}</TableCell>
                    <TableCell>
                      <Button variant="secondary" size="sm" onClick={() => handleDownload(d)}>
                        Download
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {downloadError && <p className="mt-2 text-sm text-destructive">{downloadError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
