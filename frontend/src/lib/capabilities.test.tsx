import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "./api-client";
import { useAuthStore } from "./auth-store";
import {
  ASK_TO_ADD, canCreate, canManage, domainManageAreas, inAreas, itemCreateAreas, parseCapabilities, useCapabilities, useCanCreate,
} from "./capabilities";
import { ADMIN_BOTH, ADMIN_IT, HEAD_OFFICE, OPERATOR_IT, VIEWER } from "../test-capabilities";

vi.mock("./api-client");

function signIn(token = "tok-one", over: Partial<{ role: string; isPrimaryOwner: boolean; assetUserId: number }> = {}) {
  useAuthStore.getState().setAuth({
    accessToken: token, role: over.role ?? "ADMIN", companyId: 1, isPrimaryOwner: over.isPrimaryOwner ?? false,
    mustChangePassword: false, assetUserId: over.assetUserId ?? 5,
  });
}

function Probe() {
  const { caps, ready, settled } = useCapabilities();
  const vendor = useCanCreate("vendor");
  return (
    <p data-testid="probe">
      {`ready=${ready} settled=${settled} vendor=${vendor} label=${caps?.role_label ?? "-"}`}
    </p>
  );
}

function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>);
  return qc;
}

const probe = () => screen.getByTestId("probe").textContent ?? "";

beforeEach(() => vi.clearAllMocks());
afterEach(() => useAuthStore.getState().logout());

describe("parseCapabilities and the pure helpers", () => {
  it("reads the server's answer and keeps only real flags", () => {
    const caps = parseCapabilities({ ...OPERATOR_IT, can_create: { ...OPERATOR_IT.can_create, vendor: "yes" } })!;
    expect(caps.role_label).toBe("Can Add & Move Assets");
    expect(caps.can_create.vendor).toBe(false);             // only `true` counts
    expect(caps.can_create.item).toBe(true);
    expect(caps.item_create_work_areas).toEqual(["IT"]);
  });

  it("S5: reads the person's companies (code and name); an older answer without them gives none", () => {
    const caps = parseCapabilities({ ...OPERATOR_IT, companies: [{ id: 1, code: "CKS", name: "Citykart Stores" }, { bad: true }] })!;
    expect(caps.companies).toEqual([{ id: 1, code: "CKS", name: "Citykart Stores" }]);
    const { companies: _drop, ...older } = OPERATOR_IT;
    expect(parseCapabilities(older)!.companies).toEqual([]);
  });

  it("anything that is not a capabilities object means nothing is allowed", () => {
    for (const bad of [null, undefined, [], "x", 3, {}, { can_create: [] }]) {
      expect(parseCapabilities(bad)).toBeNull();
    }
    expect(canCreate(null, "vendor")).toBe(false);
    expect(canManage(undefined, "bundle")).toBe(false);
    expect(itemCreateAreas(null)).toEqual([]);
    expect(domainManageAreas(null)).toEqual([]);
  });

  it.each([
    ["head-office admin", HEAD_OFFICE, ["IT", "NON_IT"], ["IT", "NON_IT"], true],
    ["ADMIN (both)", ADMIN_BOTH, ["IT", "NON_IT"], ["IT", "NON_IT"], true],
    ["ADMIN (IT only)", ADMIN_IT, ["IT"], ["IT"], true],
    ["OPERATOR (IT)", OPERATOR_IT, ["IT"], [], false],
    ["VIEWER", VIEWER, [], [], false],
  ])("%s: Item areas, type-of-asset areas and type creation", (_k, caps, itemAreas, typeAreas, types) => {
    expect(itemCreateAreas(caps)).toEqual(itemAreas);
    expect(domainManageAreas(caps)).toEqual(typeAreas);
    expect(canCreate(caps, "sub_category")).toBe(types);
  });

  it("a record of unknown work area is left to the server; a known one must be in the list", () => {
    expect(inAreas(null, [])).toBe(true);
    expect(inAreas("IT", ["IT"])).toBe(true);
    expect(inAreas("NON_IT", ["IT"])).toBe(false);
  });

  it("the 'ask someone' sentences name who can add the record", () => {
    expect(ASK_TO_ADD.vendor).toBe("Ask an admin or the head-office admin to add a vendor.");
    expect(ASK_TO_ADD.sub_category).toBe("Ask the head-office admin to add this type of asset.");
  });
});

describe("useCapabilities: one source, cached for the session", () => {
  it("allows nothing while the answer is on its way, then exactly what the server said", async () => {
    let answer: (v: unknown) => void = () => {};
    (apiClient.get as any).mockImplementation(() => new Promise((r) => { answer = r; }));
    signIn();
    renderProbe();
    expect(probe()).toBe("ready=false settled=false vendor=false label=-");      // never flashes a create control
    await act(async () => answer(OPERATOR_IT));
    await waitFor(() => expect(probe()).toBe("ready=true settled=true vendor=true label=Can Add & Move Assets"));
    expect(apiClient.get).toHaveBeenCalledWith("/auth/capabilities");
  });

  it("hides every create control when the call fails (the server stays the authority)", async () => {
    (apiClient.get as any).mockRejectedValue(new Error("Request failed: 500"));
    signIn();
    renderProbe();
    // (asked twice: one retry, then given up)
    await waitFor(() => expect(probe()).toBe("ready=false settled=true vendor=false label=-"), { timeout: 4000 });
  });

  it("is asked once per session, and again after a login or a token refresh", async () => {
    (apiClient.get as any).mockResolvedValue(ADMIN_BOTH);
    signIn("tok-one");
    renderProbe();
    await waitFor(() => expect(probe()).toContain("vendor=true"));
    expect(apiClient.get).toHaveBeenCalledTimes(1);

    // A refresh for the same person: asked again, and the controls never blink meanwhile.
    (apiClient.get as any).mockImplementation(() => new Promise(() => {}));
    act(() => signIn("tok-two"));
    expect(probe()).toContain("vendor=true");
    expect(apiClient.get).toHaveBeenCalledTimes(2);

    // Someone else signs in: their own answer, never the previous person's.
    act(() => signIn("tok-three", { role: "VIEWER", assetUserId: 9 }));
    expect(probe()).toBe("ready=false settled=false vendor=false label=-");
    expect(apiClient.get).toHaveBeenCalledTimes(3);
  });

  it("is not asked when nobody is signed in", async () => {
    renderProbe();
    await waitFor(() => expect(probe()).toBe("ready=false settled=true vendor=false label=-"));
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});
