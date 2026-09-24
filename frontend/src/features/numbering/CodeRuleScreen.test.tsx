import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CodeRuleScreen } from "./CodeRuleScreen";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const EXISTING = {
  id: 7,
  company_id: null,
  prefix_template: "FA/{cost_center.code}/{category.code}/",
  suffix_template: "-X",
  start_number: 100,
  pad_width: 4,
  is_active: true,
};

beforeEach(() => vi.clearAllMocks());

describe("CodeRuleScreen", () => {
  it("shows a live preview as the template is typed", async () => {
    (apiClient.get as any).mockResolvedValue([]);
    renderWithClient(<CodeRuleScreen />);

    await waitFor(() => expect(screen.getByLabelText(/prefix template/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/prefix template/i), {
      target: { value: "FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_" },
    });

    await waitFor(() => expect(screen.getByTestId("code-preview")).toHaveTextContent("FA/HO01/IT/LAP/CK_1"));
  });

  it("loads the existing active rule into the form and saves it in place (PUT, not a new rule)", async () => {
    (apiClient.get as any).mockResolvedValue([
      { ...EXISTING, id: 9, company_id: 3, prefix_template: "COMPANY-SPECIFIC/" },
      EXISTING,
    ]);
    (apiClient.put as any).mockResolvedValue({ ...EXISTING, prefix_template: "NEW/{category.code}/" });
    renderWithClient(<CodeRuleScreen />);

    // Prefilled from the global active rule (company_id null), not the company-specific one.
    await waitFor(() => expect(screen.getByLabelText(/prefix template/i)).toHaveValue(EXISTING.prefix_template));
    expect(screen.getByLabelText(/suffix template/i)).toHaveValue("-X");
    expect(screen.getByLabelText(/start number/i)).toHaveValue(100);
    expect(screen.getByLabelText(/pad width/i)).toHaveValue(4);
    expect(screen.getByTestId("code-preview")).toHaveTextContent("FA/HO01/IT/0100-X");

    fireEvent.change(screen.getByLabelText(/prefix template/i), { target: { value: "NEW/{category.code}/" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/code-rules/7", {
        company_id: null,
        prefix_template: "NEW/{category.code}/",
        suffix_template: "-X",
        start_number: 100,
        pad_width: 4,
      }),
    );
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });

  it("creates the first rule with POST when none exists yet", async () => {
    (apiClient.get as any).mockResolvedValue([]);
    (apiClient.post as any).mockResolvedValue({ ...EXISTING, id: 1 });
    renderWithClient(<CodeRuleScreen />);

    await waitFor(() => expect(screen.getByLabelText(/prefix template/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/prefix template/i), { target: { value: "FA/{category.code}/" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/code-rules", expect.objectContaining({
        company_id: null,
        prefix_template: "FA/{category.code}/",
      })),
    );
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  it("shows the server error when saving fails", async () => {
    (apiClient.get as any).mockResolvedValue([EXISTING]);
    (apiClient.put as any).mockRejectedValue(new Error("Not permitted for this action"));
    renderWithClient(<CodeRuleScreen />);
    await waitFor(() => expect(screen.getByLabelText(/prefix template/i)).toHaveValue(EXISTING.prefix_template));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText("Not permitted for this action")).toBeInTheDocument();
  });
});
