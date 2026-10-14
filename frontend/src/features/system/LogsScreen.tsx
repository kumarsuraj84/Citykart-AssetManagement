import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/PageHeader";
import { cleanReference, requestPath } from "./logs-api";
import { AuditTab } from "./AuditTab";
import { ErrorsTab } from "./ErrorsTab";
import { SystemTab } from "./SystemTab";
import { ReportsTab } from "./ReportsTab";

export const LOGS_PATH = "/settings/system/logs";
export const DIAGNOSTICS_PATH = "/settings/system/diagnostics";

export const LOG_TABS = ["audit", "errors", "security", "system", "reports"] as const;
export type LogTab = (typeof LOG_TABS)[number];

export function isLogTab(v: unknown): v is LogTab {
  return typeof v === "string" && (LOG_TABS as readonly string[]).includes(v);
}

const TAB_LABELS: Record<LogTab, string> = {
  audit: "Audit trail",
  errors: "Errors",
  security: "Security",
  system: "System events",
  reports: "User reports",
};

/** The box at the top: paste a reference (request id or a problem report's reference) -> everything for it. */
export function ReferenceSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  function go() {
    const id = cleanReference(text);
    if (!id) {
      setProblem("Paste the reference exactly as the person saw it: letters, digits, dots, dashes or underscores.");
      return;
    }
    setProblem(null);
    void navigate({ to: requestPath(id) as never });
  }
  return (
    <form
      role="search"
      aria-label="Find a reference"
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Reference to find"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a reference from an error or a problem report"
          className="h-9 max-w-md font-mono text-sm"
        />
        <Button type="submit" size="sm" className="gap-1.5">
          <Search className="h-4 w-4" aria-hidden="true" />
          Find everything
        </Button>
      </div>
      {problem && <p className="text-xs text-destructive" role="alert">{problem}</p>}
    </form>
  );
}

/** Settings › System › Logs (head-office admin): audit trail, errors, security, system events, user reports. */
export function LogsScreen({ tab, onTabChange }: { tab: LogTab; onTabChange: (t: LogTab) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Logs"
        description="Who changed what, what went wrong and what people reported. Paste a reference to see everything about one request."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={DIAGNOSTICS_PATH}>Diagnostics</Link>
          </Button>
        }
      />
      <ReferenceSearch />
      <Tabs value={tab} onValueChange={(v) => isLogTab(v) && onTabChange(v)}>
        <TabsList className="flex h-auto flex-wrap justify-start">
          {LOG_TABS.map((t) => (
            <TabsTrigger key={t} value={t}>{TAB_LABELS[t]}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="audit" className="mt-3">{tab === "audit" && <AuditTab />}</TabsContent>
        <TabsContent value="errors" className="mt-3">{tab === "errors" && <ErrorsTab />}</TabsContent>
        <TabsContent value="security" className="mt-3">{tab === "security" && <AuditTab mode="security" />}</TabsContent>
        <TabsContent value="system" className="mt-3">{tab === "system" && <SystemTab />}</TabsContent>
        <TabsContent value="reports" className="mt-3">{tab === "reports" && <ReportsTab />}</TabsContent>
      </Tabs>
    </div>
  );
}
