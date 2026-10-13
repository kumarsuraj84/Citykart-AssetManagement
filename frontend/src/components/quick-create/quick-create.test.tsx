import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { apiClient, ApiError } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import type { Capabilities } from "../../lib/capabilities";
import { ADMIN_IT, HEAD_OFFICE, OPERATOR_IT, withCapabilities } from "../../test-capabilities";
import {
  NewBrandDialog, NewCategoryDialog, NewCostCenterDialog, NewStockRoomDialog, NewSubcategoryDialog, NewVendorDialog,
} from "./masters";

vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const CATS = [
  { id: 1, code: "ITFA", name: "IT Fixed Assets", asset_domain: "IT" },
  { id: 2, code: "FUR", name: "Furniture", asset_domain: "NON_IT" },
];

function world(caps: Capabilities, over: Record<string, unknown> = {}) {
  (apiClient.get as any).mockImplementation(withCapabilities(caps, (path: string) => {
    if (path in over) return Promise.resolve(over[path]);
    if (path === "/masters/vendors") return Promise.resolve([{ id: 7, code: "ACME", name: "Acme Traders" }]);
    if (path === "/masters/brands") return Promise.resolve([{ id: 9, code: "DELL", name: "Dell" }]);
    if (path === "/masters/categories") return Promise.resolve(CATS);
    if (path === "/masters/subcategories") return Promise.resolve([{ id: 10, category_id: 1, code: "LAP", name: "Laptop" }]);
    if (path === "/masters/cost-centers?company_id=1") return Promise.resolve([{ id: 3, code: "HO01", name: "Head Office" }]);
    if (path === "/masters/locations?company_id=1") return Promise.resolve([{ id: 50, code: "HO", name: "Head Office" }]);
    if (path === "/masters/locations?company_id=2") return Promise.resolve([]);
    if (path === "/asset-users/me/companies") return Promise.resolve([{ id: 1, name: "Citykart Stores" }]);
    return Promise.resolve([]);
  }));
}

function show(ui: (p: { onCreated: (r: unknown) => void; onOpenChange: (o: boolean) => void }) => ReactElement) {
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{ui({ onCreated, onOpenChange })}</QueryClientProvider>);
  return { onCreated, onOpenChange, dialog: screen.getByRole("dialog") };
}

const save = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setAuth({ accessToken: "tok", role: "OPERATOR", companyId: 1, isPrimaryOwner: false, mustChangePassword: false, assetUserId: 5 });
  world(OPERATOR_IT);
});
afterEach(() => useAuthStore.getState().logout());

describe("New Vendor", () => {
  it("asks only for the name and GSTIN, keeps contact details under More, and never sends a code", async () => {
    (apiClient.post as any).mockResolvedValue({ id: 31, name: "Vansh Enterprises Pvt. Ltd." });
    const { dialog, onCreated, onOpenChange } = show((p) => <NewVendorDialog open {...p} />);
    expect(within(dialog).queryByLabelText(/^code/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/contact person/i)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: " Vansh Enterprises Pvt. Ltd. " } });
    fireEvent.change(within(dialog).getByLabelText(/^gstin/i), { target: { value: "07AAAAA0000A1Z5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^more$/i }));
    fireEvent.change(within(dialog).getByLabelText(/contact person/i), { target: { value: "Ravi" } });
    fireEvent.change(within(dialog).getByLabelText(/contact phone/i), { target: { value: "9999999999" } });
    save(dialog);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/vendors", {
      name: "Vansh Enterprises Pvt. Ltd.", gstin: "07AAAAA0000A1Z5", contact_name: "Ravi", contact_phone: "9999999999", contact_email: null,
    }));
    expect((apiClient.post as any).mock.calls[0][1]).not.toHaveProperty("code");
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 31, name: "Vansh Enterprises Pvt. Ltd." }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a blank GSTIN is sent as nothing", async () => {
    (apiClient.post as any).mockResolvedValue({ id: 32, name: "Blue Star" });
    const { dialog } = show((p) => <NewVendorDialog open {...p} />);
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Blue Star" } });
    save(dialog);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/vendors", expect.objectContaining({ name: "Blue Star", gstin: null })));
  });

  it("a duplicate name keeps the dialog open with the server's sentence and offers the existing vendor", async () => {
    (apiClient.post as any).mockRejectedValue(new ApiError("A vendor with this name already exists.", 422));
    const { dialog, onCreated, onOpenChange } = show((p) => <NewVendorDialog open {...p} />);
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "acme traders" } });
    save(dialog);
    expect(await within(dialog).findByText("A vendor with this name already exists.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onCreated).not.toHaveBeenCalled();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Use the existing “Acme Traders”" }));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 7, name: "Acme Traders" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("New Brand and New Cost Centre: just a name", () => {
  it("New Brand posts only the name", async () => {
    (apiClient.post as any).mockResolvedValue({ id: 12, name: "Lenovo India" });
    const { dialog, onCreated } = show((p) => <NewBrandDialog open {...p} />);
    expect(within(dialog).queryByLabelText(/^code/i)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Lenovo India" } });
    save(dialog);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/brands", { name: "Lenovo India" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 12, name: "Lenovo India" }));
  });

  it("a duplicate brand offers the existing one", async () => {
    (apiClient.post as any).mockRejectedValue(new ApiError("A brand with this name already exists.", 422));
    const { dialog, onCreated } = show((p) => <NewBrandDialog open {...p} />);
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "DELL" } });
    save(dialog);
    fireEvent.click(await within(dialog).findByRole("button", { name: "Use the existing “Dell”" }));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }));
  });

  it("New Cost Centre posts the task's company and the name, no code", async () => {
    (apiClient.post as any).mockResolvedValue({ id: 44, name: "Farukhnagar W/H" });
    const { dialog } = show((p) => <NewCostCenterDialog companyId={1} open {...p} />);
    expect(within(dialog).queryByLabelText(/^code/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/company/i)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Farukhnagar W/H" } });
    save(dialog);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/cost-centers", { company_id: 1, name: "Farukhnagar W/H" }));
  });

  it("a company-scope refusal is shown as the server wrote it and the dialog stays open", async () => {
    const sentence = "You can only add a cost centre for your own company. Ask the head-office admin to add it for another company.";
    (apiClient.post as any).mockRejectedValue(new ApiError(sentence, 403));
    const { dialog, onOpenChange } = show((p) => <NewCostCenterDialog companyId={2} open {...p} />);
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Patna" } });
    save(dialog);
    expect(await within(dialog).findByText(sentence)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("New Stock Room", () => {
  it("in an existing place of the task's company: name + location_id", async () => {
    (apiClient.post as any).mockResolvedValue({ id: 88, name: "HO Stock 2" });
    const { dialog, onCreated } = show((p) => <NewStockRoomDialog companyId={1} open {...p} />);
    expect(within(dialog).queryByLabelText(/^company/i)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "HO Stock 2" } });
    fireEvent.click(within(dialog).getByLabelText(/^place/i));
    fireEvent.click(await screen.findByRole("option", { name: "Head Office" }));
    save(dialog);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/stock-rooms", { name: "HO Stock 2", company_id: 1, location_id: 50 }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 88, name: "HO Stock 2" }));
  });

  it("in a new place: name + location_name", async () => {
    (apiClient.post as any).mockResolvedValue({ id: 89, name: "Farukhnagar Stock" });
    const { dialog } = show((p) => <NewStockRoomDialog companyId={1} open {...p} />);
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Farukhnagar Stock" } });
    fireEvent.click(within(dialog).getByLabelText(/^place/i));
    fireEvent.click(await screen.findByRole("option", { name: /a new place/i }));
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/new place name/i), { target: { value: "Farukhnagar Warehouse" } });
    save(dialog);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/stock-rooms", {
      name: "Farukhnagar Stock", company_id: 1, location_name: "Farukhnagar Warehouse",
    }));
  });

  it("a company with no place yet asks for the place name straight away", async () => {
    (apiClient.post as any).mockResolvedValue({ id: 90, name: "Patna Stock" });
    const { dialog } = show((p) => <NewStockRoomDialog companyId={2} open {...p} />);
    const placeName = await within(dialog).findByLabelText(/new place name/i);
    expect(within(dialog).queryByLabelText(/^place/i)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Patna Stock" } });
    fireEvent.change(placeName, { target: { value: "Patna" } });
    save(dialog);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/stock-rooms", { name: "Patna Stock", company_id: 2, location_name: "Patna" }));
  });

  it("where the task has no company (Move), the single allowed company is chosen for the person", async () => {
    (apiClient.post as any).mockResolvedValue({ id: 91, name: "Hisar Stock" });
    const { dialog } = show((p) => <NewStockRoomDialog open {...p} />);
    await waitFor(() => expect(within(dialog).getByLabelText(/^company/i)).toHaveTextContent("Citykart Stores"));
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Hisar Stock" } });
    fireEvent.click(within(dialog).getByLabelText(/^place/i));
    fireEvent.click(await screen.findByRole("option", { name: "Head Office" }));
    save(dialog);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/stock-rooms", { name: "Hisar Stock", company_id: 1, location_id: 50 }));
  });

  it("a name that already exists in that company (the server answers 200 with it) is simply picked", async () => {
    (apiClient.post as any).mockResolvedValue({ id: 4, name: "HO Stock" });         // the existing room
    const { dialog, onCreated } = show((p) => <NewStockRoomDialog companyId={1} open {...p} />);
    expect(within(dialog).getByText(/already has a stock room with this name, that one is picked/i)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "ho stock" } });
    fireEvent.click(within(dialog).getByLabelText(/^place/i));
    fireEvent.click(await screen.findByRole("option", { name: "Head Office" }));
    save(dialog);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 4, name: "HO Stock" }));
  });

  it("a refusal keeps the dialog open with the server's sentence", async () => {
    const sentence = "You can only add a stock room for your own company. Ask the head-office admin to add it for another company.";
    (apiClient.post as any).mockRejectedValue(new ApiError(sentence, 403));
    const { dialog, onOpenChange } = show((p) => <NewStockRoomDialog companyId={2} open {...p} />);
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "X" } });
    fireEvent.change(await within(dialog).findByLabelText(/new place name/i), { target: { value: "Y" } });
    save(dialog);
    expect(await within(dialog).findByText(sentence)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("New Category / Sub-category (types of asset) stay inside the person's work areas", () => {
  it("an IT-only admin can make a Category for the IT Team only (already chosen); the Code is made from the name, under More", async () => {
    world(ADMIN_IT);
    (apiClient.post as any).mockResolvedValue({ id: 5, name: "Networking" });
    const { dialog } = show((p) => <NewCategoryDialog open {...p} />);
    await waitFor(() => expect(within(dialog).getByLabelText(/^work area/i)).toHaveTextContent("IT Team"));
    fireEvent.click(within(dialog).getByLabelText(/^work area/i));
    expect(await screen.findByRole("option", { name: "IT Team" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Admin / Non-IT Team" })).not.toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Networking" } });
    expect(within(dialog).queryByLabelText(/^code/i)).not.toBeInTheDocument();
    save(dialog);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/masters/categories", { name: "Networking", code: "NETWOR", asset_domain: "IT" }));
  });

  it("the head-office admin may choose either work area", async () => {
    world(HEAD_OFFICE);
    const { dialog } = show((p) => <NewCategoryDialog open {...p} />);
    fireEvent.click(within(dialog).getByLabelText(/^work area/i));
    expect(await screen.findByRole("option", { name: "Admin / Non-IT Team" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "IT Team" })).toBeInTheDocument();
  });

  it("a Sub-category lists only the Categories of the person's work area, and New Category… only for someone allowed", async () => {
    world(ADMIN_IT);
    const { dialog } = show((p) => <NewSubcategoryDialog open {...p} />);
    fireEvent.click(within(dialog).getByLabelText(/^category/i));
    expect(await screen.findByRole("option", { name: "IT Fixed Assets" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Furniture" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /new category/i })).toBeInTheDocument();
  });

  it("the server's work-area sentence is shown in the dialog word for word", async () => {
    world(ADMIN_IT);
    const sentence = "This belongs to the Admin / Non-IT team; you can only work with IT items. Ask someone in the Admin / Non-IT team or the head-office admin.";
    (apiClient.post as any).mockRejectedValue(new ApiError(sentence, 403));
    const { dialog, onOpenChange } = show((p) => <NewSubcategoryDialog open defaultCategoryId="1" {...p} />);
    await waitFor(() => expect(within(dialog).getByLabelText(/^category/i)).toHaveTextContent("IT Fixed Assets"));
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Switch" } });
    save(dialog);
    expect(await within(dialog).findByText(sentence)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
