import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../lib/api-client";
import { useAuthStore } from "../../lib/auth-store";
import type { Capabilities } from "../../lib/capabilities";
import { ADMIN_BOTH, ADMIN_IT, HEAD_OFFICE } from "../../test-capabilities";
import { PeopleScreen, canManageAccount } from "./PeopleScreen";
import {
  isWiderThanMine, passwordsCsv, passwordsText, peopleListPath, storeResultSentence, type PeopleKind, type PersonRow,
} from "./people-model";
import { employeeBody } from "./AddEmployeeDialog";
import { editBody, draftFrom } from "./EditPersonDialog";
import { issueConfirmSentence } from "./IssuePasswordsDialog";
import { ensureRoomsSentence } from "./EnsureRoomsDialog";

vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, apiClient: { get: vi.fn(), getPage: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

// ---------------------------------------------------------------------------
// Fixtures: rows exactly as GET /api/people answers them.
// ---------------------------------------------------------------------------

const person = (over: Partial<PersonRow>): PersonRow => ({
  id: 1, kind: "EMPLOYEE", kind_label: "Employee", code: "E1", name: "Ankur", company_id: 1, company_code: "CKS",
  company_name: "Citykart Stores", location_id: 1, location_name: "Head Office", department_id: 3, department_name: "IT",
  email: null, phone: null, role: "SELF_SERVICE", role_label: null, work_area: null, work_area_label: null,
  login_enabled: false, has_password: false, must_change_password: false, is_primary_owner: false, is_active: true, ...over,
});

const ANKUR = person({});
const PRIYA = person({
  id: 2, code: "E2", name: "Priya", email: "priya@citykart.in", role: "OPERATOR", role_label: "Can Add & Move Assets",
  work_area: "IT", work_area_label: "IT Team", login_enabled: true, has_password: true,
});
const RAVI = person({
  id: 3, code: "E3", name: "Ravi", email: "ravi@citykart.in", role: "VIEWER", role_label: "View Only",
  work_area: "BOTH", work_area_label: "IT and Non-IT", login_enabled: true, has_password: false,
});
const OWNER = person({ id: 99, code: "HO1", name: "Head Office Owner", role: "ADMIN", role_label: "Head-office Admin", login_enabled: true, has_password: true, is_primary_owner: true });
const LAM = person({ id: 7, kind: "STORE", kind_label: "Store", code: "LAM", name: "Lucknow Aminabad", location_name: "Lucknow Aminabad", department_id: null, department_name: null, email: "sm.lam@citykartstores.com", login_enabled: true, has_password: false });
const SPR = person({ id: 8, kind: "STORE", kind_label: "Store", code: "SPR2", name: "Spring Road", location_name: "Spring Road", department_id: null, department_name: null, email: "sm.spr2@citykartstores.com", login_enabled: true, has_password: true });
const HOSTOCK = person({ id: 20, kind: "STOCK_POINT", kind_label: "Stock Room", code: "STK-HO", name: "HO Stock", department_id: null, department_name: null });
const SERVER_ROOM = person({ id: 30, kind: "INSTALLED", kind_label: "Install Point", code: "INS-HOSERVERROOM", name: "HO Server Room", department_id: null, department_name: null });

const TYPE_OF: Record<string, PeopleKind> = { EMPLOYEE: "employees", STORE: "stores", STOCK_POINT: "stock-rooms", INSTALLED: "install-points" };

let ROWS: PersonRow[] = [];
let CAPS: Capabilities = ADMIN_BOTH;
let MY_COMPANIES = [{ id: 1, code: "CKS", name: "Citykart Stores" }];

function mockApi() {
  (apiClient.getPage as any).mockImplementation((path: string) => {
    const u = new URL(path, "http://x");
    if (u.pathname !== "/people") return Promise.resolve({ data: [], total: 0 });
    const kind = u.searchParams.get("kind");
    const q = (u.searchParams.get("q") ?? "").toLowerCase();
    const company = u.searchParams.get("company_id");
    const limit = Number(u.searchParams.get("limit") ?? 200);
    const offset = Number(u.searchParams.get("offset") ?? 0);
    const all = ROWS.filter((r) => TYPE_OF[r.kind ?? ""] === kind)
      .filter((r) => !q || [r.code, r.name, r.email, r.location_name].some((v) => (v ?? "").toLowerCase().includes(q)))
      .filter((r) => !company || String(r.company_id) === company);
    return Promise.resolve({ data: all.slice(offset, offset + limit), total: all.length });
  });
  (apiClient.get as any).mockImplementation((path: string) => {
    if (path === "/auth/capabilities") return Promise.resolve(CAPS);
    if (path === "/asset-users/me/companies") return Promise.resolve(MY_COMPANIES);
    if (path === "/masters/companies") return Promise.resolve(MY_COMPANIES);
    if (path.startsWith("/masters/locations")) {
      const id = new URL(path, "http://x").searchParams.get("company_id");
      return Promise.resolve(id === "2" ? [] : [{ id: 1, code: "HO", name: "Head Office" }, { id: 2, code: "WH1", name: "Warehouse 1" }]);
    }
    if (path === "/masters/departments") return Promise.resolve([{ id: 3, name: "IT" }]);
    if (/^\/asset-users\/\d+\/company-access$/.test(path)) return Promise.resolve({ company_ids: [] });
    return Promise.resolve([]);
  });
}

function loginAs(caps: Capabilities, opts: { owner?: boolean; me?: number } = {}) {
  CAPS = caps;
  useAuthStore.getState().setAuth({
    accessToken: "tok", role: caps.role, companyId: 1, isPrimaryOwner: opts.owner ?? caps.is_head_office_admin,
    mustChangePassword: false, assetUserId: opts.me ?? 500,
  });
}

function renderPeople(kind: PeopleKind, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(<QueryClientProvider client={qc}><PeopleScreen kind={kind} /></QueryClientProvider>);
  return qc;
}

async function pick(label: string | RegExp, option: string | RegExp, within_: HTMLElement | Document = document) {
  const root = within_ === document ? screen : within(within_ as HTMLElement);
  const box = root.getByRole("combobox", { name: label });
  fireEvent.click(box);
  fireEvent.click(await screen.findByRole("option", { name: option }));
  await waitFor(() => expect(box).toHaveAttribute("aria-expanded", "false"));
  await new Promise((r) => setTimeout(r, 0));
}

const getPageCalls = () => (apiClient.getPage as any).mock.calls.map((c: unknown[]) => String(c[0]));
const RAW = /\b(EMPLOYEE|STOCK_POINT|INSTALLED|SELF_SERVICE|OPERATOR|VIEWER|NON_IT)\b|Holder|Asset User/;

beforeEach(() => {
  vi.clearAllMocks();
  ROWS = [ANKUR, PRIYA, RAVI, LAM, SPR, HOSTOCK, SERVER_ROOM];
  MY_COMPANIES = [{ id: 1, code: "CKS", name: "Citykart Stores" }];
  loginAs(ADMIN_BOTH);
  mockApi();
});
afterEach(() => useAuthStore.getState().logout());

// ---------------------------------------------------------------------------

describe("People & Places lists on GET /api/people", () => {
  it("Employees: server list, plain words for access and work area, Can sign in / Password set, no raw codes", async () => {
    renderPeople("employees");
    expect(await screen.findByRole("heading", { name: "Employees" })).toBeInTheDocument();
    await screen.findByText("Priya");
    expect(getPageCalls()[0]).toBe("/people?kind=employees&limit=50&offset=0");
    for (const h of ["Employee Code", "Name", "Place", "Department", "Access", "Work area", "Can sign in", "Password set"]) {
      expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
    }
    expect(screen.queryByRole("columnheader", { name: "Company" })).not.toBeInTheDocument();     // one company
    const priya = screen.getByText("Priya").closest("tr") as HTMLElement;
    expect(priya).toHaveTextContent("Can Add & Move Assets");
    expect(priya).toHaveTextContent("IT Team");
    expect(within(priya).getAllByRole("cell").map((c) => c.textContent)).toEqual(expect.arrayContaining(["Yes", "Yes"]));
    const ankur = screen.getByText("Ankur").closest("tr") as HTMLElement;
    expect(within(ankur).getAllByRole("cell").map((c) => c.textContent)).toEqual(expect.arrayContaining(["No", "—"]));
    expect(screen.queryByText("Lucknow Aminabad")).not.toBeInTheDocument();
    expect(screen.getByRole("table").textContent ?? "").not.toMatch(RAW);
  });

  it("search is the server's (debounced q), the company filter shows only for more than one company, and paging uses X-Total-Count", async () => {
    MY_COMPANIES = [{ id: 1, code: "CKS", name: "Citykart Stores" }, { id: 2, code: "CKV", name: "Citykart Ventures" }];
    ROWS = Array.from({ length: 120 }, (_, i) => person({ id: 1000 + i, code: `E${1000 + i}`, name: `Person ${String(i).padStart(3, "0")}` }));
    renderPeople("employees");
    expect(await screen.findByText("Showing 1–50 of 120 employees")).toBeInTheDocument();
    expect(await screen.findByRole("columnheader", { name: "Company" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(getPageCalls()).toContain("/people?kind=employees&limit=50&offset=50"));
    expect(await screen.findByText("Showing 51–100 of 120 employees")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search employees"), { target: { value: "person 11" } });
    await waitFor(() => expect(getPageCalls()).toContain("/people?kind=employees&q=person+11&limit=50&offset=0"));
    await pick("Company", "Citykart Ventures");
    await waitFor(() => expect(getPageCalls()).toContain("/people?kind=employees&q=person+11&company_id=2&limit=50&offset=0"));
    expect(await screen.findByText(/no employees match/i)).toBeInTheDocument();
  });

  it("Stores, Stock Rooms and Install Points have their own columns; places have no login columns or password action", async () => {
    renderPeople("stores");
    await screen.findByText("LAM");
    for (const h of ["Store Code", "Login email", "Can sign in", "Password set"]) expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Issue login passwords…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Store" })).toBeInTheDocument();
  });

  it.each([["stock-rooms", "Stock Rooms", "Stock Room", "HO Stock"], ["install-points", "Install Points", "Install Point", "HO Server Room"]] as const)(
    "%s: a place list (name, code, place) without logins",
    async (kind, title, noun, name) => {
      renderPeople(kind);
      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
      await screen.findByText(name);
      expect(screen.getByRole("columnheader", { name: noun })).toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: "Can sign in" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /issue login passwords/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /reset password/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Add ${noun}` })).toBeInTheDocument();
    },
  );

  it("a head-office admin's row says Head-office Admin and only a head-office admin may change it", async () => {
    ROWS = [ANKUR, OWNER];
    renderPeople("employees");
    const row = (await screen.findByText("Head Office Owner")).closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("Head-office Admin");
    expect(within(row).getByText("Head-office admin only")).toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(canManageAccount({ is_primary_owner: true }, false)).toBe(false);
    expect(canManageAccount({ is_primary_owner: true }, true)).toBe(true);
    expect(canManageAccount({ is_primary_owner: false }, false)).toBe(true);
  });

  it("peopleListPath leaves empty parts out", () => {
    expect(peopleListPath({ kind: "stores" })).toBe("/people?kind=stores&limit=50&offset=0");
    expect(peopleListPath({ kind: "stores", q: " lam ", companyId: 2, page: 2, pageSize: 10 })).toBe("/people?kind=stores&q=lam&company_id=2&limit=10&offset=20");
  });
});

describe("Add Employee (POST /api/people/employees, no type to pick)", () => {
  it("minimal: Code, Name and an existing Place; one company is not asked; no login object", async () => {
    (apiClient.post as any).mockResolvedValue(person({ id: 50, code: "E50", name: "Mohit" }));
    renderPeople("employees");
    await screen.findByText("Ankur");
    fireEvent.click(screen.getByRole("button", { name: "Add Employee" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Employee" });
    expect(within(dialog).queryByRole("combobox", { name: /type/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "Company" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Email")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/employee code/i), { target: { value: "E50" } });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Mohit" } });
    await pick("Place", "Head Office", dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Employee" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/people/employees", { code: "E50", name: "Mohit", company_id: 1, location_id: 1 }));
    expect(await screen.findByRole("status")).toHaveTextContent("Employee E50 · Mohit added.");
  });

  it("a new place is typed by name (the server makes it), with department and phone", async () => {
    (apiClient.post as any).mockResolvedValue(person({ id: 51 }));
    renderPeople("employees");
    await screen.findByText("Ankur");
    fireEvent.click(screen.getByRole("button", { name: "Add Employee" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Employee" });
    fireEvent.change(within(dialog).getByLabelText(/employee code/i), { target: { value: "E51" } });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Neha" } });
    await pick("Place", "A new place (type its name)", dialog);
    fireEvent.change(within(dialog).getByLabelText("New place name"), { target: { value: "Noida Office" } });
    await pick("Department", "IT", dialog);
    fireEvent.change(within(dialog).getByLabelText("Phone"), { target: { value: "98100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Employee" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/people/employees", {
      code: "E51", name: "Neha", company_id: 1, location_name: "Noida Office", department_id: 3, phone: "98100",
    }));
  });

  it("Can sign in reveals Email, Access level (Own Assets Only by default, plain words), Work Area (not for Own Assets Only) and extra companies: one login object", async () => {
    loginAs(HEAD_OFFICE);
    MY_COMPANIES = [{ id: 1, code: "CKS", name: "Citykart Stores" }, { id: 2, code: "CKV", name: "Citykart Ventures" }];
    (apiClient.post as any).mockResolvedValue(person({ id: 52, login_enabled: true }));
    renderPeople("employees");
    await screen.findByText("Ankur");
    fireEvent.click(screen.getByRole("button", { name: "Add Employee" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Employee" });
    fireEvent.change(within(dialog).getByLabelText(/employee code/i), { target: { value: "E52" } });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Meera" } });
    await pick("Company", "Citykart Stores", dialog);
    await pick("Place", "Head Office", dialog);
    fireEvent.click(within(dialog).getByRole("switch", { name: "Can sign in to CKAM" }));
    expect(within(dialog).getByRole("combobox", { name: "Access level" })).toHaveTextContent("Own Assets Only");
    expect(within(dialog).queryByRole("combobox", { name: "Work Area" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Add Employee" })).toBeDisabled();       // email needed
    fireEvent.change(within(dialog).getByLabelText(/^email/i), { target: { value: "meera@citykart.in" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Access level" }));
    for (const name of ["Full Admin", "Can Add & Move Assets", "View Only", "Own Assets Only"]) {
      expect(await screen.findByRole("option", { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("option", { name: "Can Add & Move Assets" }));
    fireEvent.click(await within(dialog).findByRole("combobox", { name: "Work Area" }));
    for (const name of ["IT Team", "Admin / Non-IT Team", "Both"]) expect(await screen.findByRole("option", { name })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "IT Team" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Citykart Ventures" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Employee" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/people/employees", {
      code: "E52", name: "Meera", company_id: 1, location_id: 1, email: "meera@citykart.in",
      login: { enabled: true, role: "OPERATOR", work_area: "IT", extra_company_ids: [2] },
    }));
    expect(await screen.findByRole("status")).toHaveTextContent(/no password yet/i);
  });

  it("the server's refusal (work-area widening) is shown word for word and the form stays open", async () => {
    const sentence = "You handle only IT work, so you cannot give anyone a wider work area than your own. Set their work area to IT, or ask the head-office admin.";
    (apiClient.post as any).mockRejectedValue(new ApiError(sentence, 403));
    renderPeople("employees");
    await screen.findByText("Ankur");
    fireEvent.click(screen.getByRole("button", { name: "Add Employee" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Employee" });
    fireEvent.change(within(dialog).getByLabelText(/employee code/i), { target: { value: "E53" } });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Ritu" } });
    await pick("Place", "Head Office", dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Employee" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(sentence);
    expect(screen.getByRole("dialog", { name: "Add Employee" })).toBeInTheDocument();
  });

  it("employeeBody: a Own Assets Only login sends no work area; extra companies never include the own one", () => {
    const base = {
      code: " E9 ", name: " A ", companyId: "1", place: { pick: "1", newName: "" }, departmentId: "", phone: "",
      canSignIn: true, email: "a@b.in", role: "SELF_SERVICE", workArea: "IT", extraCompanies: [1, 2],
    };
    expect(employeeBody(base)).toEqual({
      code: "E9", name: "A", company_id: 1, location_id: 1, email: "a@b.in",
      login: { enabled: true, role: "SELF_SERVICE", extra_company_ids: [2] },
    });
  });
});

describe("Add Store: store + its Stock Room + its Install Point in ONE action (idempotent)", () => {
  const ROOM = (code: string, name: string, kind: string) => person({ id: 0, kind, code, name, location_name: "Lucknow Aminabad" });

  it("checks the code like the server, sends one request, and says plainly what was created", async () => {
    (apiClient.post as any).mockResolvedValue({
      store: { ...LAM, id: 70 }, stock_room: ROOM("STK-LAM", "Lucknow Aminabad Stock Room", "STOCK_POINT"),
      install_point: ROOM("INS-LAM", "Lucknow Aminabad Install Point", "INSTALLED"),
      created: ["store", "stock_room", "install_point"], reused: [], problems: [],
    });
    renderPeople("stores");
    await screen.findByText("SPR2");
    fireEvent.click(screen.getByRole("button", { name: "Add Store" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Store" });
    fireEvent.change(within(dialog).getByLabelText(/^code/i), { target: { value: "l1" } });
    expect(within(dialog).getByText("A store code has three letters and at most one more letter or digit (for example LAM or SPR2).")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^code/i), { target: { value: "lam" } });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Lucknow Aminabad" } });
    expect(within(dialog).getByRole("combobox", { name: "Place" })).toHaveTextContent("The store's own place (made for you)");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Store" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/people/stores", { code: "LAM", name: "Lucknow Aminabad", company_id: 1 }));
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    const result = await within(dialog).findByTestId("store-result");
    expect(within(result).getByRole("status")).toHaveTextContent("Store LAM, its Stock Room and its Install Point were created.");
    const records = within(result).getByRole("list", { name: "The store's records" });
    expect(records).toHaveTextContent("STK-LAM");
    expect(records).toHaveTextContent("INS-LAM");
    expect(result).toHaveTextContent(/no password yet/i);
  });

  it("running it again creates nothing new and says so", async () => {
    (apiClient.post as any).mockResolvedValue({
      store: LAM, stock_room: ROOM("STK-LAM", "Lucknow Aminabad Stock Room", "STOCK_POINT"),
      install_point: ROOM("INS-LAM", "Lucknow Aminabad Install Point", "INSTALLED"),
      created: [], reused: ["store", "stock_room", "install_point"], problems: [],
    });
    renderPeople("stores");
    await screen.findByText("SPR2");
    fireEvent.click(screen.getByRole("button", { name: "Add Store" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Store" });
    fireEvent.change(within(dialog).getByLabelText(/^code/i), { target: { value: "LAM" } });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Lucknow Aminabad" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Store" }));
    expect(await within(dialog).findByText("Store LAM, its Stock Room and its Install Point already existed. Nothing new was added.")).toBeInTheDocument();
  });

  it("a refusal (a room code taken by something else) is shown as written; nothing is kept", async () => {
    const sentence = "The code INS-LAM is already used by Wrong kind, so the install point of store LAM was not made.";
    (apiClient.post as any).mockRejectedValue(new ApiError(sentence, 422));
    renderPeople("stores");
    await screen.findByText("SPR2");
    fireEvent.click(screen.getByRole("button", { name: "Add Store" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Store" });
    fireEvent.change(within(dialog).getByLabelText(/^code/i), { target: { value: "LAM" } });
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Lucknow Aminabad" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Store" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(sentence);
  });

  it("storeResultSentence: every mix in plain words", () => {
    expect(storeResultSentence("LAM", ["stock_room", "install_point"], ["store"])).toBe("Store LAM already existed. Its Stock Room and its Install Point were created.");
    expect(storeResultSentence("LAM", ["install_point"], ["store", "stock_room"])).toBe("Store LAM and its Stock Room already existed. Its Install Point was created.");
    expect(storeResultSentence("LAM", ["store", "stock_room"], ["install_point"])).toBe("Store LAM and its Stock Room were created. Its Install Point already existed.");
  });
});

describe("Add Stock Room / Add Install Point (name, company, place)", () => {
  it("Add Install Point posts to /people/install-points; an existing name is picked and said so", async () => {
    (apiClient.post as any).mockResolvedValue({ ...SERVER_ROOM, created: false });
    renderPeople("install-points");
    await screen.findByText("HO Server Room");
    fireEvent.click(screen.getByRole("button", { name: "Add Install Point" }));
    const dialog = await screen.findByRole("dialog", { name: "New Install Point" });
    await waitFor(() => expect(within(dialog).getByLabelText(/^company/i)).toHaveTextContent("Citykart Stores"));
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "HO Server Room" } });
    fireEvent.click(within(dialog).getByLabelText(/^place/i));
    fireEvent.click(await screen.findByRole("option", { name: "Head Office" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/people/install-points", { name: "HO Server Room", company_id: 1, location_id: 1 }));
    expect(await screen.findByRole("status")).toHaveTextContent("HO Server Room already existed; nothing new was added.");
  });

  it("Add Stock Room is the same quick-create as everywhere else (POST /stock-rooms)", async () => {
    (apiClient.post as any).mockResolvedValue({ ...HOSTOCK, id: 21, name: "Farukhnagar Stock", created: true });
    renderPeople("stock-rooms");
    await screen.findByText("HO Stock");
    fireEvent.click(screen.getByRole("button", { name: "Add Stock Room" }));
    const dialog = await screen.findByRole("dialog", { name: "New Stock Room" });
    await waitFor(() => expect(within(dialog).getByLabelText(/^company/i)).toHaveTextContent("Citykart Stores"));
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Farukhnagar Stock" } });
    fireEvent.click(within(dialog).getByLabelText(/^place/i));
    fireEvent.click(await screen.findByRole("option", { name: "A new place (type its name)" }));
    fireEvent.change(within(dialog).getByLabelText(/new place name/i), { target: { value: "Farukhnagar" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/stock-rooms", { name: "Farukhnagar Stock", company_id: 1, location_name: "Farukhnagar" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Stock Room Farukhnagar Stock added.");
  });
});

describe("Edit, deactivate, company access, reset password (existing endpoints)", () => {
  it("Edit sends only what changed (PUT /asset-users/{id}); a work area nobody touched is never sent", async () => {
    (apiClient.put as any).mockResolvedValue(PRIYA);
    renderPeople("employees");
    await screen.findByText("Priya");
    fireEvent.click(screen.getByRole("button", { name: "Edit Priya" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Employee" });
    expect(within(dialog).getByLabelText(/employee code/i)).toHaveValue("E2");
    expect(within(dialog).getByRole("combobox", { name: "Work Area" })).toHaveTextContent("IT Team");
    fireEvent.change(within(dialog).getByLabelText(/^name/i), { target: { value: "Priya S" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/asset-users/2", { name: "Priya S" }));
  });

  it("a role change warns in plain words; a changed work area is sent", async () => {
    (apiClient.put as any).mockResolvedValue(PRIYA);
    renderPeople("employees");
    await screen.findByText("Priya");
    fireEvent.click(screen.getByRole("button", { name: "Edit Priya" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Employee" });
    expect(dialog).toHaveTextContent("Current access: Can Add & Move Assets.");
    await pick("Access level", "View Only", dialog);
    expect(within(dialog).getByText(/from can add & move assets to view only will immediately change/i)).toBeInTheDocument();
    await pick("Work Area", "Both", dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/asset-users/2", { role: "VIEWER", allowed_asset_domains: "BOTH" }));
  });

  it("S6: a one-area admin sees the login controls of a wider person disabled, with the reason (other details stay editable)", async () => {
    loginAs(ADMIN_IT);
    renderPeople("employees");
    await screen.findByText("Ravi");
    fireEvent.click(screen.getByRole("button", { name: "Edit Ravi" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Employee" });
    expect(within(dialog).getByRole("switch", { name: "Can sign in to CKAM" })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Access level" })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Work Area" })).toBeDisabled();
    expect(within(dialog).getByRole("note")).toHaveTextContent("Ravi works in a wider work area than yours");
    expect(within(dialog).getByLabelText(/^name/i)).toBeEnabled();
    // The same person's IT-only colleague is not locked.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Priya" }));
    const again = await screen.findByRole("dialog", { name: "Edit Employee" });
    expect(within(again).getByRole("switch", { name: "Can sign in to CKAM" })).toBeEnabled();
  });

  it("the server's refusal is shown in the edit form", async () => {
    const sentence = "Ravi works in a wider work area than yours (you handle only IT work), so you cannot change their login, access level or work area. Ask the head-office admin.";
    (apiClient.put as any).mockRejectedValue(new ApiError(sentence, 403));
    renderPeople("employees");
    await screen.findByText("Ravi");
    fireEvent.click(screen.getByRole("button", { name: "Edit Ravi" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Employee" });
    await pick("Access level", "Full Admin", dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(sentence)).toBeInTheDocument();
  });

  it("a refused deactivation shows the 'still holds N assets' sentence and keeps the dialog open", async () => {
    const sentence = "Ankur still holds 3 assets. Move them to someone else or back to a stock room first, then deactivate.";
    (apiClient.delete as any).mockRejectedValue(new ApiError(sentence, 422));
    renderPeople("employees");
    await screen.findByText("Ankur");
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Ankur" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/history is kept/i);
    expect(dialog.textContent ?? "").not.toMatch(/restored|reversed/i);
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(sentence);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("several are deactivated after one confirmation; a refused one stays ticked with its reason", async () => {
    (apiClient.delete as any).mockImplementation((path: string) =>
      path.endsWith("/3") ? Promise.reject(new ApiError("Ravi still holds 1 asset.", 422)) : Promise.resolve(undefined));
    renderPeople("employees");
    await screen.findByText("Ankur");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ankur" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ravi" }));
    fireEvent.click(screen.getByRole("button", { name: "Deactivate 2 selected" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/asset-users/1"));
    expect(apiClient.delete).toHaveBeenCalledWith("/asset-users/3");
    expect(await screen.findByRole("alert", { name: /could not deactivate/i })).toHaveTextContent("Ravi: Ravi still holds 1 asset.");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("company access: own company implicit, others ticked and saved", async () => {
    MY_COMPANIES = [{ id: 1, code: "CKS", name: "Citykart Stores" }, { id: 2, code: "CKV", name: "Citykart Ventures" }];
    (apiClient.post as any).mockResolvedValue(undefined);
    renderPeople("employees");
    await screen.findByText("Priya");
    fireEvent.click(screen.getByRole("button", { name: "Company access for Priya" }));
    const dialog = await screen.findByRole("dialog", { name: /company access/i });
    await waitFor(() => expect(within(dialog).queryByText(/loading/i)).not.toBeInTheDocument());
    expect(within(dialog).queryByRole("checkbox", { name: "Citykart Stores" })).not.toBeInTheDocument();
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "Citykart Ventures" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/asset-users/2/company-access", { company_ids: [2] }));
  });

  it("Reset password shows the temporary password once and forgets it on close", async () => {
    (apiClient.post as any).mockResolvedValue({ temp_password: "abc123XYZ" });
    renderPeople("employees");
    await screen.findByText("Priya");
    fireEvent.click(screen.getByRole("button", { name: "Reset password for Priya" }));
    expect(await screen.findByText("abc123XYZ")).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith("/asset-users/2/reset-password");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText("abc123XYZ")).not.toBeInTheDocument());
  });

  it("editBody / draftFrom / isWiderThanMine", () => {
    const d = draftFrom(PRIYA);
    expect(editBody(PRIYA, d, "employees")).toEqual({});
    expect(editBody(PRIYA, { ...d, loginEnabled: false }, "employees")).toEqual({ login_enabled: false, role: "SELF_SERVICE" });
    expect(editBody(LAM, { ...draftFrom(LAM), code: "XYZ", email: "x@y.in" }, "stores")).toEqual({ email: "x@y.in" });
    expect(isWiderThanMine("BOTH", ["IT"])).toBe(true);
    expect(isWiderThanMine("IT", ["IT"])).toBe(false);
    expect(isWiderThanMine(null, ["IT"])).toBe(false);
  });
});

describe("Issue login passwords (one bulk action, shown once, never kept)", () => {
  const ISSUED = [
    { asset_user_id: 7, code: "LAM", name: "Lucknow Aminabad", email: "sm.lam@citykartstores.com", temp_password: "Pw-LAM-9x2Q" },
    { asset_user_id: 8, code: "SPR2", name: "Spring Road", email: "sm.spr2@citykartstores.com", temp_password: "Pw-SPR-7k1Z" },
  ];

  it("ticked stores → confirmation → one request → one-time list with Copy all and Download CSV; nothing survives closing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const blobs: Blob[] = [];
    window.URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return "blob:csv"; }) as any;
    window.URL.revokeObjectURL = vi.fn();
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "debug")];
    const before = window.location.href;
    (apiClient.post as any).mockResolvedValue(ISSUED);

    const qc = renderPeople("stores");
    await screen.findByText("LAM");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Lucknow Aminabad" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Spring Road" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Issue login passwords…" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Issue login passwords" });
    expect(within(dialog).getByRole("radio", { name: "The ticked accounts" })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(within(dialog).getByTestId("issue-confirm")).toHaveTextContent("This sets a temporary password for 2 accounts; each person must change it at first sign-in.");
    expect(dialog).toHaveTextContent("1 of them already has a password; it is replaced.");
    expect(apiClient.post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue 2 passwords" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/asset-users/issue-passwords", { asset_user_ids: [7, 8], only_without_password: false }));

    const table = await within(dialog).findByRole("table", { name: "Temporary passwords" });
    expect(within(table).getAllByRole("row").map((r) => r.textContent)).toEqual([
      "CodeNameEmailTemporary password",
      "LAMLucknow Aminabadsm.lam@citykartstores.comPw-LAM-9x2Q",
      "SPR2Spring Roadsm.spr2@citykartstores.comPw-SPR-7k1Z",
    ]);
    expect(within(dialog).getByRole("note")).toHaveTextContent(/shown only once/i);
    expect(within(dialog).getByRole("note")).toHaveTextContent(/hand each password over securely/i);

    fireEvent.click(within(dialog).getByRole("button", { name: "Copy all" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(passwordsText(ISSUED)));
    fireEvent.click(within(dialog).getByRole("button", { name: "Download CSV" }));
    expect(blobs).toHaveLength(1);
    expect(await blobs[0].text()).toBe(passwordsCsv(ISSUED));

    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Nothing of the list is kept: not on the page, not in React Query, not in storage, not in the URL or the console.
    for (const { temp_password: pw } of ISSUED) {
      expect(document.body.textContent).not.toContain(pw);
      expect(JSON.stringify(qc.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(pw);
      expect(JSON.stringify(qc.getMutationCache().getAll().map((m) => m.state.data))).not.toContain(pw);
      expect(JSON.stringify({ ...window.localStorage })).not.toContain(pw);
      expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(pw);
      for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(pw);
    }
    expect(window.location.href).toBe(before);
    // Opened again, it starts fresh.
    fireEvent.click(screen.getAllByRole("button", { name: "Issue login passwords…" })[0]);
    const fresh = await screen.findByRole("dialog", { name: "Issue login passwords" });
    expect(within(fresh).queryByRole("table", { name: "Temporary passwords" })).not.toBeInTheDocument();
    logs.forEach((s) => s.mockRestore());
  });

  it("every store without a password (counted first), in the chosen company", async () => {
    MY_COMPANIES = [{ id: 1, code: "CKS", name: "Citykart Stores" }, { id: 2, code: "CKV", name: "Citykart Ventures" }];
    (apiClient.post as any).mockResolvedValue([ISSUED[0]]);
    renderPeople("stores");
    await screen.findByText("LAM");
    await screen.findByRole("combobox", { name: "Company" });
    await pick("Company", "Citykart Stores");
    fireEvent.click(screen.getByRole("button", { name: "Issue login passwords…" }));
    const dialog = await screen.findByRole("dialog", { name: "Issue login passwords" });
    expect(within(dialog).getByRole("radio", { name: "The ticked accounts" })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: "Every store without a password" })).toBeChecked();
    expect(await within(dialog).findByText(/Every store without a password in Citykart Stores \(1\)/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(within(dialog).getByTestId("issue-confirm")).toHaveTextContent(issueConfirmSentence(1));
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue 1 password" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/asset-users/issue-passwords", { kind: "stores", only_without_password: true, company_id: 1 }));
    expect(await within(dialog).findByText("Pw-LAM-9x2Q")).toBeInTheDocument();
  });

  it("a refusal (more than 500) is shown word for word and nothing is listed", async () => {
    const sentence = "That is 501 accounts; at most 500 can be given a password at a time. Choose a company, or pick the accounts.";
    (apiClient.post as any).mockRejectedValue(new ApiError(sentence, 422));
    renderPeople("employees");
    await screen.findByText("Ravi");
    fireEvent.click(screen.getByRole("button", { name: "Issue login passwords…" }));
    const dialog = await screen.findByRole("dialog", { name: "Issue login passwords" });
    await within(dialog).findByText(/Every employee without a password \(1\)/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue 1 password" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(sentence);
    expect(within(dialog).queryByRole("table")).not.toBeInTheDocument();
  });

  it("passwordsCsv quotes what needs quoting", () => {
    expect(passwordsCsv([{ asset_user_id: 1, code: "A", name: "Rao, K", email: null, temp_password: 'p"w' }]))
      .toBe('Code,Name,Email,Temporary password\r\nA,"Rao, K",,"p""w"\r\n');
  });
});

describe("Stores: head-office extras", () => {
  it("Create missing rooms for existing stores: head-office admin only; shows the counts and the problems", async () => {
    (apiClient.post as any).mockResolvedValue({
      stores_checked: 212, stores_completed: 200, already_complete: 11, stock_rooms_created: 200, install_points_created: 199,
      problems: [{ store_code: "CCC", company_code: "CKS", message: "The code INS-CCC is already used by Wrong kind, so the install point of store CCC was not made." }],
    });
    renderPeople("stores");
    await screen.findByText("LAM");
    expect(screen.queryByRole("button", { name: /create missing rooms/i })).not.toBeInTheDocument();
    document.body.innerHTML = "";

    loginAs(HEAD_OFFICE);
    renderPeople("stores");
    fireEvent.click(await screen.findByRole("button", { name: "Create missing rooms for existing stores" }));
    const dialog = await screen.findByRole("dialog", { name: /create missing rooms/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create missing rooms" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/people/stores/ensure-rooms"));
    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "212 stores checked: 200 given their missing rooms, 11 already complete. 200 stock rooms and 199 install points created.",
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent("CCC · CKS: The code INS-CCC is already used by Wrong kind");
    expect(ensureRoomsSentence({ stores_checked: 1, stores_completed: 0, already_complete: 1, stock_rooms_created: 0, install_points_created: 0, problems: [] }))
      .toBe("1 store checked: 0 given their missing rooms, 1 already complete. Nothing new was created.");
  });
});
