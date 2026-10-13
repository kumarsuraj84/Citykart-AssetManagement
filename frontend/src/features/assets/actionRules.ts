// The ONE place the frontend decides which lifecycle choices an asset can take.
//
// Client-side mirror of backend/app/lifecycle/state_machine.py (_ALLOWED_EVENTS, the
// FOUND rules). This only decides which CHOICES the UI offers -- a UX layer. The
// backend's state_machine.transition() remains the authority and re-validates every
// event server-side (a plain-sentence 422 for anything illegal). Keep this file in sync
// with _ALLOWED_EVENTS whenever that dict changes.
//
// Both Asset 360 (its action menu) and the Move screen (its choice list) read
// `choicesFor` / `choiceAvailability` below; neither keeps its own list.
//
// PROCURED and IMPORTED are intentionally omitted: they are the first event the Add
// Asset / Receive / Import flows create, never a choice on an existing asset.

const ALLOWED_EVENTS: Record<string, string[]> = {
  IN_STOCK: ["MOVED", "SENT_FOR_REPAIR", "DISPOSED", "SOLD", "SCRAPPED", "LOST"],
  ALLOTTED: ["MOVED", "SENT_FOR_REPAIR", "LOST"],
  INSTALLED: ["MOVED", "SENT_FOR_REPAIR", "LOST"],
  UNDER_REPAIR: ["RECEIVED_FROM_REPAIR", "SCRAPPED"],
  LOST: ["FOUND"],
  DISPOSED: [],
  SOLD: [],
  SCRAPPED: [],
};

/** The event types the server accepts from this status (empty for a final status). */
export function allowedEvents(status: string | null | undefined): string[] {
  return (status && ALLOWED_EVENTS[status]) || [];
}

/**
 * The kind of person or place a choice sends the asset to (backend asset_user_type),
 * "ANY" for a return from repair (back to a person, store, stock room or install point),
 * or null when the choice sends it nowhere.
 */
export type DestinationKind = "EMPLOYEE" | "STOCK_POINT" | "STORE" | "INSTALLED" | "ANY";

export interface MoveChoice {
  /** Stable key, used in the URL (/asset-movement?choice=store). */
  key: string;
  /** The plain words on the button. */
  label: string;
  /** The event the server records (payload value, never shown). */
  eventType: string;
  destination: DestinationKind | null;
  /** The words for the destination picker. */
  destinationLabel?: string;
  /** "3 assets <doneWord>" after Apply. */
  doneWord: string;
  /** Only an admin may record it (server: "Only an admin can mark a lost asset as found."). */
  adminOnly?: boolean;
}

export const MOVE_CHOICES: MoveChoice[] = [
  { key: "employee", label: "Give to Employee", eventType: "MOVED", destination: "EMPLOYEE", destinationLabel: "Employee", doneWord: "given to the employee" },
  { key: "stock-room", label: "Return to Stock Room", eventType: "MOVED", destination: "STOCK_POINT", destinationLabel: "Stock Room", doneWord: "returned to the stock room" },
  { key: "store", label: "Send to Store", eventType: "MOVED", destination: "STORE", destinationLabel: "Store", doneWord: "sent to the store" },
  { key: "install", label: "Install", eventType: "MOVED", destination: "INSTALLED", destinationLabel: "Install Point", doneWord: "installed" },
  { key: "repair", label: "Send for Repair", eventType: "SENT_FOR_REPAIR", destination: null, doneWord: "sent for repair" },
  { key: "from-repair", label: "Receive from Repair", eventType: "RECEIVED_FROM_REPAIR", destination: "ANY", destinationLabel: "Received into", doneWord: "received back from repair" },
  { key: "lost", label: "Report Lost", eventType: "LOST", destination: null, doneWord: "reported lost" },
  // The server sends a found asset back to a stock room only.
  { key: "found", label: "Mark Found", eventType: "FOUND", destination: "STOCK_POINT", destinationLabel: "Stock Room", doneWord: "marked found", adminOnly: true },
  { key: "sell", label: "Sell", eventType: "SOLD", destination: null, doneWord: "sold" },
  { key: "scrap", label: "Scrap", eventType: "SCRAPPED", destination: null, doneWord: "scrapped" },
  { key: "dispose", label: "Dispose", eventType: "DISPOSED", destination: null, doneWord: "disposed" },
];

export function moveChoice(key: string | null | undefined): MoveChoice | undefined {
  return key ? MOVE_CHOICES.find((c) => c.key === key) : undefined;
}

/** True when the server accepts this choice for an asset in this status. */
export function isChoiceAllowed(choice: MoveChoice, status: string | null | undefined): boolean {
  return allowedEvents(status).includes(choice.eventType);
}

/** The choices an asset in this status can take (admin-only ones only for an admin). */
export function choicesFor(status: string | null | undefined, opts: { isAdmin?: boolean } = {}): MoveChoice[] {
  return MOVE_CHOICES.filter((c) => isChoiceAllowed(c, status) && (!c.adminOnly || opts.isAdmin === true));
}

export interface ChoiceState {
  choice: MoveChoice;
  enabled: boolean;
  /** Why it is off, in a few words (shown as the button's title). */
  reason?: string;
}

/**
 * Which choices can apply to a batch: a choice is on only when it is valid for every
 * asset's status (an empty batch: every choice is on). Admin-only choices are off for
 * everyone else.
 */
export function choiceAvailability(statuses: string[], opts: { isAdmin?: boolean } = {}): ChoiceState[] {
  return MOVE_CHOICES.map((choice) => {
    if (choice.adminOnly && opts.isAdmin !== true) {
      return { choice, enabled: false, reason: "Only an admin can do this." };
    }
    const blocked = statuses.filter((s) => !isChoiceAllowed(choice, s));
    if (blocked.length === 0) return { choice, enabled: true };
    return { choice, enabled: false, reason: "Not possible for every asset in this batch." };
  });
}
