import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useAccess } from "../../lib/access";

/**
 * Shown at the top of every screen for staff when NO company is switched on: without one, purchase orders, assets and
 * receiving cannot be added, and the company lists would simply be empty with no word of why. The head-office admin is
 * pointed to where a company is switched back on (or added); everyone else is told to ask them. Not shown inside
 * Settings (the admin is already there fixing it). Reads the same company list every screen uses (one cached request).
 */
export function NoCompanyBanner() {
  const { can } = useAccess();
  const { pathname } = useLocation();
  const staff = can("staff");
  const q = useQuery({
    queryKey: ["masters", "companies"],
    queryFn: () => apiClient.get<unknown[]>("/masters/companies"),
    enabled: staff,
  });
  const inSettings = pathname === "/settings" || pathname.startsWith("/settings/") || pathname.startsWith("/setup");
  if (!staff || inSettings || !q.isSuccess || !Array.isArray(q.data) || q.data.length > 0) return null;
  return (
    <div
      role="note" aria-label="No company is switched on"
      className="mb-4 flex items-start gap-2 rounded-md border border-warning/50 bg-warning-soft px-3 py-2 text-sm text-on-warning-soft"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-medium">No company is switched on</span>, so purchase orders, assets and receiving cannot be added.{" "}
        {can("settings") ? (
          <>
            Switch one back on, or add one, under{" "}
            <Link to="/settings/organisation" search={{ tab: "companies" }} className="font-medium underline underline-offset-2">
              Settings › Organisation › Companies
            </Link>
            .
          </>
        ) : (
          "Ask the head-office admin to switch one on."
        )}
      </p>
    </div>
  );
}
