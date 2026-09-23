import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HoldersScreen } from "./HoldersScreen";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("HoldersScreen", () => {
  it("resets a holder's password and shows the temp password", async () => {
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === "/holders") {
        return Promise.resolve([
          {
            id: 1,
            company_id: 1,
            emp_code: "CS6872",
            name: "Ankur",
            holder_type: "EMPLOYEE",
            location_id: 1,
            department_id: 1,
            role: "HOLDER",
            is_active: true,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    (apiClient.post as any).mockResolvedValue({ temp_password: "abc123XYZ" });

    renderWithClient(<HoldersScreen />);

    await waitFor(() => expect(screen.getByText("Ankur")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => expect(screen.getByText("abc123XYZ")).toBeInTheDocument());
    expect(apiClient.post).toHaveBeenCalledWith("/holders/1/reset-password");

    // The temp password dialog uses proper alertdialog semantics.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    // Closing the dialog must not leave the temp password visible anywhere.
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByText("abc123XYZ")).not.toBeInTheDocument());
  });
});
