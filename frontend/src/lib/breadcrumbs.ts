/**
 * S8: the last things a person did, in memory only, sent with a problem report so the head-office admin
 * can see how the person got there. NEVER what anyone typed: a click is named by the button's / link's
 * accessible name, a field never by its value, a keyboard shortcut by its keys only.
 *
 * Kinds: nav (route change), click, dialog (a dialog opened), api (method + path template + status +
 * request id), key (a shortcut such as Ctrl+K or Escape), error.
 */

export type BreadcrumbType = "nav" | "click" | "dialog" | "api" | "key" | "error";

export interface Breadcrumb {
  at: string;
  type: BreadcrumbType;
  /** One readable line ("Clicked “Save”", "Opened /assets/12", "GET /assets/{id} → 500"). */
  text: string;
  requestId?: string | null;
  status?: number;
}

const MAX = 50;
const crumbs: Breadcrumb[] = [];

export function addBreadcrumb(type: BreadcrumbType, text: string, extra: Partial<Breadcrumb> = {}): void {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 160);
  if (!clean) return;
  crumbs.push({ at: new Date().toISOString(), type, text: clean, ...extra });
  if (crumbs.length > MAX) crumbs.splice(0, crumbs.length - MAX);
}

/** The last `n`, oldest first. */
export function getBreadcrumbs(n = 30): Breadcrumb[] {
  return crumbs.slice(-n).map((c) => ({ ...c }));
}

export function clearBreadcrumbs(): void {
  crumbs.length = 0;
}

// ---------------------------------------------------------------------------
// Accessible names (never values)
// ---------------------------------------------------------------------------

const CLICKABLE = [
  "button", "a[href]", "summary", "[role=button]", "[role=link]", "[role=menuitem]", "[role=tab]",
  "[role=checkbox]", "[role=switch]", "[role=radio]", "input[type=checkbox]", "input[type=radio]",
  "input[type=button]", "input[type=submit]",
].join(",");

function textOf(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The accessible name of a clickable element: aria-label, aria-labelledby, its <label>, its text, its title. */
export function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => textOf(el.ownerDocument.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }
  if (el instanceof HTMLInputElement) {
    // A checkbox / radio / button input: its label, never its value (except a button's caption).
    const label = el.labels && el.labels.length > 0 ? textOf(el.labels[0]) : "";
    if (label) return label;
    if (el.type === "button" || el.type === "submit") return el.value;
    return el.name || el.type;
  }
  const text = textOf(el);
  if (text) return text;
  return el.getAttribute("title") ?? "";
}

function clickLabel(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  // A click inside a text field is not recorded at all (it says nothing and is next to typed text).
  if (target.closest("input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=true]")) {
    return null;
  }
  const el = target.closest(CLICKABLE);
  if (!el) return null;
  const name = accessibleName(el).slice(0, 80);
  return name || null;
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock"]);

/** "Ctrl+K", "Escape", or null for an ordinary key press (which may be typing). */
export function shortcutLabel(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string | null {
  if (!e.key || MODIFIER_KEYS.has(e.key)) return null;
  const mods = [e.ctrlKey && "Ctrl", e.metaKey && "Meta", e.altKey && "Alt"].filter(Boolean) as string[];
  if (mods.length === 0) return e.key === "Escape" ? "Escape" : null;
  if (e.shiftKey) mods.push("Shift");
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [...mods, key].join("+");
}

function dialogTitle(el: Element): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const t = textOf(el.ownerDocument.getElementById(labelledBy));
    if (t) return t;
  }
  return el.getAttribute("aria-label") ?? "";
}

let installed: (() => void) | null = null;

/** Starts recording clicks, shortcuts and dialog opens (main.tsx); returns the stop function. */
export function installBreadcrumbListeners(doc: Document = document): () => void {
  if (installed) return installed;
  const onClick = (e: Event) => {
    const label = clickLabel(e.target);
    if (label) addBreadcrumb("click", `Clicked “${label}”`);
  };
  const onKey = (e: KeyboardEvent) => {
    const label = shortcutLabel(e);
    if (label) addBreadcrumb("key", `Pressed ${label}`);
  };
  doc.addEventListener("click", onClick, true);
  doc.addEventListener("keydown", onKey, true);
  const seenDialogs = new WeakSet<Element>();
  let observer: MutationObserver | null = null;
  if (typeof MutationObserver === "function" && doc.body) {
    observer = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          const dialogs = [
            ...(node.matches("[role=dialog],[role=alertdialog]") ? [node] : []),
            ...Array.from(node.querySelectorAll("[role=dialog],[role=alertdialog]")),
          ];
          for (const d of dialogs) {
            if (seenDialogs.has(d)) continue;
            seenDialogs.add(d);
            // The title is rendered with the dialog; read it once the frame settles.
            setTimeout(() => {
              const title = dialogTitle(d);
              addBreadcrumb("dialog", title ? `Opened the dialog “${title}”` : "Opened a dialog");
            }, 0);
          }
        });
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  }
  installed = () => {
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("keydown", onKey, true);
    observer?.disconnect();
    installed = null;
  };
  return installed;
}
