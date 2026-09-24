import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReportsScreen } from "./ReportsScreen";
import { useAuthStore } from "../../lib/auth-store";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/auth-store");
vi.mock("../../lib/api-client");

function renderWithClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReportsScreen />
    </QueryClientProvider>,
  );
}

describe("ReportsScreen", () => {
  beforeEach(() => {
    (useAuthStore as any).getState = vi.fn().mockReturnValue({ accessToken: "test-token" });
    (apiClient.get as any).mockResolvedValue([{ id: 1, name: "IT Equipment" }]);
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock");
    window.URL.revokeObjectURL = vi.fn();
  });

  it("renders the page header and all three report cards", () => {
    renderWithClient();
    expect(screen.getByRole("heading", { name: /^reports$/i })).toBeInTheDocument();
    expect(screen.getByText("Asset Register")).toBeInTheDocument();
    expect(screen.getByText("Movement Log")).toBeInTheDocument();
    expect(screen.getByText("Field Change Audit")).toBeInTheDocument();
  });

  it("defaults the movement log range to the last year and downloads the asset register with the auth header", async () => {
    const blob = new Blob(["xlsx-bytes"]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    window.fetch = fetchMock as any;

    renderWithClient();

    const fromInput = screen.getByLabelText("From") as HTMLInputElement;
    const toInput = screen.getByLabelText("To") as HTMLInputElement;
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    expect(toInput.value).toBe(today.toISOString().slice(0, 10));
    expect(fromInput.value).toBe(oneYearAgo.toISOString().slice(0, 10));

    fireEvent.click(screen.getByRole("button", { name: /download asset register/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/reports/export/assets"),
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    ));
  });

  it("downloads the movement log using the chosen from/to dates", async () => {
    const blob = new Blob(["xlsx-bytes"]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    window.fetch = fetchMock as any;

    renderWithClient();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-02-01" } });
    fireEvent.click(screen.getByRole("button", { name: /download movement log/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/reports/export/movements?from_date=2026-01-01&to_date=2026-02-01"),
      expect.anything(),
    ));
  });

  it("downloads the asset register filtered by status and category", async () => {
    const blob = new Blob(["xlsx-bytes"]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    window.fetch = fetchMock as any;

    renderWithClient();

    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "IN STOCK" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(await screen.findByRole("option", { name: "IT Equipment" }));

    fireEvent.click(screen.getByRole("button", { name: /download asset register/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/reports/export/assets?status=IN_STOCK&category_id=1"),
      expect.anything(),
    ));
  });

  it("downloads the field change audit using the chosen from/to dates", async () => {
    const blob = new Blob(["xlsx-bytes"]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    window.fetch = fetchMock as any;

    renderWithClient();

    fireEvent.change(screen.getByLabelText("Changes From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Changes To"), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: /download field change audit/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/reports/export/field-changes?from_date=2026-03-01&to_date=2026-04-01"),
      expect.anything(),
    ));
  });

  it("shows an error message when the export request fails", async () => {
    window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;

    renderWithClient();
    fireEvent.click(screen.getByRole("button", { name: /download asset register/i }));

    await waitFor(() => expect(screen.getByText(/export failed/i)).toBeInTheDocument());
  });
});
