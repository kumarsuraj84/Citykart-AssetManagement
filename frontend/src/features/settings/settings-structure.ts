/**
 * The ONE description of the Settings area (head-office admin only): the
 * sidebar's Settings group and the Settings landing page are both built from
 * this list, so they can never disagree.
 *
 * Every old /setup/* address still works (router.tsx redirects it to the
 * matching entry here; /setup/bundles still opens the Bundles screen).
 */

export interface SettingsLink {
  to: string;
  label: string;
  /** One line: what it is (shown on the landing page). */
  line: string;
  /** Other paths that also light this entry up in the sidebar. */
  activePrefixes?: string[];
}

export interface SettingsSection {
  label: string;
  /** One line about the whole group (landing page). */
  line: string;
  links: SettingsLink[];
}

export const SETTINGS_HOME = "/settings";
export const SETUP_WIZARD_PATH = "/settings/setup";

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    label: "Organisation",
    line: "The companies and where they work.",
    links: [
      {
        to: "/settings/organisation",
        label: "Organisation",
        line: "Companies, Places, Cost Centres and Departments, one tab each.",
      },
    ],
  },
  {
    label: "Catalogue",
    line: "What CKAM tracks and how it is described.",
    links: [
      {
        to: "/settings/catalogue/items",
        label: "Items",
        line: "What an asset is: its type, serial number rule and whether it comes as a set.",
        activePrefixes: ["/setup/bundles"],
      },
      {
        to: "/settings/catalogue/link-assets",
        label: "Link Assets to Items",
        line: "Give older assets their Item, from suggestions; nothing changes until you confirm.",
      },
      { to: "/settings/catalogue/asset-groups", label: "Asset Groups", line: "Groups and their Sub-categories, each group with its work area." },
      { to: "/settings/catalogue/brands", label: "Brands", line: "Makers, offered as an Item's default brand." },
    ],
  },
  {
    label: "Vendors",
    line: "Who we buy from.",
    links: [{ to: "/settings/vendors", label: "Vendors", line: "Suppliers, added by hand or from the ERP." }],
  },
  {
    label: "Users & Access",
    line: "People and places that hold assets, and who can sign in.",
    links: [
      {
        to: "/settings/users-access",
        label: "Users & Access",
        line: "Employees, Stores, Stock Rooms and Install Points, with their logins and work areas.",
      },
    ],
  },
  {
    label: "ERP",
    line: "The read-only link to the ERP.",
    links: [
      {
        to: "/settings/erp/inbox",
        label: "ERP Inbox",
        line: "New items, vendors and stores from the ERP, each decided once and remembered.",
      },
      {
        to: "/settings/erp/mapping",
        label: "ERP Mapping",
        line: "Advanced mapping rules for the rare cases: which ERP codes are which Item, and what CKAM does not track.",
      },
      { to: "/settings/erp/sync", label: "ERP Data Sync", line: "When the ERP data was last copied, and refresh it now." },
    ],
  },
  {
    label: "Advanced",
    line: "Set once; rarely changed.",
    links: [
      { to: "/settings/advanced/custom-fields", label: "Custom Fields", line: "Extra fields on every asset." },
      { to: "/settings/advanced/code-format", label: "Asset Code Format", line: "How new asset codes are built, with a live example." },
      { to: "/settings/advanced/import", label: "Bulk Import", line: "Add or update many assets, POs or moves from Excel." },
    ],
  },
];

/** A path that belongs to Settings (opens the sidebar's Settings group on arrival). */
export function isSettingsPath(pathname: string): boolean {
  return (
    pathname === SETTINGS_HOME ||
    pathname.startsWith(`${SETTINGS_HOME}/`) ||
    pathname.startsWith("/setup/") ||
    pathname === "/import"
  );
}

/** Whether a Settings link is the current page (or a page inside it). */
export function isSettingsLinkActive(link: Pick<SettingsLink, "to" | "activePrefixes">, pathname: string): boolean {
  if (pathname === link.to || pathname.startsWith(`${link.to}/`)) return true;
  return (link.activePrefixes ?? []).some((p) => pathname.startsWith(p));
}
