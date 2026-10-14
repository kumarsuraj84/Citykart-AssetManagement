/**
 * S8: copy text to the clipboard. The Clipboard API only exists on https / localhost -- CKAM runs on
 * plain http inside the office network, so the old `execCommand("copy")` path is the usual one there.
 * Resolves to false when neither works (the caller then shows the text selected, to copy by hand).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof window !== "undefined" && window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the old way
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
    area.remove();
    return !!ok;
  } catch {
    return false;
  }
}

/** Selects all the text inside an element (the fallback: the person presses Ctrl+C). */
export function selectContents(el: Element | null): void {
  if (!el) return;
  try {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      el.focus();
      el.select();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    // nothing more to do
  }
}
