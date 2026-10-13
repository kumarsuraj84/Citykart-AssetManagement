import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";

/** The most serials one check-serials request takes (server limit). */
const MAX_CHECK = 2000;

/**
 * Advisory, debounced: which of these serials CKAM already has
 * (POST /purchase-orders/check-serials), as lower-case serial -> asset code
 * (or the server's masked "an asset outside your companies or work area").
 * The save itself re-checks everything, so a failed lookup means "no
 * information" and is never shown as an error.
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
          apiClient.post<{ conflicts?: { serial: string; asset_code: string }[] }>("/purchase-orders/check-serials", { serials: serials.slice(0, MAX_CHECK) }),
        )
        .then((r) => {
          if (cancelled) return;
          const list = Array.isArray(r?.conflicts) ? r.conflicts : [];
          setConflicts(Object.fromEntries(list.map((c) => [c.serial.toLowerCase(), c.asset_code])));
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
