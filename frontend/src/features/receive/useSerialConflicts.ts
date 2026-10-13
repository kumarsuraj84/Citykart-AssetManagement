import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { MASKED_ASSET } from "../purchase-orders/serial-conflict";

/** The most serials one check-serials request takes (server limit). */
const MAX_CHECK = 2000;

/** One conflict of POST /purchase-orders/check-serials (S6: `masked` = an asset the caller cannot see). */
export interface SerialConflict {
  serial: string;
  asset_code: string;
  masked?: boolean;
}

/** serial (lower case) -> who uses it: the asset's code, or MASKED_ASSET when the server hides it. */
export function conflictMap(list: SerialConflict[]): Record<string, string> {
  return Object.fromEntries(list.map((c) => [c.serial.toLowerCase(), c.masked === true ? MASKED_ASSET : c.asset_code]));
}

/**
 * Advisory, debounced: which of these serials CKAM already has
 * (POST /purchase-orders/check-serials), as lower-case serial -> asset code, or
 * "an asset you cannot see" when the server says the asset is `masked` (outside
 * the caller's companies or work area). The save itself re-checks everything,
 * so a failed lookup means "no information" and is never shown as an error.
 */
export function useSerialConflicts(serials: string[], enabled = true, delayMs = 400): Record<string, string> {
  const [conflicts, setConflicts] = useState<Record<string, string>>({});
  const key = serials.join("\n");
  useEffect(() => {
    if (!enabled || serials.length === 0) {
      setConflicts((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      Promise.resolve()
        .then(() =>
          apiClient.post<{ conflicts?: SerialConflict[] }>("/purchase-orders/check-serials", { serials: serials.slice(0, MAX_CHECK) }),
        )
        .then((r) => {
          if (cancelled) return;
          setConflicts(conflictMap(Array.isArray(r?.conflicts) ? r.conflicts : []));
        })
        .catch(() => {
          if (!cancelled) setConflicts({});
        });
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, delayMs]);
  return conflicts;
}
