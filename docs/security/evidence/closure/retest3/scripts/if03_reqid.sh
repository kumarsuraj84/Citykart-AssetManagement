#!/bin/sh
# CL3 IF-03: X-Request-ID exactly once on nginx-served + API responses; never taken from the client.
# Against the live ckam-sec nginx front (http://localhost:3411). Read-only GETs + one oversize POST (413).
BASE=http://localhost:3411
TMP=$(mktemp -d)
big="$TMP/big.bin"; head -c 12000000 /dev/zero > "$big"

probe() {  # label method path [extra curl args...]
  label="$1"; method="$2"; path="$3"; shift 3
  hdr="$TMP/h"; code=$(curl -s -o /dev/null -D "$hdr" -X "$method" "$@" "$BASE$path" -w '%{http_code}')
  n=$(grep -ci '^x-request-id:' "$hdr")
  val=$(grep -i '^x-request-id:' "$hdr" | head -1 | sed 's/^[Xx]-[Rr]equest-[Ii][Dd]: *//' | tr -d '\r')
  printf '%-26s %-6s %-34s HTTP=%s  x-request-id count=%s  value=%s\n' "$label" "$method" "$path" "$code" "$n" "$val"
}

echo "===== nginx-served responses (expect exactly ONE server-generated X-Request-ID) ====="
probe "static-index"    GET /index.html
probe "spa-route"       GET /assets/123
probe "static-404-js"   GET /assets/nope-00000000.js
probe "static-404-css"  GET /assets/nope-00000000.css
probe "map-404"         GET /assets/app-x.js.map
probe "root-spa-fallbk" GET /totally/unknown/route
echo
echo "===== 413 oversize upload (nginx @too_large JSON) ====="
probe "oversize-413"    POST /api/auth/login -H 'Content-Type: application/octet-stream' --data-binary @"$big"
echo
echo "===== API responses via nginx /api/ (app id passed through, once) ====="
probe "api-health"      GET /api/health
probe "api-404"         GET /api/does-not-exist
echo
echo "===== client tries to CHOOSE the id (value returned must be server-generated/sanitised, never echoed) ====="
probe "client-id-static" GET /index.html       -H 'X-Request-ID: attacker-1'
probe "client-id-api"    GET /api/health        -H 'X-Request-ID: attacker-1'
probe "client-id-api404" GET /api/does-not-exist -H 'X-Request-ID: attacker-oops'
probe "client-id-long"   GET /api/health        -H "X-Request-ID: $(printf 'A%.0s' $(seq 1 500))"
probe "client-id-odd"    GET /api/health        -H 'X-Request-ID: ../../etc/passwd <script> %0d%0a injected'
echo
echo "(full raw headers of the client-id-api case:)"
curl -s -o /dev/null -D - -H 'X-Request-ID: attacker-1' "$BASE/api/health" | grep -iE '^HTTP|^x-request-id|^cache-control'
rm -rf "$TMP"
