// Client-side mirror of backend/app/lifecycle/state_machine.py::_ALLOWED_EVENTS (Task 14).
// This only controls which action BUTTONS the UI offers -- a UX/convenience layer. The
// backend's state_machine.transition() remains the real authority and re-validates every
// event server-side (returning 422 via LifecycleError for anything illegal). Keep this file
// in sync with _ALLOWED_EVENTS whenever that dict changes.
//
// PROCURED and IMPORTED are intentionally omitted here: they are not user-initiated button
// actions on this screen -- they're the very first event created by the Add Asset flow
// (Task 17), before any Asset Detail page exists to click a button on.

export interface ActionDef {
  label: string;
  eventType: string;
  needsHolder: boolean;
}

const RULES: Record<string, ActionDef[]> = {
  IN_STOCK: [
    { label: "Move / Allot", eventType: "MOVED", needsHolder: true },
    { label: "Send for Repair", eventType: "SENT_FOR_REPAIR", needsHolder: false },
    { label: "Dispose", eventType: "DISPOSED", needsHolder: false },
    { label: "Sell", eventType: "SOLD", needsHolder: false },
    { label: "Scrap", eventType: "SCRAPPED", needsHolder: false },
    { label: "Report Lost", eventType: "LOST", needsHolder: false },
  ],
  ALLOTTED: [
    { label: "Move / Transfer", eventType: "MOVED", needsHolder: true },
    { label: "Send for Repair", eventType: "SENT_FOR_REPAIR", needsHolder: false },
    { label: "Report Lost", eventType: "LOST", needsHolder: false },
  ],
  INSTALLED: [
    { label: "Move", eventType: "MOVED", needsHolder: true },
    { label: "Send for Repair", eventType: "SENT_FOR_REPAIR", needsHolder: false },
    { label: "Report Lost", eventType: "LOST", needsHolder: false },
  ],
  UNDER_REPAIR: [
    { label: "Receive from Repair", eventType: "RECEIVED_FROM_REPAIR", needsHolder: true },
    { label: "Scrap", eventType: "SCRAPPED", needsHolder: false },
  ],
  LOST: [{ label: "Mark Found", eventType: "FOUND", needsHolder: true }],
  DISPOSED: [],
  SOLD: [],
  SCRAPPED: [],
};

export function actionsFor(status: string): ActionDef[] {
  return RULES[status] ?? [];
}
