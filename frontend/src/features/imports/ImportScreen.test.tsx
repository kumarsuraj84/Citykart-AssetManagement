import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportScreen } from "./ImportScreen";
import { apiClient } from "../../lib/api-client";

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
});
