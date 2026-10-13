import { useEffect, useState } from "react";

// Same key the Move screen has always used, so a PC that prints labels keeps its choice.
const PREFS_KEY = "ckam.movement.prefs";

export interface ScanLabelPrefs {
  /** Print each asset's label the moment it is scanned (default on). */
  autoPrint: boolean;
  /** Ask for each stuck-on label to be scanned back before the move (default off). */
  verify: boolean;
  setAutoPrint: (on: boolean) => void;
  setVerify: (on: boolean) => void;
}

function load(): { autoPrint: boolean; verify: boolean } {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null") as { autoPrint?: boolean; verify?: boolean } | null;
    return { autoPrint: raw?.autoPrint !== false, verify: raw?.verify === true };
  } catch {
    return { autoPrint: true, verify: false };
  }
}

/** Print-as-I-scan and confirm-by-scan, remembered in this browser (best effort). */
export function useScanLabelPrefs(): ScanLabelPrefs {
  const [prefs, setPrefs] = useState(load);
  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // best effort
    }
  }, [prefs]);
  return {
    ...prefs,
    setAutoPrint: (on) => setPrefs((p) => ({ ...p, autoPrint: on })),
    setVerify: (on) => setPrefs((p) => ({ ...p, verify: on })),
  };
}
