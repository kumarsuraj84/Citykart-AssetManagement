import { useEffect, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  Boxes,
  ChevronRight,
  ClipboardList,
  Home,
  ListChecks,
  PackageCheck,
  ScanBarcode,
  BarChart3,
  Settings,
  UserRound,
  Store,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { canUse, type AccessState } from "@/lib/access";

export interface NavLinkDef {
  to: string;
  label: string;
  icon?: LucideIcon;
  /** Other paths that also light this entry up (e.g. Assets for /assets/123). */
  activePrefixes?: string[];
}

export interface NavSection {
  /** Small heading above the section; none for single top-level entries. */
  label?: string;
  links: NavLinkDef[];
}

export interface SettingsGroup {
  label: string;
  links: NavLinkDef[];
}

const HOME: NavLinkDef = { to: "/dashboard", label: "Home", icon: Home };
const MY_ASSETS: NavLinkDef = { to: "/my-assets", label: "My Assets", icon: Boxes };
const REPORTS: NavLinkDef = { to: "/reports", label: "Reports", icon: BarChart3 };

const ASSETS: NavLinkDef = {
  to: "/assets", label: "Assets", icon: ListChecks,
  activePrefixes: ["/assets/", "/serial-pending", "/print-labels"],
};
const PURCHASE_ORDERS: NavLinkDef = {
  to: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList, activePrefixes: ["/purchase-orders/"],
};
const RECEIVE: NavLinkDef = { to: "/receive", label: "Receive", icon: PackageCheck };
const MOVE: NavLinkDef = { to: "/asset-movement", label: "Move", icon: ScanBarcode };

export const PEOPLE_LINKS: NavLinkDef[] = [
  { to: "/people/employees", label: "Employees", icon: UserRound },
  { to: "/people/stores", label: "Stores", icon: Store },
  { to: "/people/stock-rooms", label: "Stock Rooms", icon: Warehouse },
  { to: "/people/install-points", label: "Install Points", icon: Wrench },
];

/** Settings: one collapsed group for the head-office admin. Only regroups the
 * existing screens -- every /setup/* address keeps working. */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "Organisation",
    links: [
      { to: "/setup/companies", label: "Companies" },
      { to: "/setup/locations", label: "Places" },
      { to: "/setup/cost-centers", label: "Cost Centres" },
      { to: "/setup/departments", label: "Departments" },
    ],
  },
  {
    label: "Catalogue",
    links: [
      { to: "/setup/items", label: "Items" },
      // Asset Groups = Categories; Sub-categories sit beside it until a later
      // stage merges the two screens into one nested "Asset Groups" screen.
      { to: "/setup/categories", label: "Asset Groups" },
      { to: "/setup/subcategories", label: "Sub-categories" },
      { to: "/setup/brands", label: "Brands" },
      { to: "/setup/bundles", label: "Bundles" },
    ],
  },
  { label: "Vendors", links: [{ to: "/setup/vendors", label: "Vendors" }] },
  { label: "Users & Access", links: [{ to: "/people/employees", label: "People & Logins" }] },
  { label: "ERP", links: [{ to: "/setup/erp-articles", label: "ERP Mapping" }] },
  {
    label: "Advanced",
    links: [
      { to: "/setup/custom-fields", label: "Custom Fields" },
      { to: "/setup/code-rule", label: "Asset Code Format" },
      { to: "/import", label: "Bulk Import" },
    ],
  },
];

/** A path that belongs to Settings (opens the Settings group on arrival). */
export function isSettingsPath(pathname: string): boolean {
  return pathname.startsWith("/setup/") || pathname === "/import";
}

/** The main (non-Settings) sidebar sections a person sees, in order. */
export function navSectionsFor(s: AccessState): NavSection[] {
  if (canUse("self", s)) return [{ links: [MY_ASSETS] }];
  const sections: NavSection[] = [];
  if (canUse("staff", s)) sections.push({ links: [HOME] });
  const work: NavLinkDef[] = [];
  if (canUse("staff", s)) work.push(ASSETS);
  if (canUse("work", s)) work.push(PURCHASE_ORDERS, RECEIVE, MOVE);
  if (work.length > 0) sections.push({ label: "Work", links: work });
  if (canUse("people", s)) sections.push({ label: "People & Places", links: PEOPLE_LINKS });
  if (canUse("staff", s)) sections.push({ links: [REPORTS] });
  return sections;
}

function isActive(link: NavLinkDef, pathname: string): boolean {
  if (pathname === link.to) return true;
  return (link.activePrefixes ?? []).some((p) => pathname.startsWith(p));
}

function SidebarNavItem({ link }: { link: NavLinkDef }) {
  const { pathname } = useLocation();
  const Icon = link.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive(link, pathname)} tooltip={link.label}>
        <Link to={link.to}>
          {Icon && <Icon className="h-4 w-4" />}
          <span>{link.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SettingsNav() {
  const { pathname } = useLocation();
  const { state, isMobile } = useSidebar();
  const inSettings = isSettingsPath(pathname);
  // Starts collapsed unless the current page is one of its screens.
  const [open, setOpen] = useState(inSettings);
  useEffect(() => {
    if (inSettings) setOpen(true);
  }, [inSettings]);

  // In the icon-only rail the sub-list cannot show, so the icon opens the
  // first Settings screen instead of toggling an invisible list.
  if (state === "collapsed" && !isMobile) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={inSettings} tooltip="Settings">
          <Link to="/setup/companies">
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={inSettings && !open} tooltip="Settings">
            <Settings className="h-4 w-4" />
            <span>Settings</span>
            <ChevronRight
              className={`ml-auto h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
              aria-hidden="true"
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub aria-label="Settings">
            {SETTINGS_GROUPS.map((g) => (
              <SettingsGroupItems key={g.label} group={g} pathname={pathname} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function SettingsGroupItems({ group, pathname }: { group: SettingsGroup; pathname: string }) {
  // A one-entry group named like its entry (Vendors) needs no heading of its own.
  const showHeading = !(group.links.length === 1 && group.links[0].label === group.label);
  return (
    <>
      {showHeading && (
        <SidebarMenuSubItem
          role="presentation"
          className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/60"
        >
          {group.label}
        </SidebarMenuSubItem>
      )}
      {group.links.map((l) => (
        <SidebarMenuSubItem key={`${group.label}-${l.to}`}>
          <SidebarMenuSubButton asChild size="sm" isActive={pathname === l.to}>
            <Link to={l.to}>
              <span>{l.label}</span>
            </Link>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
    </>
  );
}

/** The role-aware sidebar navigation. */
export function AppNav({ access }: { access: AccessState }) {
  const sections = navSectionsFor(access);
  return (
    <nav aria-label="Main">
      {sections.map((section, i) => (
        <SidebarGroup key={section.label ?? `section-${i}`}>
          {section.label && <SidebarGroupLabel>{section.label}</SidebarGroupLabel>}
          <SidebarMenu>
            {section.links.map((l) => (
              <SidebarNavItem key={l.to} link={l} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
      {canUse("settings", access) && (
        <SidebarGroup>
          <SidebarMenu>
            <SettingsNav />
          </SidebarMenu>
        </SidebarGroup>
      )}
    </nav>
  );
}
