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
  needsAssetUser: boolean;
}

const RULES: Record<string, ActionDef[]> = {
  IN_STOCK: [
    { label: "Move / Allot", eventType: "MOVED", needsAssetUser: true },
    { label: "Send for Repair", eventType: "SENT_FOR_REPAIR", needsAssetUser: false },
    { label: "Dispose", eventType: "DISPOSED", needsAssetUser: false },
    { label: "Sell", eventType: "SOLD", needsAssetUser: false },
    { label: "Scrap", eventType: "SCRAPPED", needsAssetUser: false },
    { label: "Report Lost", eventType: "LOST", needsAssetUser: false },
  ],
  ALLOTTED: [
    { label: "Move / Transfer", eventType: "MOVED", needsAssetUser: true },
    { label: "Send for Repair", eventType: "SENT_FOR_REPAIR", needsAssetUser: false },
    { label: "Report Lost", eventType: "LOST", needsAssetUser: false },
  ],
  INSTALLED: [
    { label: "Move", eventType: "MOVED", needsAssetUser: true },
    { label: "Send for Repair", eventType: "SENT_FOR_REPAIR", needsAssetUser: false },
    { label: "Report Lost", eventType: "LOST", needsAssetUser: false },
  ],
  UNDER_REPAIR: [
    { label: "Receive from Repair", eventType: "RECEIVED_FROM_REPAIR", needsAssetUser: true },
    { label: "Scrap", eventType: "SCRAPPED", needsAssetUser: false },
  ],
  LOST: [{ label: "Mark Found", eventType: "FOUND", needsAssetUser: true }],
  DISPOSED: [],
  SOLD: [],
  SCRAPPED: [],
};

export function actionsFor(status: string): ActionDef[] {
  return RULES[status] ?? [];
}
