import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportScreen } from "./ImportScreen";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

describe("ImportScreen", () => {
  it("previews a file and shows errors before committing", async () => {
    (apiClient.post as any).mockResolvedValue({ valid_rows: [{ row: 2, legacy_asset_code: "OLD-1", description: "Laptop" }], errors: [{ row: 3, message: "unknown subcategory_code" }] });
    render(<ImportScreen />);

    const file = new File(["dummy"], "assets.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => expect(screen.getByText(/unknown subcategory_code/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /commit/i })).toBeInTheDocument();
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
