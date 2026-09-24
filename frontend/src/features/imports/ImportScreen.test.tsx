import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportScreen } from "./ImportScreen";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

const VALID_ROW = { row: 2, legacy_asset_code: "OLD-1", company: "CityKart HQ", category: "IT Equipment", subcategory: "Laptop", description: "Laptop", holder: "IT Stock-HO", quantity: 1 };
const ROW_ERROR = { row: 3, field: "Subcategory Code", message: "unknown Subcategory Code 'BAD'" };

function selectFile() {
  const file = new File(["dummy"], "assets.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [file] } });
}

describe("ImportScreen", () => {
  it("renders the page header and the three-step layout", () => {
    render(<ImportScreen />);
    expect(screen.getByRole("heading", { name: /import assets/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download template/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/file/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^preview$/i })).toBeInTheDocument();
  });

  it("disables Preview until a file is chosen", () => {
    render(<ImportScreen />);
    expect(screen.getByRole("button", { name: /^preview$/i })).toBeDisabled();
    selectFile();
    expect(screen.getByRole("button", { name: /^preview$/i })).toBeEnabled();
  });

  it("previews a file and shows both ready-to-import rows and row errors in tables", async () => {
    (apiClient.post as any).mockResolvedValue({ valid_rows: [VALID_ROW], errors: [ROW_ERROR] });
    render(<ImportScreen />);

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));

    await waitFor(() => expect(screen.getByText(/1 row ready to import/i)).toBeInTheDocument());
    expect(screen.getByText("CityKart HQ")).toBeInTheDocument();
    expect(screen.getByText("IT Equipment / Laptop")).toBeInTheDocument();
    expect(screen.getByText("unknown Subcategory Code 'BAD'")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^commit/i })).toBeEnabled();
  });

  it("disables Commit when preview found no valid rows", async () => {
    (apiClient.post as any).mockResolvedValue({ valid_rows: [], errors: [ROW_ERROR] });
    render(<ImportScreen />);

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));

    await waitFor(() => expect(screen.getByText(/0 rows ready to import/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^commit/i })).toBeDisabled();
  });

  it("shows a preview error message when the preview request itself fails", async () => {
    (apiClient.post as any).mockRejectedValue(new Error("missing required column(s): Description"));
    render(<ImportScreen />);

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));

    await waitFor(() => expect(screen.getByText(/missing required column/i)).toBeInTheDocument());
  });

  it("commits and shows the imported count plus any commit-time row errors", async () => {
    (apiClient.post as any).mockImplementation((path: string) => {
      if (path === "/imports/assets/preview") return Promise.resolve({ valid_rows: [VALID_ROW], errors: [] });
      if (path === "/imports/assets/commit") return Promise.resolve({ imported: 1, errors: [{ row: 2, message: "no active code rule" }] });
      return Promise.reject(new Error("unexpected path"));
    });
    render(<ImportScreen />);

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^commit/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^commit/i }));

    await waitFor(() => expect(screen.getByText(/imported 1 asset\./i)).toBeInTheDocument());
    expect(screen.getByText("no active code rule")).toBeInTheDocument();
  });

  it("shows a commit error message when the commit request itself fails", async () => {
    (apiClient.post as any).mockImplementation((path: string) => {
      if (path === "/imports/assets/preview") return Promise.resolve({ valid_rows: [VALID_ROW], errors: [] });
      if (path === "/imports/assets/commit") return Promise.reject(new Error("Not permitted for this company"));
      return Promise.reject(new Error("unexpected path"));
    });
    render(<ImportScreen />);

    selectFile();
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^commit/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^commit/i }));

    await waitFor(() => expect(screen.getByText(/not permitted for this company/i)).toBeInTheDocument());
  });

  it("downloads the template with the bearer token, not via a bare (401-ing) link", async () => {
    useAuthStore.getState().setAuth({ accessToken: "test-token", role: "ADMIN", companyId: 1, mustChangePassword: false });
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:template");
    window.URL.revokeObjectURL = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"])) });
    window.fetch = fetchMock as any;

    render(<ImportScreen />);
    // A real button (fetch + blob), no longer an <a href="/api/..."> that the
    // browser would request without the Authorization header.
    expect(screen.queryByRole("link", { name: /download template/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /download template/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/imports/assets/template",
        expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
      ),
    );
    await waitFor(() => expect(window.URL.createObjectURL).toHaveBeenCalled());
    useAuthStore.getState().logout();
  });

  it("shows an error if the template download fails", async () => {
    window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    render(<ImportScreen />);
    fireEvent.click(screen.getByRole("button", { name: /download template/i }));
    expect(await screen.findByText(/template download failed/i)).toBeInTheDocument();
  });
});
