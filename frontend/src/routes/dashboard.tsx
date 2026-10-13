import { Dashboard } from "../features/dashboard/Dashboard";
import { ErpInboxHomeRow } from "../features/erp/ErpInboxHomeRow";
import { SetupHomeRow } from "../features/settings/SetupHomeRow";

export default function DashboardRoute() {
  // The head-office admin's own Home rows (each renders nothing for anyone else):
  // the ERP decisions waiting first (daily), then the one-time set-up reminder.
  return (
    <Dashboard
      headOfficeSection={
        <>
          <ErpInboxHomeRow />
          <SetupHomeRow />
        </>
      }
    />
  );
}
