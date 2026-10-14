import { describe, it, expect } from "vitest";
import {
  AUDIT_ACTIONS, AUDIT_CATEGORIES, AUDIT_ENTITIES, REPORT_KINDS, auditActionLabel, auditCategoryLabel, auditOutcomeLabel,
  entityLabel, errorKindLabel, logLevelLabel, reportKindLabel, reportStatusLabel, systemComponentLabel, systemEventLabel,
} from "./labels";

const RAW = /^[A-Z0-9_]+$|_/;

describe("S8 plain words for the Logs (the one labels module)", () => {
  it("categories", () => {
    expect(AUDIT_CATEGORIES.map(auditCategoryLabel)).toEqual([
      "Data change", "Security", "Access", "Import", "Export", "ERP", "Asset movement", "System",
    ]);
    expect(auditCategoryLabel("data")).toBe("Data change");
  });

  it("outcomes", () => {
    expect(["OK", "DENIED", "FAILED"].map(auditOutcomeLabel)).toEqual(["Done", "Refused", "Failed"]);
  });

  it("common actions, and an unknown action as its raw value capitalised", () => {
    expect(auditActionLabel("CREATE")).toBe("Created");
    expect(auditActionLabel("UPDATE")).toBe("Changed");
    expect(auditActionLabel("DEACTIVATE")).toBe("Deactivated");
    expect(auditActionLabel("LOGIN")).toBe("Signed in");
    expect(auditActionLabel("LOGIN_FAILED")).toBe("Failed sign-in");
    expect(auditActionLabel("LOCKED")).toBe("Account locked");
    expect(auditActionLabel("PASSWORD_RESET")).toBe("Password reset");
    expect(auditActionLabel("PERMISSION_DENIED")).toBe("Refused");
    expect(auditActionLabel("EXPORT")).toBe("Exported");
    expect(auditActionLabel("IMPORT_COMMIT")).toBe("Imported");
    expect(auditActionLabel("RECEIVE")).toBe("Received");
    expect(auditActionLabel("BATCH_ADD")).toBe("Assets added");
    expect(auditActionLabel("MOVE")).toBe("Moved");
    expect(auditActionLabel("LINK")).toBe("Linked");
    expect(auditActionLabel("SOME_NEW_THING")).toBe("Some new thing");
    expect(auditActionLabel(null)).toBe("");
  });

  it("no listed code is ever shown raw", () => {
    for (const a of AUDIT_ACTIONS) expect(auditActionLabel(a)).not.toMatch(RAW);
    for (const e of AUDIT_ENTITIES) expect(entityLabel(e)).not.toMatch(RAW);
    for (const k of REPORT_KINDS) expect(reportKindLabel(k)).not.toMatch(RAW);
  });

  it("record types, levels, error kinds, system parts, report kinds and statuses", () => {
    expect(entityLabel("asset_user")).toBe("Person / place");
    expect(entityLabel("purchase_order")).toBe("Purchase order");
    expect(entityLabel("new_table")).toBe("New table");
    expect(logLevelLabel("WARNING")).toBe("Warning");
    expect(errorKindLabel("slow_sql")).toBe("Slow database query");
    expect(systemComponentLabel("erp_sync")).toBe("ERP data copy");
    expect(systemEventLabel("connectivity_lost")).toBe("Database unreachable");
    expect(reportKindLabel("API_ERROR")).toBe("Failed request");
    expect(reportStatusLabel("REVIEWED")).toBe("Reviewed");
  });
});
