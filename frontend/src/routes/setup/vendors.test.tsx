import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import VendorsSetup from "./vendors";
import { apiClient } from "../../lib/api-client";
import { gstinProblem } from "../../lib/gstin";

vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const VENDOR = { id: 1, code: "ACME", name: "Acme Traders", gstin: null, contact_name: null, contact_phone: null, contact_email: null, erp_links: [] };

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><VendorsSetup /></QueryClientProvider>);
}

async function openAdd() {
  await screen.findByText("Acme Traders");
  fireEvent.click(screen.getAllByRole("button", { name: "Add Vendor" })[0]);
  return await screen.findByRole("dialog", { name: "Add Vendor" });
}

beforeEach(() => {
  vi.clearAllMocks();
  (apiClient.get as any).mockImplementation((path: string) => Promise.resolve(path === "/masters/vendors" ? [VENDOR] : []));
  (apiClient.post as any).mockResolvedValue({ id: 2 });
  (apiClient.put as any).mockResolvedValue({});
});

describe("Settings › Vendors: the simple vendor form (S3b-2)", () => {
  it("Add is Name + GSTIN; contacts and Code wait under More; Save needs the name", async () => {
    renderScreen();
    const dialog = await openAdd();
    expect(within(dialog).getByLabelText("Name")).toBeVisible();
    expect(within(dialog).getByLabelText("GSTIN")).toBeVisible();
    const more = within(dialog).getByText("More").closest("details")!;
    expect(more).not.toHaveAttribute("open");
    expect(within(more).getByLabelText("Code")).toBeInTheDocument();
    expect(within(more).getByLabelText("Contact Name")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("never sends an empty code: the server makes one from the name", async () => {
    renderScreen();
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Blue Star Limited" } });
    // Typed and cleared again: still not sent.
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "BS" } });
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    const [path, body] = (apiClient.post as any).mock.calls[0];
    expect(path).toBe("/masters/vendors");
    expect(Object.keys(body)).toEqual(["name"]);
    expect(body.name).toBe("Blue Star Limited");
  });

  it("a typed code is sent", async () => {
    renderScreen();
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Blue Star Limited" } });
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: " BSL " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/vendors", { name: "Blue Star Limited", code: "BSL" }));
  });

  it("checks the GSTIN as the server does, and sends it in capitals", async () => {
    renderScreen();
    const dialog = await openAdd();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Blue Star Limited" } });
    fireEvent.change(within(dialog).getByLabelText("GSTIN"), { target: { value: "09AAACB4487" } });
    expect(within(dialog).getByText("GSTIN is not valid. It has 15 characters, for example 07AAAAA0000A1Z5.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("GSTIN"), { target: { value: "09aaacb4487d1z0" } });
    expect(within(dialog).getByRole("button", { name: "Save" })).not.toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/vendors", { name: "Blue Star Limited", gstin: "09AAACB4487D1Z0" }));
  });

  it("Edit keeps the code read-only and checks the GSTIN too", async () => {
    renderScreen();
    await screen.findByText("Acme Traders");
    fireEvent.click(screen.getByRole("button", { name: "Edit Acme Traders" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Vendor" });
    expect(dialog).toHaveTextContent("Not editable after creation.");
    expect(within(dialog).queryByLabelText("Code")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("GSTIN"), { target: { value: "bad" } });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("GSTIN"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/masters/vendors/1", {
      name: "Acme Traders", gstin: null, contact_name: null, contact_phone: null, contact_email: null,
    }));
  });

  it("the GSTIN rule", () => {
    expect(gstinProblem("")).toBeNull();
    expect(gstinProblem(" 07aaaaa0000a1z5 ")).toBeNull();
    expect(gstinProblem("07AAAAA0000A1Z")).toMatch(/not valid/);
  });
});
