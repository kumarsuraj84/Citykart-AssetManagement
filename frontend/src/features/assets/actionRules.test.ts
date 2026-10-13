import { describe, it, expect } from "vitest";
import {
  MOVE_CHOICES, allowedEvents, choiceAvailability, choicesFor, isChoiceAllowed, isEndState, moveChoice, unavailableSentence,
} from "./actionRules";

const labels = (status: string, isAdmin = true) => choicesFor(status, { isAdmin }).map((c) => c.label);

describe("allowedEvents (mirror of the server's state machine)", () => {
  it("lists what each status may do, and nothing for a final status", () => {
    expect(allowedEvents("IN_STOCK")).toEqual(["MOVED", "SENT_FOR_REPAIR", "DISPOSED", "SOLD", "SCRAPPED", "LOST"]);
    expect(allowedEvents("UNDER_REPAIR")).toEqual(["RECEIVED_FROM_REPAIR", "SCRAPPED"]);
    expect(allowedEvents("LOST")).toEqual(["FOUND"]);
    for (const s of ["DISPOSED", "SOLD", "SCRAPPED", "SOMETHING_NEW", ""]) expect(allowedEvents(s)).toEqual([]);
  });
});

describe("the plain-word choices", () => {
  it("are the eleven the owner asked for, each mapped to an existing event and destination kind", () => {
    expect(MOVE_CHOICES.map((c) => [c.label, c.eventType, c.destination])).toEqual([
      ["Give to Employee", "MOVED", "EMPLOYEE"],
      ["Move to Stock Room", "MOVED", "STOCK_POINT"],
      ["Send to Store", "MOVED", "STORE"],
      ["Install", "MOVED", "INSTALLED"],
      ["Send for Repair", "SENT_FOR_REPAIR", null],
      ["Receive from Repair", "RECEIVED_FROM_REPAIR", "ANY"],
      ["Report Lost", "LOST", null],
      ["Mark Found", "FOUND", "STOCK_POINT"],
      ["Sell", "SOLD", null],
      ["Scrap", "SCRAPPED", null],
      ["Dispose", "DISPOSED", null],
    ]);
  });

  it("never use a raw code, 'Holder' or 'Asset User' in what people read", () => {
    for (const c of MOVE_CHOICES) {
      for (const text of [c.label, c.destinationLabel ?? "", c.doneWord]) {
        expect(text).not.toMatch(/[A-Z]{2,}_|holder|asset user/i);
      }
    }
  });

  it("an asset in stock can go anywhere, be repaired, reported lost or leave; not 'receive from repair'", () => {
    expect(labels("IN_STOCK")).toEqual([
      "Give to Employee", "Move to Stock Room", "Send to Store", "Install", "Send for Repair", "Report Lost", "Sell", "Scrap", "Dispose",
    ]);
  });

  it("an asset with someone can be moved on, repaired or reported lost -- not sold or scrapped", () => {
    expect(labels("ALLOTTED")).toEqual(["Give to Employee", "Move to Stock Room", "Send to Store", "Install", "Send for Repair", "Report Lost"]);
    expect(labels("INSTALLED")).toEqual(labels("ALLOTTED"));
  });

  it("under repair: receive back or scrap; lost: mark found (admin only); final: nothing", () => {
    expect(labels("UNDER_REPAIR")).toEqual(["Receive from Repair", "Scrap"]);
    expect(labels("LOST", true)).toEqual(["Mark Found"]);
    expect(labels("LOST", false)).toEqual([]);
    expect(labels("SOLD")).toEqual([]);
  });

  it("moveChoice finds a choice by its URL key", () => {
    expect(moveChoice("store")?.label).toBe("Send to Store");
    expect(moveChoice("nope")).toBeUndefined();
    expect(moveChoice(undefined)).toBeUndefined();
    expect(isChoiceAllowed(moveChoice("from-repair")!, "UNDER_REPAIR")).toBe(true);
  });
});

describe("choiceAvailability (a batch)", () => {
  const on = (statuses: string[], isAdmin = false) =>
    choiceAvailability(statuses, { isAdmin }).filter((s) => s.enabled).map((s) => s.choice.key);

  it("an empty batch: everything except the admin-only choice is on", () => {
    expect(on([])).toEqual(MOVE_CHOICES.filter((c) => !c.adminOnly).map((c) => c.key));
    expect(on([], true)).toEqual(MOVE_CHOICES.map((c) => c.key));
  });

  it("a mixed batch: only what is possible for every asset", () => {
    expect(on(["IN_STOCK", "ALLOTTED"])).toEqual(["employee", "stock-room", "store", "install", "repair", "lost"]);
    expect(on(["IN_STOCK", "UNDER_REPAIR"])).toEqual(["scrap"]);
    expect(on(["ALLOTTED", "UNDER_REPAIR"])).toEqual([]);
  });

  it("says why a choice is off", () => {
    const states = choiceAvailability(["UNDER_REPAIR"], { isAdmin: false });
    expect(states.find((s) => s.choice.key === "found")?.reason).toMatch(/only an admin/i);
    expect(states.find((s) => s.choice.key === "store")?.reason).toMatch(/not possible for every asset/i);
  });

  it("S7 P2-8: Sell, Scrap and Dispose are end states; nothing else is", () => {
    expect(MOVE_CHOICES.filter(isEndState).map((c) => c.key)).toEqual(["sell", "scrap", "dispose"]);
    expect(isEndState(undefined)).toBe(false);
  });

  it("S7 P3-5: the reasons choices are off, as one visible sentence", () => {
    expect(unavailableSentence(choiceAvailability([], { isAdmin: true }))).toBeNull();
    expect(unavailableSentence(choiceAvailability([], { isAdmin: false }))).toBe("Not possible now: Mark Found (only an admin can do this).");
    expect(unavailableSentence(choiceAvailability(["LOST"], { isAdmin: true }))).toMatch(/^Not possible now: Give to Employee, Move to Stock Room, .* \(not possible for every asset in this batch\)\.$/);
  });
});
