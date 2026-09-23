import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReportsScreen } from "./ReportsScreen";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/auth-store");

describe("ReportsScreen", () => {
  beforeEach(() => {
    (useAuthStore as any).getState = vi.fn().mockReturnValue({ accessToken: "test-token" });
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock");
    window.URL.revokeObjectURL = vi.fn();
  });

  it("defaults the movement log range to the last year and downloads the asset register with the auth header", async () => {
    const blob = new Blob(["xlsx-bytes"]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    window.fetch = fetchMock as any;

    render(<ReportsScreen />);

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

    render(<ReportsScreen />);

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-02-01" } });
    fireEvent.click(screen.getByRole("button", { name: /download movement log/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/reports/export/movements?from_date=2026-01-01&to_date=2026-02-01"),
      expect.anything(),
    ));
  });

  it("shows an error message when the export request fails", async () => {
    window.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;

    render(<ReportsScreen />);
    fireEvent.click(screen.getByRole("button", { name: /download asset register/i }));

    await waitFor(() => expect(screen.getByText(/export failed/i)).toBeInTheDocument());
  });
});
