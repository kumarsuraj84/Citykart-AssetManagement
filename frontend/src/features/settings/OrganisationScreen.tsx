import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/PageHeader";
import CompaniesSetup from "../../routes/setup/companies";
import LocationsSetup from "../../routes/setup/locations";
import CostCentersSetup from "../../routes/setup/cost-centers";
import DepartmentsSetup from "../../routes/setup/departments";

export const ORGANISATION_TABS = [
  { value: "companies", label: "Companies" },
  { value: "places", label: "Places" },
  { value: "cost-centres", label: "Cost Centres" },
  { value: "departments", label: "Departments" },
] as const;

export type OrganisationTab = (typeof ORGANISATION_TABS)[number]["value"];

export function isOrganisationTab(v: unknown): v is OrganisationTab {
  return ORGANISATION_TABS.some((t) => t.value === v);
}

/**
 * Settings › Organisation: Companies, Places, Cost Centres and Departments on one screen, one tab each.
 * Each tab is the same screen as before (its own Add, Edit, Deactivate and Import / Export).
 * The tab is part of the address (?tab=places), so old links and Back land on the right one.
 */
export function OrganisationScreen({ tab, onTabChange }: { tab: OrganisationTab; onTabChange: (t: OrganisationTab) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Organisation"
        description="The companies whose assets CKAM keeps, their Places (offices, warehouses, stores), Cost Centres and Departments."
      />
      <Tabs value={tab} onValueChange={(v) => isOrganisationTab(v) && onTabChange(v)} className="flex flex-col gap-3">
        <TabsList className="h-auto w-fit max-w-full flex-wrap justify-start">
          {ORGANISATION_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="companies"><CompaniesSetup embedded /></TabsContent>
        <TabsContent value="places"><LocationsSetup embedded /></TabsContent>
        <TabsContent value="cost-centres"><CostCentersSetup embedded /></TabsContent>
        <TabsContent value="departments"><DepartmentsSetup embedded /></TabsContent>
      </Tabs>
    </div>
  );
}
