import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  type RouterHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiClient } from "./lib/api-client";
import { applySession, logoutSession, safeNextPath, type SessionPayload } from "./lib/auth-fetch";
import { useAuthStore } from "./lib/auth-store";
import { LoginForm } from "./routes/login";
import { ChangePasswordForm, type ChangePasswordValues } from "./routes/change-password";

import DashboardRoute from "./routes/dashboard";
import MyAssetsRoute from "./routes/my-assets";
import AssetsIndexRoute from "./routes/assets/index";
import NewAssetRoute from "./routes/assets/new";
import AssetDetailRoute from "./routes/assets/$id";
import ImportRoute from "./routes/import";
import ReportsRoute from "./routes/reports";
import CompaniesSetup from "./routes/setup/companies";
import LocationsSetup from "./routes/setup/locations";
import DepartmentsSetup from "./routes/setup/departments";
import CostCentersSetup from "./routes/setup/cost-centers";
import CategoriesSetup from "./routes/setup/categories";
import SubcategoriesSetup from "./routes/setup/subcategories";
import VendorsSetup from "./routes/setup/vendors";
import CustomFieldsSetup from "./routes/setup/custom-fields";
import HoldersSetup from "./routes/setup/holders";
import CodeRuleSetup from "./routes/setup/code-rule";

interface CompanyOption {
  id: number;
  name: string;
}

/** `?next=<in-app path>`: where to go after login / the forced password change
 * (e.g. the asset page a QR label pointed at before the user was logged in). */
interface NextSearch {
  next?: string;
}

function validateNextSearch(search: Record<string, unknown>): NextSearch {
  return { next: safeNextPath(search.next) };
}

// A HOLDER lands on their own read-only asset list; everyone else lands on the
// operational dashboard. Used both right after login and to bounce an already
// authenticated visitor away from /login.
function landingPathFor(role: string | null): string {
  return role === "HOLDER" ? "/my-assets" : "/dashboard";
}

function destinationAfterAuth(role: string | null, next: string | undefined): string {
  return safeNextPath(next) ?? landingPathFor(role);
}

// Spec §6 "Roles and access".
const WRITE_ROLES = ["ADMIN", "IT_TEAM"];
const REPORT_ROLES = ["ADMIN", "IT_TEAM", "VIEWER"];

// "Setup lists" -- IT_TEAM may manage masters but not users/roles/code rule (§6).
const MASTER_SETUP_LINKS = [
  { to: "/setup/companies", label: "Companies" },
  { to: "/setup/locations", label: "Locations" },
  { to: "/setup/departments", label: "Departments" },
  { to: "/setup/cost-centers", label: "Cost Centers" },
  { to: "/setup/categories", label: "Categories" },
  { to: "/setup/subcategories", label: "Sub-Categories" },
  { to: "/setup/vendors", label: "Vendors" },
  { to: "/setup/custom-fields", label: "Custom Fields" },
] as const;
const ADMIN_SETUP_LINKS = [
  { to: "/setup/holders", label: "Holders & Users" },
  { to: "/setup/code-rule", label: "Code Rule" },
] as const;

function LoginPage() {
  const { next } = loginRoute.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  // Real company list, fetched from the (deliberately unauthenticated) /auth/companies
  // endpoint -- replaces the single hard-coded company id 1 this screen used to ship
  // with (see that endpoint's own docstring for why it's safe to expose without auth).
  const { data: companies = [] } = useQuery({
    queryKey: ["auth", "companies"],
    queryFn: () => apiClient.get<CompanyOption[]>("/auth/companies"),
  });

  async function handleLogin(values: { companyId: number; loginId: string; password: string }) {
    const result = await apiClient.post<SessionPayload>("/auth/login", {
      company_id: values.companyId,
      login_id: values.loginId,
      password: values.password,
    });
    applySession(result);
    if (result.must_change_password) {
      // Forced first-login change: nothing else is reachable until it's done
      // (enforced here by the route guards and server-side by a 403 on every API).
      await navigate({ to: "/change-password", search: { next } });
      return;
    }
    // Back to the page that sent us here (e.g. a scanned QR label's asset), if any.
    router.history.push(destinationAfterAuth(result.role, next));
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <img src="/logo.webp" alt="CityKart Asset Management" className="h-20 w-auto" />
      {companies.length > 0 && <LoginForm companies={companies} onSubmit={handleLogin} />}
    </main>
  );
}

function ChangePasswordPage() {
  const { next } = changePasswordRoute.useSearch();
  const required = useAuthStore((s) => s.mustChangePassword);
  const navigate = useNavigate();
  const router = useRouter();

  async function handleSubmit(values: ChangePasswordValues) {
    await apiClient.post("/auth/change-password", {
      old_password: values.oldPassword,
      new_password: values.newPassword,
    });
    const s = useAuthStore.getState();
    if (s.accessToken && s.role !== null && s.companyId !== null) {
      s.setAuth({ accessToken: s.accessToken, role: s.role, companyId: s.companyId, mustChangePassword: false });
    }
    router.history.push(destinationAfterAuth(s.role, next));
  }

  async function handleLogout() {
    await logoutSession();
    await navigate({ to: "/login" });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <img src="/logo.webp" alt="CityKart Asset Management" className="h-20 w-auto" />
      <ChangePasswordForm required={required} onSubmit={handleSubmit} />
      <Button variant="outline" onClick={handleLogout}>
        Log out
      </Button>
    </main>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="hover:underline" activeProps={{ className: "underline" }}>
      {children}
    </Link>
  );
}

function SetupMenu({ role }: { role: string | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 hover:underline">
        Setup <ChevronDown className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Masters</DropdownMenuLabel>
        {MASTER_SETUP_LINKS.map((l) => (
          <DropdownMenuItem key={l.to} asChild>
            <Link to={l.to}>{l.label}</Link>
          </DropdownMenuItem>
        ))}
        {role === "ADMIN" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Administration</DropdownMenuLabel>
            {ADMIN_SETUP_LINKS.map((l) => (
              <DropdownMenuItem key={l.to} asChild>
                <Link to={l.to}>{l.label}</Link>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell() {
  const role = useAuthStore((s) => s.role);
  const navigate = useNavigate();
  const canWrite = role !== null && WRITE_ROLES.includes(role);
  const canReport = role !== null && REPORT_ROLES.includes(role);

  async function handleLogout() {
    await logoutSession();
    await navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium">
          {canReport && <NavLink to="/dashboard">Dashboard</NavLink>}
          {canReport && <NavLink to="/assets">Assets</NavLink>}
          {canWrite && <NavLink to="/assets/new">Add Asset</NavLink>}
          {canWrite && <NavLink to="/import">Import</NavLink>}
          {canReport && <NavLink to="/reports">Reports</NavLink>}
          {canWrite && <SetupMenu role={role} />}
          <NavLink to="/my-assets">My Assets</NavLink>
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/change-password" className="text-sm hover:underline">
            Change password
          </Link>
          <Button variant="outline" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </header>
      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    const { accessToken, role, mustChangePassword } = useAuthStore.getState();
    if (!accessToken) throw redirect({ to: "/login" });
    throw redirect({ to: mustChangePassword ? "/change-password" : landingPathFor(role) });
  },
});

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: validateNextSearch,
  beforeLoad: ({ search }) => {
    const { accessToken, role, mustChangePassword } = useAuthStore.getState();
    if (accessToken) {
      if (mustChangePassword) throw redirect({ to: "/change-password", search: { next: search.next } });
      throw redirect({ href: destinationAfterAuth(role, search.next) });
    }
  },
  component: LoginPage,
});

// Outside the AppShell layout on purpose: while a password change is required,
// no nav to the rest of the app is shown at all.
export const changePasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/change-password",
  validateSearch: validateNextSearch,
  beforeLoad: () => {
    if (!useAuthStore.getState().accessToken) {
      throw redirect({ to: "/login", search: { next: undefined } });
    }
  },
  component: ChangePasswordPage,
});

// Pathless layout route: everything nested under it requires a live session whose
// password isn't pending a forced change, and shares the nav/logout shell above.
// An unauthenticated visitor (e.g. someone who just scanned a QR label) is sent to
// /login with the page they wanted in `?next=`, and returned there after login.
// The server enforces the same rules independently (401 / 403 on every API call).
export const authedLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_authed",
  beforeLoad: ({ location }) => {
    const { accessToken, mustChangePassword } = useAuthStore.getState();
    if (!accessToken) {
      throw redirect({ to: "/login", search: { next: safeNextPath(location.href) } });
    }
    if (mustChangePassword) {
      throw redirect({ to: "/change-password", search: { next: safeNextPath(location.href) } });
    }
  },
  component: AppShell,
});

export const dashboardRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/dashboard",
  component: DashboardRoute,
});

export const assetsIndexRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/assets",
  component: AssetsIndexRoute,
});

export const assetsNewRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/assets/new",
  component: NewAssetRoute,
});

export const assetDetailRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/assets/$id",
  component: function AssetDetailComponent() {
    const { id } = assetDetailRoute.useParams();
    return <AssetDetailRoute params={{ id }} />;
  },
});

export const myAssetsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/my-assets",
  component: MyAssetsRoute,
});

export const importRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/import",
  component: ImportRoute,
});

export const reportsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/reports",
  component: ReportsRoute,
});

export const setupCompaniesRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/companies",
  component: CompaniesSetup,
});

export const setupLocationsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/locations",
  component: LocationsSetup,
});

export const setupDepartmentsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/departments",
  component: DepartmentsSetup,
});

export const setupCostCentersRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/cost-centers",
  component: CostCentersSetup,
});

export const setupCategoriesRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/categories",
  component: CategoriesSetup,
});

export const setupSubcategoriesRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/subcategories",
  component: SubcategoriesSetup,
});

export const setupVendorsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/vendors",
  component: VendorsSetup,
});

export const setupCustomFieldsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/custom-fields",
  component: CustomFieldsSetup,
});

export const setupHoldersRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/holders",
  component: HoldersSetup,
});

export const setupCodeRuleRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/code-rule",
  component: CodeRuleSetup,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  changePasswordRoute,
  authedLayoutRoute.addChildren([
    dashboardRoute,
    assetsIndexRoute,
    assetsNewRoute,
    assetDetailRoute,
    myAssetsRoute,
    importRoute,
    reportsRoute,
    setupCompaniesRoute,
    setupLocationsRoute,
    setupDepartmentsRoute,
    setupCostCentersRoute,
    setupCategoriesRoute,
    setupSubcategoriesRoute,
    setupVendorsRoute,
    setupCustomFieldsRoute,
    setupHoldersRoute,
    setupCodeRuleRoute,
  ]),
]);

/** Factory so tests can drive the real route tree with an in-memory history. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history });
}

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
