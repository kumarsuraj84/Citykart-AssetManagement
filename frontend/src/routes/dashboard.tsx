import { Dashboard } from "../features/dashboard/Dashboard";
import { ErpInboxHomeRow } from "../features/erp/ErpInboxHomeRow";
import { SetupHomeRow } from "../features/settings/SetupHomeRow";
import { LogsHomeRow } from "../features/system/LogsHomeRow";

export default function DashboardRoute() {
  // The head-office admin's own Home rows (each renders nothing for anyone else):
  // the ERP decisions waiting first (daily; counts from Home's one call), then errors / user reports
  // of the last 24 hours (S8), then the one-time set-up reminder.
  return (
    <Dashboard
      headOfficeSection={({ inbox }) => (
        <>
          <ErpInboxHomeRow counts={inbox} />
          <LogsHomeRow />
          <SetupHomeRow />
        </>
      )}
    />
  );
}
