import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { apiClient } from "./lib/api-client";
import { useAuthStore } from "./lib/auth-store";
import { LoginForm } from "./routes/login";

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

interface LoginResponse {
  access_token: string;
  must_change_password: boolean;
  role: string;
  company_id: number;
}

// A HOLDER lands on their own read-only asset list; everyone else lands on the
// operational dashboard. Used both right after login and to bounce an already
// authenticated visitor away from /login.
function landingPathFor(role: string | null): string {
  return role === "HOLDER" ? "/my-assets" : "/dashboard";
}

function LoginPage() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();
  // Real company list, fetched from the (deliberately unauthenticated) /auth/companies
  // endpoint -- replaces the single hard-coded company id 1 this screen used to ship
  // with (see that endpoint's own docstring for why it's safe to expose without auth).
  const { data: companies = [] } = useQuery({
    queryKey: ["auth", "companies"],
    queryFn: () => apiClient.get<CompanyOption[]>("/auth/companies"),
  });

  async function handleLogin(values: { companyId: number; empCode: string; password: string }) {
    const result = await apiClient.post<LoginResponse>("/auth/login", {
      company_id: values.companyId,
      emp_code: values.empCode,
      password: values.password,
    });
    setAuth({
      accessToken: result.access_token,
      role: result.role,
      companyId: result.company_id,
      mustChangePassword: result.must_change_password,
    });
    await navigate({ to: landingPathFor(result.role) });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <img src="/logo.webp" alt="CityKart Asset Management" className="h-20 w-auto" />
      {companies.length > 0 && <LoginForm companies={companies} onSubmit={handleLogin} />}
    </main>
  );
}

function AppShell() {
  const role = useAuthStore((s) => s.role);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  async function handleLogout() {
    logout();
    await navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <nav className="flex items-center gap-4 text-sm font-medium">
          {role !== "HOLDER" && (
            <>
              <Link to="/dashboard" className="hover:underline">
                Dashboard
              </Link>
              <Link to="/assets" className="hover:underline">
                Assets
              </Link>
              <Link to="/assets/new" className="hover:underline">
                Add Asset
              </Link>
            </>
          )}
          <Link to="/my-assets" className="hover:underline">
            My Assets
          </Link>
        </nav>
        <Button variant="outline" onClick={handleLogout}>
          Log out
        </Button>
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
    const { accessToken, role } = useAuthStore.getState();
    throw redirect({ to: accessToken ? landingPathFor(role) : "/login" });
  },
});

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: () => {
    const { accessToken, role } = useAuthStore.getState();
    if (accessToken) {
      throw redirect({ to: landingPathFor(role) });
    }
  },
  component: LoginPage,
});

// Pathless layout route: everything nested under it requires a live session, and
// shares the nav/logout shell above. Mirrors the auth gate every screen component
// already assumes (role-based hiding inside AssetDetail.tsx etc.) but at the routing
// layer, which -- until this task -- did not exist anywhere in the app (App.tsx used
// to render LoginPage unconditionally; see this task's report for details).
export const authedLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_authed",
  beforeLoad: () => {
    const { accessToken } = useAuthStore.getState();
    if (!accessToken) {
      throw redirect({ to: "/login" });
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

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
