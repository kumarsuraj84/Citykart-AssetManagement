/**
 * What a scan field sends to the asset list. A barcode scan (or a typed serial / asset code)
 * is searched as text. The QR on an asset label is a link that opens the asset in CKAM
 * (`.../assets/123`), so a 2D scanner reading it hands over that link: it is turned into a
 * lookup of that one asset instead of a text search that could never match it.
 */
export function assetScanQuery(value: string, extra = ""): string {
  const trimmed = value.trim();
  const link = /\/assets\/(\d+)(?:[/?#].*)?$/.exec(trimmed);
  if (link) return `ids=${link[1]}&limit=5${extra}`;
  return `q=${encodeURIComponent(trimmed)}&limit=5${extra}`;
}

/** True when a scanned value is a CKAM asset link (the label's QR) rather than a code. */
export function isAssetLink(value: string): boolean {
  return /\/assets\/\d+(?:[/?#].*)?$/.test(value.trim());
}
