import {
  Link,
  Outlet,
  type RouterHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import {
  LayoutDashboard,
  Boxes,
  ListChecks,
  PackagePlus,
  ClipboardList,
  ScanBarcode,
  Printer,
  Upload,
  BarChart3,
  Building2,
  MapPin,
  Users2,
  Wallet,
  Tag,
  Tags,
  Truck,
  SlidersHorizontal,
  UserCog,
  Hash,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
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
import AssetMovementRoute from "./routes/asset-movement";
import PrintLabelsRoute from "./routes/print-labels";
import PurchaseOrdersIndexRoute from "./routes/purchase-orders/index";
import NewPurchaseOrderRoute from "./routes/purchase-orders/new";
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
import CustomFieldsSetup from "./routes/setup/custom-fields";
import HoldersSetup from "./routes/setup/holders";
import CodeRuleSetup from "./routes/setup/code-rule";

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
const MASTER_SETUP_LINKS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/setup/companies", label: "Companies", icon: Building2 },
  { to: "/setup/locations", label: "Locations", icon: MapPin },
  { to: "/setup/departments", label: "Departments", icon: Users2 },
  { to: "/setup/cost-centers", label: "Cost Centers", icon: Wallet },
  { to: "/setup/categories", label: "Categories", icon: Tag },
  { to: "/setup/subcategories", label: "Sub-Categories", icon: Tags },
  { to: "/setup/vendors", label: "Vendors", icon: Truck },
  { to: "/setup/custom-fields", label: "Custom Fields", icon: SlidersHorizontal },
];
const ADMIN_SETUP_LINKS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/setup/holders", label: "Holders & Users", icon: UserCog },
  { to: "/setup/code-rule", label: "Code Rule", icon: Hash },
];

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

function SidebarNavItem({ to, label, icon: Icon }: { to: string; label: string; icon?: LucideIcon }) {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <Link to={to}>
          {Icon && <Icon className="h-4 w-4" />}
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AppShell() {
  const role = useAuthStore((s) => s.role);
  const navigate = useNavigate();
  const canWrite = role !== null && WRITE_ROLES.includes(role);
  const canReport = role !== null && REPORT_ROLES.includes(role);

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
              <nav aria-label="Main">
                <SidebarGroup>
                  <SidebarMenu>
                    {canReport && <SidebarNavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} />}
                    <SidebarNavItem to="/my-assets" label="My Assets" icon={Boxes} />
                  </SidebarMenu>
                </SidebarGroup>

                {canReport && (
                  <SidebarGroup>
                    <SidebarGroupLabel>Assets</SidebarGroupLabel>
                    <SidebarMenu>
                      <SidebarNavItem to="/assets" label="Asset Register" icon={ListChecks} />
                      {canWrite && <SidebarNavItem to="/assets/new" label="Add Asset" icon={PackagePlus} />}
                      {canWrite && <SidebarNavItem to="/asset-movement" label="Asset Movement" icon={ScanBarcode} />}
                      {canWrite && <SidebarNavItem to="/print-labels" label="Print Labels" icon={Printer} />}
                      {canWrite && <SidebarNavItem to="/purchase-orders" label="Purchase Orders" icon={ClipboardList} />}
                      {canWrite && <SidebarNavItem to="/import" label="Import" icon={Upload} />}
                      <SidebarNavItem to="/reports" label="Reports" icon={BarChart3} />
                    </SidebarMenu>
                  </SidebarGroup>
                )}

                {canWrite && (
                  <SidebarGroup>
                    <SidebarGroupLabel>Masters</SidebarGroupLabel>
                    <SidebarMenu>
                      {MASTER_SETUP_LINKS.map((l) => (
                        <SidebarNavItem key={l.to} to={l.to} label={l.label} icon={l.icon} />
                      ))}
                    </SidebarMenu>
                  </SidebarGroup>
                )}

                {role === "ADMIN" && (
                  <SidebarGroup>
                    <SidebarGroupLabel>Administration</SidebarGroupLabel>
                    <SidebarMenu>
                      {ADMIN_SETUP_LINKS.map((l) => (
                        <SidebarNavItem key={l.to} to={l.to} label={l.label} icon={l.icon} />
                      ))}
                    </SidebarMenu>
                  </SidebarGroup>
                )}
              </nav>
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

/** `?status=<ASSET_STATUS>`: lets the Dashboard's exception summary (AM-12)
 * link straight into a pre-filtered register instead of a dead, decorative
 * count -- e.g. "Repair" -> `/assets?status=UNDER_REPAIR`. */
interface AssetsSearch {
  status?: string;
}

function validateAssetsSearch(search: Record<string, unknown>): AssetsSearch {
  return { status: typeof search.status === "string" ? search.status : undefined };
}

export const assetsIndexRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/assets",
  validateSearch: validateAssetsSearch,
  component: function AssetsIndexComponent() {
    const { status } = assetsIndexRoute.useSearch();
    return <AssetsIndexRoute search={{ status }} />;
  },
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

export const assetMovementRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/asset-movement",
  component: AssetMovementRoute,
});

export const printLabelsRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/print-labels",
  component: PrintLabelsRoute,
});

export const purchaseOrdersIndexRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/purchase-orders",
  component: PurchaseOrdersIndexRoute,
});

export const purchaseOrdersNewRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/purchase-orders/new",
  component: NewPurchaseOrderRoute,
});

export const purchaseOrderDetailRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/purchase-orders/$id",
  component: function PurchaseOrderDetailComponent() {
    const { id } = purchaseOrderDetailRoute.useParams();
    return <PurchaseOrderDetailRoute params={{ id }} />;
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
    assetMovementRoute,
    printLabelsRoute,
    purchaseOrdersIndexRoute,
    purchaseOrdersNewRoute,
    purchaseOrderDetailRoute,
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
