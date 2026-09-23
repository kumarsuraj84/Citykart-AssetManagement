import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CodeRuleScreen } from "./CodeRuleScreen";
import { apiClient } from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("CodeRuleScreen", () => {
  it("shows a live preview as the template is typed", async () => {
    (apiClient.get as any).mockResolvedValue([]);
    renderWithClient(<CodeRuleScreen />);

    fireEvent.change(screen.getByLabelText(/prefix template/i), {
      target: { value: "FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_" },
    });

    await waitFor(() => expect(screen.getByTestId("code-preview")).toHaveTextContent("FA/HO01/IT/LAP/CK_1"));
  });
});
