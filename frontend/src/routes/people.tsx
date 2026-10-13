import { PeopleScreen } from "../features/people/PeopleScreen";

// People & Places: one backend table, four natural lists (S5b-2: GET /api/people?kind=…).

export function EmployeesRoute() {
  return <PeopleScreen kind="employees" />;
}

export function StoresRoute() {
  return <PeopleScreen kind="stores" />;
}

export function StockRoomsRoute() {
  return <PeopleScreen kind="stock-rooms" />;
}

export function InstallPointsRoute() {
  return <PeopleScreen kind="install-points" />;
}
