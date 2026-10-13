import { describe, it, expect } from "vitest";
import {
  holderDisplayName,
  sameText,
  ASSET_STATUSES,
  PLACE_TYPES,
  PO_STATUSES,
  ROLES,
  eventLabel,
  fieldLabel,
  humanizeCode,
  placeTypeLabel,
  placeTypePlural,
  poStatusLabel,
  poUnitStatusLabel,
  roleLabel,
  serialModeLabel,
  statusLabel,
  statusOptions,
  workAreaLabel,
} from "./labels";

const RAW = /[A-Z]{2,}_[A-Z]+|\bSELF_SERVICE\b|\bNON_IT\b/;

describe("labels: the one place codes become words", () => {
  it("statuses use the owner's words; ALLOTTED is exact when the holder type is known", () => {
    expect(ASSET_STATUSES.map((s) => statusLabel(s))).toEqual([
      "In Stock", "With Employee / Store", "Installed", "Under Repair", "Lost", "Sold", "Scrapped", "Disposed",
    ]);
    expect(statusLabel("ALLOTTED", "EMPLOYEE")).toBe("With Employee");
    expect(statusLabel("ALLOTTED", "STORE")).toBe("With Store");
    expect(statusLabel("ALLOTTED", "STOCK_POINT")).toBe("With Employee / Store");
    expect(statusLabel("IN_STOCK", "EMPLOYEE")).toBe("In Stock");
  });

  it("status options keep the backend value and show the word", () => {
    const opts = statusOptions();
    expect(opts.map((o) => o.value)).toEqual([...ASSET_STATUSES]);
    for (const o of opts) expect(o.label).not.toMatch(RAW);
  });

  it("people and places: Employee, Store, Stock Room, Install Point -- never STOCK_POINT", () => {
    expect(PLACE_TYPES.map(placeTypeLabel)).toEqual(["Employee", "Store", "Stock Room", "Install Point"]);
    expect(PLACE_TYPES.map(placeTypePlural)).toEqual(["Employees", "Stores", "Stock Rooms", "Install Points"]);
  });

  it("roles in plain words; the Primary Owner is the Head-office Admin", () => {
    expect(ROLES.map((r) => roleLabel(r))).toEqual(["Full Admin", "Can Add & Move Assets", "View Only", "Own Assets Only"]);
    expect(roleLabel("ADMIN", true)).toBe("Head-office Admin");
  });

  it("work area: IT Team, Admin / Non-IT Team, Both", () => {
    expect(workAreaLabel("IT")).toBe("IT Team");
    expect(workAreaLabel("NON_IT")).toBe("Admin / Non-IT Team");
    expect(workAreaLabel("BOTH")).toBe("Both");
  });

  it("audited field names read as labels; custom fields use their own label", () => {
    expect(fieldLabel("serial_number")).toBe("Serial number");
    expect(fieldLabel("pi_number")).toBe("Purchase Invoice (PI) number");
    expect(fieldLabel("custom_fields.ticket_no", { ticket_no: "Helpdesk Ticket No" })).toBe("Helpdesk Ticket No");
    expect(fieldLabel("custom_fields.other_key")).toBe("Other key");
    expect(fieldLabel("some_new_field")).toBe("Some new field");
  });

  it("unknown codes fall back to sentence case, never raw upper-case-with-underscores", () => {
    expect(humanizeCode("SOME_FUTURE_STATUS")).toBe("Some future status");
    expect(statusLabel("SOME_FUTURE_STATUS")).toBe("Some future status");
    expect(placeTypeLabel("NEW_KIND")).toBe("New kind");
    expect(roleLabel("AUDITOR")).toBe("Auditor");
    expect(eventLabel("SENT_FOR_REPAIR")).toBe("Sent for repair");
    expect(eventLabel("SOMETHING_ELSE")).toBe("Something else");
  });

  it("S2: purchase-order statuses, unit statuses and serial modes in plain words", () => {
    expect(PO_STATUSES.map(poStatusLabel)).toEqual(["Waiting", "Partly Received", "Received", "Cancelled"]);
    expect(["PENDING", "DELIVERED", "CANCELLED"].map(poUnitStatusLabel)).toEqual(["Waiting", "Received", "Cancelled"]);
    expect(["HAS_SERIAL", "NO_SERIAL", "SERIAL_LATER"].map(serialModeLabel)).toEqual([
      "Has serial number", "No serial number", "Serial will be entered later",
    ]);
    expect(poStatusLabel("ON_HOLD")).toBe("On hold");
    expect(poStatusLabel(null)).toBe("");
  });
});

describe("S7 P3-4: holder names and repeated texts", () => {
  it("drops the old auto-made 'Stock Point - ' in front of a name, nothing else", () => {
    expect(holderDisplayName("Stock Point - WH Stores Farukhnagar")).toBe("WH Stores Farukhnagar");
    expect(holderDisplayName("stock point – HO")).toBe("HO");
    expect(holderDisplayName("Ankur Pahwa")).toBe("Ankur Pahwa");
    expect(holderDisplayName(null)).toBe("");
  });

  it("sameText ignores case and outer spaces", () => {
    expect(sameText(" Gondola Rack", "gondola rack ")).toBe(true);
    expect(sameText("Gondola Rack 4ft", "Gondola Rack")).toBe(false);
    expect(sameText(null, "x")).toBe(false);
  });
});
