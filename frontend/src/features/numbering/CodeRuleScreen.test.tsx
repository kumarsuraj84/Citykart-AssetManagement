import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CodeRuleScreen } from "./CodeRuleScreen";
import { apiClient } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";

vi.mock("../../lib/api-client");

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function loginAs(role: string, isPrimaryOwner: boolean) {
  useAuthStore.getState().setAuth({ accessToken: "tok", role, companyId: isPrimaryOwner ? null : 1, isPrimaryOwner, mustChangePassword: false });
}

const EXISTING = {
  id: 7,
  company_id: null,
  prefix_template: "FA/{cost_center.code}/{category.code}/",
  suffix_template: "-X",
  start_number: 100,
  pad_width: 4,
  is_active: true,
  example: "FA/HO01/IT/0100-X",
};

beforeEach(() => {
  vi.clearAllMocks();
  loginAs("ADMIN", true); // the head-office admin: the only person who may change the format
});
afterEach(() => useAuthStore.getState().logout());

describe("CodeRuleScreen (head-office admin)", () => {
  it("is titled Asset Code Format", async () => {
    (apiClient.get as any).mockResolvedValue([]);
    renderWithClient(<CodeRuleScreen />);
    expect(await screen.findByRole("heading", { name: "Asset Code Format" })).toBeInTheDocument();
    expect(screen.queryByTestId("code-rule-owner-only")).not.toBeInTheDocument();
  });

  it("shows a live preview as the template is typed (offline example until the server answers)", async () => {
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
    expect(apiClient.post).not.toHaveBeenCalledWith("/code-rules", expect.anything());
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
    (apiClient.put as any).mockRejectedValue(new Error("Only the head-office admin can do this."));
    renderWithClient(<CodeRuleScreen />);
    await waitFor(() => expect(screen.getByLabelText(/prefix template/i)).toHaveValue(EXISTING.prefix_template));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText("Only the head-office admin can do this.")).toBeInTheDocument();
  });

  it("asks the server for the example while typing (debounced, body = the rule fields) and shows it", async () => {
    (apiClient.get as any).mockResolvedValue([EXISTING]);
    (apiClient.post as any).mockImplementation((path: string, b: any) =>
      path === "/code-rules/preview"
        ? Promise.resolve({ example: `SERVER:${b.prefix_template}${b.start_number}` })
        : Promise.resolve({}),
    );
    renderWithClient(<CodeRuleScreen />);
    await waitFor(() => expect(screen.getByLabelText(/prefix template/i)).toHaveValue(EXISTING.prefix_template));

    // Type three characters quickly: only the final text may reach the server.
    const input = screen.getByLabelText(/prefix template/i);
    fireEvent.change(input, { target: { value: "A" } });
    fireEvent.change(input, { target: { value: "AB" } });
    fireEvent.change(input, { target: { value: "ABC/" } });

    await waitFor(() => expect(screen.getByTestId("code-preview")).toHaveTextContent("SERVER:ABC/100"));
    const previewCalls = (apiClient.post as any).mock.calls.filter((c: any[]) => c[0] === "/code-rules/preview");
    expect(previewCalls.some((c: any[]) => c[1].prefix_template === "A" || c[1].prefix_template === "AB")).toBe(false);
    expect(previewCalls.at(-1)[1]).toEqual({
      company_id: null,
      prefix_template: "ABC/",
      suffix_template: "-X",
      start_number: 100,
      pad_width: 4,
    });
    // Nothing was saved by previewing.
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  it("shows the server's validation sentence inline when the format is not valid", async () => {
    (apiClient.get as any).mockResolvedValue([EXISTING]);
    (apiClient.post as any).mockRejectedValue(new Error("The asset code format uses {nope}, which is not a known token."));
    renderWithClient(<CodeRuleScreen />);
    await waitFor(() => expect(screen.getByLabelText(/prefix template/i)).toHaveValue(EXISTING.prefix_template));

    fireEvent.change(screen.getByLabelText(/prefix template/i), { target: { value: "FA/{nope}/" } });

    expect(await screen.findByTestId("code-preview-error")).toHaveTextContent(
      "The asset code format uses {nope}, which is not a known token.",
    );
    // No misleading example next to an error.
    expect(screen.getByTestId("code-preview")).toHaveTextContent("—");
  });
});

describe("CodeRuleScreen (anyone else)", () => {
  afterEach(() => vi.clearAllMocks());

  it.each([
    ["an ordinary admin", "ADMIN", false],
    ["an operator", "OPERATOR", false],
    ["a viewer", "VIEWER", false],
  ])("%s sees the current format read-only, no Save, and the owner-only note", async (_n, role, owner) => {
    loginAs(role, owner);
    (apiClient.get as any).mockResolvedValue([EXISTING]);
    renderWithClient(<CodeRuleScreen />);

    await waitFor(() => expect(screen.getByLabelText(/prefix template/i)).toHaveValue(EXISTING.prefix_template));
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    expect(screen.getByText("Only the head-office admin can change the asset code format.")).toBeInTheDocument();
    for (const label of [/prefix template/i, /suffix template/i, /start number/i, /pad width/i]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("readonly");
    }
    // The server's own example of the saved rule is shown; nothing is asked of the preview endpoint.
    expect(screen.getByTestId("code-preview")).toHaveTextContent("FA/HO01/IT/0100-X");
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  it("S7 fix 2 (N4): the example is the person's own company's (asked with ?company_id=)", async () => {
    loginAs("OPERATOR", false);                                  // works in company 1
    (apiClient.get as any).mockResolvedValue([{ ...EXISTING, example: "FA/CKSPL-HO/IT/0100-X" }]);
    renderWithClient(<CodeRuleScreen />);
    await waitFor(() => expect(screen.getByTestId("code-preview")).toHaveTextContent("FA/CKSPL-HO/IT/0100-X"));
    expect(apiClient.get).toHaveBeenCalledWith("/code-rules?company_id=1");
  });

  it("S7 fix 2 (N4): the set-up guide's company is the one the preview is asked for; the rule stays global", async () => {
    loginAs("ADMIN", true);
    (apiClient.get as any).mockResolvedValue([EXISTING]);
    (apiClient.post as any).mockResolvedValue({ example: "FA/HO7/IT/0100-X" });
    renderWithClient(<CodeRuleScreen embedded exampleCompany={{ id: 7, code: "UATRT" }} />);
    await waitFor(() => expect(screen.getByTestId("code-preview")).toHaveTextContent("FA/HO7/IT/0100-X"));
    expect(apiClient.get).toHaveBeenCalledWith("/code-rules?company_id=7");
    expect(apiClient.post).toHaveBeenCalledWith("/code-rules/preview?company_id=7", expect.objectContaining({ company_id: null }));
    expect(screen.getByTestId("code-preview-label")).toHaveTextContent("UATRT");
  });

  it("with no rule yet, says the head-office admin must set one up", async () => {
    loginAs("ADMIN", false);
    (apiClient.get as any).mockResolvedValue([]);
    renderWithClient(<CodeRuleScreen />);
    expect(await screen.findByText(/until the head-office admin saves one/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });
});
