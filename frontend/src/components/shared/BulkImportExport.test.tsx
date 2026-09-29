import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BulkImportExport } from "./BulkImportExport";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function selectFile() {
  const file = new File(["dummy"], "rows.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.URL.createObjectURL = vi.fn().mockReturnValue("blob:export");
  window.URL.revokeObjectURL = vi.fn();
});

describe("BulkImportExport", () => {
  it("opens the dialog with Export and Import sections", () => {
    render(<BulkImportExport resource="vendors" label="Vendors" />);
    fireEvent.click(screen.getByRole("button", { name: /import \/ export/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^export$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download template/i })).toBeInTheDocument();
  });

  it("exports via the default /masters/{resource} base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"])) });
    window.fetch = fetchMock as any;

    render(<BulkImportExport resource="vendors" label="Vendors" />);
    fireEvent.click(screen.getByRole("button", { name: /import \/ export/i }));
    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/masters/vendors/export", expect.anything()));
  });

  it("uses an explicit basePath instead of /masters/{resource} when given (Holders)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"])) });
    window.fetch = fetchMock as any;

    render(<BulkImportExport resource="holders" label="Holders" basePath="/holders" />);
    fireEvent.click(screen.getByRole("button", { name: /import \/ export/i }));
    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/holders/export", expect.anything()));
  });

  it("previews a file and shows dynamic columns built from the response, then commits", async () => {
    (apiClient.post as any).mockImplementation((path: string) => {
      if (path === "/masters/vendors/import/preview") {
        return Promise.resolve({
          valid_rows: [{ row: 2, values: { Code: "VND-1", Name: "Acme" } }],
          errors: [{ row: 3, field: "Name", message: "Name is required" }],
        });
      }
      if (path === "/masters/vendors/import/commit") {
        return Promise.resolve({ imported: 1, errors: [] });
      }
      return Promise.reject(new Error("unexpected path"));
    });

    const onImported = vi.fn();
    render(<BulkImportExport resource="vendors" label="Vendors" onImported={onImported} />);
    fireEvent.click(screen.getByRole("button", { name: /import \/ export/i }));

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));

    await waitFor(() => expect(screen.getByText(/1 row ready to import/i)).toBeInTheDocument());
    expect(screen.getByText("VND-1")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Name is required")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^commit/i }));
    await waitFor(() => expect(screen.getByText(/imported 1 vendors\./i)).toBeInTheDocument());
    expect(onImported).toHaveBeenCalled();
  });

  it("does not call onImported when nothing was actually imported", async () => {
    (apiClient.post as any).mockImplementation((path: string) => {
      if (path === "/masters/vendors/import/preview") return Promise.resolve({ valid_rows: [{ row: 2, values: { Code: "X" } }], errors: [] });
      if (path === "/masters/vendors/import/commit") return Promise.resolve({ imported: 0, errors: [{ row: 2, message: "a record with this code already exists" }] });
      return Promise.reject(new Error("unexpected path"));
    });

    const onImported = vi.fn();
    render(<BulkImportExport resource="vendors" label="Vendors" onImported={onImported} />);
    fireEvent.click(screen.getByRole("button", { name: /import \/ export/i }));

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^commit/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^commit/i }));

    await waitFor(() => expect(screen.getByText(/imported 0 vendors\./i)).toBeInTheDocument());
    expect(onImported).not.toHaveBeenCalled();
  });

  it("closing and reopening the dialog clears any previous file/preview/result", async () => {
    (apiClient.post as any).mockResolvedValue({ valid_rows: [{ row: 2, values: { Code: "X" } }], errors: [] });
    render(<BulkImportExport resource="vendors" label="Vendors" />);
    fireEvent.click(screen.getByRole("button", { name: /import \/ export/i }));

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));
    await waitFor(() => expect(screen.getByText(/1 row ready to import/i)).toBeInTheDocument());

    // Close (Escape) then reopen.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /import \/ export/i }));

    expect(screen.queryByText(/row ready/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^preview$/i })).toBeDisabled();
  });
});
