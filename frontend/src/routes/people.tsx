import { AssetUsersScreen } from "../features/asset-users/AssetUsersScreen";

// People & Places: one backend table (asset users), four natural lists.

export function EmployeesRoute() {
  return <AssetUsersScreen fixedType="EMPLOYEE" />;
}

export function StoresRoute() {
  return <AssetUsersScreen fixedType="STORE" />;
}

export function StockRoomsRoute() {
  return <AssetUsersScreen fixedType="STOCK_POINT" />;
}

export function InstallPointsRoute() {
  return <AssetUsersScreen fixedType="INSTALLED" />;
}
