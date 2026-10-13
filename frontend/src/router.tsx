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
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppNav } from "@/components/app-shell/AppNav";
import { guarded } from "@/components/app-shell/RouteGuard";
import { apiClient } from "./lib/api-client";
import { applySession, logoutSession, safeNextPath, type SessionPayload } from "./lib/auth-fetch";
import { useAuthStore } from "./lib/auth-store";
import { canUse, currentAccess, homePathFor } from "./lib/access";
import { roleLabel } from "./lib/labels";
import { LoginForm } from "./routes/login";
import { ChangePasswordForm, type ChangePasswordValues } from "./routes/change-password";

import DashboardRoute from "./routes/dashboard";
import MyAssetsRoute from "./routes/my-assets";
import AssetsIndexRoute from "./routes/assets/index";
import NewAssetRoute from "./routes/assets/new";
import SerialPendingRoute from "./routes/assets/serial-pending";
import AssetDetailRoute from "./routes/assets/$id";
import AssetMovementRoute from "./routes/asset-movement";
import PrintLabelsRoute from "./routes/print-labels";
import PurchaseOrdersIndexRoute from "./routes/purchase-orders/index";
import NewPurchaseOrderRoute from "./routes/purchase-orders/new";
import PoFromErpRoute from "./routes/purchase-orders/from-erp";
import PurchaseOrderDetailRoute from "./routes/purchase-orders/$id";
import ImportRoute from "./routes/import";
import ReportsRoute from "./routes/reports";
import CompaniesSetup from "./routes/setup/companies";
import LocationsSetup from "./routes/setup/locations";
import DepartmentsSetup from "./routes/setup/departments";
import CostCentersSetup from "./routes/setup/cost-centers";
import CategoriesSetup from "./routes/setup/categories";
import SubcategoriesSetup from "./routes/setup/subcategories";
import VendorsSetup from "./routes/setup/vendors";
import BrandsSetup from "./routes/setup/brands";
import BundlesSetup from "./routes/setup/bundles";
import ItemsSetup from "./routes/setup/items";
import ErpArticlesSetup from "./routes/setup/erp-articles";
import CustomFieldsSetup from "./routes/setup/custom-fields";
import CodeRuleSetup from "./routes/setup/code-rule";
import ReceiveRoute from "./routes/receive";
import {
  EmployeesRoute,
  InstallPointsRoute,
  StockRoomsRoute,
  StoresRoute,
} from "./routes/people";

/** `?next=<in-app path>`: where to go after login / the forced password change
 * (e.g. the asset page a QR label pointed at before the user was logged in). */
interface NextSearch {
  next?: string;
}

function validateNextSearch(search: Record<string, unknown>): NextSearch {
  return { next: safeNextPath(search.next) };
}

// A SELF_SERVICE login lands on their own read-only asset list; everyone else
// lands on Home. Used both right after login and to bounce an already
// authenticated visitor away from /login.
function destinationAfterAuth(role: string | null, next: string | undefined): string {
  return safeNextPath(next) ?? homePathFor(role);
}

function LoginPage() {
  const { next } = loginRoute.useSearch();
  const navigate = useNavigate();
  const router = useRouter();

  async function handleLogin(values: { loginId: string; password: string }) {
    const result = await apiClient.post<SessionPayload>("/auth/login", {
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-7 bg-muted p-4">
      <img
        src="/logo.png"
        alt="CityKart Asset Management"
        className="h-auto w-64 sm:w-72 md:w-80"
      />
      <div className="flex w-full max-w-md flex-col items-center gap-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Sign in to Citykart Asset Management
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Your company&apos;s Asset Management platform
        </p>
      </div>
      <LoginForm onSubmit={handleLogin} />
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
    if (s.accessToken && s.role !== null) {
      s.setAuth({
        accessToken: s.accessToken, role: s.role, companyId: s.companyId,
        isPrimaryOwner: s.isPrimaryOwner, mustChangePassword: false,
      });
    }
    router.history.push(destinationAfterAuth(s.role, next));
  }

  async function handleLogout() {
    await logoutSession();
    await navigate({ to: "/login" });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-7 p-4">
      <img
        src="/logo.png"
        alt="CityKart Asset Management"
        className="h-auto w-64 sm:w-72 md:w-80"
      />
      <ChangePasswordForm required={required} onSubmit={handleSubmit} />
      <Button variant="outline" onClick={handleLogout}>
        Log out
      </Button>
    </main>
  );
}

function AppShell() {
  const role = useAuthStore((s) => s.role);
  const isPrimaryOwner = useAuthStore((s) => s.isPrimaryOwner);
  const navigate = useNavigate();

  async function handleLogout() {
    await logoutSession();
    await navigate({ to: "/login" });
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full flex-col">
        {/* Light top header, matching the page canvas -- the logo has dark
            navy/red text with no light-colored plate behind it (transparent
            PNG), so it only reads clearly against a light background. Nav
            lives in the sidebar below, not here. */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-3">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <Link to="/" className="flex items-center gap-2 pl-1">
              <img src="/logo.png" alt="" className="h-8 w-auto" />
              <span className="hidden text-sm font-semibold tracking-tight text-foreground sm:inline">
                CityKart Asset Management
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {role && (
              <span className="hidden text-xs text-muted-foreground md:inline" data-testid="session-role">
                {roleLabel(role, isPrimaryOwner)}
              </span>
            )}
            <Link to="/change-password" className="hidden text-muted-foreground hover:text-foreground hover:underline sm:inline">
              Change password
            </Link>
            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-1.5">
              <LogOut className="h-4 w-4" />
              Log out
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <Sidebar collapsible="icon" className="top-14 h-[calc(100svh-3.5rem)]">
            <SidebarContent>
              {/* Role-aware: Home · Work · People & Places · Reports · Settings
                  (head-office admin only, one collapsed group). Hiding a link is
                  UX; the route guards below and the server enforce access. */}
              <AppNav access={{ role, isPrimaryOwner }} />
            </SidebarContent>
          </Sidebar>

          <SidebarInset>
            <main className="flex-1 p-4 md:p-6">
              <Outlet />
            </main>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
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
    throw redirect({ to: mustChangePassword ? "/change-password" : homePathFor(role) });
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

// Route guards (UX; the server stays the authority): every screen below is
// wrapped in `guarded(area, ...)`, which renders an in-shell "You don't have
// access to this area." page for anyone who may not use it -- no flash of the
// screen, no working-looking buttons that then fail with 403. Areas live in
// lib/access.ts: "staff" (Home, Assets, Reports), "work" (POs, Receive, Add,
// Move, Serial Pending, Print Labels), "people" (ADMIN), "settings"
// (head-office admin), "self" (My Assets for self-service logins).

export const dashboardRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/dashboard",
  component: guarded("staff", DashboardRoute),
});

/** Search params of the Assets list:
 * `status` -- a status filter (Home's "N under repair" rows link here);
 * `mine` -- start with the "Mine" filter on (/my-assets sends staff here);
 * `q` -- start with this search text; `find` -- put the cursor in the search
 * box (Home's "Find Asset"). */
export interface AssetsSearch {
  status?: string;
  mine?: boolean;
  q?: string;
  find?: boolean;
}

const truthyParam = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

function validateAssetsSearch(search: Record<string, unknown>): AssetsSearch {
  return {
    status: typeof search.status === "string" ? search.status : undefined,
    mine: truthyParam(search.mine) ? true : undefined,
    q: typeof search.q === "string" && search.q !== "" ? search.q : undefined,
    find: truthyParam(search.find) ? true : undefined,
  };
}

export const assetsIndexRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/assets",
  validateSearch: validateAssetsSearch,
  component: guarded("staff", function AssetsIndexComponent() {
    const search = assetsIndexRoute.useSearch();
    return <AssetsIndexRoute search={search} />;
  }),
});

export const assetsNewRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/assets/new",
  component: guarded("work", NewAssetRoute),
});

export const serialPendingRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/serial-pending",
  component: guarded("work", SerialPendingRoute),
});

// Asset 360 stays open to everyone the server allows (a self-service login
// opening its own asset from a QR label included): not guarded here.
export const assetDetailRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/assets/$id",
  component: function AssetDetailComponent() {
    const { id } = assetDetailRoute.useParams();
    return <AssetDetailRoute params={{ id }} />;
  },
});

export const assetMovementRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/asset-movement",
  component: guarded("work", AssetMovementRoute),
});

export const printLabelsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/print-labels",
  // `assets`: comma-separated asset ids to start the queue with (a delivery's new assets).
  validateSearch: (search: Record<string, unknown>): { assets?: string } => ({
    assets: typeof search.assets === "string" && search.assets !== "" ? search.assets : undefined,
  }),
  component: guarded("work", function PrintLabelsComponent() {
    const { assets } = printLabelsRoute.useSearch();
    return <PrintLabelsRoute assets={assets} />;
  }),
});

export const receiveRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/receive",
  component: guarded("work", ReceiveRoute),
});

// Dispatch is now part of Move / Dispatch (one screen); the old address keeps working.
export const dispatchRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/dispatch",
  beforeLoad: () => {
    throw redirect({ to: "/asset-movement" });
  },
});

export const purchaseOrdersIndexRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/purchase-orders",
  component: guarded("work", PurchaseOrdersIndexRoute),
});

export const purchaseOrdersNewRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/purchase-orders/new",
  component: guarded("work", NewPurchaseOrderRoute),
});

export const purchaseOrdersFromErpRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/purchase-orders/from-erp",
  component: guarded("work", PoFromErpRoute),
});

export const purchaseOrderDetailRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/purchase-orders/$id",
  component: guarded("work", function PurchaseOrderDetailComponent() {
    const { id } = purchaseOrderDetailRoute.useParams();
    return <PurchaseOrderDetailRoute params={{ id }} />;
  }),
});

// My Assets is the self-service login's own page. Staff have no separate
// "My Assets": they are sent to Assets with the "Mine" filter on.
export const myAssetsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/my-assets",
  beforeLoad: () => {
    if (canUse("staff", currentAccess())) {
      throw redirect({ to: "/assets", search: { mine: true } });
    }
  },
  component: guarded("self", MyAssetsRoute),
});

export const importRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/import",
  component: guarded("settings", ImportRoute),
});

export const reportsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/reports",
  component: guarded("staff", ReportsRoute),
});

// People & Places: the one asset-user table shown as four natural lists.
export const peopleEmployeesRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/people/employees",
  component: guarded("people", EmployeesRoute),
});

export const peopleStoresRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/people/stores",
  component: guarded("people", StoresRoute),
});

export const peopleStockRoomsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/people/stock-rooms",
  component: guarded("people", StockRoomsRoute),
});

export const peopleInstallPointsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/people/install-points",
  component: guarded("people", InstallPointsRoute),
});

// Settings (head-office admin). The /setup/* addresses are unchanged; only the
// menu around them moved.
export const setupCompaniesRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/companies",
  component: guarded("settings", CompaniesSetup),
});

export const setupLocationsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/locations",
  component: guarded("settings", LocationsSetup),
});

export const setupDepartmentsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/departments",
  component: guarded("settings", DepartmentsSetup),
});

export const setupCostCentersRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/cost-centers",
  component: guarded("settings", CostCentersSetup),
});

export const setupCategoriesRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/categories",
  component: guarded("settings", CategoriesSetup),
});

export const setupSubcategoriesRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/subcategories",
  component: guarded("settings", SubcategoriesSetup),
});

export const setupVendorsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/vendors",
  component: guarded("settings", VendorsSetup),
});

export const setupBrandsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/brands",
  component: guarded("settings", BrandsSetup),
});

export const setupBundlesRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/bundles",
  component: guarded("settings", BundlesSetup),
});

export const setupItemsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/items",
  component: guarded("settings", ItemsSetup),
});

export const setupErpArticlesRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/erp-articles",
  component: guarded("settings", ErpArticlesSetup),
});

export const setupCustomFieldsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/custom-fields",
  component: guarded("settings", CustomFieldsSetup),
});

// The old Asset Users address now opens People & Places > Employees.
export const setupAssetUsersRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/asset-users",
  beforeLoad: () => {
    throw redirect({ to: "/people/employees" });
  },
});

export const setupCodeRuleRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/setup/code-rule",
  component: guarded("settings", CodeRuleSetup),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  changePasswordRoute,
  authedLayoutRoute.addChildren([
    dashboardRoute,
    assetsIndexRoute,
    assetsNewRoute,
    serialPendingRoute,
    assetDetailRoute,
    assetMovementRoute,
    printLabelsRoute,
    receiveRoute,
    dispatchRoute,
    purchaseOrdersIndexRoute,
    purchaseOrdersNewRoute,
    purchaseOrdersFromErpRoute,
    purchaseOrderDetailRoute,
    myAssetsRoute,
    importRoute,
    reportsRoute,
    peopleEmployeesRoute,
    peopleStoresRoute,
    peopleStockRoomsRoute,
    peopleInstallPointsRoute,
    setupCompaniesRoute,
    setupLocationsRoute,
    setupDepartmentsRoute,
    setupCostCentersRoute,
    setupCategoriesRoute,
    setupSubcategoriesRoute,
    setupVendorsRoute,
    setupBrandsRoute,
    setupBundlesRoute,
    setupItemsRoute,
    setupErpArticlesRoute,
    setupCustomFieldsRoute,
    setupAssetUsersRoute,
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
