/**
 * Smart defaults (S3b-1): the Cost Centre and the "Received Into" stock room a
 * person used last, per person and per company, so the next Add Asset / New
 * Purchase Order / ERP review / Receive starts with them already chosen.
 *
 * Kept in this browser only (localStorage). A convenience, never a rule: a
 * remembered choice is used only when it is still in the list the screen
 * loaded, and silently forgotten otherwise. Every read and write is guarded,
 * so private windows or blocked storage simply mean "nothing remembered".
 */
import { useEffect, useRef } from "react";
import { useMyAssetUserId } from "./auth-store";

export type RememberedKind = "cost_centre" | "stock_room";

const PREFIX = "ckam:last-used";

function storageKey(userId: number, companyId: number | string): string {
  return `${PREFIX}:${userId}:${companyId}`;
}

function readAll(userId: number, companyId: number | string): Partial<Record<RememberedKind, string>> {
  try {
    const raw = window.localStorage.getItem(storageKey(userId, companyId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Partial<Record<RememberedKind, string>>) : {};
  } catch {
    return {};
  }
}

/** The id remembered for this person, company and kind, or null. */
export function readRemembered(userId: number | null, companyId: number | string | null | undefined, kind: RememberedKind): string | null {
  if (userId == null || companyId == null || companyId === "") return null;
  const v = readAll(userId, companyId)[kind];
  return typeof v === "string" && v !== "" ? v : null;
}

/** Remembers the id chosen (call it after the task was saved). */
export function remember(userId: number | null, companyId: number | string | null | undefined, kind: RememberedKind, id: string | number | null | undefined): void {
  if (userId == null || companyId == null || companyId === "" || id == null || id === "") return;
  try {
    const next = { ...readAll(userId, companyId), [kind]: String(id) };
    window.localStorage.setItem(storageKey(userId, companyId), JSON.stringify(next));
  } catch {
    // storage blocked or full: just do not remember
  }
}

/** A remember function bound to the signed-in person. */
export function useRemember(): (companyId: number | string | null | undefined, kind: RememberedKind, id: string | number | null | undefined) => void {
  const userId = useMyAssetUserId();
  return (companyId, kind, id) => remember(userId, companyId, kind, id);
}

/**
 * Picks the remembered value once the screen's list for this company has
 * loaded, when nothing is chosen yet and the remembered record is still in the
 * list -- or, for a Cost Centre, the only one the company has. Applied once per
 * company (choosing something else is never undone).
 */
export function useRememberedDefault({
  kind, companyId, value, setValue, validIds, ready,
}: {
  kind: RememberedKind;
  companyId: number | string | null | undefined;
  value: string;
  setValue: (id: string) => void;
  /** The ids in the list the screen loaded for this company. */
  validIds: (string | number)[];
  /** The list has loaded. */
  ready: boolean;
}): void {
  const userId = useMyAssetUserId();
  const appliedFor = useRef<string | null>(null);
  const company = companyId == null ? "" : String(companyId);
  const ids = validIds.map(String).join(",");
  useEffect(() => {
    if (!ready || company === "" || appliedFor.current === company) return;
    appliedFor.current = company;
    if (value !== "") return;
    const listed = ids === "" ? [] : ids.split(",");
    const remembered = readRemembered(userId, company, kind);
    if (remembered && listed.includes(remembered)) setValue(remembered);
    // S7 (P3-13): a company with exactly one Cost Centre has it chosen already.
    else if (kind === "cost_centre" && listed.length === 1) setValue(listed[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, company, ids, userId, kind]);
}
