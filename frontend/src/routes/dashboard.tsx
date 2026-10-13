import { Dashboard } from "../features/dashboard/Dashboard";
import { SetupHomeRow } from "../features/settings/SetupHomeRow";

export default function DashboardRoute() {
  // The head-office admin's own Home rows (renders nothing for anyone else).
  return <Dashboard headOfficeSection={<SetupHomeRow />} />;
}
