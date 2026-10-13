/**
 * "You have not saved this yet" (S7 fix P2-12): a form with typed work warns
 * before the page is left -- a reload or a closed tab (the browser's own
 * beforeunload question) and a move to another screen inside the app (one
 * plain confirm). Nothing is asked once the form is clean, or after it was
 * saved (`release()` is called right before navigating away on success).
 */
import { useCallback, useEffect, useRef } from "react";
import { useBlocker } from "@tanstack/react-router";

export const LEAVE_WARNING = "What you typed here is not saved yet. Leave this page and lose it?";

export function useUnsavedChangesWarning(dirty: boolean): { release: () => void } {
  const dirtyRef = useRef(dirty);
  const released = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
    // Typing again after a release (a new form on the same screen) warns again.
    if (dirty) released.current = false;
  }, [dirty]);
  const blocking = useCallback(() => dirtyRef.current && !released.current, []);
  // Stable, so the router's blocker is registered once, not again on every keystroke.
  const shouldBlockFn = useCallback(() => {
    if (!blocking()) return false;
    // Only an explicit "Cancel" keeps the person here (a browser without a dialog never traps them).
    return typeof window.confirm === "function" && window.confirm(LEAVE_WARNING) === false;
  }, [blocking]);
  // Inside the app: one plain question before another screen opens.
  useBlocker({
    shouldBlockFn,
    // The page itself (reload, closed tab) is handled below, the same way for every kind of history.
    enableBeforeUnload: false,
  });
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!blocking()) return;
      e.preventDefault();
      // Older browsers need a returnValue to show their own question.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [blocking]);
  const release = useCallback(() => {
    released.current = true;
  }, []);
  return { release };
}
