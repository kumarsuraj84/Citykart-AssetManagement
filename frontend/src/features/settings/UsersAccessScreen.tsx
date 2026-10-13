import { Link } from "@tanstack/react-router";
import { Store, UserRound, Warehouse, Wrench, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";

const ENTRIES: { to: string; label: string; line: string; icon: LucideIcon }[] = [
  { to: "/people/employees", label: "Employees", line: "People who hold assets; give one a login, a role and a work area.", icon: UserRound },
  { to: "/people/stores", label: "Stores", line: "Stores (from the ERP or by hand), with an optional store login.", icon: Store },
  { to: "/people/stock-rooms", label: "Stock Rooms", line: "Where new goods are received and kept (HO stock, warehouse).", icon: Warehouse },
  { to: "/people/install-points", label: "Install Points", line: "Where things get installed (a store's AC, a camera point).", icon: Wrench },
];

/** Settings › Users & Access: the way into the four People & Places lists, where logins and roles are set. */
export function UsersAccessScreen() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Users & Access"
        description="Everyone and everywhere that can hold an asset, and who can sign in. Logins, roles (Full Admin, Can Add & Move Assets, View Only, Own Assets Only) and companies are set on each Employee or Store."
      />
      <ul aria-label="People & Places lists" className="grid gap-3 sm:grid-cols-2">
        {ENTRIES.map((e) => (
          <li key={e.to} className="flex items-start gap-3 rounded-md border bg-card p-3">
            <e.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="flex flex-col">
              <Link to={e.to} className="text-sm font-medium text-primary underline-offset-2 hover:underline">{e.label}</Link>
              <p className="text-xs text-muted-foreground">{e.line}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
