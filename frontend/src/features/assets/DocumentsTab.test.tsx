import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DocumentsTab } from "./DocumentsTab";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

describe("DocumentsTab", () => {
  it("lists documents for the asset", async () => {
    (apiClient.get as any).mockResolvedValue([{ id: 1, doc_type: "invoice", file_name: "invoice.pdf", size_bytes: 1024 }]);
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><DocumentsTab assetId={1} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText("invoice.pdf")).toBeInTheDocument());
  });

  it("names each document type in plain words (po -> PO Copy)", async () => {
    (apiClient.get as any).mockResolvedValue([
      { id: 1, doc_type: "po", file_name: "po.pdf", size_bytes: 1024 },
      { id: 2, doc_type: "warranty_card", file_name: "w.pdf", size_bytes: 2048 },
    ]);
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><DocumentsTab assetId={1} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText("PO Copy")).toBeInTheDocument());
    expect(screen.getByText("Warranty Card")).toBeInTheDocument();
    expect(screen.queryByText(/warranty_card/)).not.toBeInTheDocument();
  });
});
